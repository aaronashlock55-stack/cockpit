import { ref } from 'vue'

import { type RoverProfile, defaultRoverProfile } from '@/types/rover-profile'

/**
 * Lightweight shared state for Practice/Demo mode, kept in its own module so both
 * the main vehicle store and the demo driver can read it without an import cycle.
 */

/** True while Practice/Demo mode is actively driving simulated telemetry. */
export const isDemoModeActive = ref(false)

/** The rover profile currently driving the simulator (built-in, uploaded, or imported). */
export const activeRoverProfile = ref<RoverProfile>(defaultRoverProfile)
