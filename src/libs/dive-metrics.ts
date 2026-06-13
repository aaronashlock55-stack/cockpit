import { type DiveLog, type DiveMetrics } from '@/types/dive-log'

/**
 * Debrief metrics for the V2 Mission Engine: turn a recorded run into the
 * numbers an instructor reads back after a session (time, distance, speed,
 * collisions, task completions). Pure — unit-tested.
 */

/**
 * Compute debrief metrics from a recorded run.
 * @param {DiveLog} log The finished (or in-progress) log.
 * @returns {DiveMetrics} The metrics.
 */
export const computeDiveMetrics = (log: DiveLog): DiveMetrics => {
  const frames = log.frames
  const durationS = frames.length > 1 ? frames[frames.length - 1].t - frames[0].t : 0

  let distanceM = 0
  let maxSpeedMs = 0
  let movingTime = 0
  let movingDistance = 0
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1]
    const b = frames[i]
    const dt = b.t - a.t
    if (dt <= 0) continue
    const hasXY = a.x !== undefined && a.y !== undefined && b.x !== undefined && b.y !== undefined
    const dist = hasXY
      ? Math.hypot((b.x as number) - (a.x as number), (b.y as number) - (a.y as number), b.depth - a.depth)
      : Math.abs(b.depth - a.depth)
    distanceM += dist
    const speed = b.speed ?? dist / dt
    maxSpeedMs = Math.max(maxSpeedMs, speed)
    if (speed > 0.05) {
      movingTime += dt
      movingDistance += dist
    }
  }

  const count = (kind: string): number => log.events.filter((e) => e.kind === kind).length
  return {
    durationS: Math.round(durationS * 10) / 10,
    distanceM: Math.round(distanceM * 10) / 10,
    maxSpeedMs: Math.round(maxSpeedMs * 100) / 100,
    avgSpeedMs: movingTime > 0 ? Math.round((movingDistance / movingTime) * 100) / 100 : 0,
    collisions: count('collision'),
    hoopsPassed: count('pass'),
    grabs: count('grab'),
    tetherSnags: count('snag'),
  }
}
