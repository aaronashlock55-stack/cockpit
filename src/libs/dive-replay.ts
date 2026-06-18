import { lerpAngle } from '@/libs/practice-interp'
import { type DiveEvent, type DiveLog, type DiveLogFrame } from '@/types/dive-log'

/**
 * Replay engine for recorded dives (V2 Mission Engine): a playback clock over
 * a DiveLog with play/pause/speed/scrub and smooth interpolated frames — the
 * machinery behind "watch the run back", "race your ghost", and "re-fly from
 * here". Pure (no timers — callers tick it), so it is fully unit-tested.
 */

/**
 * A live replay session over one log. The mutating methods are `this`-bound
 * (method syntax, not arrow fields) so that when a caller wraps the session in
 * Vue's `reactive()` and calls e.g. `session.tick()`, the write goes THROUGH
 * the proxy — keeping the scrubber/time/play-button reactive — while the module
 * itself stays Vue-free and unit-testable. Always call methods as
 * `session.method()` (never detached) so `this` is preserved.
 */
export interface Replay {
  /** The log being replayed. */
  log: DiveLog
  /** Total duration, seconds. */
  duration: number
  /** Current playback time, seconds from the start. */
  timeS: number
  /** Whether the clock advances on tick(). */
  playing: boolean
  /** Playback speed multiplier. */
  speed: number
  /** Start/resume playback. */
  play(): void
  /** Pause playback. */
  pause(): void
  /** Set the speed multiplier (0.25–8 sensible). */
  setSpeed(speed: number): void
  /** Jump to a time (clamped to the log). */
  seek(timeS: number): void
  /** Advance the clock by real seconds × speed; auto-pauses at the end. */
  tick(realDtS: number): void
  /** The interpolated frame at the current time. */
  frameNow(): DiveLogFrame
  /** Events with t in (t0, t1] — for firing replay-side notifications. */
  eventsBetween(t0: number, t1: number): DiveEvent[]
}

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v))

/**
 * Index of the last frame with t <= time (binary search).
 * @param {DiveLogFrame[]} frames Frames ascending in t.
 * @param {number} time Query time, seconds.
 * @returns {number} Index in [0, frames.length - 1].
 */
const frameIndexAt = (frames: DiveLogFrame[], time: number): number => {
  let lo = 0
  let hi = frames.length - 1
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (frames[mid].t <= time) lo = mid
    else hi = mid - 1
  }
  return lo
}

/**
 * Interpolate between two frames (angles take the shortest arc).
 * @param {DiveLogFrame} a Earlier frame.
 * @param {DiveLogFrame} b Later frame.
 * @param {number} alpha Blend [0, 1].
 * @returns {DiveLogFrame} The blended frame.
 */
const blendFrames = (a: DiveLogFrame, b: DiveLogFrame, alpha: number): DiveLogFrame => {
  const mix = (va: number | undefined, vb: number | undefined): number | undefined =>
    va !== undefined && vb !== undefined ? va + (vb - va) * alpha : va ?? vb
  return {
    t: a.t + (b.t - a.t) * alpha,
    x: mix(a.x, b.x),
    y: mix(a.y, b.y),
    depth: (mix(a.depth, b.depth) as number) ?? 0,
    heading: lerpAngle(a.heading, b.heading, alpha),
    pitch: lerpAngle(a.pitch, b.pitch, alpha),
    roll: lerpAngle(a.roll, b.roll, alpha),
    speed: mix(a.speed, b.speed),
    thrusterOutputs: alpha < 0.5 ? a.thrusterOutputs : b.thrusterOutputs,
  }
}

/**
 * Create a replay session over a log.
 * @param {DiveLog} log The recorded run.
 * @returns {Replay} The replay session (initially paused at t = 0).
 */
export const createReplay = (log: DiveLog): Replay => {
  const t0 = log.frames[0]?.t ?? 0
  const duration = Math.max(0, (log.frames[log.frames.length - 1]?.t ?? 0) - t0)

  // Method syntax + `this` (not arrow fields closing over a raw binding): when
  // the session is wrapped in reactive(), `session.tick()` writes through the
  // proxy, so the panel's scrubber/time/play state stays live.
  return {
    log,
    duration,
    timeS: 0,
    playing: false,
    speed: 1,
    play(this: Replay): void {
      // Replaying from the very end restarts — the natural "watch it again".
      if (this.timeS >= duration) this.timeS = 0
      this.playing = true
    },
    pause(this: Replay): void {
      this.playing = false
    },
    setSpeed(this: Replay, speed: number): void {
      this.speed = clamp(speed, 0.1, 16)
    },
    seek(this: Replay, timeS: number): void {
      this.timeS = clamp(timeS, 0, duration)
    },
    tick(this: Replay, realDtS: number): void {
      if (!this.playing) return
      this.timeS += realDtS * this.speed
      if (this.timeS >= duration) {
        this.timeS = duration
        this.playing = false
      }
    },
    frameNow(this: Replay): DiveLogFrame {
      const time = t0 + this.timeS
      const frames = log.frames
      const i = frameIndexAt(frames, time)
      const a = frames[i]
      const b = frames[Math.min(i + 1, frames.length - 1)]
      const span = b.t - a.t
      return blendFrames(a, b, span > 1e-9 ? clamp((time - a.t) / span, 0, 1) : 0)
    },
    eventsBetween(this: Replay, eventT0: number, eventT1: number): DiveEvent[] {
      return log.events.filter((e) => e.t - t0 > eventT0 && e.t - t0 <= eventT1)
    },
  }
}
