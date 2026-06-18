import { describe, expect, it } from 'vitest'

import { computeDiveMetrics } from '@/libs/dive-metrics'
import { type DiveLog } from '@/types/dive-log'

const makeLog = (overrides: Partial<DiveLog> = {}): DiveLog => ({
  schema: 'cockpit-dive-log/v1',
  id: 'test',
  name: 'test',
  source: 'practice',
  startedAt: '2026-01-01T00:00:00.000Z',
  rateHz: 10,
  frames: [
    { t: 0, x: 0, y: 0, depth: 0, heading: 0, pitch: 0, roll: 0, speed: 0 },
    { t: 1, x: 3, y: 0, depth: 0, heading: 0, pitch: 0, roll: 0, speed: 3 },
    { t: 2, x: 3, y: 4, depth: 0, heading: 0, pitch: 0, roll: 0, speed: 4 },
  ],
  events: [
    { t: 0.5, kind: 'collision', detail: 'wall' },
    { t: 1.2, kind: 'pass', detail: 'Hoop 1' },
    { t: 1.8, kind: 'grab', detail: 'cube' },
    { t: 1.9, kind: 'snag', detail: 'tether (snagged)' },
  ],
  ...overrides,
})

describe('computeDiveMetrics', () => {
  it('measures duration, distance and speeds', () => {
    const m = computeDiveMetrics(makeLog())
    expect(m.durationS).toBe(2)
    expect(m.distanceM).toBe(7) // 3 then 4
    expect(m.maxSpeedMs).toBe(4)
    expect(m.avgSpeedMs).toBeGreaterThan(0)
  })

  it('counts task/safety events', () => {
    const m = computeDiveMetrics(makeLog())
    expect(m.collisions).toBe(1)
    expect(m.hoopsPassed).toBe(1)
    expect(m.grabs).toBe(1)
    expect(m.tetherSnags).toBe(1)
  })

  it('falls back to depth-only distance when there is no XY (positionless dive)', () => {
    const m = computeDiveMetrics(
      makeLog({
        frames: [
          { t: 0, depth: 0, heading: 0, pitch: 0, roll: 0 },
          { t: 1, depth: 2, heading: 0, pitch: 0, roll: 0 },
          { t: 2, depth: 5, heading: 0, pitch: 0, roll: 0 },
        ],
        events: [],
      })
    )
    expect(m.distanceM).toBe(5) // 2 + 3 down
    expect(m.collisions).toBe(0)
  })

  it('handles a single-frame log without dividing by zero', () => {
    const m = computeDiveMetrics(makeLog({ frames: [{ t: 0, depth: 0, heading: 0, pitch: 0, roll: 0 }], events: [] }))
    expect(m.durationS).toBe(0)
    expect(m.distanceM).toBe(0)
    expect(m.avgSpeedMs).toBe(0)
  })
})
