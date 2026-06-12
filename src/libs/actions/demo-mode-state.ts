import { ref } from 'vue'

import { type PracticeEnvironment, defaultPracticeEnvironment } from '@/types/practice-environment'
import { type RoverProfile, defaultRoverProfile } from '@/types/rover-profile'

/**
 * Lightweight shared state for Practice/Demo mode, kept in its own module so both
 * the main vehicle store and the demo driver can read it without an import cycle.
 */

/** True while Practice/Demo mode is actively driving simulated telemetry. */
export const isDemoModeActive = ref(false)

/** The rover profile currently driving the simulator (built-in, uploaded, or imported). */
export const activeRoverProfile = ref<RoverProfile>(defaultRoverProfile)

/** The practice environment (pool, water, ice, tether, obstacles) the sim runs in. */
// Cloned: the sim mutates obstacle positions (held objects), and the built-in
// preset constants must stay pristine for later re-selection.
export const activePracticeEnvironment = ref<PracticeEnvironment>(structuredClone(defaultPracticeEnvironment))

/** Live readout for UI (pool-view widget); written by the demo driver each tick. */
export interface PracticeSimReadout {
  /** Pool-local x in meters. */
  x: number
  /** Pool-local y in meters. */
  y: number
  /** Depth in meters. */
  depth: number
  /** Heading in radians. */
  heading: number
  /** Deployed tether length in meters. */
  tetherDeployed: number
  /** Whatever the rover is currently touching, if anything. */
  collidedWith?: string
  /** Name of a hoop cleanly passed through in the last few seconds, if any. */
  recentPass?: string
  /** Claw closure, 0 = open .. 1 = closed. */
  gripper?: number
  /** Id of the obstacle currently held by the claw, if any. */
  heldObstacleId?: string
}

/** Latest sim readout, or null when the sim is not running. */
export const practiceSimReadout = ref<PracticeSimReadout | null>(null)
