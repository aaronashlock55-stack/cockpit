import { ref, shallowRef } from 'vue'

import { type Replay } from '@/libs/dive-replay'
import { type DiveMetrics } from '@/types/dive-log'

/**
 * Shared state for the V2 Mission Engine (replay / ghost / instructor),
 * kept in its own leaf module so the demo driver, the 3D widget, the mission
 * panel, and the pool view can all read it without import cycles.
 */

/** The replay session currently loaded, if any (ticked by the demo loop). */
export const activeReplay = shallowRef<Replay | null>(null)

/**
 * How the replay shows in the 3D view:
 * - 'watch': the 3D vehicle IS the recording (fly-on-the-wall or first-person
 *   review of what happened); the live sim freezes underneath.
 * - 'ghost': the recording flies alongside as a translucent ghost to race.
 */
export const replayMode = ref<'watch' | 'ghost' | null>(null)

/** Debrief card data for the last finished practice run. */
export const lastDiveSummary = ref<
  | (DiveMetrics & {
      /**
eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee *
eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee
       */
      name: string
    })
  | null
>(null)

/** Bumped whenever stored logs change, so lists refresh. */
export const diveLogsVersion = ref(0)

/** Instructor-injected failures and session control (CAE-style IOS panel). */
export interface InstructorState {
  /** Freeze the simulation (vehicle holds in place, controls ignored). */
  frozen: boolean
  /** Indices of thrusters that are dead (no output). */
  disabledThrusters: number[]
  /** Global thrust multiplier (0.4 = brownout, 1 = healthy). */
  thrustScale: number
  /** Extra downward ballast force, N (simulates a leak / flooded enclosure). */
  extraBallastN: number
}

/** Live instructor state consumed by the sim loop every tick. */
export const instructorState = ref<InstructorState>({
  frozen: false,
  disabledThrusters: [],
  thrustScale: 1,
  extraBallastN: 0,
})

/**
 * Reset all instructor failures (vehicle back to healthy).
 * @returns {void}
 */
export const resetInstructorState = (): void => {
  instructorState.value = { frozen: false, disabledThrusters: [], thrustScale: 1, extraBallastN: 0 }
}
