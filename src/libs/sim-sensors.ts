import { type PracticeEnvironment } from '@/types/practice-environment'

/**
 * Simulated acoustic + inertial sensor suite for the practice trainer
 * (UWSim-inspired, but modeled on the BlueRobotics hardware a BlueROV actually
 * carries): a Ping single-beam echosounder/altimeter, a Ping360 mechanical
 * scanning imaging sonar, and a Water-Linked-style DVL (altitude + ground
 * velocity). All computed analytically from the environment geometry and the
 * vehicle pose — pure, no three.js, no renderer — so the same data can drive a
 * sonar display, an altitude HUD, station-keeping practice, and the data lake,
 * with zero hardware. Unit-tested.
 *
 * Geometry note: sonar/echosounder are treated as horizontal plan-view
 * raycasts that only "see" obstacles whose vertical extent overlaps the
 * vehicle's depth (an imaging sonar has a narrow vertical fan), so you don't
 * paint a floor crate while hovering near the surface.
 */

/** A pose sufficient to drive the sensors. */
export interface SensorPose {
  /** Pool-local x, meters. */
  x: number
  /** Pool-local y, meters. */
  y: number
  /** Depth, meters positive down. */
  depth: number
  /** Heading, radians (0 = +x). */
  heading: number
  /** Body-frame forward velocity, m/s. */
  surgeVel: number
  /** Body-frame rightward velocity, m/s. */
  swayVel: number
  /** Body-frame downward velocity, m/s. */
  heaveVel: number
}

/** Ping360 imaging-sonar configuration. */
export interface SonarOptions {
  /** Number of angular bins around the full 360° (display resolution). */
  bins: number
  /** Maximum range, meters (no return → this value). */
  maxRangeM: number
}

/** Default Ping360-like sonar: 240 bins (1.5°), 20 m range. */
export const defaultSonarOptions: SonarOptions = { bins: 240, maxRangeM: 20 }

/** A DVL reading: altitude over bottom + ground velocity. */
export interface DvlReading {
  /** Altitude above the bottom (floor or whatever is directly below), meters. */
  altitudeM: number
  /** Ground velocity forward / right / down (body frame), m/s. */
  vx: number
  /** Rightward ground velocity, m/s. */
  vy: number
  /** Downward ground velocity, m/s. */
  vz: number
  /** Bottom lock: true when within the DVL's altitude envelope. */
  valid: boolean
}

const EPS = 1e-6

/**
 * Distance from a point to the nearest pool wall along a plan-view direction
 * (the ray exits the rectangular pool). The point is assumed inside.
 * @param {number} L Pool length.
 * @param {number} W Pool width.
 * @param {number} x Point x.
 * @param {number} y Point y.
 * @param {number} dx Unit direction x.
 * @param {number} dy Unit direction y.
 * @returns {number} Distance to the wall, meters.
 */
const wallDistance = (L: number, W: number, x: number, y: number, dx: number, dy: number): number => {
  const tx = dx > EPS ? (L - x) / dx : dx < -EPS ? -x / dx : Infinity
  const ty = dy > EPS ? (W - y) / dy : dy < -EPS ? -y / dy : Infinity
  return Math.max(0, Math.min(tx, ty))
}

/**
 * Nearest forward ray hit against a circle, or Infinity.
 * @param {number} x Ray origin x.
 * @param {number} y Ray origin y.
 * @param {number} dx Unit direction x.
 * @param {number} dy Unit direction y.
 * @param {number} cx Circle center x.
 * @param {number} cy Circle center y.
 * @param {number} r Circle radius.
 * @returns {number} Forward distance, or Infinity.
 */
const rayCircle = (x: number, y: number, dx: number, dy: number, cx: number, cy: number, r: number): number => {
  const ox = x - cx
  const oy = y - cy
  const b = 2 * (dx * ox + dy * oy)
  const c = ox * ox + oy * oy - r * r
  const disc = b * b - 4 * c
  if (disc < 0) return Infinity
  const s = Math.sqrt(disc)
  const t1 = (-b - s) / 2
  if (t1 >= 0) return t1
  const t2 = (-b + s) / 2
  return t2 >= 0 ? t2 : Infinity
}

/**
 * Nearest forward ray hit against an axis-aligned box (slab method), or Infinity.
 * @param {number} x Ray origin x.
 * @param {number} y Ray origin y.
 * @param {number} dx Unit direction x.
 * @param {number} dy Unit direction y.
 * @param {number} cx Box center x.
 * @param {number} cy Box center y.
 * @param {number} hx Box half-extent x.
 * @param {number} hy Box half-extent y.
 * @returns {number} Forward distance, or Infinity.
 */
const rayBox = (
  x: number,
  y: number,
  dx: number,
  dy: number,
  cx: number,
  cy: number,
  hx: number,
  hy: number
): number => {
  const inv = (d: number, lo: number, hi: number, p: number): [number, number] => {
    if (Math.abs(d) < EPS) return p < lo || p > hi ? [Infinity, -Infinity] : [-Infinity, Infinity]
    const t1 = (lo - p) / d
    const t2 = (hi - p) / d
    return t1 < t2 ? [t1, t2] : [t2, t1]
  }
  const [txmin, txmax] = inv(dx, cx - hx, cx + hx, x)
  const [tymin, tymax] = inv(dy, cy - hy, cy + hy, y)
  const tEnter = Math.max(txmin, tymin)
  const tExit = Math.min(txmax, tymax)
  if (tEnter > tExit || tExit < 0) return Infinity
  return tEnter >= 0 ? tEnter : 0
}

/**
 * Whether an obstacle's vertical extent overlaps the sonar beam at the given
 * depth (the beam widens with range to mimic the vertical fan).
 * @param {number} top Obstacle top depth.
 * @param {number} bottom Obstacle bottom depth.
 * @param {number} depth Vehicle depth.
 * @param {number} range Plan distance to the obstacle.
 * @returns {boolean} True if the beam touches it.
 */
const inBeam = (top: number, bottom: number, depth: number, range: number): boolean => {
  const half = 0.35 + 0.15 * range
  return top <= depth + half && bottom >= depth - half
}

/**
 * Range to the nearest pool wall or obstacle along a plan-view direction, as an
 * imaging sonar / echosounder would measure it.
 * @param {PracticeEnvironment} env The environment.
 * @param {number} x Vehicle x.
 * @param {number} y Vehicle y.
 * @param {number} depth Vehicle depth.
 * @param {number} dirX Unit direction x.
 * @param {number} dirY Unit direction y.
 * @param {number} maxRange Maximum range, meters.
 * @returns {number} Range to the nearest return, clamped to maxRange.
 */
export const rayRangeToEnvironment = (
  env: PracticeEnvironment,
  x: number,
  y: number,
  depth: number,
  dirX: number,
  dirY: number,
  maxRange: number
): number => {
  const len = Math.hypot(dirX, dirY) || 1
  const dx = dirX / len
  const dy = dirY / len
  let best = wallDistance(env.pool.length, env.pool.width, x, y, dx, dy)

  for (const obstacle of env.obstacles) {
    const [ox, oy, otop] = obstacle.position
    const top = otop
    const bottom = otop + (obstacle.shape === 'ring' ? obstacle.size[0] : obstacle.size[2])
    let hit: number
    if (obstacle.shape === 'box') {
      hit = rayBox(x, y, dx, dy, ox, oy, obstacle.size[0] / 2, obstacle.size[1] / 2)
    } else {
      // cylinder + ring: a circle (ring uses its outer radius).
      hit = rayCircle(x, y, dx, dy, ox, oy, obstacle.size[0] / 2)
    }
    if (hit < best && inBeam(top, bottom, depth, hit)) best = hit
  }
  return Math.min(best, maxRange)
}

/**
 * A full 360° imaging-sonar scan (vehicle-relative; bin 0 = straight ahead,
 * increasing clockwise). Each value is the range for that bearing.
 * @param {PracticeEnvironment} env The environment.
 * @param {SensorPose} pose The vehicle pose.
 * @param {SonarOptions} opts Sonar configuration.
 * @returns {number[]} Range per bin, length opts.bins.
 */
export const sonarScan = (env: PracticeEnvironment, pose: SensorPose, opts: SonarOptions): number[] => {
  const ranges = new Array(opts.bins)
  for (let i = 0; i < opts.bins; i++) {
    ranges[i] = sonarBeam(env, pose, i, opts)
  }
  return ranges
}

/**
 * The range for a single sonar bin (used by the live sweep, which only refreshes
 * a few bins per tick like a real mechanical scanner).
 * @param {PracticeEnvironment} env The environment.
 * @param {SensorPose} pose The vehicle pose.
 * @param {number} bin Bin index in [0, opts.bins).
 * @param {SonarOptions} opts Sonar configuration.
 * @returns {number} Range for that bearing, meters.
 */
export const sonarBeam = (env: PracticeEnvironment, pose: SensorPose, bin: number, opts: SonarOptions): number => {
  const bearing = (bin / opts.bins) * 2 * Math.PI // vehicle-relative, 0 = forward
  const world = pose.heading + bearing
  return rayRangeToEnvironment(env, pose.x, pose.y, pose.depth, Math.cos(world), Math.sin(world), opts.maxRangeM)
}

/**
 * Altitude above the bottom directly below the vehicle (floor, or the top of an
 * obstacle the vehicle is over) — what a downward echosounder / DVL reports.
 * @param {PracticeEnvironment} env The environment.
 * @param {number} x Vehicle x.
 * @param {number} y Vehicle y.
 * @param {number} depth Vehicle depth.
 * @returns {number} Altitude above the bottom, meters (>= 0).
 */
export const altitudeBelow = (env: PracticeEnvironment, x: number, y: number, depth: number): number => {
  let bottomDepth = env.pool.depth
  for (const obstacle of env.obstacles) {
    if (obstacle.shape === 'ring') continue
    const [ox, oy, otop] = obstacle.position
    if (otop <= depth) continue // only things below us raise the bottom
    let over = false
    if (obstacle.shape === 'box') {
      over = Math.abs(x - ox) <= obstacle.size[0] / 2 && Math.abs(y - oy) <= obstacle.size[1] / 2
    } else {
      over = Math.hypot(x - ox, y - oy) <= obstacle.size[0] / 2
    }
    if (over) bottomDepth = Math.min(bottomDepth, otop)
  }
  return Math.max(0, bottomDepth - depth)
}

/** DVL altitude envelope (bottom lock), meters. */
const DVL_MAX_ALTITUDE = 50
const DVL_MIN_ALTITUDE = 0.05

/**
 * DVL reading: altitude + body-frame ground velocity, with a bottom-lock flag.
 * @param {PracticeEnvironment} env The environment.
 * @param {SensorPose} pose The vehicle pose.
 * @returns {DvlReading} The DVL reading.
 */
export const computeDvl = (env: PracticeEnvironment, pose: SensorPose): DvlReading => {
  const altitudeM = altitudeBelow(env, pose.x, pose.y, pose.depth)
  return {
    altitudeM,
    vx: pose.surgeVel,
    vy: pose.swayVel,
    vz: pose.heaveVel,
    valid: altitudeM >= DVL_MIN_ALTITUDE && altitudeM <= DVL_MAX_ALTITUDE,
  }
}

/** The full simulated sensor readout for one tick. */
export interface SensorReadout {
  /** Downward echosounder altitude (Ping), meters. */
  altimeterM: number
  /** Forward echosounder range, meters. */
  forwardRangeM: number
  /** DVL altitude + ground velocity. */
  dvl: DvlReading
  /** Depth from pressure, meters. */
  pressureDepthM: number
}

/**
 * Compute the non-sweeping sensors (echosounders, DVL, pressure) for a tick.
 * The Ping360 sweep is maintained separately by the caller (it refreshes a few
 * bins per tick), but this gives the scalar instruments.
 * @param {PracticeEnvironment} env The environment.
 * @param {SensorPose} pose The vehicle pose.
 * @returns {SensorReadout} The scalar sensor readout.
 */
export const computeSensorReadout = (env: PracticeEnvironment, pose: SensorPose): SensorReadout => ({
  altimeterM: altitudeBelow(env, pose.x, pose.y, pose.depth),
  forwardRangeM: rayRangeToEnvironment(
    env,
    pose.x,
    pose.y,
    pose.depth,
    Math.cos(pose.heading),
    Math.sin(pose.heading),
    defaultSonarOptions.maxRangeM
  ),
  dvl: computeDvl(env, pose),
  pressureDepthM: Math.max(0, pose.depth),
})
