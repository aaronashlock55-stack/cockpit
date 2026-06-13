import { describe, expect, it } from 'vitest'

import {
  type SensorPose,
  altitudeBelow,
  computeDvl,
  computeSensorReadout,
  defaultSonarOptions,
  rayRangeToEnvironment,
  sonarBeam,
  sonarScan,
} from '@/libs/sim-sensors'
import { type PracticeEnvironment } from '@/types/practice-environment'

const makeEnv = (overrides: Partial<PracticeEnvironment> = {}): PracticeEnvironment => ({
  name: 'test pool',
  pool: { length: 20, width: 10, depth: 4 },
  water: { salinityPpt: 0, temperatureC: 15 },
  tether: { enabled: false, length: 10, attachPoint: [0, 5] },
  obstacles: [],
  schema: 'cockpit-practice-env/v1',
  ...overrides,
})

const makePose = (overrides: Partial<SensorPose> = {}): SensorPose => ({
  x: 5,
  y: 5,
  depth: 2,
  heading: 0,
  surgeVel: 0,
  swayVel: 0,
  heaveVel: 0,
  ...overrides,
})

describe('rayRangeToEnvironment', () => {
  it('measures the distance to the pool wall in an empty pool', () => {
    const env = makeEnv()
    // Facing +x from x=5 in a 20 m pool -> 15 m to the far wall.
    expect(rayRangeToEnvironment(env, 5, 5, 2, 1, 0, 30)).toBeCloseTo(15)
    // Facing -x -> 5 m to the near wall.
    expect(rayRangeToEnvironment(env, 5, 5, 2, -1, 0, 30)).toBeCloseTo(5)
  })

  it('returns a closer range when an obstacle is in the way (at matching depth)', () => {
    const env = makeEnv({
      obstacles: [{ id: 'c', name: 'c', shape: 'cylinder', position: [10, 5, 0], size: [1, 1, 4] }],
    })
    // Cylinder radius 0.5 at x=10; from x=5 the front face is at 10-0.5=9.5 -> 4.5 m.
    expect(rayRangeToEnvironment(env, 5, 5, 2, 1, 0, 30)).toBeCloseTo(4.5)
  })

  it('does NOT see an obstacle outside the beam depth band', () => {
    const env = makeEnv({
      // A short crate sitting on the floor (top at 3.5 m), vehicle near the surface.
      obstacles: [{ id: 'b', name: 'b', shape: 'box', position: [10, 5, 3.5], size: [1, 1, 0.5] }],
    })
    // Vehicle at 0.5 m depth: the floor crate is far below the sonar fan -> wall range.
    expect(rayRangeToEnvironment(env, 5, 5, 0.5, 1, 0, 30)).toBeCloseTo(15)
    // Vehicle down at the crate's depth: now it's seen.
    expect(rayRangeToEnvironment(env, 5, 5, 3.6, 1, 0, 30)).toBeLessThan(6)
  })

  it('clamps to the max range', () => {
    const env = makeEnv({ pool: { length: 200, width: 10, depth: 4 } })
    expect(rayRangeToEnvironment(env, 5, 5, 2, 1, 0, 20)).toBe(20)
  })
})

describe('altitudeBelow', () => {
  it('is the distance to the floor over open ground', () => {
    expect(altitudeBelow(makeEnv(), 5, 5, 2)).toBeCloseTo(2) // floor at 4, depth 2
  })

  it('shrinks when hovering over an obstacle', () => {
    const env = makeEnv({
      obstacles: [{ id: 'b', name: 'b', shape: 'box', position: [5, 5, 3], size: [2, 2, 1] }],
    })
    // Obstacle top at 3 m, vehicle at 2 m -> 1 m altitude (not 2 m to the floor).
    expect(altitudeBelow(env, 5, 5, 2)).toBeCloseTo(1)
    // Off to the side -> back to the floor.
    expect(altitudeBelow(env, 9, 9, 2)).toBeCloseTo(2)
  })

  it('never goes negative', () => {
    expect(altitudeBelow(makeEnv(), 5, 5, 4)).toBe(0)
    expect(altitudeBelow(makeEnv(), 5, 5, 5)).toBe(0)
  })
})

describe('computeDvl', () => {
  it('reports altitude, body velocity and bottom lock', () => {
    const dvl = computeDvl(makeEnv(), makePose({ surgeVel: 0.4, swayVel: -0.1, heaveVel: 0.05 }))
    expect(dvl.altitudeM).toBeCloseTo(2)
    expect(dvl.vx).toBeCloseTo(0.4)
    expect(dvl.vy).toBeCloseTo(-0.1)
    expect(dvl.valid).toBe(true)
  })

  it('loses bottom lock at the surface with zero altitude', () => {
    const dvl = computeDvl(makeEnv(), makePose({ depth: 4 }))
    expect(dvl.altitudeM).toBe(0)
    expect(dvl.valid).toBe(false)
  })
})

describe('sonar scan', () => {
  it('forward bin (0) sees an obstacle dead ahead', () => {
    const env = makeEnv({
      obstacles: [{ id: 'c', name: 'c', shape: 'cylinder', position: [10, 5, 0], size: [1, 1, 4] }],
    })
    const fwd = sonarBeam(env, makePose(), 0, defaultSonarOptions)
    expect(fwd).toBeCloseTo(4.5, 1)
    // A full scan has one value per bin.
    expect(sonarScan(env, makePose(), defaultSonarOptions)).toHaveLength(defaultSonarOptions.bins)
  })

  it('the rear bins see the wall behind the vehicle', () => {
    const env = makeEnv()
    const rear = sonarBeam(env, makePose(), defaultSonarOptions.bins / 2, defaultSonarOptions)
    expect(rear).toBeCloseTo(5, 0) // wall 5 m behind at x=5
  })
})

describe('computeSensorReadout', () => {
  it('bundles the scalar instruments', () => {
    const env = makeEnv()
    const r = computeSensorReadout(env, makePose({ surgeVel: 0.3 }))
    expect(r.altimeterM).toBeCloseTo(2)
    expect(r.forwardRangeM).toBeCloseTo(15)
    expect(r.pressureDepthM).toBeCloseTo(2)
    expect(r.dvl.vx).toBeCloseTo(0.3)
  })
})
