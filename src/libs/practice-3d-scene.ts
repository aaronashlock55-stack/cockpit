import * as THREE from 'three'

import { buildAnimatedWater, buildCaustics, buildDriftingParticles, tiledMaterial } from '@/libs/practice-3d-fx'
import { buildRoverModel } from '@/libs/practice-3d-rover'
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

/** Per-frame update options. */
export interface WorldUpdateOptions {
  /** Claw closure 0..1. */
  gripper?: number
  /** Camera mode: first-person ROV camera or third-person chase view. */
  cameraMode?: 'fp' | 'chase'
  /** Vehicle speed (m/s) — drives propeller spin. */
  speed?: number
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

  // Underwater atmosphere: dense exponential fog + matching background.
  scene.background = new THREE.Color(WATER_COLOR)
  scene.fog = new THREE.FogExp2(WATER_COLOR, 0.07)

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
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(L, W), tiledMaterial(0xffffff, L, W))
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
      tiledMaterial(0xe8f4f8, spec.size[0], spec.size[1])
    )
    wall.name = spec.name
    wall.position.set(...spec.pos)
    wall.rotation.y = spec.rotY
    wall.receiveShadow = true
    scene.add(wall)
  }

  // Caustic shimmer above the floor.
  const caustics = buildCaustics(L, W, D)
  scene.add(caustics.object)

  // Ice sheet with launch hole, or animated water surface seen from below.
  let water: ReturnType<typeof buildAnimatedWater> | undefined
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
    water = buildAnimatedWater(L, W)
    scene.add(water.object)
  }

  // Obstacles / mission props. Meshes are tracked so positions re-sync every
  // frame (a grabbed prop follows the claw; the sim mutates env positions).
  const obstacleMeshes = new Map<string, THREE.Mesh>()
  for (const obstacle of env.obstacles) {
    const height = obstacle.size[2]
    const color = new THREE.Color(obstacle.color ?? '#ffd24a')
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.05 })
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
      mesh.position.set(obstacle.position[0], -(obstacle.position[2] + obstacle.size[2] / 2), obstacle.position[1])
    }
  }
  syncObstacles()

  // Drifting particulate.
  const particles = buildDriftingParticles(L, W, D)
  scene.add(particles.object)

  // The full rover model (visible in chase view), built from the profile.
  const rover = buildRoverModel(profile)
  rover.group.visible = false
  scene.add(rover.group)

  // Tether: a real rope (tube) that sags in proportion to slack, straightens
  // and turns red as it runs out, and routes through the ice launch hole.
  // Always built; visibility follows env.tether.enabled live (no rebuild).
  const tetherMaterial = new THREE.MeshBasicMaterial({ color: TETHER_SLACK.clone() })
  const tether = new THREE.Mesh(new THREE.BufferGeometry(), tetherMaterial)
  tether.name = 'tether'
  tether.frustumCulled = false
  scene.add(tether)

  // First-person camera: wide angle like a typical ROV camera. The camera is
  // added to the scene so vehicle-fixed children (frame, claw) render with it.
  const camera = new THREE.PerspectiveCamera(80, 16 / 9, 0.02, 250)
  scene.add(camera)

  // Vehicle frame visible at the edges of view — real ROV cameras sit inside
  // the frame, so the operator always sees a bit of their own vehicle.
  const frameMaterial = new THREE.MeshStandardMaterial({ color: 0x12181c, roughness: 0.8 })
  const accentMaterial = new THREE.MeshStandardMaterial({ color: 0x1b6f9e, roughness: 0.7 })
  const frameGroup = new THREE.Group()
  frameGroup.name = 'vehicle-frame'
  const topBar = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.025, 0.05), frameMaterial)
  topBar.position.set(0, 0.165, -0.3)
  frameGroup.add(topBar)
  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.16, 0.22), accentMaterial)
    rail.position.set(side * 0.225, -0.1, -0.28)
    rail.rotation.z = side * -0.12
    frameGroup.add(rail)
  }
  for (const side of [-1, 1]) {
    const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.05, 12), frameMaterial)
    pod.rotation.x = Math.PI / 2
    pod.position.set(side * 0.19, 0.145, -0.29)
    frameGroup.add(pod)
  }
  camera.add(frameGroup)

  // First-person claw: two jaws at the bottom-center of view.
  const clawGroup = new THREE.Group()
  clawGroup.name = 'claw'
  clawGroup.position.set(0, -0.16, -0.3)
  const jawPivots: THREE.Group[] = []
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group()
    pivot.position.x = side * 0.035
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.03, 0.16), frameMaterial)
    jaw.position.set(0, 0, -0.08)
    pivot.add(jaw)
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.026, 0.03), frameMaterial)
    tip.position.set(side * -0.012, 0, -0.155)
    tip.rotation.y = side * -0.35
    pivot.add(tip)
    clawGroup.add(pivot)
    jawPivots.push(pivot)
  }
  const wrist = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.06, 12), frameMaterial)
  wrist.rotation.x = Math.PI / 2
  wrist.position.z = 0.04
  clawGroup.add(wrist)
  camera.add(clawGroup)

  const setFpClawClosure = (closure: number): void => {
    const angle = (1 - closure) * 0.5
    jawPivots[0].rotation.y = -angle
    jawPivots[1].rotation.y = angle
  }
  setFpClawClosure(0)

  // Visible FP frame/claw scale with the active rover's real width.
  const frameScale = Math.min(2, Math.max(0.7, profile.dimensions.width / 0.338))
  frameGroup.scale.setScalar(frameScale)
  clawGroup.scale.setScalar(frameScale)

  const clock = new THREE.Clock()
  let elapsed = 0
  const chasePos = new THREE.Vector3()
  let chaseInit = false
  const roverL = Math.max(profile.dimensions.length, 0.3)

  const update = (pose: CameraPose, opts: WorldUpdateOptions = {}): void => {
    const delta = Math.min(clock.getDelta(), 0.1)
    elapsed += delta
    caustics.update(elapsed)
    water?.update(elapsed)
    particles.update(elapsed)
    syncObstacles()

    // Rover model pose (same rotation convention as the camera).
    rover.group.position.set(pose.x, -pose.depth, pose.y)
    rover.group.rotation.set(0, 0, 0)
    rover.group.rotateY(-Math.PI / 2 - pose.heading)
    rover.group.rotateX(pose.pitch)
    rover.group.rotateZ(pose.roll)
    rover.setClawClosure(opts.gripper ?? 0)
    rover.spinProps((2 + (opts.speed ?? 0) * 18) * delta * 6)
    setFpClawClosure(opts.gripper ?? 0)

    const chase = opts.cameraMode === 'chase'
    rover.group.visible = chase
    frameGroup.visible = !chase
    clawGroup.visible = !chase
    if (chase) {
      // Third-person: trail behind and above the rover, smoothed.
      const dist = Math.max(1.6, roverL * 3.2)
      const desired = new THREE.Vector3(
        pose.x - Math.cos(pose.heading) * dist,
        Math.min(-0.12, Math.max(-D + 0.25, -pose.depth + dist * 0.42)),
        pose.y - Math.sin(pose.heading) * dist
      )
      desired.x = Math.min(L - 0.3, Math.max(0.3, desired.x))
      desired.z = Math.min(W - 0.3, Math.max(0.3, desired.z))
      if (!chaseInit) {
        chasePos.copy(desired)
        chaseInit = true
      } else {
        chasePos.lerp(desired, 0.1)
      }
      camera.position.copy(chasePos)
      camera.lookAt(pose.x, -pose.depth, pose.y)
    } else {
      chaseInit = false
      camera.position.set(pose.x, -pose.depth, pose.y)
      // Three.js cameras look down -Z; a -90° base yaw makes heading 0 look toward
      // pool +x, and heading increases clockwise (toward pool +y / three +Z).
      camera.rotation.set(0, 0, 0)
      camera.rotateY(-Math.PI / 2 - pose.heading)
      camera.rotateX(pose.pitch)
      camera.rotateZ(pose.roll)
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

    // Tether rope: sag from slack, color from tautness, routed via the ice hole.
    tether.visible = env.tether.enabled
    if (tether.visible) {
      const path = tetherWorldPath({ x: pose.x, y: pose.y, depth: pose.depth }, env)
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
