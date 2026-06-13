import { unit } from 'mathjs'

import { type ActiveRecording, saveDiveLog, startDiveRecording } from '@/libs/dive-recorder'
import { applyExpo, stepDemandEnvelope } from '@/libs/input-shaping'
import { type PracticePoseFrame } from '@/libs/practice-interp'
import { type SimState, initialSimState, stepSimulation, tetherDeployedLength } from '@/libs/rover-simulator'
import { tetherFullPath, tetherSnaggedObstacleIds } from '@/libs/rover-tether'
import { type SensorPose, computeSensorReadout, defaultSonarOptions, sonarBeam } from '@/libs/sim-sensors'
import { type DiveLogFrame } from '@/types/dive-log'
import { clonePracticeEnvironment } from '@/types/practice-environment'
// NOTE: the vehicle store and joystick manager are loaded lazily inside
// startDemoMode(). Importing them statically from here (which the development
// store pulls in at boot) changes the production bundle's module evaluation
// order and crashes with 'Cannot access mavlinkManualControlAxes before
// initialization' (a circular-import TDZ in the joystick protocol graph).
import { type BodyAxes } from '@/types/rover-profile'

import { createDataLakeVariable, getDataLakeVariableInfo, setDataLakeVariableData } from './data-lake'
import {
  activePracticeEnvironment,
  activeRoverProfile,
  isDemoModeActive,
  practicePoseFrames,
  practiceSimReadout,
} from './demo-mode-state'
import {
  activeReplay,
  diveLogsVersion,
  instructorState,
  lastDiveSummary,
  replayMode,
  resetInstructorState,
} from './dive-session-state'

/**
 * Practice / Demo mode driver.
 *
 * Makes Cockpit fully usable with NO vehicle: it runs a small ROV motion model
 * (driven by the active rover profile's motor mix, so it handles like the user's
 * rover) and feeds the result into BOTH telemetry paths — the reactive
 * mainVehicle store (which the HUD widgets read) and the data lake (which custom
 * widgets read). Control input comes from a connected gamepad if present, else a
 * gentle automated "patrol" so reviewers see live motion with zero hardware.
 */

// Physics steps at 50 Hz for fidelity and glassy interpolated motion; telemetry
// (store + data lake + pool-view readout) still publishes at 25 Hz, exactly as
// before — do NOT publish those every tick or mathjs unit() churn doubles.
const SIM_HZ = 50
const dt = 1 / SIM_HZ
const READOUT_EVERY = 2 // sim ticks per telemetry publish (50 Hz -> 25 Hz)

// ArduSub flight modes keyed by the same enum names a real vehicle reports
// (see ardusub.ts modesAvailable), so the mode UI behaves identically in demo.
const arduSubModes = new Map<string, number>([
  ['MANUAL', 19],
  ['STABILIZE', 0],
  ['ALT_HOLD', 2],
  ['ACRO', 1],
  ['POSHOLD', 16],
  ['SURFACE', 9],
  ['GUIDED', 4],
  ['AUTO', 3],
])

let simState: SimState = initialSimState(activePracticeEnvironment.value)
let loopTimer: ReturnType<typeof setInterval> | undefined
let elapsed = 0
// Hoop-pass feedback: keep the last cleanly-passed hoop on screen briefly.
let recentPassName: string | undefined
let recentPassUntil = 0

// V2 Mission Engine: every practice run is recorded as a dive log ("black
// box") so it can be replayed, raced as a ghost, scored, and re-flown.
const RECORD_EVERY = 5 // sim ticks per recorded frame (50 Hz -> 10 Hz)
const MIN_SAVE_FRAMES = 30 // don't persist runs shorter than ~3 s
let recording: ActiveRecording | null = null
let recordingStartElapsed = 0
let frozenElapsed = 0 // total seconds spent frozen, subtracted from the run timeline
let lastCollidedWith: string | undefined
let lastHeldId: string | undefined

const beginPracticeRecording = (): void => {
  const env = activePracticeEnvironment.value
  recording = startDiveRecording({
    source: 'practice',
    rateHz: SIM_HZ / RECORD_EVERY,
    profileName: activeRoverProfile.value.name,
    environmentName: env.name,
    environment: clonePracticeEnvironment(env),
  })
  recordingStartElapsed = elapsed
  frozenElapsed = 0
  lastCollidedWith = undefined
  lastHeldId = undefined
}

const persistRecording = (name?: string): void => {
  if (!recording || recording.frameCount() < MIN_SAVE_FRAMES) return
  const log = recording.finish(name)
  lastDiveSummary.value = { ...log.metrics!, name: log.name }
  saveDiveLog(log)
    .then(() => diveLogsVersion.value++)
    .catch((error) => console.error('Could not save dive log:', error))
}

/**
 * Cut the current practice recording into a saved run and start a fresh one
 * (the mission panel's "save run" button).
 * @param {string} name Optional display name for the saved run.
 * @returns {void}
 */
export const finishPracticeRun = (name?: string): void => {
  persistRecording(name)
  beginPracticeRecording()
}

/**
 * Teleport the simulated rover into a recorded situation — the full-flight-sim
 * "reposition and unfreeze" used for re-flying a moment from a previous run.
 * Velocities/rates reset so the pilot takes over from rest; the tether and
 * claw release so the state is always physically consistent.
 * @param {DiveLogFrame} frame The recorded frame to resume from.
 * @returns {void}
 */
export const repositionPracticeSim = (frame: DiveLogFrame): void => {
  simState = {
    ...simState,
    x: frame.x ?? simState.x,
    y: frame.y ?? simState.y,
    depth: Math.max(0, frame.depth),
    heading: frame.heading,
    pitch: frame.pitch,
    roll: frame.roll,
    surgeVel: 0,
    swayVel: 0,
    heaveVel: 0,
    yawRate: 0,
    pitchRate: 0,
    rollRate: 0,
    thrusterOutputs: [],
    tetherNodes: [], // rebuilt at the new pose on the next tether step
    tetherDeployed: 0,
    ringSides: {},
    heldObstacleId: undefined,
    collidedWith: undefined,
  }
}

// Map anchor for converting pool-local meters to lat/lon (arbitrary but valid).
const ORIGIN_LAT = 47.3977
const ORIGIN_LON = 8.5456

// Ping360-style scanning sonar: a persistent ring of range bins that a sweep
// refreshes a few at a time (a mechanical scanner only points one way at once).
const sonarBins = new Array<number>(defaultSonarOptions.bins).fill(defaultSonarOptions.maxRangeM)
let sonarHead = 0
const SONAR_BINS_PER_TICK = 5

const sensorPose = (): SensorPose => ({
  x: simState.x,
  y: simState.y,
  depth: simState.depth,
  heading: simState.heading,
  surgeVel: simState.surgeVel,
  swayVel: simState.swayVel,
  heaveVel: simState.heaveVel,
})

// Latest raw joystick axes, updated by a one-time subscription (the manager has no
// unsubscribe API, so we read into a module variable rather than re-subscribing).
let latestAxes: number[] = []
let lastJoystickActivity = 0
let joystickSubscribed = false

const subscribeToJoystick = async (): Promise<void> => {
  if (joystickSubscribed) return
  joystickSubscribed = true
  const { joystickManager } = await import('@/libs/joystick/manager')
  joystickManager.onJoystickStateUpdate((event) => {
    latestAxes = event.calibratedState.axes.map((a) => a ?? 0)
    if (latestAxes.some((a) => Math.abs(a) > 0.08)) lastJoystickActivity = performance.now()
  })
}

// Keyboard fallback: WASD = move, arrows = turn/depth (active while Practice mode runs).
const pressedKeys = new Set<string>()

const keyTargetIsTyping = (event: KeyboardEvent): boolean => {
  const target = event.target as HTMLElement | null
  return !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
}

// Commanded claw state (toggled by key/button); consumed by the sim each tick.
export const gripperClosedTarget = { value: false }

const onKeyDown = (event: KeyboardEvent): void => {
  if (keyTargetIsTyping(event)) return
  // G (or Space) toggles the claw — on the initial press only, not key repeat.
  if (!event.repeat && (event.key.toLowerCase() === 'g' || event.key === ' ')) {
    gripperClosedTarget.value = !gripperClosedTarget.value
    if (event.key === ' ') event.preventDefault()
  }
  pressedKeys.add(event.key.toLowerCase())
  // Keep arrows from scrolling the page while flying.
  if (event.key.startsWith('Arrow')) event.preventDefault()
}
const onKeyUp = (event: KeyboardEvent): void => {
  pressedKeys.delete(event.key.toLowerCase())
}

/**
 * Demand from the WASD/arrow keys, or null when nothing relevant is held.
 * W/S = forward/back, A/D = strafe, ←/→ = turn, ↑/↓ = ascend/descend.
 * @returns {BodyAxes | null} The keyboard demand, or null when idle.
 */
export const keyboardDemand = (): BodyAxes | null => {
  const key = (k: string): number => (pressedKeys.has(k) ? 1 : 0)
  const demand: BodyAxes = {
    surge: key('w') - key('s'),
    sway: key('d') - key('a'),
    yaw: key('arrowright') - key('arrowleft'),
    heave: key('arrowdown') - key('arrowup'), // heave positive = down
    pitch: 0,
    roll: 0,
  }
  const active = demand.surge || demand.sway || demand.yaw || demand.heave
  return active ? demand : null
}

const zeroAxes = (): BodyAxes => ({ surge: 0, sway: 0, heave: 0, yaw: 0, pitch: 0, roll: 0 })

/** Gamepad stick expo: softer center for fine positioning, full authority at full stick. */
const STICK_EXPO = 0.3

// Keyboard demand shaped through an attack/release envelope so keys behave
// like an analog stick being pushed and released (thrust builds and bleeds off
// instead of snapping) — the core of the "weight" feel on WASD.
let shapedKeys: BodyAxes = zeroAxes()
// Once the pilot has flown manually, the rover never moves on its own again
// (the idle patrol is a pre-flight demo behavior only).
let hasHadManualInput = false

/**
 * Build the control demand for this tick: gamepad if recently active, else the
 * envelope-shaped keyboard, else (only before the first manual input ever) an
 * automated patrol so hands-off demos still show motion.
 * @returns {BodyAxes} Per-axis demand in [-1, 1].
 */
const currentDemand = (): BodyAxes => {
  const joystickActive = performance.now() - lastJoystickActivity < 1000 && latestAxes.length >= 2
  if (joystickActive) {
    lastManualInput = performance.now()
    hasHadManualInput = true
    shapedKeys = zeroAxes()
    return {
      surge: applyExpo(-(latestAxes[1] ?? 0), STICK_EXPO), // left stick vertical (up = forward)
      sway: applyExpo(latestAxes[0] ?? 0, STICK_EXPO), // left stick horizontal
      yaw: applyExpo(latestAxes[2] ?? 0, STICK_EXPO), // right stick horizontal
      heave: applyExpo(latestAxes[3] ?? 0, STICK_EXPO), // right stick vertical (down = descend)
      pitch: 0,
      roll: 0,
    }
  }

  const rawKeys = keyboardDemand()
  shapedKeys = stepDemandEnvelope(shapedKeys, rawKeys ?? zeroAxes(), dt)
  if (rawKeys) {
    lastManualInput = performance.now()
    hasHadManualInput = true
  }
  const keysSettling = Object.values(shapedKeys).some((v) => Math.abs(v) > 0.005)
  if (rawKeys || keysSettling) return shapedKeys

  // After the first manual input the rover holds position when idle.
  if (hasHadManualInput || performance.now() - lastManualInput < 10000) {
    return zeroAxes()
  }

  // Automated patrol: slow figure-eight-ish motion so HUDs/telemetry always move.
  const t = elapsed
  return {
    surge: 0.35 + 0.15 * Math.sin(t * 0.2),
    sway: 0.2 * Math.sin(t * 0.13),
    yaw: 0.25 * Math.sin(t * 0.1),
    heave: 0.15 * Math.sin(t * 0.07),
    pitch: 0.1 * Math.sin(t * 0.23),
    roll: 0.1 * Math.sin(t * 0.17),
  }
}
let lastManualInput = 0

const ensureDataLakeVar = (id: string): void => {
  if (!getDataLakeVariableInfo(id)) {
    createDataLakeVariable({ id, name: id, type: 'number', persistent: false, persistValue: false })
  }
}

const demoDataLakeIds = [
  'ATTITUDE/roll',
  'ATTITUDE/pitch',
  'ATTITUDE/yaw',
  'VFR_HUD/heading',
  'VFR_HUD/alt',
  'VFR_HUD/groundspeed',
  'BATTERY_STATUS/voltages',
  'PRACTICE/tether-deployed',
  'DVL/altitude',
  'DVL/ground-velocity',
  'PING/altitude',
  'SONAR/forward-range',
]

/**
 * Start Practice/Demo mode: seed a fake ArduSub vehicle and begin the sim loop.
 * Loads the vehicle store and joystick manager lazily (see import note above).
 * @returns {Promise<void>} Resolves once the sim loop is running.
 */
export const startDemoMode = async (): Promise<void> => {
  if (isDemoModeActive.value) return
  const { useMainVehicleStore } = await import('@/stores/mainVehicle')
  const store = useMainVehicleStore()
  await subscribeToJoystick()

  simState = initialSimState(activePracticeEnvironment.value)
  elapsed = 0
  shapedKeys = zeroAxes()
  hasHadManualInput = false
  // Clear any replay/freeze left over from a prior session, else the new sim
  // would start frozen (dead on arrival) ticking a stale replay.
  activeReplay.value = null
  replayMode.value = null
  resetInstructorState()
  sonarBins.fill(defaultSonarOptions.maxRangeM)
  sonarHead = 0
  isDemoModeActive.value = true
  beginPracticeRecording()

  // Keyboard fallback controls while practicing.
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)

  // Present as a connected ArduSub so the UI behaves as if online.
  store.modes = arduSubModes
  store.mode = 'MANUAL'
  store.isArmed = true

  demoDataLakeIds.forEach(ensureDataLakeVar)

  let tick = 0
  loopTimer = setInterval(() => {
    elapsed += dt
    tick++
    const env = activePracticeEnvironment.value

    // The replay clock advances on the sim's heartbeat (even while frozen, so
    // a frozen pilot can still watch a recording).
    activeReplay.value?.tick(dt)

    // Instructor freeze: the world holds; controls are ignored.
    if (instructorState.value.frozen) {
      frozenElapsed += dt
    } else {
      simState = stepSimulation(simState, activeRoverProfile.value, env, currentDemand(), dt, {
        gripperClosed: gripperClosedTarget.value,
        failures: instructorState.value,
      })
    }

    // Pose frames publish EVERY tick (50 Hz): the 3D view interpolates between
    // prev and curr so motion is glassy at any display refresh rate.
    const frame: PracticePoseFrame = {
      t: performance.now(),
      x: simState.x,
      y: simState.y,
      depth: simState.depth,
      heading: simState.heading,
      pitch: simState.pitch,
      roll: simState.roll,
      speed: Math.hypot(simState.surgeVel, simState.swayVel, simState.heaveVel),
      surgeVel: simState.surgeVel,
      swayVel: simState.swayVel,
      heaveVel: simState.heaveVel,
    }
    practicePoseFrames.value = { prev: practicePoseFrames.value?.curr ?? frame, curr: frame }

    // Transient events are captured every tick so none slip between publishes.
    if (simState.justPassed) {
      recentPassName = simState.justPassed
      recentPassUntil = elapsed + 3
    }

    // Black box: 10 Hz frames + edge-triggered events into the dive log. Frozen
    // ticks (instructor freeze, or watching a replay) are NOT recorded — they'd
    // append a stationary tail to the run and inflate its duration.
    if (recording && !instructorState.value.frozen) {
      const recT = elapsed - recordingStartElapsed - frozenElapsed
      if (tick % RECORD_EVERY === 0) {
        recording.addFrame({
          t: recT,
          x: simState.x,
          y: simState.y,
          depth: simState.depth,
          heading: simState.heading,
          pitch: simState.pitch,
          roll: simState.roll,
          speed: frame.speed,
          thrusterOutputs: simState.thrusterOutputs,
        })
      }
      if (simState.collidedWith && simState.collidedWith !== lastCollidedWith) {
        const isSnag = simState.collidedWith.startsWith('tether')
        recording.addEvent(recT, isSnag ? 'snag' : 'collision', simState.collidedWith)
      }
      lastCollidedWith = simState.collidedWith
      if (simState.justPassed) recording.addEvent(recT, 'pass', simState.justPassed)
      if (simState.heldObstacleId && simState.heldObstacleId !== lastHeldId) {
        recording.addEvent(recT, 'grab', simState.heldObstacleId)
      } else if (!simState.heldObstacleId && lastHeldId) {
        recording.addEvent(recT, 'release', lastHeldId)
      }
      lastHeldId = simState.heldObstacleId
    }

    // Everything below (readout + vehicle store + data lake) stays at 25 Hz.
    if (tick % READOUT_EVERY !== 0) return

    const depth = simState.depth
    const headingDeg = (simState.heading * 180) / Math.PI
    const battery = 16.8 - 0.0008 * elapsed - 0.05 * Math.abs(simState.surgeVel)
    const tetherDeployed = tetherDeployedLength(simState, env)

    // Simulated sensor suite (UWSim-style): scalar instruments every tick, plus
    // a few Ping360 sonar bins refreshed to animate the mechanical sweep.
    const pose = sensorPose()
    const sensors = computeSensorReadout(env, pose)
    for (let i = 0; i < SONAR_BINS_PER_TICK; i++) {
      sonarHead = (sonarHead + 1) % defaultSonarOptions.bins
      sonarBins[sonarHead] = sonarBeam(env, pose, sonarHead, defaultSonarOptions)
    }

    // Publish the pool-local readout for the practice widgets.
    practiceSimReadout.value = {
      x: simState.x,
      y: simState.y,
      depth,
      heading: simState.heading,
      tetherDeployed,
      tetherPath: env.tether.enabled
        ? tetherFullPath(simState, env).map((p) => [p.x, p.y, p.depth] as [number, number, number])
        : undefined,
      tetherSnagged: env.tether.enabled ? tetherSnaggedObstacleIds(simState, env) : undefined,
      collidedWith: simState.collidedWith,
      recentPass: elapsed < recentPassUntil ? recentPassName : undefined,
      gripper: simState.gripper,
      heldObstacleId: simState.heldObstacleId,
      thrusterOutputs: simState.thrusterOutputs,
      thrust: simState.thrust,
      sensors,
      sonar: { bins: sonarBins, head: sonarHead, maxRangeM: defaultSonarOptions.maxRangeM },
    }

    // Convert pool-local meters to lat/lon for the map widget (x = north, y = east).
    const metersPerDegLat = 111320
    const metersPerDegLon = 111320 * Math.cos((ORIGIN_LAT * Math.PI) / 180)

    // Path 1: reactive store objects (read directly by Attitude/Compass/Depth/Battery widgets).
    Object.assign(store.attitude, { roll: simState.roll, pitch: simState.pitch, yaw: simState.heading })
    Object.assign(store.altitude, { msl: unit(-depth, 'm'), rel: -depth })
    Object.assign(store.coordinates, {
      latitude: ORIGIN_LAT + simState.x / metersPerDegLat,
      longitude: ORIGIN_LON + simState.y / metersPerDegLon,
      altitude: -depth,
      precision: 1,
    })
    Object.assign(store.velocity, {
      x: simState.surgeVel,
      y: simState.swayVel,
      z: simState.heaveVel,
      ground: Math.hypot(simState.surgeVel, simState.swayVel),
      overall: Math.hypot(simState.surgeVel, simState.swayVel, simState.heaveVel),
    })
    Object.assign(store.powerSupply, { voltage: battery, current: 2 + 4 * Math.abs(simState.surgeVel), remaining: 80 })
    store.lastHeartbeat = new Date()

    // Path 2: data lake (read by custom VeryGenericIndicator widgets).
    setDataLakeVariableData('ATTITUDE/roll', simState.roll)
    setDataLakeVariableData('ATTITUDE/pitch', simState.pitch)
    setDataLakeVariableData('ATTITUDE/yaw', simState.heading)
    setDataLakeVariableData('VFR_HUD/heading', headingDeg)
    setDataLakeVariableData('VFR_HUD/alt', -depth)
    setDataLakeVariableData('VFR_HUD/groundspeed', Math.hypot(simState.surgeVel, simState.swayVel))
    setDataLakeVariableData('BATTERY_STATUS/voltages', battery)
    setDataLakeVariableData('PRACTICE/tether-deployed', tetherDeployed)
    setDataLakeVariableData('DVL/altitude', sensors.dvl.altitudeM)
    setDataLakeVariableData('DVL/ground-velocity', Math.hypot(sensors.dvl.vx, sensors.dvl.vy))
    setDataLakeVariableData('PING/altitude', sensors.altimeterM)
    setDataLakeVariableData('SONAR/forward-range', sensors.forwardRangeM)
  }, 1000 / SIM_HZ)
}

/**
 * Reset the simulated rover to the environment's start position (e.g. after the
 * user switches environments, so the rover is never stranded outside the pool).
 * @returns {void}
 */
export const resetPracticeSim = (): void => {
  simState = initialSimState(activePracticeEnvironment.value)
}

/**
 * Stop Practice/Demo mode and let the real connection path resume.
 * @returns {void}
 */
export const stopDemoMode = (): void => {
  if (loopTimer) clearInterval(loopTimer)
  loopTimer = undefined
  persistRecording()
  recording = null
  isDemoModeActive.value = false
  practiceSimReadout.value = null
  practicePoseFrames.value = null
  shapedKeys = zeroAxes()
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
  pressedKeys.clear()
}
