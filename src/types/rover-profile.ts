/**
 * A "rover profile" captures the physical + control characteristics of a specific
 * ROV so Practice/Demo mode can simulate how *that* vehicle handles ("learn my rover").
 *
 * It is intentionally lightweight and self-contained (plain JSON) so it can be
 * exported, shared between operators, and imported on any machine. The motor
 * `contribution` weights are the key part: they are the per-thruster mixing
 * factors (how much each thruster contributes to each body axis) that make one
 * rover feel different from another.
 */

/** Body axes used for the control mix (ArduSub manual-control convention). */
export interface BodyAxes {
  /** Forward/back, positive forward. */
  surge: number
  /** Left/right, positive right. */
  sway: number
  /** Up/down, positive down. */
  heave: number
  /** Rotation, positive clockwise from above. */
  yaw: number
  /** Nose up/down. */
  pitch: number
  /** Bank left/right. */
  roll: number
}

/** A single thruster and its contribution to each body axis at full output. */
export interface RoverThruster {
  /** PWM output port this thruster is wired to (1-based), matching SERVOn_FUNCTION. */
  port: number
  /** Position relative to vehicle center, meters: x forward, y right, z down. */
  position: [number, number, number]
  /** Physical spin direction (informational / for the Phase-9 wizard). */
  spin: 'cw' | 'ccw'
  /** Mixing weights: contribution of this thruster (at +1 output) to each axis. */
  contribution: BodyAxes
}

/** A complete, shareable rover profile. */
export interface RoverProfile {
  /** Human-friendly name, e.g. "Team Bluefin — BlueROV2 Heavy". */
  name: string
  /** Frame family, e.g. "BlueROV2", "BlueROV2 Heavy", "Custom". */
  frame: string
  /** Physical dimensions, meters + kg. Used for inertia/drag feel in the sim. */
  dimensions: {
    /** Length in meters. */
    length: number
    /** Width in meters. */
    width: number
    /** Height in meters. */
    height: number
    /** Mass in kilograms. */
    massKg: number
  }
  /** The thrusters and their mixing weights. */
  thrusters: RoverThruster[]
  /** Max thrust per thruster in Newtons (T200 ≈ 35 N at 14 V, ≈ 50 N at 16 V). Defaults to 35. */
  thrusterMaxForceN?: number
  /** Schema marker for forward-compat / validation. */
  schema: 'cockpit-rover-profile/v1'
}

const zeroAxes = (): BodyAxes => ({ surge: 0, sway: 0, heave: 0, yaw: 0, pitch: 0, roll: 0 })

const thruster = (
  port: number,
  position: [number, number, number],
  spin: 'cw' | 'ccw',
  contribution: Partial<BodyAxes>
): RoverThruster => ({ port, position, spin, contribution: { ...zeroAxes(), ...contribution } })

// BlueROV2: 4 vectored horizontal thrusters (surge/sway/yaw) + 2 vertical (heave).
export const blueRov2Profile: RoverProfile = {
  name: 'BlueROV2 (stock)',
  frame: 'BlueROV2',
  dimensions: { length: 0.457, width: 0.338, height: 0.254, massKg: 11 },
  schema: 'cockpit-rover-profile/v1',
  // Vectored mix: surge [+ + + +], sway [- + + -], yaw [+ - + -] — mutually
  // orthogonal patterns, so strafing produces no spin and turning no drift.
  thrusters: [
    thruster(1, [0.15, -0.18, 0], 'cw', { surge: 0.7, sway: -0.7, yaw: 0.7 }),
    thruster(2, [0.15, 0.18, 0], 'ccw', { surge: 0.7, sway: 0.7, yaw: -0.7 }),
    thruster(3, [-0.15, -0.18, 0], 'ccw', { surge: 0.7, sway: 0.7, yaw: 0.7 }),
    thruster(4, [-0.15, 0.18, 0], 'cw', { surge: 0.7, sway: -0.7, yaw: -0.7 }),
    thruster(5, [0.12, -0.22, -0.06], 'cw', { heave: 1 }),
    thruster(6, [0.12, 0.22, -0.06], 'ccw', { heave: 1 }),
  ],
}

// BlueROV2 Heavy: 4 vectored horizontal + 4 vertical (adds pitch/roll authority).
export const blueRov2HeavyProfile: RoverProfile = {
  name: 'BlueROV2 Heavy (stock)',
  frame: 'BlueROV2 Heavy',
  dimensions: { length: 0.575, width: 0.45, height: 0.254, massKg: 13.4 },
  schema: 'cockpit-rover-profile/v1',
  // Same orthogonal vectored mix as the stock frame (see note above).
  thrusters: [
    thruster(1, [0.15, -0.18, 0], 'cw', { surge: 0.7, sway: -0.7, yaw: 0.7 }),
    thruster(2, [0.15, 0.18, 0], 'ccw', { surge: 0.7, sway: 0.7, yaw: -0.7 }),
    thruster(3, [-0.15, -0.18, 0], 'ccw', { surge: 0.7, sway: 0.7, yaw: 0.7 }),
    thruster(4, [-0.15, 0.18, 0], 'cw', { surge: 0.7, sway: -0.7, yaw: -0.7 }),
    thruster(5, [0.18, -0.22, -0.06], 'cw', { heave: 1, pitch: 0.6, roll: -0.6 }),
    thruster(6, [0.18, 0.22, -0.06], 'ccw', { heave: 1, pitch: 0.6, roll: 0.6 }),
    thruster(7, [-0.18, -0.22, -0.06], 'ccw', { heave: 1, pitch: -0.6, roll: -0.6 }),
    thruster(8, [-0.18, 0.22, -0.06], 'cw', { heave: 1, pitch: -0.6, roll: 0.6 }),
  ],
}

export const builtInRoverProfiles: RoverProfile[] = [blueRov2Profile, blueRov2HeavyProfile]

export const defaultRoverProfile = blueRov2HeavyProfile

const bodyAxisKeys: (keyof BodyAxes)[] = ['surge', 'sway', 'heave', 'yaw', 'pitch', 'roll']

/**
 * Validate an unknown value as a RoverProfile. Returns the profile or throws with a clear reason.
 * @param {unknown} maybeProfile Parsed JSON to validate.
 * @returns {RoverProfile} The validated profile.
 */
export const validateRoverProfile = (maybeProfile: unknown): RoverProfile => {
  const p = maybeProfile as Partial<RoverProfile>
  if (!p || typeof p !== 'object') throw new Error('Profile is not an object.')
  if (p.schema !== 'cockpit-rover-profile/v1') throw new Error('Unrecognized or missing profile schema.')
  if (typeof p.name !== 'string' || typeof p.frame !== 'string') throw new Error('Profile is missing name/frame.')
  if (!p.dimensions || typeof p.dimensions.massKg !== 'number') throw new Error('Profile is missing dimensions/mass.')
  if (!Array.isArray(p.thrusters) || p.thrusters.length === 0) throw new Error('Profile has no thrusters.')
  p.thrusters.forEach((t, i) => {
    if (typeof t.port !== 'number') throw new Error(`Thruster ${i} is missing a port.`)
    if (!t.contribution) throw new Error(`Thruster ${i} is missing contribution weights.`)
    bodyAxisKeys.forEach((axis) => {
      if (typeof t.contribution[axis] !== 'number')
        throw new Error(`Thruster ${i} contribution.${axis} is not a number.`)
    })
  })
  return p as RoverProfile
}
