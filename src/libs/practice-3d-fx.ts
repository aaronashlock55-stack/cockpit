import * as THREE from 'three'

/**
 * Visual-effects helpers for the practice trainer's underwater world: animated
 * water surface, floor caustics, drifting particulate, and the procedural
 * pool-tile materials. Everything is canvas/procedural — no asset files — and
 * each builder returns its object plus a per-frame `update(t)` hook.
 */

/** A built effect: the object to add plus its per-frame animator. */
export interface AnimatedEffect {
  /** The scene object. */
  object: THREE.Object3D
  /** Advance the effect to time t (seconds). */
  update: (t: number) => void
}

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

/**
 * Tiled pool material (floor/walls).
 * @param {number} color Base material color.
 * @param {number} length Surface length in meters (sets tile repeat).
 * @param {number} height Surface height in meters (sets tile repeat).
 * @returns {THREE.MeshStandardMaterial} The material.
 */
export const tiledMaterial = (color: number, length: number, height: number): THREE.MeshStandardMaterial => {
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0 })
  const texture = makeTileTexture('#9fc3d4', '#7da9bd')
  if (texture) {
    texture.repeat.set(Math.max(1, Math.round(length / 2)), Math.max(1, Math.round(height / 2)))
    material.map = texture
  }
  return material
}

/**
 * Soft cellular caustic texture (random blurred arcs; mirrored tiling hides seams).
 * @returns {THREE.Texture | null} The texture, or null outside a browser.
 */
const makeCausticTexture = (): THREE.Texture | null => {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)'
  ctx.shadowColor = 'rgba(255, 255, 255, 0.5)'
  ctx.shadowBlur = 4
  for (let i = 0; i < 70; i++) {
    ctx.lineWidth = 1.5 + ((i * 37) % 10) / 3
    const x = (i * 97) % 256
    const y = (i * 151) % 256
    const r = 8 + ((i * 29) % 26)
    const a0 = ((i * 53) % 360) * (Math.PI / 180)
    ctx.beginPath()
    ctx.arc(x, y, r, a0, a0 + 2 + ((i * 13) % 30) / 10)
    ctx.stroke()
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.MirroredRepeatWrapping
  texture.wrapT = THREE.MirroredRepeatWrapping
  return texture
}

/**
 * Two drifting additive caustic layers just above the pool floor.
 * @param {number} L Pool length, m.
 * @param {number} W Pool width, m.
 * @param {number} D Pool depth, m.
 * @returns {AnimatedEffect} Group + animator.
 */
export const buildCaustics = (L: number, W: number, D: number): AnimatedEffect => {
  const group = new THREE.Group()
  group.name = 'caustics'
  const layers: THREE.Texture[] = []
  for (const [i, opacity] of [0.16, 0.1].entries()) {
    const texture = makeCausticTexture()
    const material = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    if (texture) {
      texture.repeat.set(Math.max(2, L / 3), Math.max(2, W / 3))
      material.map = texture
      layers.push(texture)
    }
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(L, W), material)
    plane.rotation.x = -Math.PI / 2
    plane.position.set(L / 2, -D + 0.015 + i * 0.012, W / 2)
    group.add(plane)
  }
  const update = (t: number): void => {
    if (layers[0]) layers[0].offset.set(t * 0.012, t * 0.017)
    if (layers[1]) layers[1].offset.set(-t * 0.015, t * 0.01)
  }
  return { object: group, update }
}

/**
 * Animated water surface seen from below: a segmented plane with two crossing
 * sine waves displacing it each frame.
 * @param {number} L Pool length, m.
 * @param {number} W Pool width, m.
 * @returns {AnimatedEffect} Mesh + animator.
 */
export const buildAnimatedWater = (L: number, W: number): AnimatedEffect => {
  const sx = Math.min(80, Math.max(16, Math.round(L * 1.5)))
  const sy = Math.min(80, Math.max(16, Math.round(W * 1.5)))
  const geometry = new THREE.PlaneGeometry(L, W, sx, sy)
  geometry.rotateX(Math.PI / 2) // lie flat; vertices now in XZ, displace along Y
  const material = new THREE.MeshPhongMaterial({
    color: 0xa9d9ee,
    specular: 0xcfe9ff,
    shininess: 90,
    transparent: true,
    opacity: 0.5,
    side: THREE.DoubleSide,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'water-surface'
  mesh.position.set(L / 2, 0, W / 2)
  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  const update = (t: number): void => {
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i)
      const z = position.getZ(i)
      position.setY(i, 0.045 * Math.sin(0.7 * x + 1.3 * t) + 0.035 * Math.sin(0.9 * z + 0.9 * t + 0.4 * x))
    }
    position.needsUpdate = true
    geometry.computeVertexNormals()
  }
  return { object: mesh, update }
}

/**
 * Suspended particulate that drifts gently, for motion/depth perception.
 * @param {number} L Pool length, m.
 * @param {number} W Pool width, m.
 * @param {number} D Pool depth, m.
 * @returns {AnimatedEffect} Points + animator.
 */
export const buildDriftingParticles = (L: number, W: number, D: number): AnimatedEffect => {
  const count = 500
  const base = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    base[i * 3] = Math.random() * L
    base[i * 3 + 1] = -Math.random() * D
    base[i * 3 + 2] = Math.random() * W
  }
  const positions = new Float32Array(base)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const points = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({ color: 0xbcd9e8, size: 0.02, transparent: true, opacity: 0.5 })
  )
  points.name = 'particles'
  const attr = geometry.getAttribute('position') as THREE.BufferAttribute
  const update = (t: number): void => {
    for (let i = 0; i < count; i++) {
      attr.setX(i, base[i * 3] + 0.12 * Math.sin(0.25 * t + i))
      attr.setY(i, base[i * 3 + 1] + 0.05 * Math.sin(0.4 * t + i * 1.7))
    }
    attr.needsUpdate = true
  }
  return { object: points, update }
}
