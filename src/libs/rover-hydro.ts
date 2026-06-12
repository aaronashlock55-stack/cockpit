import { type RoverProfile } from '@/types/rover-profile'

/**
 * Hydrodynamic model derivation for the practice simulator. Every coefficient
 * of the Fossen 6-DOF model is DERIVED here from the rover profile (mass,
 * dimensions, thrusters) and water density — only the dimensionless shape
 * coefficients below are tuned. A heavier or bigger rover genuinely handles
 * differently.
 */

export const GRAVITY = 9.81
/** Bluff-body drag coefficient per axis (open ROV frame; heave high — flat frame). */
const CD = { surge: 0.9, sway: 1.1, heave: 2.2 }
/** Added-mass coefficient per axis (fraction of frame-volume water entrained). */
const CA = { surge: 0.1, sway: 0.2, heave: 0.3 }
/** Linear (skin friction) drag per m² of projected area, N/(m/s). */
const LIN_DRAG_PER_AREA = 55
/** Rotational added inertia as a fraction of dry inertia. */
const ROT_ADDED = 1.0
/** Rotational quadratic drag coefficient. */
const CD_ROT = 2.0
/** Buoyancy-to-gravity center separation as a fraction of vehicle height. */
const BG_FRACTION = 0.18
/** Pitch/roll damping ratio (<1 → slight righting wobble, like a real ROV). */
const ROT_DAMPING = 0.5
/** Positive ballast trim, N per kg (ROVs are trimmed slightly buoyant). */
const TRIM_N_PER_KG = 0.07
/** Default per-thruster max force, N (T200 at ~14 V). */
const DEFAULT_THRUSTER_N = 35

/** A scalar for each translation axis. */
export interface TranslationScalars {
  /** Forward/back axis. */
  surge: number
  /** Left/right axis. */
  sway: number
  /** Up/down axis. */
  heave: number
}

/** A scalar for each rotation axis. */
export interface RotationScalars {
  /** Rotation about the vertical axis. */
  yaw: number
  /** Nose up/down. */
  pitch: number
  /** Bank left/right. */
  roll: number
}

/** Physical model derived from a rover profile + water density (exported for tests). */
export interface HydroModel {
  /** Dry mass, kg. */
  massKg: number
  /** Translational added mass per axis, kg. */
  addedMass: TranslationScalars
  /** Quadratic drag per axis, N/(m/s)². */
  dragQuad: TranslationScalars
  /** Linear drag per axis, N/(m/s). */
  dragLin: TranslationScalars
  /** Rotational inertia incl. added water, kg·m². */
  inertia: RotationScalars
  /** Righting-moment slope m·g·BG, N·m per sin(angle). */
  rightingNm: number
  /** Quadratic rotational drag, N·m/(rad/s)². */
  rotDragQuad: RotationScalars
  /** Linear rotational drag, N·m/(rad/s). */
  rotDragLin: RotationScalars
  /** Net hydrostatic force, N, positive down (negative = floats up). */
  buoyancyDownN: number
  /** Per-thruster max force, N. */
  thrusterN: number
}

/**
 * Derive the full hydrodynamic model from a rover profile and water density.
 * @param {RoverProfile} profile The rover profile (mass, dimensions, thrusters).
 * @param {number} density Water density in kg/m³.
 * @returns {HydroModel} The derived model.
 */
export const hydroModel = (profile: RoverProfile, density: number): HydroModel => {
  const m = Math.max(profile.dimensions.massKg, 1)
  const L = Math.max(profile.dimensions.length, 0.15)
  const W = Math.max(profile.dimensions.width, 0.15)
  const H = Math.max(profile.dimensions.height, 0.1)
  const area = { surge: W * H, sway: L * H, heave: L * W }
  const volume = L * W * H
  const rightingNm = m * GRAVITY * BG_FRACTION * H
  const inertia = {
    yaw: ((m * (L * L + W * W)) / 12) * (1 + ROT_ADDED),
    pitch: ((m * (L * L + H * H)) / 12) * (1 + ROT_ADDED),
    roll: ((m * (W * W + H * H)) / 12) * (1 + ROT_ADDED),
  }
  return {
    massKg: m,
    addedMass: {
      surge: density * volume * CA.surge,
      sway: density * volume * CA.sway,
      heave: density * volume * CA.heave,
    },
    dragQuad: {
      surge: 0.5 * density * CD.surge * area.surge,
      sway: 0.5 * density * CD.sway * area.sway,
      heave: 0.5 * density * CD.heave * area.heave,
    },
    dragLin: {
      surge: LIN_DRAG_PER_AREA * area.surge * (density / 1000),
      sway: LIN_DRAG_PER_AREA * area.sway * (density / 1000),
      heave: LIN_DRAG_PER_AREA * area.heave * (density / 1000),
    },
    inertia,
    rightingNm,
    rotDragQuad: {
      yaw: 0.5 * density * CD_ROT * area.heave * (L / 2) ** 3,
      pitch: 0.5 * density * CD_ROT * area.heave * (L / 2) ** 3 * 0.7,
      roll: 0.5 * density * CD_ROT * area.heave * (W / 2) ** 3 * 0.7,
    },
    rotDragLin: {
      yaw: 0.6 * inertia.yaw,
      pitch: 2 * ROT_DAMPING * Math.sqrt(rightingNm * inertia.pitch),
      roll: 2 * ROT_DAMPING * Math.sqrt(rightingNm * inertia.roll),
    },
    // Ballasted neutral in fresh water plus a slight positive trim; salinity
    // shifts density and the same displaced volume then floats the vehicle up.
    buoyancyDownN: -((m / 1000) * (density - 1000) * GRAVITY + TRIM_N_PER_KG * m),
    thrusterN: profile.thrusterMaxForceN ?? DEFAULT_THRUSTER_N,
  }
}

/**
 * Body→world rotation (ZYX Euler) applied to a body-frame vector.
 * @param {number} u Body forward component.
 * @param {number} v Body right component.
 * @param {number} w Body down component.
 * @param {number} roll Roll, rad.
 * @param {number} pitch Pitch, rad (nose-up positive).
 * @param {number} yaw Heading, rad.
 * @returns {[number, number, number]} World [x, y, down] components.
 */
export const bodyToWorld = (
  u: number,
  v: number,
  w: number,
  roll: number,
  pitch: number,
  yaw: number
): [number, number, number] => {
  const [cy, sy] = [Math.cos(yaw), Math.sin(yaw)]
  const [cp, sp] = [Math.cos(pitch), Math.sin(pitch)]
  const [cr, sr] = [Math.cos(roll), Math.sin(roll)]
  return [
    cy * cp * u + (cy * sp * sr - sy * cr) * v + (cy * sp * cr + sy * sr) * w,
    sy * cp * u + (sy * sp * sr + cy * cr) * v + (sy * sp * cr - cy * sr) * w,
    -sp * u + cp * sr * v + cp * cr * w,
  ]
}

/**
 * World→body rotation (transpose of bodyToWorld).
 * @param {number} X World x component.
 * @param {number} Y World y component.
 * @param {number} Z World down component.
 * @param {number} roll Roll, rad.
 * @param {number} pitch Pitch, rad (nose-up positive).
 * @param {number} yaw Heading, rad.
 * @returns {[number, number, number]} Body [forward, right, down] components.
 */
export const worldToBody = (
  X: number,
  Y: number,
  Z: number,
  roll: number,
  pitch: number,
  yaw: number
): [number, number, number] => {
  const [cy, sy] = [Math.cos(yaw), Math.sin(yaw)]
  const [cp, sp] = [Math.cos(pitch), Math.sin(pitch)]
  const [cr, sr] = [Math.cos(roll), Math.sin(roll)]
  return [
    cy * cp * X + sy * cp * Y - sp * Z,
    (cy * sp * sr - sy * cr) * X + (sy * sp * sr + cy * cr) * Y + cp * sr * Z,
    (cy * sp * cr + sy * sr) * X + (sy * sp * cr - cy * sr) * Y + cp * cr * Z,
  ]
}
