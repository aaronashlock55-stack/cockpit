import { axisKeys, backMix, bodyToWorld, footprintRadius, hydroModel, worldToBody } from '@/libs/rover-hydro'
import { type TetherWrap, applyTetherPhysics, tetherDeployedLength } from '@/libs/rover-tether'
import { type PracticeEnvironment, waterDensity } from '@/types/practice-environment'
import { type BodyAxes, type RoverProfile } from '@/types/rover-profile'

export { tetherDeployedLength } from '@/libs/rover-tether'

/**
 * ROV motion model for Practice mode: a profile-derived Fossen 6-DOF rigid-body
 * model (M ν̇ + D(ν) ν + g(η) = τ) — the same formulation used by marine
 * simulators like Stonefish and UNav-Sim.
 *
 * All coefficients are derived in rover-hydro.ts from the active rover profile
 * (mass, dimensions, thruster layout) and the water density, so a heavier or
 * bigger rover genuinely handles differently. Highlights:
 * - Thrust from per-thruster max force × the profile's mix weights; torques use
 *   each thruster's real moment arm from its mounted position.
 * - Full attitude kinematics: nose-down + forward genuinely drives you deeper.
 * - Environment: pool walls/floor, ice sheet with launch hole, obstacle and
 *   hoop (ring) collisions with clean-pass detection, tether (routed through
 *   the ice hole; drag grows with deployment; rigid length limit that also
 *   kills outward momentum when it snaps taut).
 * - Gripper: a claw at the nose that can grab small obstacles.
 *
 * Simplifications (deliberate): no Coriolis/centripetal coupling, Euler-rate ≈
 * body-rate for attitude, and pitch/roll are clamped at ~57° so a training
 * vehicle cannot capsize.
 */

/** Simulated vehicle state (SI units, radians). */
export interface SimState {
  /** Position along the pool length, meters. */
  x: number
  /** Position across the pool width, meters. */
  y: number
  /** Depth in meters, positive down. */
  depth: number
  /** Heading in radians, 0 = +x (north on the map), positive clockwise. */
  heading: number
  /** Roll in radians. */
  roll: number
  /** Pitch in radians, positive nose-up. */
  pitch: number
  /** Roll rate, rad/s. */
  rollRate: number
  /** Pitch rate, rad/s. */
  pitchRate: number
  /** Body-frame forward velocity, m/s. */
  surgeVel: number
  /** Body-frame rightward velocity, m/s. */
  swayVel: number
  /** Body-frame downward velocity, m/s. */
  heaveVel: number
  /** Yaw rate, rad/s. */
  yawRate: number
  /** Spooled per-thruster outputs [-1, 1] (lagging the commanded mix). */
  thrusterOutputs: number[]
  /** Achieved normalized force per axis [-1, 1], for UI display. */
  thrust: BodyAxes
  /** Which side of each ring (by id) the rover was last on, for pass detection. */
  ringSides: Record<string, number>
  /** Name of the hoop cleanly passed through on this step, if any. */
  justPassed?: string
  /** Points where the tether is currently snagged/bending around obstacles. */
  tetherWraps: TetherWrap[]
  /** Claw closure, 0 = open .. 1 = closed (animated toward the commanded state). */
  gripper: number
  /** Id of the obstacle currently held by the claw, if any. */
  heldObstacleId?: string
  /** Name of whatever the rover is currently in contact with, if anything. */
  collidedWith?: string
}

/** Optional per-step controls beyond the axis demand. */
export interface SimControls {
  /** Commanded claw state: true = close/grab, false = open/release. */
  gripperClosed?: boolean
}

const zeroAxes = (): BodyAxes => ({ surge: 0, sway: 0, heave: 0, yaw: 0, pitch: 0, roll: 0 })

/**
 * Initial state for a given environment: start just below the surface, at the
 * ice launch hole if there is one, else near the tether attach / pool corner.
 * @param {PracticeEnvironment} env The practice environment.
 * @returns {SimState} The initial state.
 */
export const initialSimState = (env: PracticeEnvironment): SimState => ({
  x: env.iceSheet ? env.iceSheet.holeCenter[0] : Math.min(3, env.pool.length / 2),
  y: env.iceSheet ? env.iceSheet.holeCenter[1] : env.pool.width / 2,
  depth: Math.min(0.5, env.pool.depth / 2),
  heading: 0,
  roll: 0,
  pitch: 0,
  rollRate: 0,
  pitchRate: 0,
  surgeVel: 0,
  swayVel: 0,
  heaveVel: 0,
  yawRate: 0,
  thrusterOutputs: [],
  thrust: zeroAxes(),
  ringSides: {},
  tetherWraps: [],
  gripper: 0,
})

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v))

/** Thruster spool time constant, seconds (T200-class response). */
const THRUST_TAU = 0.25
/** Tether drag: quadratic-drag multiplier growth per meter deployed. */
const TETHER_DRAG_PER_M = 0.05
/** Trainer max lean (rad) so the vehicle cannot capsize. */
const MAX_ANGLE = 1.0

/** Claw geometry/limits. */
const GRIPPER_REACH = 0.75 // meters from vehicle center to grab point
const GRIPPER_RADIUS = 0.45 // meters around the grab point that can be grabbed
const GRIPPER_MAX_SIZE = 0.45 // largest plan-view obstacle dimension the claw can hold
const GRIPPER_SPEED = 2.5 // closure units per second

/** A point in pool-local coordinates. */
export interface PoolPoint {
  /** Pool-local x, meters. */
  x: number
  /** Pool-local y, meters. */
  y: number
  /** Depth, meters. */
  depth: number
}

/**
 * The claw's grab point in pool coordinates (just ahead of the nose).
 * @param {SimState} state Current state.
 * @returns {PoolPoint} Grab point.
 */
export const gripperPoint = (state: SimState): PoolPoint => ({
  x: state.x + GRIPPER_REACH * Math.cos(state.heading),
  y: state.y + GRIPPER_REACH * Math.sin(state.heading),
  depth: state.depth + 0.1, // claw sits slightly below the camera line
})

/**
 * The tether's path from the surface attach point to the rover. Under an ice
 * sheet the tether can only enter the water through the launch hole, so the
 * path routes attach → hole → rover; otherwise it runs straight.
 * @param {PoolPoint} rover Rover position.
 * @param {PracticeEnvironment} env The environment (attach point, ice sheet).
 * @returns {PoolPoint[]} Waypoints from attach point to rover.
 */
export const tetherWorldPath = (rover: PoolPoint, env: PracticeEnvironment): PoolPoint[] => {
  const attach: PoolPoint = { x: env.tether.attachPoint[0], y: env.tether.attachPoint[1], depth: 0 }
  if (!env.iceSheet) return [attach, rover]
  const hole: PoolPoint = { x: env.iceSheet.holeCenter[0], y: env.iceSheet.holeCenter[1], depth: 0 }
  return [attach, hole, rover]
}

/**
 * Advance the simulation one step inside the given environment.
 * @param {SimState} state Current state.
 * @param {RoverProfile} profile Rover profile providing mix + mass + dims.
 * @param {PracticeEnvironment} env The practice environment (pool/water/ice/tether/obstacles).
 * @param {BodyAxes} demand Control demand per axis, each in [-1, 1].
 * @param {number} dt Timestep in seconds.
 * @param {SimControls} controls Optional extra controls (claw).
 * @returns {SimState} The advanced state.
 */
export const stepSimulation = (
  state: SimState,
  profile: RoverProfile,
  env: PracticeEnvironment,
  demand: BodyAxes,
  dt: number,
  controls: SimControls = {}
): SimState => {
  const density = waterDensity(env.water.salinityPpt, env.water.temperatureC)
  const model = hydroModel(profile, density)
  const next: SimState = {
    ...state,
    thrust: { ...state.thrust },
    ringSides: { ...state.ringSides },
    justPassed: undefined,
    collidedWith: undefined,
  }

  // Thruster outputs: forward-mix the demand, then spool toward the target.
  const targets = profile.thrusters.map((t) =>
    clamp(
      axisKeys.reduce((sum, axis) => sum + t.contribution[axis] * demand[axis], 0),
      -1,
      1
    )
  )
  const outputs =
    state.thrusterOutputs.length === profile.thrusters.length
      ? [...state.thrusterOutputs]
      : profile.thrusters.map(() => 0)
  const spool = clamp(dt / THRUST_TAU, 0, 1)
  targets.forEach((target, i) => {
    outputs[i] += (target - outputs[i]) * spool
  })
  next.thrusterOutputs = outputs

  // Forces (N) and torques (N·m) from the thrusters. Translation treats the mix
  // weights as thrust-direction components; rotation uses each thruster's real
  // moment arm from its mounted position (falls back to a frame-scaled arm).
  const L = Math.max(profile.dimensions.length, 0.15)
  const W = Math.max(profile.dimensions.width, 0.15)
  let [fSurge, fSway, fHeave, tYaw, tPitch, tRoll] = [0, 0, 0, 0, 0, 0]
  profile.thrusters.forEach((t, i) => {
    const force = outputs[i] * model.thrusterN
    const [px, py] = t.position ?? [0, 0, 0]
    fSurge += force * t.contribution.surge
    fSway += force * t.contribution.sway
    fHeave += force * t.contribution.heave
    tYaw += force * t.contribution.yaw * (Math.hypot(px, py) || L / 4)
    tPitch += force * t.contribution.pitch * (Math.abs(px) || L / 4)
    tRoll += force * t.contribution.roll * (Math.abs(py) || W / 4)
  })

  // Achieved normalized per-axis force for UI display.
  next.thrust = backMix(profile, outputs)

  // Tether drag: extra quadratic damping that grows with deployed length.
  const tetherDragMult = env.tether.enabled ? 1 + TETHER_DRAG_PER_M * tetherDeployedLength(state, env) : 1

  // Hydrostatics: world-frame net buoyancy resolved into body axes, so a
  // pitched vehicle feels it partly along surge — like the real thing.
  const [bSurge, bSway, bHeave] = worldToBody(0, 0, model.buoyancyDownN, state.roll, state.pitch, state.heading)

  // Translational dynamics: M ν̇ = τ − D(ν) ν + g(η).
  const accel = (axis: 'surge' | 'sway' | 'heave', vel: number, thrustN: number, hydroN: number): number => {
    const drag = (model.dragQuad[axis] * Math.abs(vel) * vel + model.dragLin[axis] * vel) * tetherDragMult
    return (thrustN + hydroN - drag) / (model.massKg + model.addedMass[axis])
  }
  next.surgeVel = state.surgeVel + accel('surge', state.surgeVel, fSurge, bSurge) * dt
  next.swayVel = state.swayVel + accel('sway', state.swayVel, fSway, bSway) * dt
  next.heaveVel = state.heaveVel + accel('heave', state.heaveVel, fHeave, bHeave) * dt

  // Rotational dynamics. Pitch/roll feel the hydrostatic righting moment.
  const rotAccel = (axis: 'yaw' | 'pitch' | 'roll', rate: number, torque: number, righting: number): number => {
    const drag = model.rotDragQuad[axis] * Math.abs(rate) * rate + model.rotDragLin[axis] * rate
    return (torque + righting - drag) / model.inertia[axis]
  }
  next.yawRate = state.yawRate + rotAccel('yaw', state.yawRate, tYaw, 0) * dt
  next.pitchRate =
    state.pitchRate + rotAccel('pitch', state.pitchRate, tPitch, -model.rightingNm * Math.sin(state.pitch)) * dt
  next.rollRate =
    state.rollRate + rotAccel('roll', state.rollRate, tRoll, -model.rightingNm * Math.sin(state.roll)) * dt

  // Attitude integration (Euler rate ≈ body rate), with the anti-capsize clamp.
  next.heading = (state.heading + next.yawRate * dt + 2 * Math.PI) % (2 * Math.PI)
  next.pitch = state.pitch + next.pitchRate * dt
  next.roll = state.roll + next.rollRate * dt
  if (Math.abs(next.pitch) > MAX_ANGLE) {
    next.pitch = clamp(next.pitch, -MAX_ANGLE, MAX_ANGLE)
    next.pitchRate = 0
  }
  if (Math.abs(next.roll) > MAX_ANGLE) {
    next.roll = clamp(next.roll, -MAX_ANGLE, MAX_ANGLE)
    next.rollRate = 0
  }

  // Position integration through the full body→world rotation: attitude
  // genuinely steers the velocity (nose down + forward = descend).
  const [dx, dy, dDepth] = bodyToWorld(next.surgeVel, next.swayVel, next.heaveVel, next.roll, next.pitch, next.heading)
  next.x = state.x + dx * dt
  next.y = state.y + dy * dt
  next.depth = state.depth + dDepth * dt

  // Rigid-body contact response: kill the velocity component pointing into a
  // surface (world-frame direction d), so the rover thunks instead of ghosting.
  const killVelToward = (kdx: number, kdy: number, kdz: number): void => {
    const [wx, wy, wz] = bodyToWorld(next.surgeVel, next.swayVel, next.heaveVel, next.roll, next.pitch, next.heading)
    const into = wx * kdx + wy * kdy + wz * kdz
    if (into <= 0) return
    const [u, v, w] = worldToBody(
      wx - kdx * into,
      wy - kdy * into,
      wz - kdz * into,
      next.roll,
      next.pitch,
      next.heading
    )
    next.surgeVel = u
    next.swayVel = v
    next.heaveVel = w
  }
  // Oriented footprint: the rover meets surfaces with its REAL length×width
  // extent for the current heading (ellipse support), not a worst-case circle.
  const footprint = (fdx: number, fdy: number): number => footprintRadius(profile, next.heading, fdx, fdy)

  // Pool walls.
  const rx = footprint(1, 0)
  if (next.x < rx || next.x > env.pool.length - rx) {
    killVelToward(next.x < rx ? -1 : 1, 0, 0)
    next.x = clamp(next.x, rx, env.pool.length - rx)
    next.collidedWith = 'pool wall'
  }
  const ry = footprint(0, 1)
  if (next.y < ry || next.y > env.pool.width - ry) {
    killVelToward(0, next.y < ry ? -1 : 1, 0)
    next.y = clamp(next.y, ry, env.pool.width - ry)
    next.collidedWith = 'pool wall'
  }

  // Floor and surface/ice.
  if (next.depth > env.pool.depth - profile.dimensions.height / 2) {
    next.depth = env.pool.depth - profile.dimensions.height / 2
    killVelToward(0, 0, 1)
    next.collidedWith = 'pool floor'
  }
  let minDepth = 0
  if (env.iceSheet) {
    const [hx, hy] = env.iceSheet.holeCenter
    const half = env.iceSheet.holeSize / 2
    const inHole = Math.abs(next.x - hx) <= half && Math.abs(next.y - hy) <= half
    if (!inHole) minDepth = env.iceSheet.thickness + profile.dimensions.height / 2
  }
  if (next.depth < minDepth) {
    next.depth = minDepth
    killVelToward(0, 0, -1)
    if (minDepth > 0) next.collidedWith = 'ice sheet'
  }

  // Obstacles. Rings (hoops) collide as a torus and detect clean pass-throughs;
  // boxes/cylinders resolve by pushing the rover out in plan view.
  const roverTop = next.depth - profile.dimensions.height / 2
  const roverBottom = next.depth + profile.dimensions.height / 2
  for (const obstacle of env.obstacles) {
    if (obstacle.id === state.heldObstacleId) continue // don't collide with what we hold
    const [ox, oy, otop] = obstacle.position

    if (obstacle.shape === 'ring') {
      const gamma = ((obstacle.yawDeg ?? 0) * Math.PI) / 180
      const [nx, ny] = [Math.cos(gamma), Math.sin(gamma)] // hoop plane normal (horizontal)
      const outerR = obstacle.size[0] / 2
      const tubeR = obstacle.size[1] / 2
      const ringR = outerR - tubeR // center-circle radius
      const cz = otop + outerR
      const [rdx, rdy, rdz] = [next.x - ox, next.y - oy, next.depth - cz]
      const axial = rdx * nx + rdy * ny
      const [lx, ly] = [rdx - axial * nx, rdy - axial * ny] // in-plane horizontal part
      const planar = Math.hypot(lx, ly, rdz)

      // Clean pass: crossed the hoop plane while inside the opening.
      const side = axial >= 0 ? 1 : -1
      const prevSide = state.ringSides[obstacle.id]
      if (prevSide && side !== prevSide && planar < ringR - tubeR) next.justPassed = obstacle.name
      if (Math.abs(axial) > 0.05) next.ringSides[obstacle.id] = side

      // Torus collision: distance from the hoop's center circle, against the
      // rover's mean cross-section (half-width/half-height average).
      const crossR = (Math.max(profile.dimensions.width, 0.15) + Math.max(profile.dimensions.height, 0.1)) / 4
      const q = Math.hypot(planar - ringR, axial)
      if (q < tubeR + crossR && q > 1e-6) {
        const [pux, puy, puz] = planar > 1e-6 ? [lx / planar, ly / planar, rdz / planar] : [0, 0, 1]
        const [ccx, ccy, ccz] = [ox + pux * ringR, oy + puy * ringR, cz + puz * ringR] // nearest circle point
        const push = (tubeR + crossR) / q
        killVelToward((ccx - next.x) / q, (ccy - next.y) / q, (ccz - next.depth) / q)
        next.x = ccx + (next.x - ccx) * push
        next.y = ccy + (next.y - ccy) * push
        next.depth = Math.max(0, ccz + (next.depth - ccz) * push)
        next.collidedWith = obstacle.name
      }
      continue
    }

    const obottom = otop + obstacle.size[2]
    if (roverBottom < otop || roverTop > obottom) continue

    if (obstacle.shape === 'cylinder') {
      const cdx = next.x - ox
      const cdy = next.y - oy
      const dist = Math.hypot(cdx, cdy)
      const minDist = (dist > 1e-6 ? footprint(cdx / dist, cdy / dist) : footprint(1, 0)) + obstacle.size[0] / 2
      if (dist < minDist && dist > 1e-6) {
        killVelToward(-cdx / dist, -cdy / dist, 0)
        next.x = ox + (cdx / dist) * minDist
        next.y = oy + (cdy / dist) * minDist
        next.collidedWith = obstacle.name
      }
    } else {
      const halfX = obstacle.size[0] / 2 + footprint(1, 0)
      const halfY = obstacle.size[1] / 2 + footprint(0, 1)
      const bdx = next.x - ox
      const bdy = next.y - oy
      if (Math.abs(bdx) < halfX && Math.abs(bdy) < halfY) {
        if (halfX - Math.abs(bdx) < halfY - Math.abs(bdy)) {
          killVelToward(-Math.sign(bdx || 1), 0, 0)
          next.x = ox + Math.sign(bdx || 1) * halfX
        } else {
          killVelToward(0, -Math.sign(bdy || 1), 0)
          next.y = oy + Math.sign(bdy || 1) * halfY
        }
        next.collidedWith = obstacle.name
      }
    }
  }

  // Claw: animate closure toward the commanded state; grab/release obstacles.
  const gripperTarget = controls.gripperClosed ? 1 : 0
  next.gripper = clamp(state.gripper + Math.sign(gripperTarget - state.gripper) * GRIPPER_SPEED * dt, 0, 1)

  if (!controls.gripperClosed && state.heldObstacleId) {
    next.heldObstacleId = undefined // released
  } else if (controls.gripperClosed && !state.heldObstacleId && next.gripper > 0.5) {
    const grab = gripperPoint(next)
    for (const obstacle of env.obstacles) {
      if (obstacle.shape === 'ring') continue
      if (Math.max(obstacle.size[0], obstacle.size[1]) > GRIPPER_MAX_SIZE) continue
      const [ox, oy, otop] = obstacle.position
      const centerDepth = otop + obstacle.size[2] / 2
      const dist = Math.hypot(ox - grab.x, oy - grab.y, centerDepth - grab.depth)
      if (dist <= GRIPPER_RADIUS + Math.max(obstacle.size[0], obstacle.size[1]) / 2) {
        next.heldObstacleId = obstacle.id
        break
      }
    }
  }

  // A held obstacle follows the claw (mutates the environment so all views agree).
  if (next.heldObstacleId) {
    const held = env.obstacles.find((o) => o.id === next.heldObstacleId)
    if (held) {
      const grab = gripperPoint(next)
      held.position[0] = grab.x
      held.position[1] = grab.y
      held.position[2] = Math.max(0, grab.depth - held.size[2] / 2)
    } else {
      next.heldObstacleId = undefined
    }
  }

  // Tether: snag on obstacles + enforce the hard length limit (see rover-tether).
  applyTetherPhysics(next, env)

  return next
}
