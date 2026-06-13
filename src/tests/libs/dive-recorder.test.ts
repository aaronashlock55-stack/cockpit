import { describe, expect, it } from 'vitest'

import { exportDiveLogText, importDiveLogText, startDiveRecording } from '@/libs/dive-recorder'

// Note: the IndexedDB save/load/list/delete paths need a real browser and are
// covered by the manual checklist; these tests cover the pure recording,
// metrics-on-finish, and export/import round-trip.

describe('startDiveRecording', () => {
  it('accumulates frames and events, then finishes with metrics', () => {
    const rec = startDiveRecording({ source: 'practice', rateHz: 10, environmentName: 'Training course' })
    rec.addFrame({ t: 0, x: 0, y: 0, depth: 0, heading: 0, pitch: 0, roll: 0, speed: 0 })
    rec.addFrame({ t: 1, x: 3, y: 0, depth: 1, heading: 0, pitch: 0, roll: 0, speed: 3 })
    rec.addEvent(0.5, 'pass', 'Hoop 1')
    expect(rec.frameCount()).toBe(2)
    expect(rec.elapsedS()).toBe(1)
    const log = rec.finish()
    expect(log.schema).toBe('cockpit-dive-log/v1')
    expect(log.source).toBe('practice')
    expect(log.frames).toHaveLength(2)
    expect(log.metrics?.hoopsPassed).toBe(1)
    expect(log.metrics?.durationS).toBe(1)
    expect(log.name).toContain('Training course')
  })

  it('uses a Dive label for vehicle runs', () => {
    const rec = startDiveRecording({ source: 'vehicle', rateHz: 5 })
    rec.addFrame({ t: 0, depth: 0, heading: 0, pitch: 0, roll: 0 })
    const log = rec.finish()
    expect(log.source).toBe('vehicle')
    expect(log.name).toContain('Dive')
  })

  it('round-trips through export/import preserving frames and events', () => {
    const rec = startDiveRecording({ source: 'practice', rateHz: 10 })
    rec.addFrame({ t: 0, x: 1, y: 2, depth: 0, heading: 0.5, pitch: 0, roll: 0 })
    rec.addFrame({ t: 1, x: 2, y: 2, depth: 1, heading: 0.6, pitch: 0, roll: 0 })
    rec.addEvent(0.4, 'collision', 'wall')
    const log = rec.finish('My run')
    const text = exportDiveLogText(log)
    const restored = importDiveLogText(text)
    expect(restored.id).toBe(log.id)
    expect(restored.name).toBe('My run')
    expect(restored.frames).toHaveLength(2)
    expect(restored.events[0].detail).toBe('wall')
  })

  it('rejects malformed imported logs', () => {
    expect(() => importDiveLogText('{"schema":"wrong"}')).toThrow()
    expect(() =>
      importDiveLogText(
        '{"schema":"cockpit-dive-log/v1","id":"x","name":"y","source":"practice","frames":[],"events":[]}'
      )
    ).toThrow()
  })
})
