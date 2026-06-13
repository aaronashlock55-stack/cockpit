import { type PracticeEnvironment } from '@/types/practice-environment'

/**
 * The dive log is the "black box" of BlueOS 2.0's training system (V2 Mission
 * Engine): a timestamped recording of a run — from the practice simulator OR a
 * real vehicle — that can be replayed, raced as a ghost, scored for debrief,
 * and resumed mid-run ("re-fly from here", the way full-flight simulators like
 * the CAE 7000XR reposition into a recorded situation). Plain, shareable JSON
 * (`cockpit-dive-log/v1`) so teams can trade runs.
 */

/** A discrete event that happened during the run. */
export interface DiveEvent {
  /** Seconds since the start of the recording. */
  t: number
  /** Event kind. */
  kind: 'collision' | 'pass' | 'grab' | 'release' | 'snag' | 'note'
  /** Human-readable detail, e.g. what was hit or grabbed. */
  detail?: string
}

/** One telemetry frame. Position fields are optional: real dives may have no positioning. */
export interface DiveLogFrame {
  /** Seconds since the start of the recording. */
  t: number
  /** Pool-local x, meters (practice) or local meters east of the first fix (vehicle). */
  x?: number
  /** Pool-local y, meters (practice) or local meters north of the first fix (vehicle). */
  y?: number
  /** Depth, meters positive down. */
  depth: number
  /** Heading, radians. */
  heading: number
  /** Pitch, radians (nose-up positive). */
  pitch: number
  /** Roll, radians. */
  roll: number
  /** Overall speed, m/s. */
  speed?: number
  /** Spooled per-thruster outputs [-1, 1] (practice runs). */
  thrusterOutputs?: number[]
}

/** Debrief metrics computed from a finished log. */
export interface DiveMetrics {
  /** Run length, seconds. */
  durationS: number
  /** Total distance covered, meters (only where position exists). */
  distanceM: number
  /** Peak speed, m/s. */
  maxSpeedMs: number
  /** Mean speed while moving, m/s. */
  avgSpeedMs: number
  /** Number of collision events. */
  collisions: number
  /** Hoops cleanly passed. */
  hoopsPassed: number
  /** Objects grabbed with the claw. */
  grabs: number
  /** Times the tether snagged. */
  tetherSnags: number
}

/** A complete recorded run. */
export interface DiveLog {
  /** Schema marker for validation / forward-compat. */
  schema: 'cockpit-dive-log/v1'
  /** Unique id (also the storage key). */
  id: string
  /** Display name, e.g. "Training course — 14:32". */
  name: string
  /** Where the data came from: the practice sim or a real armed vehicle. */
  source: 'practice' | 'vehicle'
  /** ISO timestamp of the start of the run. */
  startedAt: string
  /** Nominal recording rate, Hz. */
  rateHz: number
  /** Rover profile name active during the run, if known. */
  profileName?: string
  /** Practice environment name, if a practice run. */
  environmentName?: string
  /** Full environment snapshot (practice runs) so the run can be re-flown in the same world. */
  environment?: PracticeEnvironment
  /** Telemetry frames, ascending t. */
  frames: DiveLogFrame[]
  /** Discrete events, ascending t. */
  events: DiveEvent[]
  /** True if the recording hit the frame cap and later frames were dropped. */
  truncated?: boolean
  /** Debrief metrics (filled when the recording is finished). */
  metrics?: DiveMetrics
}

/** Lightweight listing entry for stored logs (kept in an index, not the full log). */
export interface DiveLogSummary {
  /** Unique id (storage key). */
  id: string
  /** Display name. */
  name: string
  /** practice or vehicle. */
  source: 'practice' | 'vehicle'
  /** ISO start timestamp. */
  startedAt: string
  /** Run length, seconds. */
  durationS: number
  /** Number of frames stored. */
  frameCount: number
  /** Debrief metrics, if computed. */
  metrics?: DiveMetrics
}

/**
 * Validate an unknown value as a DiveLog. Throws with a clear reason on failure.
 * @param {unknown} maybeLog Parsed JSON to validate.
 * @returns {DiveLog} The validated log.
 */
export const validateDiveLog = (maybeLog: unknown): DiveLog => {
  const log = maybeLog as Partial<DiveLog>
  if (!log || typeof log !== 'object') throw new Error('Dive log is not an object.')
  if (log.schema !== 'cockpit-dive-log/v1') throw new Error('Unrecognized or missing dive-log schema.')
  if (typeof log.id !== 'string' || typeof log.name !== 'string') throw new Error('Dive log is missing id/name.')
  if (log.source !== 'practice' && log.source !== 'vehicle') throw new Error('Dive log has an invalid source.')
  if (!Array.isArray(log.frames) || log.frames.length === 0) throw new Error('Dive log has no frames.')
  log.frames.forEach((frame, i) => {
    if (typeof frame.t !== 'number' || typeof frame.depth !== 'number' || typeof frame.heading !== 'number') {
      throw new Error(`Dive log frame ${i} is invalid.`)
    }
  })
  if (!Array.isArray(log.events)) throw new Error('Dive log events must be an array.')
  return log as DiveLog
}
