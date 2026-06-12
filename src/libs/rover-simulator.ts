import { type PracticeEnvironment, waterDensity } from '@/types/practice-environment'
import { type BodyAxes, type RoverProfile } from '@/types/rover-profile'

/**
 * ROV motion model for Practice mode, shaped after the marine-robotics standard
 * (Fossen model) used by simulators like Stonefish and UNav-Sim:
 *
 *   (m + m_added) * v_dot = thrust - d_lin*v - d_quad*v|v| - restoring
 *
 * - Added mass: water resists acceleration, so the rover feels heavy, not
 *   weightless — different per axis (heaving a flat frame drags far more water
 *   than surging).
 * - Quadratic + linear damping: release the sticks and the rover COASTS,
 *   shedding speed fast at first then drifting — like a real vehicle.
 * - Thruster spool: thrust ramps over ~0.3 s rather than stepping.
 * - Hydrostatic restoring: net buoyancy (water density vs. trim) acts as a
 *   force in heave; pitch/roll have an underdamped righting moment, so the
 *   vehicle bobs slightly when disturbed.
 * - Environment: pool walls/floor, ice sheet with launch hole, obstacle
 *   collisions, tether (drag grows with deployment; hard length limit).
 * - Gripper: a claw at the nose that can grab small obstacles; held objects
 *   follow the vehicle until released.
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
  /** Pitch in radians. */
  pitch: number
  /** Roll rate, rad/s (for the righting oscillation). */
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
  /** Spooled (lagged) thrust per axis, as normalized force [-1, 1]. */
  thrust: BodyAxes
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
  thrust: zeroAxes(),
  gripper: 0,
})

const axisKeys: (keyof BodyAxes)[] = ['surge', 'sway', 'heave', 'yaw', 'pitch', 'roll']
const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v))

/**
 * Apply a control demand through the profile's motor mix to get achieved body force per axis.
 * Forward mix: each thruster output = sum_axis(contribution[axis] * demand[axis]), saturated to [-1,1].
 * Back mix: achieved force[axis] = sum_thruster(contribution[axis] * output), normalized by axis authority.
 * @param {RoverProfile} profile The rover profile providing the mix weights.
 * @param {BodyAxes} demand Control demand per axis, each in [-1, 1].
 * @returns {BodyAxes} Achieved normalized body force per axis, each ~[-1, 1].
 */
export const mixToBodyForce = (profile: RoverProfile, demand: BodyAxes): BodyAxes => {
  const outputs = profile.thrusters.map((t) =>
    clamp(
      axisKeys.reduce((sum, axis) => sum + t.contribution[axis] * demand[axis], 0),
      -1,
      1
    )
  )

  const force = zeroAxes()
  const authority = zeroAxes()
  profile.thrusters.forEach((t, i) => {
    axisKeys.forEach((axis) => {
      force[axis] += t.contribution[axis] * outputs[i]
      authority[axis] += Math.abs(t.contribution[axis])
    })
  })
  axisKeys.forEach((axis) => {
    force[axis] = authority[axis] > 1e-6 ? clamp(force[axis] / authority[axis], -1, 1) : 0
  })
  return force
}

// --- Dynamics constants (BlueROV2-class, tuned for believable training feel) ---

const GRAVITY = 9.81
/** Max thrust force per axis at |force|=1, Newtons (Newton-meters for yaw). */
const F_MAX = { surge: 65, sway: 50, heave: 55, yaw: 14 }
/** Added-mass factor per axis (fraction of dry mass dragged along as water). */
const ADDED_MASS = { surge: 0.35, sway: 0.7, heave: 1.1 }
/** Quadratic drag d_quad (N per (m/s)^2): sets terminal speeds (~1.15 / 0.75 / 0.5 m/s). */
const D_QUAD = { surge: 48, sway: 85, heave: 210 }
/** Linear (skin-friction) drag d_lin (N per m/s): kills the slow-coast tail. */
const D_LIN = { surge: 4, sway: 6, heave: 10 }
/** Yaw: inertia (kg*m^2, incl. added), quadratic + linear rotational drag. */
const YAW_INERTIA_FACTOR = 0.16 // * massKg -> ~2 kg*m^2 for a BlueROV2
const YAW_D_QUAD = 9
const YAW_D_LIN = 1.2
/** Pitch/roll righting: underdamped spring so the vehicle bobs when disturbed. */
const RIGHTING_FREQ = 2.4 // rad/s natural frequency
const RIGHTING_DAMPING = 0.55 // damping ratio < 1 -> slight oscillation
const MAX_TILT = 0.35 // rad (~20 deg) demanded lean at full pitch/roll input
/** Thruster spool time constant, seconds. */
const THRUST_TAU = 0.3
/** Positive trim: ROVs are ballasted slightly buoyant in fresh water, Newtons. */
const TRIM_BUOYANCY_N = 0.8

/** Claw geometry/limits. */
const GRIPPER_REACH = 0.75 // meters from vehicle center to grab point
const GRIPPER_RADIUS = 0.45 // meters around the grab point that can be grabbed
const GRIPPER_MAX_SIZE = 0.45 // largest plan-view obstacle dimension the claw can hold
const GRIPPER_SPEED = 2.5 // closure units per second

/**
 * Approximate rover plan-view radius for collisions.
 * @param {RoverProfile} profile The rover profile providing dimensions.
 * @returns {number} Radius in meters.
 */
const roverRadius = (profile: RoverProfile): number => Math.max(profile.dimensions.length, profile.dimensions.width) / 2

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
  const mixedForce = mixToBodyForce(profile, demand)
  const next: SimState = { ...state, thrust: { ...state.thrust }, collidedWith: undefined }
  const mass = Math.max(profile.dimensions.massKg, 1)

  // Thruster spool: normalized thrust lags the commanded mix.
  const spool = clamp(dt / THRUST_TAU, 0, 1)
  axisKeys.forEach((axis) => {
    next.thrust[axis] += (mixedForce[axis] - next.thrust[axis]) * spool
  })

  // Tether drag: extra quadratic damping that grows with deployed length.
  const attach = env.tether.attachPoint
  const tdx = state.x - attach[0]
  const tdy = state.y - attach[1]
  const tetherDist = Math.sqrt(tdx * tdx + tdy * tdy + state.depth * state.depth)
  const tetherDragMult = env.tether.enabled ? 1 + 0.06 * tetherDist : 1

  // Net hydrostatic force in heave (positive down): negative = floats up.
  // Vehicles are ballasted ~neutral in fresh water with slight positive trim.
  const density = waterDensity(env.water.salinityPpt, env.water.temperatureC)
  const displaced = mass / 1000 // m^3, neutral in fresh water at 15 C
  const buoyancyDown = -(displaced * (density - 1000) * GRAVITY + TRIM_BUOYANCY_N)

  // Fossen-style per-axis translation dynamics.
  const accel = (axis: 'surge' | 'sway' | 'heave', vel: number, extraForce = 0): number => {
    const totalMass = mass * (1 + ADDED_MASS[axis])
    const thrustN = next.thrust[axis] * F_MAX[axis]
    const drag = (D_QUAD[axis] * Math.abs(vel) * vel + D_LIN[axis] * vel) * tetherDragMult
    return (thrustN + extraForce - drag) / totalMass
  }
  next.surgeVel = state.surgeVel + accel('surge', state.surgeVel) * dt
  next.swayVel = state.swayVel + accel('sway', state.swayVel) * dt
  next.heaveVel = state.heaveVel + accel('heave', state.heaveVel, buoyancyDown) * dt

  // Yaw dynamics.
  const yawInertia = mass * YAW_INERTIA_FACTOR
  const yawTorque = next.thrust.yaw * F_MAX.yaw
  const yawDrag = YAW_D_QUAD * Math.abs(state.yawRate) * state.yawRate + YAW_D_LIN * state.yawRate
  next.yawRate = state.yawRate + ((yawTorque - yawDrag) / yawInertia) * dt

  // Pitch/roll: underdamped righting spring toward the demanded lean.
  const spring = (angle: number, rate: number, target: number): [number, number] => {
    const accelAng = RIGHTING_FREQ * RIGHTING_FREQ * (target - angle) - 2 * RIGHTING_DAMPING * RIGHTING_FREQ * rate
    const newRate = rate + accelAng * dt
    return [angle + newRate * dt, newRate]
  }
  // Lean targets come from the MIXED thrust, so frames without pitch/roll
  // authority (e.g. a stock BlueROV2) genuinely cannot lean on demand.
  ;[next.pitch, next.pitchRate] = spring(state.pitch, state.pitchRate, clamp(next.thrust.pitch, -1, 1) * MAX_TILT)
  ;[next.roll, next.rollRate] = spring(state.roll, state.rollRate, clamp(next.thrust.roll, -1, 1) * MAX_TILT)

  // Integrate position.
  next.heading = (state.heading + next.yawRate * dt + 2 * Math.PI) % (2 * Math.PI)
  next.x = state.x + (next.surgeVel * Math.cos(next.heading) - next.swayVel * Math.sin(next.heading)) * dt
  next.y = state.y + (next.surgeVel * Math.sin(next.heading) + next.swayVel * Math.cos(next.heading)) * dt
  next.depth = state.depth + next.heaveVel * dt

  const radius = roverRadius(profile)

  // Pool walls.
  if (next.x < radius || next.x > env.pool.length - radius) {
    next.x = clamp(next.x, radius, env.pool.length - radius)
    next.collidedWith = 'pool wall'
  }
  if (next.y < radius || next.y > env.pool.width - radius) {
    next.y = clamp(next.y, radius, env.pool.width - radius)
    next.collidedWith = 'pool wall'
  }

  // Floor and surface/ice.
  if (next.depth > env.pool.depth - profile.dimensions.height / 2) {
    next.depth = env.pool.depth - profile.dimensions.height / 2
    next.heaveVel = Math.min(0, next.heaveVel)
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
    next.heaveVel = Math.max(0, next.heaveVel)
    if (minDepth > 0) next.collidedWith = 'ice sheet'
  }

  // Obstacles: plan-view overlap with depth-range check, resolved by pushing out.
  const roverTop = next.depth - profile.dimensions.height / 2
  const roverBottom = next.depth + profile.dimensions.height / 2
  for (const obstacle of env.obstacles) {
    if (obstacle.id === state.heldObstacleId) continue // don't collide with what we hold
    const [ox, oy, otop] = obstacle.position
    const obottom = otop + obstacle.size[2]
    if (roverBottom < otop || roverTop > obottom) continue

    if (obstacle.shape === 'cylinder') {
      const dx = next.x - ox
      const dy = next.y - oy
      const dist = Math.hypot(dx, dy)
      const minDist = radius + obstacle.size[0] / 2
      if (dist < minDist && dist > 1e-6) {
        next.x = ox + (dx / dist) * minDist
        next.y = oy + (dy / dist) * minDist
        next.collidedWith = obstacle.name
      }
    } else {
      const halfX = obstacle.size[0] / 2 + radius
      const halfY = obstacle.size[1] / 2 + radius
      const dx = next.x - ox
      const dy = next.y - oy
      if (Math.abs(dx) < halfX && Math.abs(dy) < halfY) {
        if (halfX - Math.abs(dx) < halfY - Math.abs(dy)) {
          next.x = ox + Math.sign(dx || 1) * halfX
        } else {
          next.y = oy + Math.sign(dy || 1) * halfY
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

  // Tether hard constraint: cannot exceed length; when taut, pulled back onto the sphere.
  if (env.tether.enabled) {
    const dx = next.x - attach[0]
    const dy = next.y - attach[1]
    const dist3 = Math.sqrt(dx * dx + dy * dy + next.depth * next.depth)
    if (dist3 > env.tether.length) {
      const scale = env.tether.length / dist3
      next.x = attach[0] + dx * scale
      next.y = attach[1] + dy * scale
      next.depth = next.depth * scale
      next.collidedWith = next.collidedWith ?? 'tether (taut)'
    }
  }

  return next
}

/**
 * Straight-line tether deployment for UI display (distance from attach point).
 * @param {SimState} state Current sim state.
 * @param {PracticeEnvironment} env The environment providing the attach point.
 * @returns {number} Deployed distance in meters.
 */
export const tetherDeployedLength = (state: SimState, env: PracticeEnvironment): number => {
  const [ax, ay] = env.tether.attachPoint
  return Math.sqrt((state.x - ax) ** 2 + (state.y - ay) ** 2 + state.depth ** 2)
}
