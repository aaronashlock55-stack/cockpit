import { describe, expect, it } from 'vitest'

import { initialSimState, mixToBodyForce, stepSimulation, tetherDeployedLength } from '@/libs/rover-simulator'
import { type PracticeEnvironment } from '@/types/practice-environment'
import { type BodyAxes, blueRov2HeavyProfile, blueRov2Profile } from '@/types/rover-profile'

const zeroDemand: BodyAxes = { surge: 0, sway: 0, heave: 0, yaw: 0, pitch: 0, roll: 0 }

const makeEnv = (overrides: Partial<PracticeEnvironment> = {}): PracticeEnvironment => ({
  name: 'test pool',
  pool: { length: 20, width: 10, depth: 3 },
  water: { salinityPpt: 0, temperatureC: 15 },
  tether: { enabled: false, length: 10, attachPoint: [0, 5] },
  obstacles: [],
  schema: 'cockpit-practice-env/v1',
  ...overrides,
})

/**
 * Run N sim steps with a constant demand.
 * @param env
 * @param demand
 * @param steps
 * @param start
 */
const run = (
  env: PracticeEnvironment,
  demand: BodyAxes,
  steps: number,
  start = initialSimState(env)
): ReturnType<typeof stepSimulation> => {
  let state = start
  for (let i = 0; i < steps; i++) state = stepSimulation(state, blueRov2HeavyProfile, env, demand, 0.04)
  return state
}

describe('mixToBodyForce', () => {
  it('produces forward force for surge demand on a BlueROV2 mix', () => {
    const force = mixToBodyForce(blueRov2Profile, { ...zeroDemand, surge: 1 })
    expect(force.surge).toBeGreaterThan(0.5)
    expect(Math.abs(force.sway)).toBeLessThan(0.01)
    expect(Math.abs(force.yaw)).toBeLessThan(0.01)
  })

  it('stock BlueROV2 has no pitch authority but the Heavy does', () => {
    const stock = mixToBodyForce(blueRov2Profile, { ...zeroDemand, pitch: 1 })
    const heavy = mixToBodyForce(blueRov2HeavyProfile, { ...zeroDemand, pitch: 1 })
    expect(Math.abs(stock.pitch)).toBeLessThan(0.01)
    expect(heavy.pitch).toBeGreaterThan(0.2)
  })
})

describe('stepSimulation environment physics', () => {
  it('keeps the rover inside the pool walls', () => {
    const env = makeEnv()
    const state = run(env, { ...zeroDemand, surge: 1 }, 2000)
    expect(state.x).toBeLessThanOrEqual(env.pool.length)
    expect(state.x).toBeGreaterThanOrEqual(0)
  })

  it('does not let the rover sink through the floor', () => {
    const env = makeEnv()
    const state = run(env, { ...zeroDemand, heave: 1 }, 1000)
    expect(state.depth).toBeLessThanOrEqual(env.pool.depth)
    expect(state.collidedWith).toBe('pool floor')
  })

  it('salty water makes the rover drift up at zero demand', () => {
    const fresh = makeEnv()
    const salty = makeEnv({ water: { salinityPpt: 32, temperatureC: 15 } })
    const startDepth = 1.5
    const start = { ...initialSimState(fresh), depth: startDepth }
    const freshState = run(fresh, zeroDemand, 250, { ...start })
    const saltyState = run(salty, zeroDemand, 250, { ...start })
    expect(saltyState.depth).toBeLessThan(freshState.depth) // floated up
  })

  it('blocks surfacing under an ice sheet but allows it in the launch hole', () => {
    const ice = { thickness: 0.03, holeCenter: [3, 5] as [number, number], holeSize: 1 }
    const env = makeEnv({ iceSheet: ice })
    // Away from the hole: ascend hard -> pinned under the ice keel.
    const away = run(env, { ...zeroDemand, heave: -1 }, 500, { ...initialSimState(env), x: 10, y: 5, depth: 2 })
    expect(away.depth).toBeGreaterThan(ice.thickness)
    expect(away.collidedWith).toBe('ice sheet')
    // Inside the hole: can reach the surface.
    const inHole = run(env, { ...zeroDemand, heave: -1 }, 500, { ...initialSimState(env), x: 3, y: 5, depth: 2 })
    expect(inHole.depth).toBeLessThan(0.05)
  })

  it('collides with a cylinder obstacle instead of passing through', () => {
    const env = makeEnv({
      obstacles: [{ id: 'f', name: 'float', shape: 'cylinder', position: [5, 5, 0], size: [0.2, 0.2, 3] }],
    })
    const start = { ...initialSimState(env), x: 2, y: 5, depth: 1, heading: 0 }
    const state = run(env, { ...zeroDemand, surge: 1 }, 400, start)
    // Rover travels +x toward the float at (5,5) and must stop at its radius.
    const distance = Math.hypot(state.x - 5, state.y - 5)
    expect(distance).toBeGreaterThanOrEqual(0.1 + blueRov2HeavyProfile.dimensions.length / 2 - 0.01)
  })

  it('enforces the tether length as a hard limit', () => {
    const env = makeEnv({ tether: { enabled: true, length: 5, attachPoint: [0, 5] } })
    const state = run(env, { ...zeroDemand, surge: 1 }, 2000)
    expect(tetherDeployedLength(state, env)).toBeLessThanOrEqual(env.tether.length + 0.01)
  })

  it('tether drag slows the rover as more tether is deployed', () => {
    const short = makeEnv({ tether: { enabled: true, length: 100, attachPoint: [0, 5] } })
    const none = makeEnv()
    const far = { ...initialSimState(short), x: 18, y: 5, depth: 1 } // ~18 m deployed
    const withTether = run(short, { ...zeroDemand, surge: 1 }, 100, { ...far })
    const withoutTether = run(none, { ...zeroDemand, surge: 1 }, 100, { ...far })
    expect(withTether.surgeVel).toBeLessThan(withoutTether.surgeVel)
  })
})
