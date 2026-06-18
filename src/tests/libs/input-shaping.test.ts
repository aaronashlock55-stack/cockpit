import { describe, expect, it } from 'vitest'

import { applyExpo, stepAxisEnvelope, stepDemandEnvelope } from '@/libs/input-shaping'
import { type BodyAxes } from '@/types/rover-profile'

const DT = 0.02 // 50 Hz, like the sim loop

/**
 * Run the envelope for a duration with a constant target.
 * @param {number} start Starting value.
 * @param {number} target Constant target.
 * @param {number} seconds Duration to run.
 * @returns {number} Final shaped value.
 */
const runEnvelope = (start: number, target: number, seconds: number): number => {
  let v = start
  for (let t = 0; t < seconds; t += DT) v = stepAxisEnvelope(v, target, DT)
  return v
}

describe('stepAxisEnvelope', () => {
  it('ramps up like an analog stick: not instant, full in ~0.35 s', () => {
    expect(runEnvelope(0, 1, 0.1)).toBeLessThan(0.4) // far from full early on
    expect(runEnvelope(0, 1, 0.25)).toBeLessThan(0.95) // still climbing
    expect(runEnvelope(0, 1, 0.4)).toBeGreaterThan(0.99) // full shortly after attackTime
  })

  it('decays on release in ~0.2 s instead of snapping to zero', () => {
    expect(Math.abs(runEnvelope(1, 0, 0.06))).toBeGreaterThan(0.5) // thrust bleeds, not snaps
    expect(Math.abs(runEnvelope(1, 0, 0.25))).toBeLessThan(0.05) // gone after releaseTime
  })

  it('reverses through zero using the release rate first', () => {
    // From +1 commanding -1: after 0.1 s it should have shed most of the +
    // (release rate 5/s) rather than creeping at the attack rate (2.9/s).
    const v = runEnvelope(1, -1, 0.1)
    expect(v).toBeLessThan(0.55)
    expect(runEnvelope(1, -1, 0.8)).toBeLessThan(-0.95) // ends at full reverse
  })

  it('stays within [-1, 1]', () => {
    expect(runEnvelope(0, 5, 2)).toBeLessThanOrEqual(1)
    expect(runEnvelope(0, -5, 2)).toBeGreaterThanOrEqual(-1)
  })
})

describe('stepDemandEnvelope', () => {
  it('shapes every axis independently', () => {
    const zero: BodyAxes = { surge: 0, sway: 0, heave: 0, yaw: 0, pitch: 0, roll: 0 }
    const target: BodyAxes = { surge: 1, sway: -1, heave: 0, yaw: 1, pitch: 0, roll: 0 }
    let demand = zero
    for (let t = 0; t < 0.1; t += DT) demand = stepDemandEnvelope(demand, target, DT)
    expect(demand.surge).toBeGreaterThan(0.1)
    expect(demand.surge).toBeLessThan(0.5)
    expect(demand.sway).toBeCloseTo(-demand.surge, 5)
    expect(demand.heave).toBe(0)
  })
})

describe('applyExpo', () => {
  it('softens the center but keeps full deflection', () => {
    expect(applyExpo(0.5, 0.3)).toBeLessThan(0.5)
    expect(applyExpo(1, 0.3)).toBeCloseTo(1)
    expect(applyExpo(-1, 0.3)).toBeCloseTo(-1)
    expect(applyExpo(0, 0.3)).toBe(0)
  })
})
