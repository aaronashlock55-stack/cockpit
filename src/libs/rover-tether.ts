import { bodyToWorld, worldToBody } from '@/libs/rover-hydro'
import { type PracticeEnvironment, type PracticeObstacle } from '@/types/practice-environment'

/**
 * Tether model for the practice simulator — a real 3D rope, not a rubber band.
 *
 * The cable is a chain of point masses (Verlet integration + position-based
 * distance constraints) pinned at the surface attach point (routed through the
 * ice launch hole when present) and at the REAR of the rover, so the rope leaves
 * the back of the hull and never clips through it. Each node:
 * - sags under a gentle catenary load and is damped by the water,
 * - collides with posts/props (capsules), boxes, the pool walls and floor, and
 *   STICKS via contact friction — so the cable genuinely wraps, snags and
 *   TANGLES around obstacles and stays caught when you back off,
 * - shares an inextensible length: when the wrapped path consumes more cable
 *   than is paid out, the rope pulls the rover up short (and kills its outward
 *   momentum), and the winch pays out smoothly until it runs out.
 *
 * Pure + deterministic (no RNG in the step) so it is unit-testable.
 */

/** A point in pool-local coordinates. */
export interface Point3 {
  /** Pool-local x, meters. */
  x: number
  /** Pool-local y, meters. */
  y: number
  /** Depth, meters (positive down). */
  depth: number
}

/** One rope node: current + previous position (Verlet) and a contact flag. */
export interface TetherNode {
  /** Pool-local x, meters. */
  x: number
  /** Pool-local y, meters. */
  y: number
  /** Depth, meters. */
  depth: number
  /** Previous x (Verlet). */
  px: number
  /** Previous y (Verlet). */
  py: number
  /** Previous depth (Verlet). */
  pd: number
  /** True the step this node was in contact with something (drives friction + visuals). */
  touching?: boolean
}

/** Minimal view of the rover state the tether needs (mutated in place). */
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
  /** The rope nodes (surface-anchor side first, rover side last). */
  tetherNodes: TetherNode[]
  /** Paid-out cable length on the dynamic span (hole/attach → rover), meters. */
  tetherDeployed: number
  /** The rover-rear attach point from the last step (renders the rope into the hull). */
  roverEndCache?: Point3
  /** Whatever the rover is touching, set when the tether goes taut. */
  collidedWith?: string
  /** Currently held obstacle id (the cable ignores it). */
  heldObstacleId?: string
}

/** Number of rope nodes (chain resolution). */
const NODE_COUNT = 48
/** Position-constraint relaxation iterations per step. */
const SOLVE_ITERS = 8
/** Rope radius, meters (collision standoff + render thickness). */
export const TETHER_RADIUS = 0.045
/** Catenary sag acceleration on free nodes, m/s² (gentle — cable is near-neutral). */
const SAG_ACCEL = 0.6
/** Per-step Verlet velocity retention (water drag); <1 damps. */
const DAMPING = 0.9
/** Contact friction: fraction of tangential velocity kept at a contact (low = grippy → stays tangled). */
const CONTACT_SLIP = 0.25
/** Winch pay-out / take-up rate, m/s. */
const PAY_RATE = 1.2
const TEND_RATE = 0.5
/** Gap (m) beyond reach before the taut rope pulls the rover. */
const TAUT_TOL = 0.05
/** Max distance (m) the taut rope pulls the rover per step (stability clamp). */
const MAX_PULL_PER_STEP = 0.5

const dist3 = (a: Point3, b: Point3): number => Math.hypot(b.x - a.x, b.y - a.y, b.depth - a.depth)

/**
 * Fixed surface routing: the attach point, plus the ice launch hole if present.
 * The dynamic rope hangs from the LAST of these to the rover.
 * @param {PracticeEnvironment} env The environment.
 * @returns {Point3[]} Surface anchor points, in order.
 */
const surfaceAnchors = (env: PracticeEnvironment): Point3[] => {
  const attach: Point3 = { x: env.tether.attachPoint[0], y: env.tether.attachPoint[1], depth: 0 }
  if (!env.iceSheet) return [attach]
  return [attach, { x: env.iceSheet.holeCenter[0], y: env.iceSheet.holeCenter[1], depth: 0 }]
}

/**
 * Plan-view radius an obstacle presents to the cable.
 * @param {PracticeObstacle} o The obstacle.
 * @returns {number} Radius in meters.
 */
const obstacleRadius = (o: PracticeObstacle): number =>
  o.shape === 'cylinder' ? o.size[0] / 2 : Math.max(o.size[0], o.size[1]) / 2

/**
 * Build a fresh rope from the last surface anchor to the rover end, laid in a
 * straight line (Verlet velocities zero).
 * @param {PracticeEnvironment} env The environment.
 * @param {Point3} roverEnd The rover-rear attach point.
 * @returns {TetherNode[]} The node chain.
 */
export const initTetherNodes = (env: PracticeEnvironment, roverEnd: Point3): TetherNode[] => {
  const anchors = surfaceAnchors(env)
  const start = anchors[anchors.length - 1]
  const nodes: TetherNode[] = []
  for (let i = 0; i < NODE_COUNT; i++) {
    const t = i / (NODE_COUNT - 1)
    const x = start.x + (roverEnd.x - start.x) * t
    const y = start.y + (roverEnd.y - start.y) * t
    const depth = start.depth + (roverEnd.depth - start.depth) * t
    nodes.push({ x, y, depth, px: x, py: y, pd: depth, touching: false })
  }
  return nodes
}

/**
 * The full render/measure path: fixed surface anchors then the rope nodes.
 * (Node 0 coincides with the last surface anchor, so it isn't duplicated.)
 * @param {TetherState} state The sim state.
 * @param {PracticeEnvironment} env The environment.
 * @returns {Point3[]} Waypoints from attach point to rover.
 */
export const tetherFullPath = (state: TetherState, env: PracticeEnvironment): Point3[] => {
  const anchors = surfaceAnchors(env)
  const lead = anchors.slice(0, -1) // attach (and nothing else) when there's an ice hole
  const nodes = state.tetherNodes.map((n) => ({ x: n.x, y: n.y, depth: n.depth }))
  // Render the last point AT the rover rear, not the (possibly taut-and-short)
  // last free node, so the cable always terminates in the hull's boss.
  if (state.roverEndCache && nodes.length > 0) nodes[nodes.length - 1] = { ...state.roverEndCache }
  return [...lead, ...nodes]
}

/**
 * Deployed cable length (fixed surface run + paid-out dynamic span) — drives
 * tether drag and the deployed/limit UI.
 * @param {TetherState} state The sim state.
 * @param {PracticeEnvironment} env The environment.
 * @returns {number} Deployed length in meters.
 */
export const tetherDeployedLength = (state: TetherState, env: PracticeEnvironment): number => {
  const anchors = surfaceAnchors(env)
  let lead = 0
  for (let i = 1; i < anchors.length; i++) lead += dist3(anchors[i - 1], anchors[i])
  return lead + state.tetherDeployed
}

/**
 * Push one node out of a single obstacle (capsule for cylinders/rings, vertical
 * box for boxes), returning true if it was in contact.
 * @param {TetherNode} node The node (mutated).
 * @param {PracticeObstacle} o The obstacle.
 * @returns {boolean} True if the node was pushed out.
 */
const collideNodeWithObstacle = (node: TetherNode, o: PracticeObstacle): boolean => {
  const [ox, oy, otop] = o.position
  const obottom = otop + (o.shape === 'ring' ? o.size[0] : o.size[2])
  if (node.depth < otop - TETHER_RADIUS || node.depth > obottom + TETHER_RADIUS) return false
  if (o.shape === 'box') {
    const hx = o.size[0] / 2 + TETHER_RADIUS
    const hy = o.size[1] / 2 + TETHER_RADIUS
    const dx = node.x - ox
    const dy = node.y - oy
    if (Math.abs(dx) >= hx || Math.abs(dy) >= hy) return false
    // Push out along the least-penetrating horizontal face.
    if (hx - Math.abs(dx) < hy - Math.abs(dy)) node.x = ox + Math.sign(dx || 1) * hx
    else node.y = oy + Math.sign(dy || 1) * hy
    return true
  }
  // cylinder / ring: radial push in plan view.
  const r = obstacleRadius(o) + TETHER_RADIUS
  const dx = node.x - ox
  const dy = node.y - oy
  const d = Math.hypot(dx, dy)
  if (d >= r) return false
  if (d < 1e-6) {
    node.x = ox + r
  } else {
    node.x = ox + (dx / d) * r
    node.y = oy + (dy / d) * r
  }
  return true
}

/**
 * Constrain a node to the pool box (walls, floor, surface/ice), returning true
 * on contact.
 * @param {TetherNode} node The node (mutated).
 * @param {PracticeEnvironment} env The environment.
 * @returns {boolean} True if clamped.
 */
const collideNodeWithPool = (node: TetherNode, env: PracticeEnvironment): boolean => {
  const { length: L, width: W, depth: D } = env.pool
  let touched = false
  const minX = TETHER_RADIUS
  const maxX = L - TETHER_RADIUS
  const minY = TETHER_RADIUS
  const maxY = W - TETHER_RADIUS
  if (node.x < minX) {
    node.x = minX
    touched = true
  } else if (node.x > maxX) {
    node.x = maxX
    touched = true
  }
  if (node.y < minY) {
    node.y = minY
    touched = true
  } else if (node.y > maxY) {
    node.y = maxY
    touched = true
  }
  if (node.depth > D - TETHER_RADIUS) {
    node.depth = D - TETHER_RADIUS
    touched = true
  }
  if (node.depth < 0) {
    node.depth = 0
    touched = true
  }
  return touched
}

/**
 * Advance the rope one step and resolve its effect on the rover.
 * @param {TetherState} state The sim state (rope + rover, mutated in place).
 * @param {PracticeEnvironment} env The environment.
 * @param {Point3} roverEnd The rover-rear attach point this step.
 * @param {number} dt Timestep, seconds.
 * @returns {void}
 */
export const applyTetherPhysics = (
  state: TetherState,
  env: PracticeEnvironment,
  roverEnd: Point3,
  dt: number
): void => {
  if (!env.tether.enabled) {
    state.tetherNodes = []
    return
  }
  const anchors = surfaceAnchors(env)
  const start = anchors[anchors.length - 1]
  // The dynamic rope (hole/attach → rover) shares the total cable budget with
  // the fixed surface run, so its max length is what's left after the lead.
  let leadLen = 0
  for (let i = 1; i < anchors.length; i++) leadLen += dist3(anchors[i - 1], anchors[i])
  const maxDynamic = Math.max(env.tether.length - leadLen, 0.5)

  // (Re)initialize if the rope is missing or the wrong size.
  if (state.tetherNodes.length !== NODE_COUNT) {
    state.tetherNodes = initTetherNodes(env, roverEnd)
    state.tetherDeployed = Math.min(maxDynamic, Math.max(dist3(start, roverEnd) * 1.05, 0.5))
  }
  const nodes = state.tetherNodes
  const last = NODE_COUNT - 1
  state.roverEndCache = { x: roverEnd.x, y: roverEnd.y, depth: Math.max(0, roverEnd.depth) }

  // Verlet integration of the free interior nodes (ends are pinned below).
  const sub = Math.min(dt, 0.05)
  const obstacles = env.obstacles.filter((o) => o.id !== state.heldObstacleId)
  for (let i = 1; i < last; i++) {
    const n = nodes[i]
    const vx = (n.x - n.px) * DAMPING
    const vy = (n.y - n.py) * DAMPING
    const vd = (n.depth - n.pd) * DAMPING
    n.px = n.x
    n.py = n.y
    n.pd = n.depth
    n.x += vx
    n.y += vy
    n.depth += vd + SAG_ACCEL * sub * sub
    n.touching = false
  }

  // Pin node 0 at the surface anchor. The LAST node is seeded at the rover rear
  // but left FREE during the solve, so an inextensible rope that can't reach the
  // rover simply falls short (the gap = tension) instead of overstretching.
  nodes[0].x = start.x
  nodes[0].y = start.y
  nodes[0].depth = start.depth
  nodes[last].x = roverEnd.x
  nodes[last].y = roverEnd.y
  nodes[last].depth = Math.max(0, roverEnd.depth)

  // Relax distance constraints + collisions. Each segment is held at the rest
  // length set by the paid-out cable; only node 0 is pinned.
  const seg = state.tetherDeployed / (NODE_COUNT - 1)
  for (let iter = 0; iter < SOLVE_ITERS; iter++) {
    for (let i = 0; i < last; i++) {
      const a = nodes[i]
      const b = nodes[i + 1]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const dd = b.depth - a.depth
      const d = Math.hypot(dx, dy, dd) || 1e-6
      const diff = (d - seg) / d
      const wa = i === 0 ? 0 : 0.5
      const wb = i === 0 ? 1 : 0.5
      a.x += dx * diff * wa
      a.y += dy * diff * wa
      a.depth += dd * diff * wa
      b.x -= dx * diff * wb
      b.y -= dy * diff * wb
      b.depth -= dd * diff * wb
    }
    // Collisions on the interior nodes (the end nodes are the anchors).
    for (let i = 1; i < last; i++) {
      const n = nodes[i]
      let hit = collideNodeWithPool(n, env)
      for (const o of obstacles) if (collideNodeWithObstacle(n, o)) hit = true
      if (hit) n.touching = true
    }
    nodes[0].x = start.x
    nodes[0].y = start.y
    nodes[0].depth = start.depth
  }

  // Contact friction: a node that touched something this step keeps only a
  // little of its tangential velocity, so the rope grabs and stays tangled.
  for (let i = 1; i < last; i++) {
    const n = nodes[i]
    if (!n.touching) continue
    n.px = n.x + (n.px - n.x) * CONTACT_SLIP
    n.py = n.y + (n.py - n.y) * CONTACT_SLIP
    n.pd = n.depth + (n.pd - n.depth) * CONTACT_SLIP
  }

  const anyContact = nodes.some((n) => n.touching)

  // Tension: the gap between where the rope can reach and where the rover is.
  let gx = roverEnd.x - nodes[last].x
  let gy = roverEnd.y - nodes[last].y
  let gd = roverEnd.depth - nodes[last].depth
  const gap = Math.hypot(gx, gy, gd)

  if (gap > TAUT_TOL) {
    if (state.tetherDeployed < maxDynamic) {
      // Winch still has cable: pay out so the rope reaches next step.
      state.tetherDeployed = Math.min(maxDynamic, state.tetherDeployed + PAY_RATE * dt)
    } else {
      // Out of cable: pull the rover back to where the rope can reach (clamped
      // per step for stability) and kill its outward momentum.
      const pull = Math.min(gap, MAX_PULL_PER_STEP)
      gx /= gap
      gy /= gap
      gd /= gap
      state.x -= gx * pull
      state.y -= gy * pull
      state.depth = Math.max(0, state.depth - gd * pull)
      const [wx, wy, wz] = bodyToWorld(
        state.surgeVel,
        state.swayVel,
        state.heaveVel,
        state.roll,
        state.pitch,
        state.heading
      )
      const outward = wx * gx + wy * gy + wz * gd
      if (outward > 0) {
        const [bu, bv, bw] = worldToBody(
          wx - gx * outward,
          wy - gy * outward,
          wz - gd * outward,
          state.roll,
          state.pitch,
          state.heading
        )
        state.surgeVel = bu
        state.swayVel = bv
        state.heaveVel = bw
      }
      state.collidedWith = state.collidedWith ?? (anyContact ? 'tether (snagged)' : 'tether (taut)')
    }
  } else {
    // Slack and reaching: gently take up extra cable so slack doesn't pile up.
    // Compare against the TRUE straight-line reach (start → rover), NOT the
    // sagged node-chain length — the latter inflates to track the deployed
    // length once slack rope piles on the floor, so take-up would never fire.
    // A rope snagged on an OBSTACLE legitimately needs more than the straight
    // run, so don't reel that in (floor contact alone is fine to take up).
    const snaggedOnObstacle = tetherSnaggedObstacleIds(state, env).length > 0
    if (!snaggedOnObstacle && state.tetherDeployed > dist3(start, roverEnd) + 0.8) {
      state.tetherDeployed = Math.max(0.5, state.tetherDeployed - TEND_RATE * dt)
    }
    if (anyContact && !state.collidedWith) state.collidedWith = 'tether (snagged)'
  }
}

/**
 * Ids of obstacles the rope is currently caught on (for highlighting them).
 * @param {TetherState} state The sim state.
 * @param {PracticeEnvironment} env The environment.
 * @returns {string[]} Obstacle ids in contact with the cable.
 */
export const tetherSnaggedObstacleIds = (state: TetherState, env: PracticeEnvironment): string[] => {
  const ids = new Set<string>()
  for (const n of state.tetherNodes) {
    if (!n.touching) continue
    for (const o of env.obstacles) {
      if (o.id === state.heldObstacleId) continue
      const [ox, oy, otop] = o.position
      const obottom = otop + (o.shape === 'ring' ? o.size[0] : o.size[2])
      if (n.depth < otop - TETHER_RADIUS - 0.05 || n.depth > obottom + TETHER_RADIUS + 0.05) continue
      const reach = obstacleRadius(o) + TETHER_RADIUS + 0.06
      if (Math.hypot(n.x - ox, n.y - oy) <= reach) ids.add(o.id)
    }
  }
  return [...ids]
}
