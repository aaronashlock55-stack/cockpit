import * as THREE from 'three'

import { tetherWorldPath } from '@/libs/rover-simulator'
import { type PracticeEnvironment } from '@/types/practice-environment'
import { type RoverProfile } from '@/types/rover-profile'

/**
 * Builds the first-person 3D underwater world for Practice mode (the
 * "flight simulator" view): pool walls/floor with tile lines, water surface,
 * optional ice sheet with its launch hole, obstacles/mission props, the tether,
 * and suspended particles for depth perception. Pure three.js object-graph
 * construction — no renderer — so the structure is unit-testable in node.
 *
 * Coordinate mapping (pool-local -> three.js):
 *   pool x (along length)  -> three +X
 *   pool y (across width)  -> three +Z
 *   pool depth (down)      -> three -Y   (water surface at Y=0)
 */

/** Handle to the built world, used by the widget each frame. */
export interface PracticeWorld {
  /** The scene to render. */
  scene: THREE.Scene
  /** First-person camera (ROV's forward camera). */
  camera: THREE.PerspectiveCamera
  /** Per-frame updater: camera pose, claw closure (0..1), and obstacle sync. */
  update: (pose: CameraPose, gripperClosure?: number) => void
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

/**
 * Procedural pool-tile texture (canvas-based, no assets needed).
 * @param {string} base Base CSS color of the tiles.
 * @param {string} line Grout line CSS color.
 * @returns {THREE.Texture | null} The tile texture, or null outside a browser (tests).
 */
const makeTileTexture = (base: string, line: string): THREE.Texture | null => {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = base
  ctx.fillRect(0, 0, 256, 256)
  ctx.strokeStyle = line
  ctx.lineWidth = 4
  for (let i = 0; i <= 256; i += 64) {
    ctx.beginPath()
    ctx.moveTo(i, 0)
    ctx.lineTo(i, 256)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(0, i)
    ctx.lineTo(256, i)
    ctx.stroke()
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  return texture
}

const tiledMaterial = (color: number, length: number, height: number): THREE.MeshLambertMaterial => {
  const material = new THREE.MeshLambertMaterial({ color })
  const texture = makeTileTexture('#9fc3d4', '#7da9bd')
  if (texture) {
    texture.repeat.set(Math.max(1, Math.round(length / 2)), Math.max(1, Math.round(height / 2)))
    material.map = texture
  }
  return material
}

/**
 * Build the practice world for an environment.
 * @param {PracticeEnvironment} env The practice environment to model.
 * @param {RoverProfile} profile Optional rover profile (scales the visible frame).
 * @returns {PracticeWorld} Scene, camera, per-frame updater, and disposer.
 */
export const buildPracticeWorld = (env: PracticeEnvironment, profile?: RoverProfile): PracticeWorld => {
  const scene = new THREE.Scene()
  const { length: L, width: W, depth: D } = env.pool

  // Underwater atmosphere: dense exponential fog + matching background.
  scene.background = new THREE.Color(WATER_COLOR)
  scene.fog = new THREE.FogExp2(WATER_COLOR, 0.075)

  const sun = new THREE.DirectionalLight(0xcfe8ff, 2.2)
  sun.position.set(L / 2, 10, W / 2)
  scene.add(sun)
  scene.add(new THREE.AmbientLight(0x9fc8e0, 1.1))

  // Floor.
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(L, W), tiledMaterial(0xffffff, L, W))
  floor.name = 'floor'
  floor.rotation.x = -Math.PI / 2
  floor.position.set(L / 2, -D, W / 2)
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
    scene.add(wall)
  }

  // Water surface seen from below (skip where an ice sheet covers it) or ice sheet with launch hole.
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
      new THREE.MeshLambertMaterial({ color: 0xe6f3fb, transparent: true, opacity: 0.92, side: THREE.DoubleSide })
    )
    ice.name = 'ice-sheet'
    // ShapeGeometry is built in XY; rotate flat and place at the surface.
    ice.rotation.x = Math.PI / 2
    ice.position.y = 0
    scene.add(ice)
  } else {
    const surface = new THREE.Mesh(
      new THREE.PlaneGeometry(L, W),
      new THREE.MeshLambertMaterial({ color: 0xbfe6f5, transparent: true, opacity: 0.45, side: THREE.DoubleSide })
    )
    surface.name = 'water-surface'
    surface.rotation.x = Math.PI / 2
    surface.position.set(L / 2, 0, W / 2)
    scene.add(surface)
  }

  // Obstacles / mission props. Meshes are tracked so positions re-sync every
  // frame (a grabbed prop follows the claw; the sim mutates env positions).
  const obstacleMeshes = new Map<string, THREE.Mesh>()
  for (const obstacle of env.obstacles) {
    const height = obstacle.size[2]
    const color = new THREE.Color(obstacle.color ?? '#ffd24a')
    const material = new THREE.MeshLambertMaterial({ color })
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

  // Tether: a sagging curve from the attach point to the rover, routed through
  // the ice launch hole when there is one. Always built; visibility follows the
  // live env.tether.enabled flag so the Settings toggle works without a rebuild.
  const tetherGeometry = new THREE.BufferGeometry()
  tetherGeometry.setFromPoints([new THREE.Vector3(), new THREE.Vector3()])
  const tether = new THREE.Line(tetherGeometry, new THREE.LineBasicMaterial({ color: 0xffe066 }))
  tether.name = 'tether'
  tether.frustumCulled = false
  scene.add(tether)

  // Suspended particles for motion/depth perception.
  const particleCount = 400
  const positions = new Float32Array(particleCount * 3)
  for (let i = 0; i < particleCount; i++) {
    positions[i * 3] = Math.random() * L
    positions[i * 3 + 1] = -Math.random() * D
    positions[i * 3 + 2] = Math.random() * W
  }
  const particleGeometry = new THREE.BufferGeometry()
  particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const particles = new THREE.Points(
    particleGeometry,
    new THREE.PointsMaterial({ color: 0xbcd9e8, size: 0.02, transparent: true, opacity: 0.55 })
  )
  particles.name = 'particles'
  scene.add(particles)

  // First-person camera: wide angle like a typical ROV camera. The camera is
  // added to the scene so vehicle-fixed children (frame, claw) render with it.
  const camera = new THREE.PerspectiveCamera(80, 16 / 9, 0.02, 250)
  scene.add(camera)

  // Vehicle frame visible at the edges of view — real ROV cameras sit inside
  // the frame, so the operator always sees a bit of their own vehicle.
  const frameMaterial = new THREE.MeshLambertMaterial({ color: 0x12181c })
  const accentMaterial = new THREE.MeshLambertMaterial({ color: 0x1b6f9e })
  const frameGroup = new THREE.Group()
  frameGroup.name = 'vehicle-frame'
  // Top frame bar across the upper edge.
  const topBar = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.025, 0.05), frameMaterial)
  topBar.position.set(0, 0.165, -0.3)
  frameGroup.add(topBar)
  // Side rails in the lower corners (the classic BlueROV2 side plates).
  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.16, 0.22), accentMaterial)
    rail.position.set(side * 0.225, -0.1, -0.28)
    rail.rotation.z = side * -0.12
    frameGroup.add(rail)
  }
  // Two small light pods top corners.
  for (const side of [-1, 1]) {
    const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.05, 12), frameMaterial)
    pod.rotation.x = Math.PI / 2
    pod.position.set(side * 0.19, 0.145, -0.29)
    frameGroup.add(pod)
  }
  camera.add(frameGroup)

  // Claw (Newton-gripper style): two jaws at the bottom-center of view that
  // rotate together as the claw closes.
  const jawMaterial = new THREE.MeshLambertMaterial({ color: 0x202a30 })
  const clawGroup = new THREE.Group()
  clawGroup.name = 'claw'
  clawGroup.position.set(0, -0.16, -0.3)
  const jawPivots: THREE.Group[] = []
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group()
    pivot.position.x = side * 0.035
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.03, 0.16), jawMaterial)
    jaw.position.set(0, 0, -0.08) // extend forward from the pivot
    pivot.add(jaw)
    // Jaw tip teeth.
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.026, 0.03), jawMaterial)
    tip.position.set(side * -0.012, 0, -0.155)
    tip.rotation.y = side * -0.35
    pivot.add(tip)
    clawGroup.add(pivot)
    jawPivots.push(pivot)
  }
  // Claw wrist/base.
  const wrist = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.06, 12), frameMaterial)
  wrist.rotation.x = Math.PI / 2
  wrist.position.z = 0.04
  clawGroup.add(wrist)
  camera.add(clawGroup)

  const setClawClosure = (closure: number): void => {
    // Open = jaws splayed outward (~30 deg); closed = parallel.
    const angle = (1 - closure) * 0.5
    jawPivots[0].rotation.y = -angle
    jawPivots[1].rotation.y = angle
  }
  setClawClosure(0)

  // Visible frame/claw scale with the active rover's real width.
  const frameScale = profile ? Math.min(2, Math.max(0.7, profile.dimensions.width / 0.338)) : 1
  frameGroup.scale.setScalar(frameScale)
  clawGroup.scale.setScalar(frameScale)

  const update = (pose: CameraPose, gripperClosure = 0): void => {
    setClawClosure(gripperClosure)
    syncObstacles()
    camera.position.set(pose.x, -pose.depth, pose.y)
    // Three.js cameras look down -Z; a -90° base yaw makes heading 0 look toward
    // pool +x, and heading increases clockwise (toward pool +y / three +Z).
    camera.rotation.set(0, 0, 0)
    camera.rotateY(-Math.PI / 2 - pose.heading)
    camera.rotateX(pose.pitch)
    camera.rotateZ(pose.roll)

    // Fog thickens slightly with depth for ambience.
    if (scene.fog instanceof THREE.FogExp2) {
      scene.fog.density = 0.06 + 0.02 * (pose.depth / Math.max(env.pool.depth, 1))
    }
    if (scene.background instanceof THREE.Color) {
      scene.background.lerpColors(
        new THREE.Color(WATER_COLOR),
        new THREE.Color(WATER_COLOR_DEEP),
        pose.depth / Math.max(env.pool.depth, 1)
      )
    }

    // Tether: follows the live toggle; sagging segments along the real path
    // (attach → ice hole → rover when an ice sheet is present).
    tether.visible = env.tether.enabled
    if (tether.visible) {
      const path = tetherWorldPath({ x: pose.x, y: pose.y, depth: pose.depth }, env)
      const points: THREE.Vector3[] = []
      for (let i = 1; i < path.length; i++) {
        const a = new THREE.Vector3(path[i - 1].x, -path[i - 1].depth, path[i - 1].y)
        const b = new THREE.Vector3(path[i].x, -path[i].depth, path[i].y)
        const mid = a.clone().lerp(b, 0.5)
        mid.y -= 0.075 * a.distanceTo(b) // simple catenary-ish sag
        points.push(...new THREE.QuadraticBezierCurve3(a, mid, b).getPoints(16))
      }
      tether.geometry.setFromPoints(points)
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
