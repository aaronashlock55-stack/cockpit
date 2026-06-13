import * as THREE from 'three'

import {
  buildBubbles,
  buildDriftingParticles,
  buildLightShafts,
  buildNearFieldMotes,
  buildPropWash,
  gradientEnvironment,
} from '@/libs/practice-3d-fx'
import { buildRoverModel } from '@/libs/practice-3d-rover'
import { buildShaderCaustics, buildShaderWater } from '@/libs/practice-3d-shaders'
import { buildPoolDetails, obstacleMaterial, tiledMaterial } from '@/libs/practice-3d-textures'
import { smoothTowards } from '@/libs/practice-interp'
import { tetherWorldPath } from '@/libs/rover-simulator'
import { type PracticeEnvironment } from '@/types/practice-environment'
import { type RoverProfile, defaultRoverProfile } from '@/types/rover-profile'

/**
 * The first-person/chase 3D underwater world for Practice mode: pool, animated
 * water surface or ice sheet with launch hole, floor caustics, obstacles and
 * hoops, the FULL rover model (built from the imported profile), and a real
 * rope tether that sags when slack and pulls straight + red when taut.
 * Pure three.js object-graph construction — no renderer — so the structure is
 * unit-testable in node.
 *
 * Coordinate mapping (pool-local -> three.js):
 *   pool x (along length)  -> three +X
 *   pool y (across width)  -> three +Z
 *   pool depth (down)      -> three -Y   (water surface at Y=0)
 */

/** Operator camera look/zoom offset on top of the rigid mount or chase rig. */
export interface CameraAdjust {
  /** Yaw look offset, radians. */
  yaw: number
  /** Pitch look offset, radians. */
  pitch: number
  /** Zoom factor (1 = default; >1 zooms in / narrows FOV / pulls the chase in). */
  zoom: number
}

/** Body-frame acceleration, m/s², for camera weight cues. */
export interface BodyAccel {
  /** Forward acceleration. */
  surge: number
  /** Rightward acceleration. */
  sway: number
  /** Downward acceleration. */
  heave: number
}

/** Per-frame update options. */
export interface WorldUpdateOptions {
  /** Claw closure 0..1. */
  gripper?: number
  /** Camera mode: first-person ROV camera or third-person chase view. */
  cameraMode?: 'fp' | 'chase'
  /** Vehicle speed (m/s) — drives propeller spin, FOV and chase distance cues. */
  speed?: number
  /** Full tether path (attach → hole → snag points → rover) as [x, y, depth] triples. */
  tetherPath?: [number, number, number][]
  /** Operator camera look/zoom adjustment. */
  cameraAdjust?: CameraAdjust
  /** Body-frame acceleration for first-person micro-inertia cues. */
  accel?: BodyAccel
  /** Spooled per-thruster outputs [-1, 1], for prop-wash visuals. */
  thrusterOutputs?: number[]
  /** Frame dt override in seconds (tests; defaults to the internal clock). */
  dt?: number
}

/** Handle to the built world, used by the widget each frame. */
export interface PracticeWorld {
  /** The scene to render. */
  scene: THREE.Scene
  /** The active camera. */
  camera: THREE.PerspectiveCamera
  /** Per-frame updater: vehicle pose plus view/claw/speed options. */
  update: (pose: CameraPose, opts?: WorldUpdateOptions) => void
  /** Free GPU/heap resources. */
  dispose: () => void
}

/** Camera pose in pool-local terms. */
export interface CameraPose {
  /** Pool-local x, meters. */
  x: number
  /** Pool-local y, meters. */
  y: number
  /** Depth, meters (positive down). */
  depth: number
  /** Heading, radians (0 = +x, clockwise from above). */
  heading: number
  /** Pitch, radians (nose up positive). */
  pitch: number
  /** Roll, radians. */
  roll: number
}

const WATER_COLOR = 0x16465e
const WATER_COLOR_DEEP = 0x0c2d3f
const TETHER_SLACK = new THREE.Color(0xffe066)
const TETHER_TAUT = new THREE.Color(0xff5050)

/**
 * Build the practice world for an environment.
 * @param {PracticeEnvironment} env The practice environment to model.
 * @param {RoverProfile} profile Rover profile: sizes the visible vehicle + frame.
 * @returns {PracticeWorld} Scene, camera, per-frame updater, and disposer.
 */
export const buildPracticeWorld = (
  env: PracticeEnvironment,
  profile: RoverProfile = defaultRoverProfile
): PracticeWorld => {
  const scene = new THREE.Scene()
  const { length: L, width: W, depth: D } = env.pool

  // Underwater atmosphere: dense exponential fog + matching background +
  // an environment map so clear/metal surfaces pick up subtle reflections.
  scene.background = new THREE.Color(WATER_COLOR)
  scene.fog = new THREE.FogExp2(WATER_COLOR, 0.07)
  const envMap = gradientEnvironment()
  if (envMap) scene.environment = envMap

  // Lighting: sky/depth hemisphere + a shadow-casting sun through the surface.
  scene.add(new THREE.HemisphereLight(0xbfe3ff, 0x0c2d3f, 0.9))
  scene.add(new THREE.AmbientLight(0x9fc8e0, 0.35))
  const sun = new THREE.DirectionalLight(0xcfe8ff, 1.7)
  sun.position.set(L / 2 + 4, 12, W / 2 - 3)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  const span = Math.max(L, W) / 2 + 2
  sun.shadow.camera.left = -span
  sun.shadow.camera.right = span
  sun.shadow.camera.top = span
  sun.shadow.camera.bottom = -span
  sun.shadow.camera.far = 40
  sun.target.position.set(L / 2, -D, W / 2)
  scene.add(sun)
  scene.add(sun.target)

  // Floor.
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(L, W), tiledMaterial(0xffffff, L, W, 'floor'))
  floor.name = 'floor'
  floor.rotation.x = -Math.PI / 2
  floor.position.set(L / 2, -D, W / 2)
  floor.receiveShadow = true
  scene.add(floor)

  // Walls (single-sided, facing inward).
  /* eslint-disable jsdoc/require-jsdoc */
  const wallSpecs: { name: string; size: [number, number]; pos: [number, number, number]; rotY: number }[] = [
    { name: 'wall-north', size: [W, D], pos: [0, -D / 2, W / 2], rotY: Math.PI / 2 },
    { name: 'wall-south', size: [W, D], pos: [L, -D / 2, W / 2], rotY: -Math.PI / 2 },
    { name: 'wall-west', size: [L, D], pos: [L / 2, -D / 2, 0], rotY: 0 },
    { name: 'wall-east', size: [L, D], pos: [L / 2, -D / 2, W], rotY: Math.PI },
  ]
  /* eslint-enable jsdoc/require-jsdoc */
  for (const spec of wallSpecs) {
    const wall = new THREE.Mesh(
      new THREE.PlaneGeometry(spec.size[0], spec.size[1]),
      tiledMaterial(0xe8f4f8, spec.size[0], spec.size[1], 'wall')
    )
    wall.name = spec.name
    wall.position.set(...spec.pos)
    wall.rotation.y = spec.rotY
    wall.receiveShadow = true
    scene.add(wall)
  }

  // Lane lines + waterline band: the competition-pool dressing that also gives
  // the eye strong optic-flow references for judging speed.
  scene.add(buildPoolDetails(L, W, D))

  // Caustic shimmer above the floor + slanting light shafts from the surface.
  const caustics = buildShaderCaustics(L, W, D)
  scene.add(caustics.object)
  const lightShafts = buildLightShafts(L, W, D)
  scene.add(lightShafts.object)

  // Representative current for visuals: stream particles, scale wave chop.
  const flowDir = ((env.flow?.directionDeg ?? 0) * Math.PI) / 180
  const flowSpeed = env.flow && env.flow.type !== 'waves' ? env.flow.speed * (env.flow.type === 'jet' ? 0.6 : 1) : 0
  const repDrift: [number, number] = [Math.cos(flowDir) * flowSpeed, Math.sin(flowDir) * flowSpeed]
  const waveAmp = env.flow?.type === 'waves' ? 1 + env.flow.speed * 3 : 1

  // Ice sheet with launch hole, or animated water surface seen from below.
  let water: ReturnType<typeof buildShaderWater> | undefined
  if (env.iceSheet) {
    const iceShape = new THREE.Shape()
    iceShape.moveTo(0, 0)
    iceShape.lineTo(L, 0)
    iceShape.lineTo(L, W)
    iceShape.lineTo(0, W)
    iceShape.closePath()
    const [hx, hy] = env.iceSheet.holeCenter
    const half = env.iceSheet.holeSize / 2
    const hole = new THREE.Path()
    hole.moveTo(hx - half, hy - half)
    hole.lineTo(hx + half, hy - half)
    hole.lineTo(hx + half, hy + half)
    hole.lineTo(hx - half, hy + half)
    hole.closePath()
    iceShape.holes.push(hole)
    const ice = new THREE.Mesh(
      new THREE.ShapeGeometry(iceShape),
      new THREE.MeshStandardMaterial({
        color: 0xe6f3fb,
        roughness: 0.45,
        transparent: true,
        opacity: 0.92,
        side: THREE.DoubleSide,
      })
    )
    ice.name = 'ice-sheet'
    // ShapeGeometry is built in XY; rotate flat and place at the surface.
    ice.rotation.x = Math.PI / 2
    ice.position.y = 0
    scene.add(ice)
  } else {
    water = buildShaderWater(L, W, waveAmp)
    scene.add(water.object)
  }

  // Obstacles / mission props. Meshes are tracked so positions re-sync every
  // frame (a grabbed prop follows the claw; the sim mutates env positions).
  const obstacleMeshes = new Map<string, THREE.Mesh>()
  for (const obstacle of env.obstacles) {
    const height = obstacle.size[2]
    const material = obstacleMaterial(obstacle)
    let mesh: THREE.Mesh
    if (obstacle.shape === 'ring') {
      // Vertical hoop to fly through; torus is built in XY (normal +Z).
      const outerR = obstacle.size[0] / 2
      const tubeR = obstacle.size[1] / 2
      mesh = new THREE.Mesh(new THREE.TorusGeometry(outerR - tubeR, tubeR, 12, 36), material)
      mesh.rotation.y = Math.PI / 2 - ((obstacle.yawDeg ?? 0) * Math.PI) / 180
    } else if (obstacle.shape === 'cylinder') {
      mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(obstacle.size[0] / 2, obstacle.size[0] / 2, height, 24),
        material
      )
    } else {
      mesh = new THREE.Mesh(new THREE.BoxGeometry(obstacle.size[0], height, obstacle.size[1]), material)
    }
    mesh.name = `obstacle-${obstacle.id}`
    mesh.castShadow = true
    mesh.receiveShadow = true
    obstacleMeshes.set(obstacle.id, mesh)
    scene.add(mesh)
  }
  const syncObstacles = (): void => {
    for (const obstacle of env.obstacles) {
      const mesh = obstacleMeshes.get(obstacle.id)
      if (!mesh) continue
      // Rings center at top + outer RADIUS (size[0]/2) — the same point the
      // torus collision uses — so the visual hoop and its hitbox always agree.
      const centerDepth = obstacle.position[2] + (obstacle.shape === 'ring' ? obstacle.size[0] : obstacle.size[2]) / 2
      mesh.position.set(obstacle.position[0], -centerDepth, obstacle.position[1])
    }
  }
  syncObstacles()

  // Drifting particulate (streams with any current) + rising bubbles.
  const particles = buildDriftingParticles(L, W, D, repDrift)
  scene.add(particles.object)
  const bubbles = buildBubbles(L, W, D)
  scene.add(bubbles.object)

  // Near-camera motes streaming opposite the velocity: the strongest
  // underwater speed cue.
  const nearMotes = buildNearFieldMotes()
  scene.add(nearMotes.object)

  // The full rover model (visible in chase view), built from the profile.
  const rover = buildRoverModel(profile)
  rover.group.visible = false
  scene.add(rover.group)

  // Prop wash rides the rover: bubbles burst behind whichever thrusters are
  // working, so thrust effort is visible (a weight cue, and great feedback).
  const propWash = buildPropWash(profile)
  rover.group.add(propWash.object)

  // Tether: a real rope (tube) that sags in proportion to slack, straightens
  // and turns red as it runs out, and routes through the ice launch hole.
  // Always built; visibility follows env.tether.enabled live (no rebuild).
  const tetherMaterial = new THREE.MeshBasicMaterial({ color: TETHER_SLACK.clone() })
  const tether = new THREE.Mesh(new THREE.BufferGeometry(), tetherMaterial)
  tether.name = 'tether'
  tether.frustumCulled = false
  scene.add(tether)

  // First-person camera MOUNTED ON the rover model — the camera and vehicle are
  // one rigid body, like a real ROV's fixed forward camera. The mount sits at
  // the nose so the hull is behind the lens; the view looks out over the frame
  // edges and the claw. Chase view detaches the same camera behind the vehicle.
  const camera = new THREE.PerspectiveCamera(80, 16 / 9, 0.02, 250)
  const mountH = Math.max(profile.dimensions.height, 0.2)
  const mountL = Math.max(profile.dimensions.length, 0.3)
  const FP_MOUNT = new THREE.Vector3(0, mountH * 0.34, -mountL * 0.46)
  const FP_TILT = -0.14 // look slightly down so the claw stays in frame

  // FP micro-inertia (flight-sim "head inertia"): acceleration tips the view a
  // touch and tucks the camera back on its mount — the cue that sells mass.
  let fpPitchOff = 0
  let fpLagOff = 0
  let fpRollOff = 0

  // Adjustable camera: the operator can look around (yaw/pitch offset) and zoom
  // on top of the rigid mount / chase rig.
  const mountCameraFp = (adjust?: CameraAdjust): void => {
    if (camera.parent !== rover.group) rover.group.add(camera)
    camera.position.copy(FP_MOUNT)
    camera.position.z += fpLagOff
    camera.rotation.set(FP_TILT + (adjust?.pitch ?? 0) + fpPitchOff, adjust?.yaw ?? 0, fpRollOff)
  }
  // Speed widens the FOV subtly (sense of speed), smoothed so it eases in/out.
  let smoothSpeed = 0
  const FOV_SPEED_GAIN = 6 // extra degrees at >= 1.2 m/s
  let lastFov = camera.fov
  const applyZoom = (zoom: number): void => {
    const base = 80 + FOV_SPEED_GAIN * Math.min(smoothSpeed, 1.2)
    const fov = Math.min(110, Math.max(30, base / Math.max(0.4, zoom)))
    if (Math.abs(fov - lastFov) > 0.01) {
      camera.fov = fov
      camera.updateProjectionMatrix()
      lastFov = fov
    }
  }
  mountCameraFp()

  const clock = new THREE.Clock()
  let elapsed = 0
  const chasePos = new THREE.Vector3()
  const lookPos = new THREE.Vector3()
  const lastPos = new THREE.Vector3(NaN, NaN, NaN)
  const velWorld = new THREE.Vector3()
  const camWorld = new THREE.Vector3()
  let chaseInit = false
  const roverL = Math.max(profile.dimensions.length, 0.3)
  /** Chase rig stiffness, 1/s (frame-rate independent via exp smoothing). */
  const CHASE_SMOOTH_K = 6
  const LOOK_SMOOTH_K = 10

  const update = (pose: CameraPose, opts: WorldUpdateOptions = {}): void => {
    const delta = opts.dt ?? Math.min(clock.getDelta(), 0.1)
    elapsed += delta
    caustics.update(elapsed)
    water?.update(elapsed)
    particles.update(elapsed)
    bubbles.update(elapsed)
    lightShafts.update(elapsed)
    syncObstacles()
    const adjust = opts.cameraAdjust
    smoothSpeed = smoothTowards(smoothSpeed, opts.speed ?? 0, 4, delta)
    // Micro-inertia springs: forward acceleration dips the view (~1°) and tucks
    // the camera back (~2 cm); sway acceleration banks it a hair.
    const accel = opts.accel
    const clampAbs = (v: number, abs: number): number => Math.min(abs, Math.max(-abs, v))
    fpPitchOff = smoothTowards(fpPitchOff, clampAbs(-(accel?.surge ?? 0) * 0.012, 0.025), 8, delta)
    fpLagOff = smoothTowards(fpLagOff, clampAbs((accel?.surge ?? 0) * 0.01, 0.02), 8, delta)
    fpRollOff = smoothTowards(fpRollOff, clampAbs((accel?.sway ?? 0) * 0.008, 0.015), 8, delta)
    applyZoom(adjust?.zoom ?? 1)

    // Rover model pose (same rotation convention as the camera).
    rover.group.position.set(pose.x, -pose.depth, pose.y)
    rover.group.rotation.set(0, 0, 0)
    rover.group.rotateY(-Math.PI / 2 - pose.heading)
    rover.group.rotateX(pose.pitch)
    rover.group.rotateZ(pose.roll)
    rover.setClawClosure(opts.gripper ?? 0)
    rover.spinProps((2 + (opts.speed ?? 0) * 18) * delta * 6)
    propWash.update(delta, opts.thrusterOutputs ?? [])

    // World velocity from pose deltas, for the near-camera speed motes.
    if (Number.isFinite(lastPos.x) && delta > 1e-4) {
      velWorld.set((pose.x - lastPos.x) / delta, (-pose.depth - lastPos.y) / delta, (pose.y - lastPos.z) / delta)
      if (velWorld.lengthSq() > 16) velWorld.setScalar(0) // teleport (env switch) — ignore
    }
    lastPos.set(pose.x, -pose.depth, pose.y)
    camera.getWorldPosition(camWorld)
    nearMotes.update(delta, camWorld, velWorld)

    // The rover (and its mounted camera) are always part of the scene now.
    rover.group.visible = true
    const chase = opts.cameraMode === 'chase'
    if (chase) {
      // Third-person orbit: trail behind/above the rover; drag orbits, wheel
      // zooms. Springs use exp smoothing so the rig's stiffness is identical
      // at any frame rate, and speed pulls the camera back slightly.
      if (camera.parent !== scene) scene.add(camera)
      const speedPull = 1 + 0.12 * Math.min(smoothSpeed, 1.2)
      const dist = (Math.max(1.6, roverL * 3.2) * speedPull) / Math.max(0.4, adjust?.zoom ?? 1)
      const az = pose.heading + Math.PI + (adjust?.yaw ?? 0) // behind the rover by default
      const el = Math.min(1.2, Math.max(-0.25, 0.42 + (adjust?.pitch ?? 0)))
      const horiz = Math.cos(el) * dist
      const desired = new THREE.Vector3(
        pose.x + Math.cos(az) * horiz,
        Math.min(-0.12, Math.max(-D + 0.25, -pose.depth + Math.sin(el) * dist)),
        pose.y + Math.sin(az) * horiz
      )
      desired.x = Math.min(L - 0.3, Math.max(0.3, desired.x))
      desired.z = Math.min(W - 0.3, Math.max(0.3, desired.z))
      const lookTarget = new THREE.Vector3(pose.x, -pose.depth, pose.y)
      if (!chaseInit) {
        chasePos.copy(desired)
        lookPos.copy(lookTarget)
        chaseInit = true
      } else {
        chasePos.lerp(desired, 1 - Math.exp(-CHASE_SMOOTH_K * delta))
        lookPos.lerp(lookTarget, 1 - Math.exp(-LOOK_SMOOTH_K * delta))
      }
      camera.position.copy(chasePos)
      camera.lookAt(lookPos)
    } else {
      // First-person: the camera rides on the rover as a rigid body, so it
      // inherits the vehicle's heading/pitch/roll automatically. The look
      // offset lets the operator glance around without moving the vehicle.
      chaseInit = false
      mountCameraFp(adjust)
    }

    // Fog thickens slightly with depth for ambience.
    if (scene.fog instanceof THREE.FogExp2) {
      scene.fog.density = 0.055 + 0.02 * (pose.depth / Math.max(env.pool.depth, 1))
    }
    if (scene.background instanceof THREE.Color) {
      scene.background.lerpColors(
        new THREE.Color(WATER_COLOR),
        new THREE.Color(WATER_COLOR_DEEP),
        pose.depth / Math.max(env.pool.depth, 1)
      )
    }

    // Tether rope: sag from slack, color from tautness, routed via the ice hole
    // and bent around any obstacles it has snagged on (from the sim's path).
    tether.visible = env.tether.enabled
    if (tether.visible) {
      const path = opts.tetherPath
        ? opts.tetherPath.map(([x, y, depth]) => ({ x, y, depth }))
        : tetherWorldPath({ x: pose.x, y: pose.y, depth: pose.depth }, env)
      let deployed = 0
      const samples: THREE.Vector3[] = []
      for (let i = 1; i < path.length; i++) {
        const a = new THREE.Vector3(path[i - 1].x, -path[i - 1].depth, path[i - 1].y)
        const b = new THREE.Vector3(path[i].x, -path[i].depth, path[i].y)
        deployed += a.distanceTo(b)
        const slackRatio = Math.max(0, 1 - deployed / Math.max(env.tether.length, 0.1))
        const mid = a.clone().lerp(b, 0.5)
        mid.y -= a.distanceTo(b) * (0.03 + 0.4 * slackRatio)
        const seg = new THREE.QuadraticBezierCurve3(a, mid, b).getPoints(14)
        samples.push(...(i > 1 ? seg.slice(1) : seg))
      }
      const tautness = Math.min(1, deployed / Math.max(env.tether.length, 0.1))
      tetherMaterial.color.lerpColors(TETHER_SLACK, TETHER_TAUT, Math.max(0, (tautness - 0.7) / 0.3))
      tether.geometry.dispose()
      tether.geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(samples), samples.length, 0.018, 6, false)
    }
  }

  const dispose = (): void => {
    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if (mesh.geometry) mesh.geometry.dispose()
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined
      if (Array.isArray(material)) material.forEach((m) => m.dispose())
      else if (material) material.dispose()
    })
  }

  return { scene, camera, update, dispose }
}

// Default camera direction sanity reference: heading 0 should look toward +X.
export const HEADING_ZERO_LOOKS_TOWARD = new THREE.Vector3(1, 0, 0)
