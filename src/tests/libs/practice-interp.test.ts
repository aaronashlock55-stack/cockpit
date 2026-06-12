import { describe, expect, it } from 'vitest'

import { type PracticePoseFrame, frameAlpha, interpolatePose, lerpAngle, smoothTowards } from '@/libs/practice-interp'

const makeFrame = (overrides: Partial<PracticePoseFrame> = {}): PracticePoseFrame => ({
  t: 0,
  x: 0,
  y: 0,
  depth: 0,
  heading: 0,
  pitch: 0,
  roll: 0,
  speed: 0,
  surgeVel: 0,
  swayVel: 0,
  heaveVel: 0,
  ...overrides,
})

describe('lerpAngle', () => {
  it('interpolates plain angles linearly', () => {
    expect(lerpAngle(0, 1, 0.5)).toBeCloseTo(0.5)
  })

  it('takes the shortest arc across the 2π wrap (no long-way spin)', () => {
    // 0.1 rad -> 2π - 0.1 rad is a -0.2 rad step, not +2π - 0.2.
    const mid = lerpAngle(0.1, 2 * Math.PI - 0.1, 0.5)
    expect(Math.abs(Math.sin(mid))).toBeLessThan(1e-9) // ≈ 0 (mod 2π)
    expect(Math.cos(mid)).toBeCloseTo(1)
  })

  it('is monotonic through the wrap', () => {
    const quarter = lerpAngle(0.1, 2 * Math.PI - 0.1, 0.25)
    const half = lerpAngle(0.1, 2 * Math.PI - 0.1, 0.5)
    // Moving negative (clockwise through zero): quarter is still positive-ish, half at the wrap.
    expect(Math.sin(quarter)).toBeGreaterThan(Math.sin(half))
  })
})

describe('interpolatePose', () => {
  it('blends positions at the midpoint', () => {
    const prev = makeFrame({ x: 2, y: 4, depth: 1, speed: 0.2 })
    const curr = makeFrame({ x: 4, y: 8, depth: 2, speed: 0.6 })
    const mid = interpolatePose(prev, curr, 0.5)
    expect(mid.x).toBeCloseTo(3)
    expect(mid.y).toBeCloseTo(6)
    expect(mid.depth).toBeCloseTo(1.5)
    expect(mid.speed).toBeCloseTo(0.4)
  })

  it('blends heading across the wrap without spinning the long way', () => {
    const prev = makeFrame({ heading: 0.1 })
    const curr = makeFrame({ heading: 2 * Math.PI - 0.1 })
    const mid = interpolatePose(prev, curr, 0.5)
    expect(Math.cos(mid.heading)).toBeCloseTo(1) // near 0/2π, not π
  })
})

describe('frameAlpha', () => {
  it('is 0 at the moment curr was published and 1 one interval later', () => {
    expect(frameAlpha(100, 120, 120)).toBeCloseTo(0)
    expect(frameAlpha(100, 120, 140)).toBeCloseTo(1)
    expect(frameAlpha(100, 120, 130)).toBeCloseTo(0.5)
  })

  it('clamps to [0, 1] (never extrapolates past curr)', () => {
    expect(frameAlpha(100, 120, 90)).toBe(0)
    expect(frameAlpha(100, 120, 500)).toBe(1)
  })
})

describe('smoothTowards', () => {
  it('is frame-rate independent: two half-steps equal one full step', () => {
    const oneStep = smoothTowards(0, 1, 5, 0.1)
    const twoSteps = smoothTowards(smoothTowards(0, 1, 5, 0.05), 1, 5, 0.05)
    expect(twoSteps).toBeCloseTo(oneStep, 10)
  })

  it('converges toward the target without overshooting', () => {
    let v = 0
    for (let i = 0; i < 100; i++) v = smoothTowards(v, 1, 5, 0.05)
    expect(v).toBeGreaterThan(0.99)
    expect(v).toBeLessThanOrEqual(1)
  })
})
