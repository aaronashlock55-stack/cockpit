import { unit } from 'mathjs'

import { type SimState, initialSimState, stepSimulation, tetherDeployedLength } from '@/libs/rover-simulator'
// NOTE: the vehicle store and joystick manager are loaded lazily inside
// startDemoMode(). Importing them statically from here (which the development
// store pulls in at boot) changes the production bundle's module evaluation
// order and crashes with 'Cannot access mavlinkManualControlAxes before
// initialization' (a circular-import TDZ in the joystick protocol graph).
import { type BodyAxes } from '@/types/rover-profile'

import { createDataLakeVariable, getDataLakeVariableInfo, setDataLakeVariableData } from './data-lake'
import { activePracticeEnvironment, activeRoverProfile, isDemoModeActive, practiceSimReadout } from './demo-mode-state'

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

const SIM_HZ = 25
const dt = 1 / SIM_HZ

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

// Map anchor for converting pool-local meters to lat/lon (arbitrary but valid).
const ORIGIN_LAT = 47.3977
const ORIGIN_LON = 8.5456

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

/**
 * Build the control demand for this tick: gamepad if recently active, else the
 * keyboard (WASD/arrows), else an automated patrol so demos always show motion.
 * @returns {BodyAxes} Per-axis demand in [-1, 1].
 */
const currentDemand = (): BodyAxes => {
  const joystickActive = performance.now() - lastJoystickActivity < 1000 && latestAxes.length >= 2
  if (joystickActive) {
    lastManualInput = performance.now()
    return {
      surge: -(latestAxes[1] ?? 0), // left stick vertical (up = forward)
      sway: latestAxes[0] ?? 0, // left stick horizontal
      yaw: latestAxes[2] ?? 0, // right stick horizontal
      heave: latestAxes[3] ?? 0, // right stick vertical (down = descend)
      pitch: 0,
      roll: 0,
    }
  }

  const keys = keyboardDemand()
  if (keys) {
    lastManualInput = performance.now()
    return keys
  }

  // Hold still briefly after manual input stops instead of resuming the patrol immediately.
  if (performance.now() - lastManualInput < 10000) {
    return { surge: 0, sway: 0, heave: 0, yaw: 0, pitch: 0, roll: 0 }
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
  isDemoModeActive.value = true

  // Keyboard fallback controls while practicing.
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)

  // Present as a connected ArduSub so the UI behaves as if online.
  store.modes = arduSubModes
  store.mode = 'MANUAL'
  store.isArmed = true

  demoDataLakeIds.forEach(ensureDataLakeVar)

  loopTimer = setInterval(() => {
    elapsed += dt
    const env = activePracticeEnvironment.value
    simState = stepSimulation(simState, activeRoverProfile.value, env, currentDemand(), dt, {
      gripperClosed: gripperClosedTarget.value,
    })

    const depth = simState.depth
    const headingDeg = (simState.heading * 180) / Math.PI
    const battery = 16.8 - 0.0008 * elapsed - 0.05 * Math.abs(simState.surgeVel)
    const tetherDeployed = tetherDeployedLength(simState, env)

    // Publish the pool-local readout for the practice widgets.
    practiceSimReadout.value = {
      x: simState.x,
      y: simState.y,
      depth,
      heading: simState.heading,
      tetherDeployed,
      collidedWith: simState.collidedWith,
      gripper: simState.gripper,
      heldObstacleId: simState.heldObstacleId,
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
  isDemoModeActive.value = false
  practiceSimReadout.value = null
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
  pressedKeys.clear()
}
