import { describe, expect, it } from 'vitest'

import {
  type Point3,
  type TetherState,
  applyTetherPhysics,
  initTetherNodes,
  tetherDeployedLength,
  tetherFullPath,
  tetherSnaggedObstacleIds,
} from '@/libs/rover-tether'
import { type PracticeEnvironment } from '@/types/practice-environment'

const makeEnv = (overrides: Partial<PracticeEnvironment> = {}): PracticeEnvironment => ({
  name: 'test pool',
  pool: { length: 30, width: 10, depth: 4 },
  water: { salinityPpt: 0, temperatureC: 15 },
  tether: { enabled: true, length: 60, attachPoint: [0, 5] },
  obstacles: [],
  schema: 'cockpit-practice-env/v1',
  ...overrides,
})

const makeState = (x: number, y: number, depth: number): TetherState => ({
  x,
  y,
  depth,
  heading: 0,
  roll: 0,
  pitch: 0,
  surgeVel: 0,
  swayVel: 0,
  heaveVel: 0,
  tetherNodes: [],
  tetherDeployed: 0,
})

/**
 * Settle the rope by stepping it N times, recomputing the rover-end from the
 * (possibly pulled-in) rover position each step — like the sim loop does.
 * @param {TetherState} state The state (mutated).
 * @param {PracticeEnvironment} env The environment.
 * @param {number} steps Number of 40 ms steps.
 * @returns {void}
 */
const settle = (state: TetherState, env: PracticeEnvironment, steps: number): void => {
  for (let i = 0; i < steps; i++) {
    const end: Point3 = { x: state.x, y: state.y, depth: state.depth }
    applyTetherPhysics(state, env, end, 0.04)
  }
}

describe('tether rope', () => {
  it('builds a node chain attached at the surface anchor and the rover end', () => {
    const env = makeEnv()
    const state = makeState(8, 5, 1)
    settle(state, env, 1)
    expect(state.tetherNodes.length).toBeGreaterThan(2)
    const first = state.tetherNodes[0]
    const lastNode = state.tetherNodes[state.tetherNodes.length - 1]
    expect(first.x).toBeCloseTo(0) // surface attach
    expect(first.y).toBeCloseTo(5)
    expect(lastNode.x).toBeCloseTo(8, 1) // rover end
    expect(lastNode.y).toBeCloseTo(5, 1)
  })

  it('clears the rope when the tether is disabled', () => {
    const env = makeEnv({ tether: { enabled: false, length: 60, attachPoint: [0, 5] } })
    const state = makeState(8, 5, 1)
    state.tetherNodes = initTetherNodes(makeEnv(), { x: 8, y: 5, depth: 1 })
    applyTetherPhysics(state, env, { x: 8, y: 5, depth: 1 }, 0.04)
    expect(state.tetherNodes).toHaveLength(0)
  })

  it('pays out cable as the rover moves out, growing the deployed length', () => {
    const env = makeEnv()
    const near = makeState(4, 5, 1)
    settle(near, env, 60)
    const far = makeState(20, 5, 1)
    settle(far, env, 60)
    expect(tetherDeployedLength(far, env)).toBeGreaterThan(tetherDeployedLength(near, env))
  })

  it('enforces the tether length as a hard limit and pulls the rover in', () => {
    const env = makeEnv({
      pool: { length: 60, width: 10, depth: 4 },
      tether: { enabled: true, length: 6, attachPoint: [0, 5] },
    })
    const state = makeState(40, 5, 1) // way past a 6 m tether
    settle(state, env, 400)
    expect(tetherDeployedLength(state, env)).toBeLessThanOrEqual(env.tether.length + 0.2)
    expect(Math.hypot(state.x - 0, state.y - 5, state.depth)).toBeLessThanOrEqual(env.tether.length + 0.3)
    expect(state.x).toBeLessThan(20) // dragged well back in
  })

  it('wraps and STICKS on a post between the anchor and the rover', () => {
    const env = makeEnv({
      tether: { enabled: true, length: 60, attachPoint: [0, 5] },
      obstacles: [{ id: 'post', name: 'Post', shape: 'cylinder', position: [8, 5, 0], size: [0.6, 0.6, 4] }],
    })
    // Rover beyond the post on the anchor→post line (tiny offset breaks symmetry)
    // so the straight cable runs through the post and must bend around it.
    const state = makeState(16, 5.4, 1)
    settle(state, env, 250)
    expect(tetherSnaggedObstacleIds(state, env)).toContain('post')
    // The rope hugs the post: some node sits on the post's surface ring.
    const hugging = state.tetherNodes.some((n) => Math.abs(Math.hypot(n.x - 8, n.y - 5) - (0.3 + 0.045)) < 0.15)
    expect(hugging).toBe(true)
  })

  it('routes the rendered path from the attach point through the ice hole', () => {
    const env = makeEnv({
      iceSheet: { thickness: 0.03, holeCenter: [3, 5], holeSize: 1 },
      tether: { enabled: true, length: 60, attachPoint: [0, 5] },
    })
    const state = makeState(10, 5, 2)
    settle(state, env, 5)
    const path = tetherFullPath(state, env)
    expect(path[0].x).toBeCloseTo(0) // attach
    expect(path[1].x).toBeCloseTo(3) // ice hole (first rope node pinned there)
    expect(path[1].depth).toBeCloseTo(0)
  })

  it('reels slack back in after the rover returns toward the anchor', () => {
    const env = makeEnv({
      pool: { length: 30, width: 10, depth: 4 },
      tether: { enabled: true, length: 60, attachPoint: [0, 5] },
    })
    const state = makeState(22, 5, 1)
    settle(state, env, 120) // pay out a lot of cable
    const deployedFar = tetherDeployedLength(state, env)
    state.x = 3 // drive back near the anchor
    state.y = 5
    settle(state, env, 400)
    expect(tetherDeployedLength(state, env)).toBeLessThan(deployedFar - 5) // cable reeled in
  })

  it('renders the rope END at the rover rear even when taut (no detached tip)', () => {
    const env = makeEnv({
      pool: { length: 60, width: 10, depth: 4 },
      tether: { enabled: true, length: 6, attachPoint: [0, 5] },
    })
    const state = makeState(40, 5, 1)
    settle(state, env, 400) // taut: the last free node falls short of the rover
    const path = tetherFullPath(state, env)
    const end = path[path.length - 1]
    expect(end.x).toBeCloseTo(state.x, 4) // the rendered tip is the rover rear, not the short node
    expect(end.y).toBeCloseTo(state.y, 4)
  })

  it('keeps the rope inside the pool (no node leaves the walls/floor)', () => {
    const env = makeEnv({ tether: { enabled: true, length: 60, attachPoint: [0, 5] } })
    const state = makeState(28, 9, 3.5) // near the far corner / floor
    settle(state, env, 80)
    for (const n of state.tetherNodes) {
      expect(n.x).toBeGreaterThanOrEqual(-0.01)
      expect(n.x).toBeLessThanOrEqual(env.pool.length + 0.01)
      expect(n.depth).toBeGreaterThanOrEqual(-0.01)
      expect(n.depth).toBeLessThanOrEqual(env.pool.depth + 0.01)
    }
  })
})
