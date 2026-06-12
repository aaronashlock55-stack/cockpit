import { type PracticeEnvironment, waterDensity } from '@/types/practice-environment'
import { type BodyAxes, type RoverProfile } from '@/types/rover-profile'

/**
 * A minimal, believable ROV motion model for Practice/Demo mode. It is NOT a
 * physics-grade simulator — it exists so operators can feel how *their* rover
 * (per its motor-mix profile) responds in *their* environment (pool, water,
 * tether, props), and so the rest of Cockpit has live data with no hardware.
 *
 * Environment effects modeled (deliberately simple but directionally correct):
 * - Buoyancy: rovers are assumed ballasted neutral in fresh water; saltier or
 *   colder water is denser, so the rover slowly floats up unless compensated.
 * - Pool walls/floor: hard limits with velocity zeroed into the surface.
 * - Ice sheet: blocks ascent above its keel everywhere except the launch hole.
 * - Obstacles: plan-view collision (with depth overlap) pushes the rover out.
 * - Tether: a hard length constraint plus drag that grows with deployed length
 *   (long tethers are the dominant drag source on real ROVs).
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
  /** Body-frame forward velocity, m/s. */
  surgeVel: number
  /** Body-frame rightward velocity, m/s. */
  swayVel: number
  /** Body-frame downward velocity, m/s. */
  heaveVel: number
  /** Yaw rate, rad/s. */
  yawRate: number
  /** Name of whatever the rover is currently in contact with, if anything. */
  collidedWith?: string
}

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
  surgeVel: 0,
  swayVel: 0,
  heaveVel: 0,
  yawRate: 0,
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

  const force = { surge: 0, sway: 0, heave: 0, yaw: 0, pitch: 0, roll: 0 } as BodyAxes
  const authority = { surge: 0, sway: 0, heave: 0, yaw: 0, pitch: 0, roll: 0 } as BodyAxes
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

// Peak speeds at full force — tuned for a believable ROV (slow, deliberate).
const MAX_SURGE = 1.2 // m/s
const MAX_SWAY = 0.9
const MAX_HEAVE = 0.7
const MAX_YAW_RATE = 1.0 // rad/s (~57 deg/s)
const MAX_TILT = 0.35 // rad (~20 deg) achievable lean for pitch/roll demand

/**
 * Approximate rover plan-view radius for collisions.
 * @param {RoverProfile} profile The rover profile providing dimensions.
 * @returns {number} Radius in meters.
 */
const roverRadius = (profile: RoverProfile): number => Math.max(profile.dimensions.length, profile.dimensions.width) / 2

/**
 * Advance the simulation one step inside the given environment.
 * @param {SimState} state Current state.
 * @param {RoverProfile} profile Rover profile providing mix + mass + dims.
 * @param {PracticeEnvironment} env The practice environment (pool/water/ice/tether/obstacles).
 * @param {BodyAxes} demand Control demand per axis, each in [-1, 1].
 * @param {number} dt Timestep in seconds.
 * @returns {SimState} The advanced state.
 */
export const stepSimulation = (
  state: SimState,
  profile: RoverProfile,
  env: PracticeEnvironment,
  demand: BodyAxes,
  dt: number
): SimState => {
  const force = mixToBodyForce(profile, demand)
  const next: SimState = { ...state, collidedWith: undefined }

  // Tether drag: effective top speed falls off with deployed length (straight-line distance).
  const attach = env.tether.attachPoint
  const tetherDx = state.x - attach[0]
  const tetherDy = state.y - attach[1]
  const tetherDist = Math.sqrt(tetherDx * tetherDx + tetherDy * tetherDy + state.depth * state.depth)
  const tetherDragFactor = env.tether.enabled ? 1 / (1 + 0.015 * tetherDist) : 1

  // First-order velocity response: heavier rover accelerates slower; drag pulls toward target.
  const responsiveness = clamp(20 / Math.max(profile.dimensions.massKg, 1), 0.5, 4)
  const approach = (current: number, target: number): number =>
    current + (target - current) * clamp(responsiveness * dt, 0, 1)

  // Buoyancy: neutral in fresh water at 15 C; denser water floats the rover up (negative heave).
  const density = waterDensity(env.water.salinityPpt, env.water.temperatureC)
  const buoyancyBias = -((density - 1000) * 0.004) // m/s of upward drift at zero heave demand

  next.surgeVel = approach(state.surgeVel, force.surge * MAX_SURGE * tetherDragFactor)
  next.swayVel = approach(state.swayVel, force.sway * MAX_SWAY * tetherDragFactor)
  next.heaveVel = approach(state.heaveVel, force.heave * MAX_HEAVE * tetherDragFactor + buoyancyBias)
  next.yawRate = approach(state.yawRate, force.yaw * MAX_YAW_RATE)

  // Integrate heading, position, depth.
  next.heading = (state.heading + next.yawRate * dt + 2 * Math.PI) % (2 * Math.PI)
  next.x = state.x + (next.surgeVel * Math.cos(next.heading) - next.swayVel * Math.sin(next.heading)) * dt
  next.y = state.y + (next.surgeVel * Math.sin(next.heading) + next.swayVel * Math.cos(next.heading)) * dt
  next.depth = state.depth + next.heaveVel * dt

  // Bottom-heavy ROVs self-level: pitch/roll settle toward the demanded lean.
  next.pitch = approach(state.pitch, clamp(demand.pitch, -1, 1) * MAX_TILT)
  next.roll = approach(state.roll, clamp(demand.roll, -1, 1) * MAX_TILT)

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
    const [ox, oy, otop] = obstacle.position
    const obottom = otop + obstacle.size[2]
    if (roverBottom < otop || roverTop > obottom) continue // no depth overlap

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
        // Push out along the axis of least penetration.
        if (halfX - Math.abs(dx) < halfY - Math.abs(dy)) {
          next.x = ox + Math.sign(dx || 1) * halfX
        } else {
          next.y = oy + Math.sign(dy || 1) * halfY
        }
        next.collidedWith = obstacle.name
      }
    }
  }

  // Tether hard constraint: cannot exceed length; when taut, motion is pulled back onto the sphere.
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
