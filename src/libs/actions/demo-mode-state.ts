import { ref, shallowRef } from 'vue'

import { type PracticePoseFrame } from '@/libs/practice-interp'
import { type SensorReadout } from '@/libs/sim-sensors'
import {
  type PracticeEnvironment,
  clonePracticeEnvironment,
  defaultPracticeEnvironment,
} from '@/types/practice-environment'
import { type BodyAxes, type RoverProfile, defaultRoverProfile } from '@/types/rover-profile'

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
export const activePracticeEnvironment = ref<PracticeEnvironment>(clonePracticeEnvironment(defaultPracticeEnvironment))

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
  /** Full tether path (attach → ice hole → rope nodes → rover rear) as [x, y, depth] triples. */
  tetherPath?: [number, number, number][]
  /** Ids of obstacles the tether is currently caught on (for highlighting them). */
  tetherSnagged?: string[]
  /** Whatever the rover is currently touching, if anything. */
  collidedWith?: string
  /** Name of a hoop cleanly passed through in the last few seconds, if any. */
  recentPass?: string
  /** Claw closure, 0 = open .. 1 = closed. */
  gripper?: number
  /** Id of the obstacle currently held by the claw, if any. */
  heldObstacleId?: string
  /** Spooled per-thruster outputs [-1, 1] (drives prop-wash visuals). */
  thrusterOutputs?: number[]
  /** Achieved normalized force per axis [-1, 1]. */
  thrust?: BodyAxes
  /** Simulated scalar sensors (echosounders, DVL, pressure). */
  sensors?: SensorReadout
  /**
   * Ping360 scanning-sonar state. `bins` is a LIVE shared buffer the sim mutates
   * in place each tick (read it every frame; do not snapshot/persist it — copy
   * with `.slice()` first if you ever need a frozen frame).
   */
  sonar?: {
    /** Range per angular bin (bin 0 = forward, clockwise), meters. */
    bins: number[]
    /** Index of the bin the sweep most recently refreshed. */
    head: number
    /** Maximum sonar range, meters. */
    maxRangeM: number
  }
}

/**
 * Latest sim readout, or null when the sim is not running. shallowRef (like
 * {@link practicePoseFrames}): the driver replaces the whole object each tick,
 * so deep reactivity would only waste cycles proxying the sonar bin array.
 */
export const practiceSimReadout = shallowRef<PracticeSimReadout | null>(null)

/**
 * Previous + current timestamped pose snapshots, published every sim tick for
 * the 3D widget's render interpolation (shallowRef — replaced wholesale at
 * sim rate, deep reactivity would be waste).
 */
export const practicePoseFrames = shallowRef<{
  /** The snapshot before last. */ prev: PracticePoseFrame
  /** The latest snapshot. */ curr: PracticePoseFrame
} | null>(null)
