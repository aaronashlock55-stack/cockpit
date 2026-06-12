/**
 * The practice environment describes the WORLD the Practice/Demo simulator runs
 * in: pool dimensions, water properties (salinity/temperature -> density and
 * buoyancy), an optional surface ice sheet with a launch hole, an optional
 * tether, and obstacles/mission props. Like rover profiles it is plain,
 * shareable JSON so teams can model their own pool and prop layout.
 *
 * The bundled MATE 2026 preset is built from the official "MATE Floats Under
 * the Ice!" preview mission: NRC ice tank 90 m x 12 m x 3 m, EGADS water with
 * specific gravity ~1.025, a 1-5 cm ice sheet with a 1 m x 1 m launch hole, and
 * a vertical profiling float (<18 cm diameter, <1 m tall) as the recovery prop.
 */

/** An obstacle / mission prop placed in the pool. */
export interface PracticeObstacle {
  /** Unique id within the environment. */
  id: string
  /** Display name, e.g. "Profiling float". */
  name: string
  /** Shape used for collision and drawing. 'ring' is a vertical hoop to fly through. */
  shape: 'box' | 'cylinder' | 'ring'
  /** Position in pool-local meters: x along length, y across width, top depth below surface. */
  position: [number, number, number]
  /**
   * Size in meters: box = [dx, dy, height]; cylinder = [diameter, diameter, height];
   * ring = [outerDiameter, tubeDiameter, outerDiameter] (vertical extent = outer diameter).
   */
  size: [number, number, number]
  /** Rotation about the vertical axis, degrees. For rings, 0 = fly through traveling along pool +x. */
  yawDeg?: number
  /** Optional display color (CSS). */
  color?: string
}

/** A complete, shareable practice environment. */
export interface PracticeEnvironment {
  /** Human-friendly name. */
  name: string
  /** Pool dimensions in meters. */
  pool: {
    /** Length (x axis) in meters. */
    length: number
    /** Width (y axis) in meters. */
    width: number
    /** Depth in meters. */
    depth: number
  }
  /** Water properties driving density/buoyancy. */
  water: {
    /** Salinity in g/kg (ppt). Fresh pool ~0, seawater/EGADS ~32-35. */
    salinityPpt: number
    /** Water temperature in Celsius (display/realism). */
    temperatureC: number
  }
  /** Optional surface ice sheet. The rover collides with it except inside the launch hole. */
  iceSheet?: {
    /** Ice thickness in meters (MATE 2026: 0.01-0.05). */
    thickness: number
    /** Launch-hole center in pool-local meters [x, y]. */
    holeCenter: [number, number]
    /** Square hole side length in meters (MATE 2026: 1.0). */
    holeSize: number
  }
  /** Tether configuration. */
  tether: {
    /** Whether the tether is simulated. */
    enabled: boolean
    /** Tether length in meters. */
    length: number
    /** Surface attachment point in pool-local meters [x, y] (e.g. pool edge). */
    attachPoint: [number, number]
  }
  /** Obstacles / mission props. */
  obstacles: PracticeObstacle[]
  /** Schema marker for validation / forward-compat. */
  schema: 'cockpit-practice-env/v1'
}

/**
 * Approximate water density from salinity and temperature.
 * Linearized around typical pool/sea conditions (good to ~0.5 kg/m3 here).
 * @param {number} salinityPpt Salinity in g/kg.
 * @param {number} temperatureC Temperature in Celsius.
 * @returns {number} Density in kg/m3.
 */
export const waterDensity = (salinityPpt: number, temperatureC: number): number => {
  return 1000 + 0.78 * salinityPpt - 0.2 * (temperatureC - 15)
}

// MATE 2026 World Championship: NRC ice tank per the official preview mission.
export const mate2026IceTankEnvironment: PracticeEnvironment = {
  name: 'MATE 2026 — NRC Ice Tank (Worlds)',
  pool: { length: 90, width: 12, depth: 3 },
  // EGADS solution, specific gravity ~1.025 -> ~32 ppt equivalent; tank runs cold.
  water: { salinityPpt: 32, temperatureC: 2 },
  iceSheet: { thickness: 0.03, holeCenter: [3, 6], holeSize: 1 },
  tether: { enabled: true, length: 25, attachPoint: [0, 6] },
  obstacles: [
    {
      id: 'float-1',
      name: 'Profiling float (hold 2.5 m)',
      shape: 'cylinder',
      position: [10, 6, 2.0], // top of the float when holding at 2.5 m (bottom at 3.0... float is 1 m tall)
      size: [0.18, 0.18, 1.0],
      color: '#ffd24a',
    },
  ],
  schema: 'cockpit-practice-env/v1',
}

// A typical regional: standard pool, no real ice ("ice assumed"), float prop present.
export const mateRegionalEnvironment: PracticeEnvironment = {
  name: 'MATE 2026 — Regional pool',
  pool: { length: 25, width: 15, depth: 2.5 },
  water: { salinityPpt: 0, temperatureC: 26 },
  tether: { enabled: true, length: 20, attachPoint: [0, 7.5] },
  obstacles: [
    {
      id: 'float-1',
      name: 'Profiling float',
      shape: 'cylinder',
      position: [8, 7.5, 1.5],
      size: [0.18, 0.18, 1.0],
      color: '#ffd24a',
    },
  ],
  schema: 'cockpit-practice-env/v1',
}

// Skills course: hoops to fly through, corner slalom gates, and objects to pick
// up with the claw — simple, repeatable pilot-training tasks.
export const trainingCourseEnvironment: PracticeEnvironment = {
  name: 'Training course — hoops, gates & pickups',
  pool: { length: 30, width: 15, depth: 4 },
  water: { salinityPpt: 0, temperatureC: 24 },
  tether: { enabled: true, length: 35, attachPoint: [0, 7.5] },
  obstacles: [
    // Hoops at increasing distance/depth (a ✔ flashes in the 3D view on a clean pass).
    { id: 'hoop-1', name: 'Hoop 1', shape: 'ring', position: [7, 7.5, 1.0], size: [1.4, 0.08, 1.4], color: '#56e08e' },
    {
      id: 'hoop-2',
      name: 'Hoop 2',
      shape: 'ring',
      position: [13, 5, 1.8],
      size: [1.2, 0.08, 1.2],
      yawDeg: 25,
      color: '#56e08e',
    },
    {
      id: 'hoop-3',
      name: 'Hoop 3',
      shape: 'ring',
      position: [19, 10, 2.6],
      size: [1.0, 0.08, 1.0],
      yawDeg: -20,
      color: '#56e08e',
    },
    // Corner slalom: post pairs to thread near the far corners.
    {
      id: 'gate-1l',
      name: 'Gate 1',
      shape: 'cylinder',
      position: [24, 3, 2.0],
      size: [0.11, 0.11, 2.0],
      color: '#ff8c42',
    },
    {
      id: 'gate-1r',
      name: 'Gate 1',
      shape: 'cylinder',
      position: [24, 5, 2.0],
      size: [0.11, 0.11, 2.0],
      color: '#ff8c42',
    },
    {
      id: 'gate-2l',
      name: 'Gate 2',
      shape: 'cylinder',
      position: [26, 11, 2.0],
      size: [0.11, 0.11, 2.0],
      color: '#ff8c42',
    },
    {
      id: 'gate-2r',
      name: 'Gate 2',
      shape: 'cylinder',
      position: [26, 13, 2.0],
      size: [0.11, 0.11, 2.0],
      color: '#ff8c42',
    },
    // Pickup objects on the floor (grab with the claw) + a basket to carry them back to.
    {
      id: 'cube-1',
      name: 'Practice cube',
      shape: 'box',
      position: [10, 11, 3.75],
      size: [0.25, 0.25, 0.25],
      color: '#ffd24a',
    },
    {
      id: 'can-1',
      name: 'Canister',
      shape: 'cylinder',
      position: [16, 3.5, 3.6],
      size: [0.16, 0.16, 0.4],
      color: '#e25563',
    },
    {
      id: 'float-1',
      name: 'Profiling float',
      shape: 'cylinder',
      position: [22, 7.5, 3.0],
      size: [0.18, 0.18, 1.0],
      color: '#ffd24a',
    },
    {
      id: 'basket',
      name: 'Recovery basket',
      shape: 'box',
      position: [3, 12, 3.5],
      size: [1.2, 1.2, 0.5],
      color: '#9aa7b0',
    },
  ],
  schema: 'cockpit-practice-env/v1',
}

export const openWaterEnvironment: PracticeEnvironment = {
  name: 'Open practice pool (no props)',
  pool: { length: 50, width: 25, depth: 5 },
  water: { salinityPpt: 0, temperatureC: 24 },
  tether: { enabled: false, length: 30, attachPoint: [0, 12.5] },
  obstacles: [],
  schema: 'cockpit-practice-env/v1',
}

export const builtInPracticeEnvironments: PracticeEnvironment[] = [
  trainingCourseEnvironment,
  mate2026IceTankEnvironment,
  mateRegionalEnvironment,
  openWaterEnvironment,
]

export const defaultPracticeEnvironment = trainingCourseEnvironment

/**
 * Validate an unknown value as a PracticeEnvironment. Throws with a clear reason on failure.
 * @param {unknown} maybeEnv Parsed JSON to validate.
 * @returns {PracticeEnvironment} The validated environment.
 */
export const validatePracticeEnvironment = (maybeEnv: unknown): PracticeEnvironment => {
  const e = maybeEnv as Partial<PracticeEnvironment>
  if (!e || typeof e !== 'object') throw new Error('Environment is not an object.')
  if (e.schema !== 'cockpit-practice-env/v1') throw new Error('Unrecognized or missing environment schema.')
  if (typeof e.name !== 'string') throw new Error('Environment is missing a name.')
  if (!e.pool || [e.pool.length, e.pool.width, e.pool.depth].some((v) => typeof v !== 'number' || v <= 0)) {
    throw new Error('Environment pool dimensions are invalid.')
  }
  if (!e.water || typeof e.water.salinityPpt !== 'number') throw new Error('Environment water properties are invalid.')
  if (!e.tether || typeof e.tether.length !== 'number') throw new Error('Environment tether settings are invalid.')
  if (!Array.isArray(e.obstacles)) throw new Error('Environment obstacles must be an array.')
  e.obstacles.forEach((o, i) => {
    if (!o.position || o.position.length !== 3 || !o.size || o.size.length !== 3) {
      throw new Error(`Obstacle ${i} has invalid position/size.`)
    }
  })
  return e as PracticeEnvironment
}
