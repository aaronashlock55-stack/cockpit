import { describe, expect, it } from 'vitest'
import { effect, reactive } from 'vue'

import { createReplay } from '@/libs/dive-replay'
import { type DiveLog } from '@/types/dive-log'

const makeLog = (overrides: Partial<DiveLog> = {}): DiveLog => ({
  schema: 'cockpit-dive-log/v1',
  id: 'test',
  name: 'test run',
  source: 'practice',
  startedAt: '2026-01-01T00:00:00.000Z',
  rateHz: 10,
  frames: [
    { t: 0, x: 0, y: 0, depth: 0, heading: 0, pitch: 0, roll: 0, speed: 0 },
    { t: 1, x: 2, y: 0, depth: 1, heading: Math.PI / 2, pitch: 0, roll: 0, speed: 2 },
    { t: 2, x: 4, y: 0, depth: 2, heading: Math.PI, pitch: 0, roll: 0, speed: 2 },
  ],
  events: [
    { t: 0.5, kind: 'collision', detail: 'wall' },
    { t: 1.5, kind: 'pass', detail: 'Hoop 1' },
  ],
  ...overrides,
})

describe('createReplay', () => {
  it('reports the duration from the frames', () => {
    const replay = createReplay(makeLog())
    expect(replay.duration).toBe(2)
    expect(replay.timeS).toBe(0)
    expect(replay.playing).toBe(false)
  })

  it('advances the clock by realDt × speed only while playing', () => {
    const replay = createReplay(makeLog())
    replay.tick(0.5)
    expect(replay.timeS).toBe(0) // paused
    replay.play()
    replay.tick(0.5)
    expect(replay.timeS).toBeCloseTo(0.5)
    replay.setSpeed(2)
    replay.tick(0.5)
    expect(replay.timeS).toBeCloseTo(1.5)
  })

  it('auto-pauses at the end and restarts on replay', () => {
    const replay = createReplay(makeLog())
    replay.play()
    replay.tick(5)
    expect(replay.timeS).toBe(2)
    expect(replay.playing).toBe(false)
    replay.play() // from the end -> restart
    expect(replay.timeS).toBe(0)
    expect(replay.playing).toBe(true)
  })

  it('interpolates the frame at the current time (shortest-arc heading)', () => {
    const replay = createReplay(makeLog())
    replay.seek(0.5)
    const frame = replay.frameNow()
    expect(frame.x).toBeCloseTo(1) // halfway between x=0 and x=2
    expect(frame.depth).toBeCloseTo(0.5)
    expect(frame.heading).toBeCloseTo(Math.PI / 4) // halfway 0 -> PI/2
  })

  it('clamps seek to the log bounds', () => {
    const replay = createReplay(makeLog())
    replay.seek(-5)
    expect(replay.timeS).toBe(0)
    replay.seek(99)
    expect(replay.timeS).toBe(2)
  })

  it('returns events within a time window for replay-side notifications', () => {
    const replay = createReplay(makeLog())
    expect(replay.eventsBetween(0, 1).map((e) => e.kind)).toEqual(['collision'])
    expect(replay.eventsBetween(1, 2).map((e) => e.kind)).toEqual(['pass'])
    expect(replay.eventsBetween(0, 2)).toHaveLength(2)
  })

  it('mutates through a reactive() proxy so the scrubber/time stay live', () => {
    // Regression: methods must be `this`-bound, not closed over the raw object,
    // or wrapping in reactive() and ticking via the proxy would never re-render.
    const session = reactive(createReplay(makeLog()))
    let observedTime = -1
    let runs = 0
    effect(() => {
      observedTime = session.timeS
      runs++
    })
    expect(runs).toBe(1)
    session.play()
    session.tick(0.5) // ticked via the proxy, like the sim loop does
    expect(session.timeS).toBeCloseTo(0.5)
    expect(observedTime).toBeCloseTo(0.5) // the effect re-ran -> UI would update
    expect(runs).toBeGreaterThan(1)
  })

  it('handles logs whose frames do not start at t=0 (real vehicle dives)', () => {
    const replay = createReplay(
      makeLog({
        frames: [
          { t: 100, depth: 0, heading: 0, pitch: 0, roll: 0 },
          { t: 102, depth: 4, heading: 1, pitch: 0, roll: 0 },
        ],
        events: [{ t: 101, kind: 'note', detail: 'midpoint' }],
      })
    )
    expect(replay.duration).toBe(2)
    replay.seek(1)
    expect(replay.frameNow().depth).toBeCloseTo(2)
    expect(replay.eventsBetween(0, 1).map((e) => e.detail)).toEqual(['midpoint'])
  })
})
