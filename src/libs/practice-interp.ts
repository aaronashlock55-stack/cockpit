/**
 * Render interpolation helpers for the practice trainer — the "fix your
 * timestep" pattern: the sim advances in fixed steps on its own clock and
 * publishes timestamped pose snapshots; the render loop blends the previous and
 * current snapshots by wall-clock alpha, so motion is glassy at any frame rate
 * (one sim tick of latency, zero stutter). Pure math, no three.js — unit-tested.
 */

/** One published sim pose snapshot, timestamped for render interpolation. */
export interface PracticePoseFrame {
  /** performance.now() timestamp when published, ms. */
  t: number
  /** Pool-local x, meters. */
  x: number
  /** Pool-local y, meters. */
  y: number
  /** Depth, meters (positive down). */
  depth: number
  /** Heading, radians. */
  heading: number
  /** Pitch, radians (nose-up positive). */
  pitch: number
  /** Roll, radians. */
  roll: number
  /** Overall speed, m/s (drives FOV/prop-spin cues). */
  speed: number
  /** Body-frame forward velocity, m/s (for acceleration cues). */
  surgeVel: number
  /** Body-frame rightward velocity, m/s. */
  swayVel: number
  /** Body-frame downward velocity, m/s. */
  heaveVel: number
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))

/**
 * Shortest-arc angle interpolation (handles the 2π→0 heading wrap, so a rover
 * crossing north never visibly spins the long way round).
 * @param {number} a Start angle, rad.
 * @param {number} b End angle, rad.
 * @param {number} alpha Blend factor [0, 1].
 * @returns {number} Interpolated angle, rad.
 */
export const lerpAngle = (a: number, b: number, alpha: number): number => {
  const delta = ((((b - a) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI
  return a + delta * alpha
}

/**
 * Linear interpolation of two pose frames; angles via shortest arc.
 * @param {PracticePoseFrame} prev Earlier frame.
 * @param {PracticePoseFrame} curr Later frame.
 * @param {number} alpha Blend factor [0, 1].
 * @returns {PracticePoseFrame} Interpolated frame.
 */
export const interpolatePose = (prev: PracticePoseFrame, curr: PracticePoseFrame, alpha: number): PracticePoseFrame => {
  const mix = (a: number, b: number): number => a + (b - a) * alpha
  return {
    t: mix(prev.t, curr.t),
    x: mix(prev.x, curr.x),
    y: mix(prev.y, curr.y),
    depth: mix(prev.depth, curr.depth),
    heading: lerpAngle(prev.heading, curr.heading, alpha),
    pitch: lerpAngle(prev.pitch, curr.pitch, alpha),
    roll: lerpAngle(prev.roll, curr.roll, alpha),
    speed: mix(prev.speed, curr.speed),
    surgeVel: mix(prev.surgeVel, curr.surgeVel),
    swayVel: mix(prev.swayVel, curr.swayVel),
    heaveVel: mix(prev.heaveVel, curr.heaveVel),
  }
}

/**
 * Render alpha for "one tick behind" interpolation: 0 right when `curr` was
 * published, 1 one tick interval later. Clamped — never extrapolates (an
 * extrapolated pose would overshoot collisions and visibly snap back).
 * @param {number} prevT Previous frame timestamp, ms.
 * @param {number} currT Current frame timestamp, ms.
 * @param {number} nowT Render-time timestamp, ms.
 * @returns {number} Blend factor [0, 1].
 */
export const frameAlpha = (prevT: number, currT: number, nowT: number): number =>
  clamp01((nowT - currT) / Math.max(currT - prevT, 1))

/**
 * Frame-rate-independent exponential smoothing toward a target: the same
 * stiffness k feels identical at 30, 60, or 120 fps (two half-steps compose to
 * exactly one full step). Used for camera springs.
 * @param {number} current Current value.
 * @param {number} target Target value.
 * @param {number} k Stiffness, 1/s (higher = snappier).
 * @param {number} dt Timestep, seconds.
 * @returns {number} The smoothed value.
 */
export const smoothTowards = (current: number, target: number, k: number, dt: number): number =>
  current + (target - current) * (1 - Math.exp(-k * dt))
