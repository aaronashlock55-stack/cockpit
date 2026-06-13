import localforage from 'localforage'

import { computeDiveMetrics } from '@/libs/dive-metrics'
import { type DiveEvent, type DiveLog, type DiveLogFrame, type DiveLogSummary, validateDiveLog } from '@/types/dive-log'
import { type PracticeEnvironment } from '@/types/practice-environment'

/**
 * Dive recording + persistent storage (V2 Mission Engine "black box").
 * Recordings accumulate frames/events in memory and are persisted to
 * IndexedDB (localforage) when finished; a small index record keeps listing
 * cheap. Old runs are pruned automatically. Logs export/import as plain JSON
 * so teams can share runs between machines.
 */

/** Storage caps: keep this many finished runs, newest first. */
const MAX_STORED_LOGS = 24
/** Hard frame cap per recording (~80 min at 10 Hz) so a forgotten session can't grow unbounded. */
const MAX_FRAMES = 48_000
const INDEX_KEY = '__index'

const diveStore = localforage.createInstance({
  driver: localforage.INDEXEDDB,
  name: 'Cockpit',
  storeName: 'cockpit-dive-logs',
})

/** Options to begin a recording. */
export interface StartRecordingOptions {
  /** practice sim or real vehicle. */
  source: 'practice' | 'vehicle'
  /** Nominal frame rate, Hz (metadata only — addFrame timing is the caller's). */
  rateHz: number
  /** Active rover profile name. */
  profileName?: string
  /** Practice environment name. */
  environmentName?: string
  /** Snapshot of the practice environment, for faithful re-fly. */
  environment?: PracticeEnvironment
}

/** A recording in progress. */
export interface ActiveRecording {
  /** Append a telemetry frame (t is seconds since recording start). */
  addFrame: (frame: DiveLogFrame) => void
  /** Append a discrete event at time t (seconds since start). */
  addEvent: (t: number, kind: DiveEvent['kind'], detail?: string) => void
  /** Frames captured so far. */
  frameCount: () => number
  /** Seconds covered so far. */
  elapsedS: () => number
  /** Finish: compute metrics and return the immutable log (does NOT save). */
  finish: (name?: string) => DiveLog
}

/**
 * Begin a recording.
 * @param {StartRecordingOptions} opts What is being recorded.
 * @returns {ActiveRecording} The active recording handle.
 */
export const startDiveRecording = (opts: StartRecordingOptions): ActiveRecording => {
  const startedAt = new Date()
  const frames: DiveLogFrame[] = []
  const events: DiveEvent[] = []
  let truncated = false
  let lastT = 0
  return {
    addFrame: (frame: DiveLogFrame): void => {
      lastT = frame.t
      if (frames.length >= MAX_FRAMES) {
        if (!truncated) console.warn('Dive recording hit the frame cap; later frames are dropped.')
        truncated = true
        return
      }
      frames.push(frame)
    },
    addEvent: (t: number, kind: DiveEvent['kind'], detail?: string): void => {
      events.push({ t, kind, detail })
    },
    frameCount: (): number => frames.length,
    elapsedS: (): number => (frames.length > 1 ? frames[frames.length - 1].t - frames[0].t : 0),
    finish: (name?: string): DiveLog => {
      const timeLabel = startedAt.toTimeString().slice(0, 5)
      const dateLabel = startedAt.toISOString().slice(0, 10)
      const log: DiveLog = {
        schema: 'cockpit-dive-log/v1',
        id: `dive-${startedAt.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
        name:
          name ??
          `${opts.source === 'vehicle' ? 'Dive' : opts.environmentName ?? 'Practice'} — ${dateLabel} ${timeLabel}`,
        source: opts.source,
        startedAt: startedAt.toISOString(),
        rateHz: opts.rateHz,
        profileName: opts.profileName,
        environmentName: opts.environmentName,
        environment: opts.environment,
        frames,
        events,
        truncated: truncated || undefined,
      }
      log.metrics = computeDiveMetrics(log)
      // Keep real elapsed time honest even though frames past the cap were dropped.
      if (truncated && log.metrics) log.metrics.durationS = Math.round(lastT * 10) / 10
      return log
    },
  }
}

/**
 * Summarize a log for the stored index.
 * @param {DiveLog} log The log.
 * @returns {DiveLogSummary} Its index entry.
 */
const summarize = (log: DiveLog): DiveLogSummary => ({
  id: log.id,
  name: log.name,
  source: log.source,
  startedAt: log.startedAt,
  durationS: log.metrics?.durationS ?? 0,
  frameCount: log.frames.length,
  metrics: log.metrics,
})

/**
 * List stored runs, newest first.
 * @returns {Promise<DiveLogSummary[]>} The stored-run index.
 */
export const listDiveLogs = async (): Promise<DiveLogSummary[]> => {
  const index = (await diveStore.getItem<DiveLogSummary[]>(INDEX_KEY)) ?? []
  return [...index].sort((a, b) => b.startedAt.localeCompare(a.startedAt))
}

/**
 * Persist a finished log (prunes the oldest runs past the cap).
 * @param {DiveLog} log The finished log.
 * @returns {Promise<void>} Resolves when stored.
 */
export const saveDiveLog = async (log: DiveLog): Promise<void> => {
  await diveStore.setItem(log.id, log)
  let index = (await diveStore.getItem<DiveLogSummary[]>(INDEX_KEY)) ?? []
  index = index.filter((entry) => entry.id !== log.id)
  index.push(summarize(log))
  index.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  for (const old of index.slice(MAX_STORED_LOGS)) await diveStore.removeItem(old.id)
  await diveStore.setItem(INDEX_KEY, index.slice(0, MAX_STORED_LOGS))
}

/**
 * Load a stored run.
 * @param {string} id The log id.
 * @returns {Promise<DiveLog | null>} The log, or null if missing.
 */
export const loadDiveLog = async (id: string): Promise<DiveLog | null> => {
  return (await diveStore.getItem<DiveLog>(id)) ?? null
}

/**
 * Delete a stored run.
 * @param {string} id The log id.
 * @returns {Promise<void>} Resolves when removed.
 */
export const deleteDiveLog = async (id: string): Promise<void> => {
  await diveStore.removeItem(id)
  const index = (await diveStore.getItem<DiveLogSummary[]>(INDEX_KEY)) ?? []
  await diveStore.setItem(
    INDEX_KEY,
    index.filter((entry) => entry.id !== id)
  )
}

/**
 * Serialize a log for download/sharing.
 * @param {DiveLog} log The log.
 * @returns {string} Pretty JSON.
 */
export const exportDiveLogText = (log: DiveLog): string => JSON.stringify(log, null, 2)

/**
 * Parse + validate an uploaded log file.
 * @param {string} text File contents.
 * @returns {DiveLog} The validated log.
 */
export const importDiveLogText = (text: string): DiveLog => validateDiveLog(JSON.parse(text))
