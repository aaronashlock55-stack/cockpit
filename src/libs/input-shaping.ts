import { type BodyAxes } from '@/types/rover-profile'

/**
 * Input shaping for the practice trainer, borrowed from flight/FPV simulators:
 * keyboard keys ramp like an analog stick being pushed and released (instead of
 * binary ±1 snaps), and gamepad sticks get an expo curve for fine center
 * control. Pure functions — unit-tested.
 */

/** Attack/release slew configuration for one input axis. */
export interface AxisEnvelopeConfig {
  /** Seconds to ramp from 0 to full deflection while held. */
  attackTime: number
  /** Seconds to decay from full deflection back to 0 when released. */
  releaseTime: number
}

/** Default keyboard envelope: deliberate spool-up, quick but not instant letoff. */
export const KEY_ENVELOPE: AxisEnvelopeConfig = { attackTime: 0.35, releaseTime: 0.2 }

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v))

/**
 * Slew one axis toward its target like an analog stick: pushing further uses
 * the attack rate, letting off (or reversing through zero) uses the release
 * rate. Output is always within [-1, 1].
 * @param {number} current Current shaped value.
 * @param {number} target Commanded value (e.g. ±1 from a key, 0 released).
 * @param {number} dt Timestep, seconds.
 * @param {AxisEnvelopeConfig} cfg Attack/release times.
 * @returns {number} The new shaped value.
 */
export const stepAxisEnvelope = (
  current: number,
  target: number,
  dt: number,
  cfg: AxisEnvelopeConfig = KEY_ENVELOPE
): number => {
  // Pushing = moving away from zero in the target's direction; anything else
  // (letting off, reversing) decays at the release rate first.
  const pushing =
    target !== 0 && Math.sign(target) === Math.sign(current || target) && Math.abs(target) > Math.abs(current)
  const rate = pushing ? 1 / Math.max(cfg.attackTime, 1e-3) : 1 / Math.max(cfg.releaseTime, 1e-3)
  const next = current + clamp(target - current, -rate * dt, rate * dt)
  return clamp(next, -1, 1)
}

/**
 * Slew a full body-axes demand, per-axis envelopes.
 * @param {BodyAxes} current Current shaped demand.
 * @param {BodyAxes} target Commanded demand.
 * @param {number} dt Timestep, seconds.
 * @param {AxisEnvelopeConfig} cfg Attack/release times.
 * @returns {BodyAxes} The new shaped demand.
 */
export const stepDemandEnvelope = (
  current: BodyAxes,
  target: BodyAxes,
  dt: number,
  cfg: AxisEnvelopeConfig = KEY_ENVELOPE
): BodyAxes => ({
  surge: stepAxisEnvelope(current.surge, target.surge, dt, cfg),
  sway: stepAxisEnvelope(current.sway, target.sway, dt, cfg),
  heave: stepAxisEnvelope(current.heave, target.heave, dt, cfg),
  yaw: stepAxisEnvelope(current.yaw, target.yaw, dt, cfg),
  pitch: stepAxisEnvelope(current.pitch, target.pitch, dt, cfg),
  roll: stepAxisEnvelope(current.roll, target.roll, dt, cfg),
})

/**
 * Stick expo curve (FPV-sim style): softens the center for fine control while
 * keeping full deflection at full stick. expo 0 = linear, 1 = fully cubic.
 * @param {number} value Stick value in [-1, 1].
 * @param {number} expo Expo amount [0, 1].
 * @returns {number} The curved value.
 */
export const applyExpo = (value: number, expo: number): number => value * (1 - expo) + value ** 3 * expo
