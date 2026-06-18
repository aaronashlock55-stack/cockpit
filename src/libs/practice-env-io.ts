import { saveAs } from 'file-saver'

import { type PracticeEnvironment, validatePracticeEnvironment } from '@/types/practice-environment'

/**
 * Export a practice environment to a downloadable JSON file (shareable between teams).
 * @param {PracticeEnvironment} env The environment to export.
 */
export const downloadPracticeEnvironment = (env: PracticeEnvironment): void => {
  const blob = new Blob([JSON.stringify(env, null, 2)], { type: 'application/json;charset=utf-8' })
  const safeName = env.name.replace(/[^a-z0-9-_]+/gi, '_')
  saveAs(blob, `cockpit-practice-env-${safeName}.json`)
}

/**
 * Parse + validate an uploaded practice-environment file, rejecting malformed
 * files with a clear reason.
 * @param {File} file The uploaded file.
 * @returns {Promise<PracticeEnvironment>} The validated environment.
 */
export const readPracticeEnvironmentFile = (file: File): Promise<PracticeEnvironment> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const contents = event.target?.result
        if (typeof contents !== 'string') throw new Error('Could not read file contents.')
        resolve(validatePracticeEnvironment(JSON.parse(contents)))
      } catch (error) {
        reject(new Error(`Invalid practice environment file. ${error instanceof Error ? error.message : error}`))
      }
    }
    reader.onerror = () => reject(new Error('Could not read the selected file.'))
    reader.readAsText(file)
  })
}
