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
 * @param {PracticeEnvironment} env The environment to simulate in.
 * @param {BodyAxes} demand Constant per-axis demand.
 * @param {number} steps Number of 40 ms steps to run.
 * @param {ReturnType<typeof initialSimState>} start Starting state.
 * @returns {ReturnType<typeof stepSimulation>} Final state.
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

describe('inertia and momentum (Fossen-style feel)', () => {
  it('accelerates gradually from rest (added mass + thruster spool)', () => {
    const env = makeEnv()
    const after200ms = run(env, { ...zeroDemand, surge: 1 }, 5)
    const terminal = run(env, { ...zeroDemand, surge: 1 }, 500)
    expect(after200ms.surgeVel).toBeLessThan(0.5 * terminal.surgeVel)
    expect(terminal.surgeVel).toBeGreaterThan(0.8) // believable top speed ~1 m/s
    expect(terminal.surgeVel).toBeLessThan(1.6)
  })

  it('coasts after the sticks are released instead of stopping dead', () => {
    const env = makeEnv()
    const cruising = run(env, { ...zeroDemand, surge: 1 }, 150)
    const peak = cruising.surgeVel
    const oneSecLater = run(env, zeroDemand, 25, { ...cruising })
    expect(oneSecLater.surgeVel).toBeGreaterThan(0.3 * peak) // still gliding
    expect(oneSecLater.surgeVel).toBeLessThan(peak) // but slowing
  })

  it('pitch disturbance settles back with a damped wobble (righting moment)', () => {
    const env = makeEnv()
    const disturbed = { ...initialSimState(env), pitch: 0.3 }
    const settled = run(env, zeroDemand, 250, disturbed)
    expect(Math.abs(settled.pitch)).toBeLessThan(0.03)
  })
})

describe('gripper', () => {
  const floatEnv = (): PracticeEnvironment =>
    makeEnv({
      obstacles: [{ id: 'float', name: 'float', shape: 'cylinder', position: [5, 5, 0.5], size: [0.18, 0.18, 1] }],
    })

  /**
   * Step with the claw commanded closed or open.
   * @param {PracticeEnvironment} env The environment to simulate in.
   * @param {number} steps Number of 40 ms steps to run.
   * @param {ReturnType<typeof initialSimState>} start Starting state.
   * @param {boolean} gripperClosed Commanded claw state.
   * @returns {ReturnType<typeof stepSimulation>} Final state.
   */
  const runGrip = (
    env: PracticeEnvironment,
    steps: number,
    start: ReturnType<typeof initialSimState>,
    gripperClosed: boolean
  ): ReturnType<typeof stepSimulation> => {
    let state = start
    for (let i = 0; i < steps; i++) {
      state = stepSimulation(state, blueRov2HeavyProfile, env, zeroDemand, 0.04, { gripperClosed })
    }
    return state
  }

  it('grabs a small obstacle within reach and holds it', () => {
    const env = floatEnv()
    // Park right in front of the float (nose ~0.75 m ahead), facing it.
    const start = { ...initialSimState(env), x: 4.3, y: 5, depth: 1, heading: 0 }
    const state = runGrip(env, 30, start, true)
    expect(state.gripper).toBeGreaterThan(0.9)
    expect(state.heldObstacleId).toBe('float')
  })

  it('a held obstacle follows the claw as the rover moves', () => {
    const env = floatEnv()
    const start = { ...initialSimState(env), x: 4.3, y: 5, depth: 1, heading: 0 }
    let state = runGrip(env, 30, start, true)
    // Drive backward while holding.
    for (let i = 0; i < 50; i++) {
      state = stepSimulation(state, blueRov2HeavyProfile, env, { ...zeroDemand, surge: -0.6 }, 0.04, {
        gripperClosed: true,
      })
    }
    const held = env.obstacles[0]
    expect(state.heldObstacleId).toBe('float')
    // The float should have moved with us (it started at x=5).
    expect(held.position[0]).toBeLessThan(4.9)
    expect(Math.hypot(held.position[0] - state.x, held.position[1] - state.y)).toBeLessThan(1.2)
  })

  it('opening the claw releases the held obstacle', () => {
    const env = floatEnv()
    const start = { ...initialSimState(env), x: 4.3, y: 5, depth: 1, heading: 0 }
    let state = runGrip(env, 30, start, true)
    expect(state.heldObstacleId).toBe('float')
    state = runGrip(env, 10, state, false)
    expect(state.heldObstacleId).toBeUndefined()
    expect(state.gripper).toBeLessThan(0.2)
  })

  it('cannot grab obstacles larger than the claw', () => {
    const env = makeEnv({
      obstacles: [{ id: 'crate', name: 'big crate', shape: 'box', position: [5, 5, 0.5], size: [1.5, 1.5, 1] }],
    })
    const start = { ...initialSimState(env), x: 4.0, y: 5, depth: 1, heading: 0 }
    const state = runGrip(env, 30, start, true)
    expect(state.heldObstacleId).toBeUndefined()
  })
})
