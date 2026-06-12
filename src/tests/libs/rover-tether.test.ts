import { describe, expect, it } from 'vitest'

import {
  type TetherState,
  type TetherWrap,
  applyTetherPhysics,
  tetherDeployedLength,
  tetherFullPath,
} from '@/libs/rover-tether'
import { type PracticeEnvironment } from '@/types/practice-environment'

const makeEnv = (overrides: Partial<PracticeEnvironment> = {}): PracticeEnvironment => ({
  name: 'tether pool',
  pool: { length: 20, width: 10, depth: 3 },
  water: { salinityPpt: 0, temperatureC: 15 },
  tether: { enabled: true, length: 100, attachPoint: [0, 5] },
  obstacles: [{ id: 'post', name: 'Post', shape: 'cylinder', position: [6, 5, 0], size: [0.6, 0.6, 3] }],
  schema: 'cockpit-practice-env/v1',
  ...overrides,
})

const makeState = (x: number, y: number, depth: number, wraps: TetherWrap[] = []): TetherState => ({
  x,
  y,
  depth,
  heading: 0,
  roll: 0,
  pitch: 0,
  surgeVel: 0,
  swayVel: 0,
  heaveVel: 0,
  tetherWraps: wraps,
})

describe('tether snag physics', () => {
  it('snags on a post when the cable run crosses it', () => {
    const env = makeEnv()
    // Straight run from attach (0,5) to the rover (8, 5.2) clips the post at (6,5).
    const state = makeState(8, 5.2, 1)
    applyTetherPhysics(state, env)
    expect(state.tetherWraps).toHaveLength(1)
    expect(state.tetherWraps[0].obstacleId).toBe('post')
  })

  it('a snag makes the deployed length longer than the straight-line distance', () => {
    const env = makeEnv()
    const state = makeState(8, 5.2, 1)
    applyTetherPhysics(state, env)
    const straight = Math.hypot(state.x - 0, state.y - 5, state.depth)
    expect(tetherDeployedLength(state, env)).toBeGreaterThan(straight)
  })

  it('does not snag a cable that passes the post by a wide margin', () => {
    const env = makeEnv()
    // Rover well above the post; the straight run clears it.
    const state = makeState(8, 9, 1)
    applyTetherPhysics(state, env)
    expect(state.tetherWraps).toHaveLength(0)
  })

  it('does not snag a post the cable passes over (depth above the obstacle)', () => {
    const env = makeEnv({
      obstacles: [{ id: 'cube', name: 'Floor cube', shape: 'box', position: [6, 5, 2.6], size: [0.4, 0.4, 0.4] }],
    })
    // Cable runs near the surface; the cube only spans depth 2.6–3.0.
    const state = makeState(8, 5.05, 0.3)
    applyTetherPhysics(state, env)
    expect(state.tetherWraps).toHaveLength(0)
  })

  it('releases the wrap once the rover unwinds back to a clear line', () => {
    const env = makeEnv()
    const wraps: TetherWrap[] = [{ x: 6, y: 5.36, depth: 0.75, obstacleId: 'post' }]
    const state = makeState(4, 9, 1, wraps)
    applyTetherPhysics(state, env)
    expect(state.tetherWraps).toHaveLength(0)
  })

  it('clears all wraps when the tether is turned off', () => {
    const env = makeEnv({ tether: { enabled: false, length: 100, attachPoint: [0, 5] } })
    const state = makeState(8, 5.2, 1, [{ x: 6, y: 5.36, depth: 0.75, obstacleId: 'post' }])
    applyTetherPhysics(state, env)
    expect(state.tetherWraps).toHaveLength(0)
  })

  it('routes the full path attach → wraps → rover in order', () => {
    const env = makeEnv()
    const wraps: TetherWrap[] = [{ x: 6, y: 5.36, depth: 0.75, obstacleId: 'post' }]
    const path = tetherFullPath(wraps, { x: 8, y: 5.2, depth: 1 }, env)
    expect(path).toHaveLength(3) // attach, wrap, rover
    expect(path[0]).toMatchObject({ x: 0, y: 5 })
    expect(path[1]).toMatchObject({ x: 6 })
    expect(path[2]).toMatchObject({ x: 8 })
  })
})
