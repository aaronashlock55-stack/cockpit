import { bodyToWorld, worldToBody } from '@/libs/rover-hydro'
import { type PracticeEnvironment, type PracticeObstacle } from '@/types/practice-environment'

/**
 * Tether model for the practice simulator. The cable is a taut inextensible
 * line from the surface attach point to the rover. It:
 * - routes through the ice launch hole when there is an ice sheet,
 * - SNAGS on obstacles: when the free run from the last anchor to the rover
 *   crosses a prop/post, a wrap point is pinned at that obstacle's edge and the
 *   cable bends around it (and unwinds when the rover comes back),
 * - enforces a hard length limit measured along the whole wrapped path, killing
 *   the rover's outward momentum when it snaps taut.
 *
 * Wrap handling is a plan-view "rubber band around pegs" approximation: corners
 * sit on the outside of each bend and slide around the peg as the rover moves,
 * which is good enough to make tether management a real part of piloting.
 */

/** A point where the tether is pinned against an obstacle as it bends around it. */
export interface TetherWrap {
  /** Pool-local x of the bend point, meters. */
  x: number
  /** Pool-local y of the bend point, meters. */
  y: number
  /** Depth of the bend point, meters. */
  depth: number
  /** The obstacle the cable is caught on. */
  obstacleId: string
}

/** A point in pool-local coordinates (subset of the sim's PoolPoint). */
interface Point3 {
  /** Pool-local x, meters. */
  x: number
  /** Pool-local y, meters. */
  y: number
  /** Depth, meters. */
  depth: number
}

/** Minimal view of the rover state the tether needs. */
export interface TetherState {
  /** Pool-local x, meters. */
  x: number
  /** Pool-local y, meters. */
  y: number
  /** Depth, meters. */
  depth: number
  /** Heading, rad. */
  heading: number
  /** Roll, rad. */
  roll: number
  /** Pitch, rad. */
  pitch: number
  /** Body forward velocity, m/s. */
  surgeVel: number
  /** Body right velocity, m/s. */
  swayVel: number
  /** Body down velocity, m/s. */
  heaveVel: number
  /** Current tether wraps. */
  tetherWraps: TetherWrap[]
  /** Whatever the rover is touching, set when the tether goes taut. */
  collidedWith?: string
  /** Currently held obstacle id (never snags the tether). */
  heldObstacleId?: string
}

/** How far past an obstacle's radius the cable rides, meters. */
const SNAG_MARGIN = 0.06
/** Extra clearance required before a wrap releases (hysteresis), meters. */
const RELEASE_MARGIN = 0.25

const segLen = (a: Point3, b: Point3): number => Math.hypot(b.x - a.x, b.y - a.y, b.depth - a.depth)

/**
 * Fixed surface routing: the attach point, plus the ice launch hole if present.
 * @param {PracticeEnvironment} env The environment.
 * @returns {Point3[]} Surface anchor points, in order.
 */
const surfaceAnchors = (env: PracticeEnvironment): Point3[] => {
  const attach: Point3 = { x: env.tether.attachPoint[0], y: env.tether.attachPoint[1], depth: 0 }
  if (!env.iceSheet) return [attach]
  return [attach, { x: env.iceSheet.holeCenter[0], y: env.iceSheet.holeCenter[1], depth: 0 }]
}

/**
 * The full tether path: surface anchors → wrap points → rover.
 * @param {TetherWrap[]} wraps Current wrap points.
 * @param {Point3} rover Rover position.
 * @param {PracticeEnvironment} env The environment.
 * @returns {Point3[]} Waypoints from attach point to rover.
 */
export const tetherFullPath = (wraps: TetherWrap[], rover: Point3, env: PracticeEnvironment): Point3[] => [
  ...surfaceAnchors(env),
  ...wraps.map((w) => ({ x: w.x, y: w.y, depth: w.depth })),
  rover,
]

/**
 * Deployed tether length along its real (wrapped, hole-routed) path.
 * @param {TetherState} state Current sim state (position + wraps).
 * @param {PracticeEnvironment} env The environment.
 * @returns {number} Deployed distance in meters.
 */
export const tetherDeployedLength = (state: TetherState, env: PracticeEnvironment): number => {
  const path = tetherFullPath(state.tetherWraps, { x: state.x, y: state.y, depth: state.depth }, env)
  let total = 0
  for (let i = 1; i < path.length; i++) total += segLen(path[i - 1], path[i])
  return total
}

/**
 * Plan-view radius an obstacle presents to the cable.
 * @param {PracticeObstacle} o The obstacle.
 * @returns {number} Radius in meters.
 */
const obstacleRadius = (o: PracticeObstacle): number =>
  o.shape === 'cylinder' ? o.size[0] / 2 : Math.max(o.size[0], o.size[1]) / 2

/** Result of a closest-approach query. */
interface Approach {
  /** Parameter along the segment, [0, 1]. */
  t: number
  /** Plan-view distance from the point to the segment, meters. */
  dist: number
}

/**
 * Closest approach of plan-view segment AB to a point O.
 * @param {Point3} a Segment start.
 * @param {Point3} b Segment end.
 * @param {number} ox Point x.
 * @param {number} oy Point y.
 * @returns {Approach} Parameter t in [0,1] and plan-view distance.
 */
const closestApproach = (a: Point3, b: Point3, ox: number, oy: number): Approach => {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const t = len2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((ox - a.x) * dx + (oy - a.y) * dy) / len2))
  return { t, dist: Math.hypot(a.x + t * dx - ox, a.y + t * dy - oy) }
}

/**
 * Obstacles the cable can catch on (skip open hoops and the held prop).
 * @param {PracticeEnvironment} env The environment.
 * @param {string} heldId Id of the currently held prop, if any.
 * @returns {PracticeObstacle[]} Snaggable obstacles.
 */
const snaggable = (env: PracticeEnvironment, heldId?: string): PracticeObstacle[] =>
  env.obstacles.filter((o) => o.shape !== 'ring' && o.id !== heldId)

/**
 * Reposition existing wrap corners to hug the outside of each bend, so the cable
 * slides around a peg as the rover moves instead of staying pinned at one spot.
 * @param {TetherState} state The sim state (wraps mutated in place).
 * @param {PracticeEnvironment} env The environment.
 * @returns {void}
 */
const repositionWraps = (state: TetherState, env: PracticeEnvironment): void => {
  const anchors = surfaceAnchors(env)
  const rover: Point3 = { x: state.x, y: state.y, depth: state.depth }
  for (let i = 0; i < state.tetherWraps.length; i++) {
    const wrap = state.tetherWraps[i]
    const obstacle = env.obstacles.find((o) => o.id === wrap.obstacleId)
    if (!obstacle) continue
    const before = i > 0 ? state.tetherWraps[i - 1] : anchors[anchors.length - 1]
    const after = i < state.tetherWraps.length - 1 ? state.tetherWraps[i + 1] : rover
    const [ox, oy] = [obstacle.position[0], obstacle.position[1]]
    // Outward bisector of the two segments meeting at this corner.
    const b = Math.hypot(before.x - ox, before.y - oy) || 1
    const f = Math.hypot(after.x - ox, after.y - oy) || 1
    let bx = (before.x - ox) / b + (after.x - ox) / f
    let by = (before.y - oy) / b + (after.y - oy) / f
    const bl = Math.hypot(bx, by)
    if (bl < 1e-4) continue
    bx /= bl
    by /= bl
    const r = obstacleRadius(obstacle) + SNAG_MARGIN
    wrap.x = ox + bx * r
    wrap.y = oy + by * r
  }
}

/**
 * Release the last wrap (LIFO) while the straight run from the point before it
 * to the rover clears its obstacle — i.e. the rover has unwound past the peg.
 * @param {TetherState} state The sim state (wraps mutated in place).
 * @param {PracticeEnvironment} env The environment.
 * @returns {void}
 */
const releaseWraps = (state: TetherState, env: PracticeEnvironment): void => {
  const anchors = surfaceAnchors(env)
  const rover: Point3 = { x: state.x, y: state.y, depth: state.depth }
  while (state.tetherWraps.length > 0) {
    const wraps = state.tetherWraps
    const wrap = wraps[wraps.length - 1]
    const obstacle = env.obstacles.find((o) => o.id === wrap.obstacleId)
    if (!obstacle) {
      wraps.pop()
      continue
    }
    const before = wraps.length > 1 ? wraps[wraps.length - 2] : anchors[anchors.length - 1]
    const { dist } = closestApproach(before, rover, obstacle.position[0], obstacle.position[1])
    if (dist > obstacleRadius(obstacle) + RELEASE_MARGIN) wraps.pop()
    else break
  }
}

/**
 * Snag a new wrap if the free run from the last anchor to the rover crosses an
 * obstacle at the cable's depth. At most one new wrap per step.
 * @param {TetherState} state The sim state (wraps mutated in place).
 * @param {PracticeEnvironment} env The environment.
 * @returns {void}
 */
const snagWraps = (state: TetherState, env: PracticeEnvironment): void => {
  const anchors = surfaceAnchors(env)
  const wraps = state.tetherWraps
  const last = wraps.length > 0 ? wraps[wraps.length - 1] : anchors[anchors.length - 1]
  const rover: Point3 = { x: state.x, y: state.y, depth: state.depth }
  for (const obstacle of snaggable(env, state.heldObstacleId)) {
    if (wraps.some((w) => w.obstacleId === obstacle.id)) continue
    const [ox, oy, otop] = obstacle.position
    const { t, dist } = closestApproach(last, rover, ox, oy)
    if (t <= 0.05 || t >= 0.95) continue
    const r = obstacleRadius(obstacle)
    if (dist >= r + SNAG_MARGIN || dist < 1e-4) continue
    const cornerDepth = last.depth + t * (rover.depth - last.depth)
    if (cornerDepth < otop - 0.15 || cornerDepth > otop + obstacle.size[2] + 0.15) continue
    const closeX = last.x + t * (rover.x - last.x)
    const closeY = last.y + t * (rover.y - last.y)
    const nx = (closeX - ox) / dist
    const ny = (closeY - oy) / dist
    wraps.push({
      x: ox + nx * (r + SNAG_MARGIN),
      y: oy + ny * (r + SNAG_MARGIN),
      depth: cornerDepth,
      obstacleId: obstacle.id,
    })
    return
  }
}

/**
 * Resolve all tether physics for this step: update snags, then enforce the hard
 * length limit along the wrapped path (pulling the rover onto the budget sphere
 * around the final anchor and killing its outward momentum).
 * @param {TetherState} state The sim state (mutated in place).
 * @param {PracticeEnvironment} env The environment.
 * @returns {void}
 */
export const applyTetherPhysics = (state: TetherState, env: PracticeEnvironment): void => {
  if (!env.tether.enabled) {
    state.tetherWraps = []
    return
  }
  repositionWraps(state, env)
  releaseWraps(state, env)
  snagWraps(state, env)

  // Length limit along the full path; the final free segment gets what's left.
  const anchors = surfaceAnchors(env)
  const chain = [...anchors, ...state.tetherWraps.map((w) => ({ x: w.x, y: w.y, depth: w.depth }))]
  const anchor = chain[chain.length - 1]
  let priorLen = 0
  for (let i = 1; i < chain.length; i++) priorLen += segLen(chain[i - 1], chain[i])
  const budget = Math.max(env.tether.length - priorLen, 0.1)
  const rover: Point3 = { x: state.x, y: state.y, depth: state.depth }
  const free = segLen(anchor, rover)
  if (free <= budget) return

  const scale = budget / free
  state.x = anchor.x + (state.x - anchor.x) * scale
  state.y = anchor.y + (state.y - anchor.y) * scale
  state.depth = Math.max(0, anchor.depth + (state.depth - anchor.depth) * scale)
  // Kill the velocity component pointing away from the anchor.
  const away = [(state.x - anchor.x) / budget, (state.y - anchor.y) / budget, (state.depth - anchor.depth) / budget]
  const [wx, wy, wz] = bodyToWorld(
    state.surgeVel,
    state.swayVel,
    state.heaveVel,
    state.roll,
    state.pitch,
    state.heading
  )
  const outward = wx * away[0] + wy * away[1] + wz * away[2]
  if (outward > 0) {
    const [bu, bv, bw] = worldToBody(
      wx - away[0] * outward,
      wy - away[1] * outward,
      wz - away[2] * outward,
      state.roll,
      state.pitch,
      state.heading
    )
    state.surgeVel = bu
    state.swayVel = bv
    state.heaveVel = bw
  }
  state.collidedWith = state.collidedWith ?? (state.tetherWraps.length > 0 ? 'tether (snagged)' : 'tether (taut)')
}
