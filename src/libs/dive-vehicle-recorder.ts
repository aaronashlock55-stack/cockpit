import { type Ref, watch } from 'vue'

import { isDemoModeActive } from '@/libs/actions/demo-mode-state'
import { diveLogsVersion } from '@/libs/actions/dive-session-state'
import { type ActiveRecording, saveDiveLog, startDiveRecording } from '@/libs/dive-recorder'

/**
 * Real-dive black box (V2 Mission Engine): records every ARMED session of a
 * real vehicle into a dive log — attitude, depth, heading, speed and (when a
 * position source exists) a local-meters track from the first fix. Recordings
 * start on arm and save on disarm, so real situations can be replayed and
 * re-flown in the practice simulator afterwards.
 */

/** Telemetry the recorder samples (the mainVehicle store's reactive objects). */
export interface VehicleTelemetrySource {
  /** Armed state (recording runs while true). */
  isArmed: Ref<boolean | undefined>
  /** Attitude, radians. */
  attitude: {
    /** Roll, rad. */ roll?: number
    /** Pitch, rad. */ pitch?: number
    /** Yaw/heading, rad. */ yaw?: number
  }
  /** Altitude (rel is negative underwater). */
  altitude: {
    /** Relative altitude, m (negative = below surface). */ rel?: number
  }
  /** Global position, if any (0/undefined when no fix — typical underwater). */
  coordinates: {
    /** Latitude, deg. */ latitude?: number
    /** Longitude, deg. */ longitude?: number
  }
  /** Velocity estimates. */
  velocity: {
    /** Overall speed, m/s. */ overall?: number
  }
  /** Vehicle display name. */
  currentVehicleName: Ref<string | undefined>
}

const RATE_HZ = 5
const MIN_SAVE_FRAMES = 15 // ignore arm blips shorter than ~3 s

/**
 * Install the auto-recorder: watches the armed state and records every real
 * armed session (skipped entirely while Practice/Demo mode is simulating).
 * Call once from the mainVehicle store setup.
 * @param {VehicleTelemetrySource} vehicle The telemetry to sample.
 * @returns {void}
 */
export const installVehicleDiveRecorder = (vehicle: VehicleTelemetrySource): void => {
  let recording: ActiveRecording | null = null
  let timer: ReturnType<typeof setInterval> | undefined
  let startMs = 0
  let origin: [number, number] | null = null

  const stop = (): void => {
    if (timer) clearInterval(timer)
    timer = undefined
    if (recording && recording.frameCount() >= MIN_SAVE_FRAMES) {
      const log = recording.finish()
      saveDiveLog(log)
        .then(() => diveLogsVersion.value++)
        .catch((error) => console.error('Could not save vehicle dive log:', error))
    }
    recording = null
  }

  const begin = (): void => {
    recording = startDiveRecording({
      source: 'vehicle',
      rateHz: RATE_HZ,
      profileName: vehicle.currentVehicleName.value,
    })
    startMs = performance.now()
    origin = null
    timer = setInterval(() => {
      if (!recording) return
      const t = (performance.now() - startMs) / 1000
      const { latitude, longitude } = vehicle.coordinates
      let x: number | undefined
      let y: number | undefined
      // Local-meters track from the first valid fix (x = north, y = east —
      // the same convention the practice pool uses).
      if (typeof latitude === 'number' && typeof longitude === 'number' && (latitude !== 0 || longitude !== 0)) {
        if (!origin) origin = [latitude, longitude]
        x = (latitude - origin[0]) * 111320
        y = (longitude - origin[1]) * 111320 * Math.cos((origin[0] * Math.PI) / 180)
      }
      const rel = vehicle.altitude.rel
      const speed = vehicle.velocity.overall
      recording.addFrame({
        t,
        x,
        y,
        depth: typeof rel === 'number' && Number.isFinite(rel) ? Math.max(0, -rel) : 0,
        heading: vehicle.attitude.yaw ?? 0,
        pitch: vehicle.attitude.pitch ?? 0,
        roll: vehicle.attitude.roll ?? 0,
        speed: typeof speed === 'number' && Number.isFinite(speed) ? speed : undefined,
      })
    }, 1000 / RATE_HZ)
  }

  watch(vehicle.isArmed, (armed, wasArmed) => {
    // Practice mode arms the FAKE vehicle — that path has its own recorder.
    if (isDemoModeActive.value) return
    if (armed === true && wasArmed !== true) begin()
    else if (armed !== true && wasArmed === true) stop()
  })
}
