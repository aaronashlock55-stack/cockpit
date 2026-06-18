import { saveAs } from 'file-saver'

import { type RoverProfile, blueRov2HeavyProfile, blueRov2Profile, validateRoverProfile } from '@/types/rover-profile'

/**
 * Export a rover profile to a downloadable JSON file (shareable between operators).
 * @param {RoverProfile} profile The profile to export.
 */
export const downloadRoverProfile = (profile: RoverProfile): void => {
  const blob = new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json;charset=utf-8' })
  const safeName = profile.name.replace(/[^a-z0-9-_]+/gi, '_')
  saveAs(blob, `cockpit-rover-profile-${safeName}.json`)
}

/**
 * Parse + validate an uploaded rover-profile file. Rejects malformed files with a clear reason
 * (mirrors the defensive import handling added for controller mappings in Phase 3).
 * @param {File} file The uploaded file.
 * @returns {Promise<RoverProfile>} The validated profile.
 */
export const readRoverProfileFile = (file: File): Promise<RoverProfile> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const contents = event.target?.result
        if (typeof contents !== 'string') throw new Error('Could not read file contents.')
        resolve(validateRoverProfile(JSON.parse(contents)))
      } catch (error) {
        reject(new Error(`Invalid rover profile file. ${error instanceof Error ? error.message : error}`))
      }
    }
    reader.onerror = () => reject(new Error('Could not read the selected file.'))
    reader.readAsText(file)
  })
}

/**
 * Best-effort import of a rover profile from a connected vehicle.
 *
 * Cockpit does not expose the autopilot's raw motor-factor parameters over its
 * MAVLink connection, so a faithful per-thruster read is not available here — the
 * richest source is BlueOS (where the motor config lives) exporting this same JSON.
 * As a useful default we derive a profile from the detected frame/vehicle type by
 * matching a built-in preset, which the operator can then tune and save.
 * @param {string | undefined} detectedFrame A frame hint (e.g. from FRAME_CONFIG), if known.
 * @returns {RoverProfile} The best-matching profile (a copy, renamed as imported).
 */
export const importRoverProfileFromVehicle = (detectedFrame?: string): RoverProfile => {
  const heavy = /heavy/i.test(detectedFrame ?? '')
  const base = heavy ? blueRov2HeavyProfile : blueRov2Profile
  return { ...structuredClone(base), name: `${base.frame} (imported)` }
}
