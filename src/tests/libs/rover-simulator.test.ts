import { describe, expect, it } from 'vitest'

import { hydroModel, mixToBodyForce } from '@/libs/rover-hydro'
import { initialSimState, stepSimulation, tetherDeployedLength } from '@/libs/rover-simulator'
import { type PracticeEnvironment } from '@/types/practice-environment'
import { type BodyAxes, type RoverProfile, blueRov2HeavyProfile, blueRov2Profile } from '@/types/rover-profile'

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
 * @param {RoverProfile} profile Rover profile to simulate.
 * @returns {ReturnType<typeof stepSimulation>} Final state.
 */
const run = (
  env: PracticeEnvironment,
  demand: BodyAxes,
  steps: number,
  start = initialSimState(env),
  profile: RoverProfile = blueRov2HeavyProfile
): ReturnType<typeof stepSimulation> => {
  let state = start
  for (let i = 0; i < steps; i++) state = stepSimulation(state, profile, env, demand, 0.04)
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

describe('profile-derived hydrodynamics', () => {
  it('derives drag and added mass from the real dimensions', () => {
    const small = hydroModel(blueRov2Profile, 1000)
    const big = hydroModel(blueRov2HeavyProfile, 1000)
    expect(big.dragQuad.surge).toBeGreaterThan(small.dragQuad.surge)
    expect(big.addedMass.heave).toBeGreaterThan(small.addedMass.heave)
    expect(big.inertia.yaw).toBeGreaterThan(small.inertia.yaw)
  })

  it('a heavier rover accelerates more slowly', () => {
    const env = makeEnv()
    const heavy: RoverProfile = {
      ...blueRov2HeavyProfile,
      dimensions: { ...blueRov2HeavyProfile.dimensions, massKg: blueRov2HeavyProfile.dimensions.massKg * 3 },
    }
    const light = run(env, { ...zeroDemand, surge: 1 }, 25)
    const loaded = run(env, { ...zeroDemand, surge: 1 }, 25, initialSimState(env), heavy)
    expect(loaded.surgeVel).toBeLessThan(light.surgeVel)
  })

  it('a bigger frame has a lower top speed (more drag area)', () => {
    const env = makeEnv({ pool: { length: 60, width: 10, depth: 3 } })
    const wide: RoverProfile = {
      ...blueRov2HeavyProfile,
      dimensions: { ...blueRov2HeavyProfile.dimensions, width: blueRov2HeavyProfile.dimensions.width * 2 },
    }
    const stock = run(env, { ...zeroDemand, surge: 1 }, 200)
    const barge = run(env, { ...zeroDemand, surge: 1 }, 200, initialSimState(env), wide)
    expect(barge.surgeVel).toBeLessThan(stock.surgeVel)
  })

  it('nose-down plus forward thrust drives the rover deeper (attitude kinematics)', () => {
    const env = makeEnv()
    const level = run(env, { ...zeroDemand, surge: 1 }, 25, { ...initialSimState(env), depth: 1 })
    const nosedDown = run(env, { ...zeroDemand, surge: 1 }, 25, { ...initialSimState(env), depth: 1, pitch: -0.4 })
    expect(nosedDown.depth).toBeGreaterThan(level.depth + 0.03)
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

  it('meets obstacles with its real oriented footprint (sideways = narrower than nose-on)', () => {
    const env = makeEnv({
      obstacles: [{ id: 'f', name: 'post', shape: 'cylinder', position: [5, 5, 0], size: [0.2, 0.2, 3] }],
    })
    // Nose-on: stops at half-LENGTH + post radius.
    const noseOn = run(env, { ...zeroDemand, surge: 1 }, 400, {
      ...initialSimState(env),
      x: 2,
      y: 5,
      depth: 1,
      heading: 0,
    })
    // Side-on: nose pointing +y, strafing toward +x — stops at half-WIDTH + post radius.
    const sideOn = run(env, { ...zeroDemand, sway: -1 }, 400, {
      ...initialSimState(env),
      x: 2,
      y: 5,
      depth: 1,
      heading: Math.PI / 2,
    })
    const noseDist = Math.hypot(noseOn.x - 5, noseOn.y - 5)
    const sideDist = Math.hypot(sideOn.x - 5, sideOn.y - 5)
    expect(sideDist).toBeLessThan(noseDist - 0.03) // Heavy is 0.575 long but only 0.45 wide
  })

  it('wall contact kills the inward momentum (rigid-body thunk, no ghost-push)', () => {
    const env = makeEnv()
    const state = run(env, { ...zeroDemand, surge: 1 }, 700)
    expect(state.x).toBeGreaterThan(env.pool.length - 0.4) // parked against the far wall
    expect(Math.abs(state.surgeVel)).toBeLessThan(0.3) // velocity absorbed, not accumulated
  })
})

describe('hoops (ring obstacles)', () => {
  const hoopEnv = (): PracticeEnvironment =>
    makeEnv({
      obstacles: [{ id: 'h1', name: 'Test hoop', shape: 'ring', position: [5, 5, 1.0], size: [1.4, 0.08, 1.4] }],
    })

  it('flags a clean pass through the hoop opening', () => {
    const env = hoopEnv()
    // Hoop center is at depth 1.0 + 0.7 = 1.7; approach dead-center along +x.
    let state = { ...initialSimState(env), x: 3, y: 5, depth: 1.7, heading: 0 }
    let passed: string | undefined
    let hitHoop = false
    for (let i = 0; i < 200; i++) {
      state = stepSimulation(state, blueRov2HeavyProfile, env, { ...zeroDemand, surge: 1 }, 0.04)
      if (state.justPassed) passed = state.justPassed
      if (state.collidedWith === 'Test hoop') hitHoop = true
    }
    expect(passed).toBe('Test hoop')
    expect(hitHoop).toBe(false)
    expect(state.x).toBeGreaterThan(5) // really made it to the other side
  })

  it('collides with the hoop rim instead of phasing through it', () => {
    const env = hoopEnv()
    // Aim at the tube (offset across by the ring radius).
    let state = { ...initialSimState(env), x: 3, y: 5.66, depth: 1.7, heading: 0 }
    let hitHoop = false
    let passed = false
    for (let i = 0; i < 200; i++) {
      state = stepSimulation(state, blueRov2HeavyProfile, env, { ...zeroDemand, surge: 1 }, 0.04)
      if (state.collidedWith === 'Test hoop') hitHoop = true
      if (state.justPassed) passed = true
    }
    expect(hitHoop).toBe(true)
    expect(passed).toBe(false)
  })
})

describe('tether', () => {
  it('enforces the tether length as a hard limit', () => {
    const env = makeEnv({ tether: { enabled: true, length: 5, attachPoint: [0, 5] } })
    const state = run(env, { ...zeroDemand, surge: 1 }, 2000)
    expect(tetherDeployedLength(state, env)).toBeLessThanOrEqual(env.tether.length + 0.01)
  })

  it('tether drag slows the rover as more tether is deployed', () => {
    const pool = { length: 60, width: 10, depth: 3 }
    const short = makeEnv({ pool, tether: { enabled: true, length: 100, attachPoint: [0, 5] } })
    const none = makeEnv({ pool })
    const far = { ...initialSimState(short), x: 18, y: 5, depth: 1 } // ~18 m deployed
    const withTether = run(short, { ...zeroDemand, surge: 1 }, 100, { ...far })
    const withoutTether = run(none, { ...zeroDemand, surge: 1 }, 100, { ...far })
    expect(withTether.surgeVel).toBeLessThan(withoutTether.surgeVel)
  })

  it('routes through the ice launch hole (longer real path than the straight line)', () => {
    const env = makeEnv({
      iceSheet: { thickness: 0.03, holeCenter: [3, 5], holeSize: 1 },
      tether: { enabled: true, length: 50, attachPoint: [0, 5] },
    })
    const state = { ...initialSimState(env), x: 10, y: 5, depth: 2 }
    // attach→hole = 3 m on the surface, hole→rover = hypot(7, 0, 2).
    const expected = 3 + Math.hypot(7, 0, 2)
    expect(tetherDeployedLength(state, env)).toBeCloseTo(expected, 5)
    expect(expected).toBeGreaterThan(Math.hypot(10, 0, 2)) // longer than straight-line
  })

  it('the hole-routed tether limits range measured along the path', () => {
    const env = makeEnv({
      iceSheet: { thickness: 0.03, holeCenter: [3, 5], holeSize: 1 },
      tether: { enabled: true, length: 8, attachPoint: [0, 5] },
    })
    const start = { ...initialSimState(env), x: 3, y: 5, depth: 1 }
    const state = run(env, { ...zeroDemand, surge: 1 }, 1000, start)
    expect(tetherDeployedLength(state, env)).toBeLessThanOrEqual(env.tether.length + 0.01)
    // Only 5 m of slack past the hole at (3,5): the rover cannot reach x = 10.
    expect(state.x).toBeLessThan(8.1)
  })
})

describe('inertia and momentum (Fossen-style feel)', () => {
  it('accelerates gradually from rest (added mass + thruster spool)', () => {
    const env = makeEnv({ pool: { length: 60, width: 10, depth: 3 } })
    const after200ms = run(env, { ...zeroDemand, surge: 1 }, 5)
    const terminal = run(env, { ...zeroDemand, surge: 1 }, 500)
    expect(after200ms.surgeVel).toBeLessThan(0.6 * terminal.surgeVel)
    expect(terminal.surgeVel).toBeGreaterThan(0.7) // believable top speed ~1 m/s
    expect(terminal.surgeVel).toBeLessThan(1.8)
  })

  it('coasts after the sticks are released instead of stopping dead', () => {
    const env = makeEnv()
    const cruising = run(env, { ...zeroDemand, surge: 1 }, 150)
    const peak = cruising.surgeVel
    const oneSecLater = run(env, zeroDemand, 25, { ...cruising })
    expect(oneSecLater.surgeVel).toBeGreaterThan(0.2 * peak) // still gliding
    expect(oneSecLater.surgeVel).toBeLessThan(peak) // but slowing
  })

  it('pitch disturbance settles back with a damped wobble (righting moment)', () => {
    const env = makeEnv()
    const disturbed = { ...initialSimState(env), pitch: 0.3 }
    const settled = run(env, zeroDemand, 250, disturbed)
    expect(Math.abs(settled.pitch)).toBeLessThan(0.03)
  })

  it('yaw spins up to a believable rate and keeps turning after release', () => {
    const env = makeEnv()
    const spinning = run(env, { ...zeroDemand, yaw: 1 }, 200)
    expect(Math.abs(spinning.yawRate)).toBeGreaterThan(0.5) // rad/s
    expect(Math.abs(spinning.yawRate)).toBeLessThan(4)
    const later = run(env, zeroDemand, 10, { ...spinning })
    expect(Math.abs(later.yawRate)).toBeGreaterThan(0.1) // angular momentum carries
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
