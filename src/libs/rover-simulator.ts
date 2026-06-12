import { type BodyAxes, type RoverProfile } from '@/types/rover-profile'

/**
 * A minimal, believable ROV motion model for Practice/Demo mode. It is NOT a
 * physics-grade simulator — it exists so operators can feel how *their* rover
 * (per its motor-mix profile) responds to stick input, and so the rest of
 * Cockpit (HUDs, telemetry, video overlay) has live data with no hardware.
 *
 * The handling difference between rovers comes from the profile's per-thruster
 * `contribution` weights: we apply the mix forward (demand -> per-thruster
 * output, saturated) and back (outputs -> achieved body force), exactly the way
 * an over/under-actuated frame would, so e.g. a Heavy config feels different
 * from a stock one.
 */

/** Simulated vehicle state in world/body terms (SI units, radians). */
export interface SimState {
  /** Depth in meters, positive down. */
  depth: number
  /** Heading in radians, 0 = north, positive clockwise. */
  heading: number
  /** Roll in radians. */
  roll: number
  /** Pitch in radians. */
  pitch: number
  /** Latitude in decimal degrees. */
  latitude: number
  /** Longitude in decimal degrees. */
  longitude: number
  /** Body-frame forward velocity, m/s. */
  surgeVel: number
  /** Body-frame rightward velocity, m/s. */
  swayVel: number
  /** Body-frame downward velocity, m/s. */
  heaveVel: number
  /** Yaw rate, rad/s. */
  yawRate: number
}

export const initialSimState = (): SimState => ({
  depth: 0,
  heading: 0,
  roll: 0,
  pitch: 0,
  latitude: 47.3977, // arbitrary but valid (so the map widget shows the vehicle)
  longitude: 8.5456,
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
 * Advance the simulation one step.
 * @param {SimState} state Current state (mutated copy returned).
 * @param {RoverProfile} profile Rover profile providing mix + mass.
 * @param {BodyAxes} demand Control demand per axis, each in [-1, 1].
 * @param {number} dt Timestep in seconds.
 * @returns {SimState} The advanced state.
 */
export const stepSimulation = (state: SimState, profile: RoverProfile, demand: BodyAxes, dt: number): SimState => {
  const force = mixToBodyForce(profile, demand)

  // First-order velocity response: heavier rover accelerates slower; drag pulls toward target.
  const responsiveness = clamp(20 / Math.max(profile.dimensions.massKg, 1), 0.5, 4)
  const approach = (current: number, target: number): number =>
    current + (target - current) * clamp(responsiveness * dt, 0, 1)

  const next: SimState = { ...state }
  next.surgeVel = approach(state.surgeVel, force.surge * MAX_SURGE)
  next.swayVel = approach(state.swayVel, force.sway * MAX_SWAY)
  next.heaveVel = approach(state.heaveVel, force.heave * MAX_HEAVE)
  next.yawRate = approach(state.yawRate, force.yaw * MAX_YAW_RATE)

  // Integrate heading + depth.
  next.heading = (state.heading + next.yawRate * dt + 2 * Math.PI) % (2 * Math.PI)
  next.depth = Math.max(0, state.depth + next.heaveVel * dt)

  // Bottom-heavy ROVs self-level: pitch/roll settle toward the demanded lean.
  next.pitch = approach(state.pitch, clamp(demand.pitch, -1, 1) * MAX_TILT)
  next.roll = approach(state.roll, clamp(demand.roll, -1, 1) * MAX_TILT)

  // Integrate horizontal position from body velocities (rough lat/lon at this scale).
  const metersPerDegLat = 111320
  const metersPerDegLon = 111320 * Math.cos((state.latitude * Math.PI) / 180)
  const north = next.surgeVel * Math.cos(next.heading) - next.swayVel * Math.sin(next.heading)
  const east = next.surgeVel * Math.sin(next.heading) + next.swayVel * Math.cos(next.heading)
  next.latitude = state.latitude + (north * dt) / metersPerDegLat
  next.longitude = state.longitude + (east * dt) / metersPerDegLon

  return next
}
