import * as THREE from 'three'

/**
 * Visual-effects helpers for the practice trainer's underwater world: drifting
 * particulate, light shafts, and bubbles. (The water surface and floor
 * caustics are GLSL shaders — see practice-3d-shaders.ts; pool tiles and prop
 * dressing live in practice-3d-textures.ts.) Everything is canvas/procedural —
 * no asset files — and each builder returns its object plus a per-frame
 * `update(t)` hook.
 */

/** A built effect: the object to add plus its per-frame animator. */
export interface AnimatedEffect {
  /** The scene object. */
  object: THREE.Object3D
  /** Advance the effect to time t (seconds). */
  update: (t: number) => void
}

/**
 * Suspended particulate that drifts gently and streams along any water current,
 * for motion/depth perception and to make a flow's direction visible.
 * @param {number} L Pool length, m.
 * @param {number} W Pool width, m.
 * @param {number} D Pool depth, m.
 * @param {[number, number]} drift Representative current [vx, vy] in m/s.
 * @returns {AnimatedEffect} Points + animator.
 */
export const buildDriftingParticles = (
  L: number,
  W: number,
  D: number,
  drift: [number, number] = [0, 0]
): AnimatedEffect => {
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
  const wrap = (v: number, max: number): number => ((v % max) + max) % max
  const update = (t: number): void => {
    for (let i = 0; i < count; i++) {
      attr.setX(i, wrap(base[i * 3] + drift[0] * t + 0.12 * Math.sin(0.25 * t + i), L))
      attr.setY(i, base[i * 3 + 1] + 0.05 * Math.sin(0.4 * t + i * 1.7))
      attr.setZ(i, wrap(base[i * 3 + 2] + drift[1] * t, W))
    }
    attr.needsUpdate = true
  }
  return { object: points, update }
}

/**
 * Volumetric-looking light shafts (god rays) slanting down from the surface.
 * @param {number} L Pool length, m.
 * @param {number} W Pool width, m.
 * @param {number} D Pool depth, m.
 * @returns {AnimatedEffect} Group + animator.
 */
export const buildLightShafts = (L: number, W: number, D: number): AnimatedEffect => {
  const group = new THREE.Group()
  group.name = 'light-shafts'
  const material = new THREE.MeshBasicMaterial({
    color: 0xdff1ff,
    transparent: true,
    opacity: 0.05,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
  const shafts: THREE.Mesh[] = []
  const count = Math.max(4, Math.round(L / 6))
  for (let i = 0; i < count; i++) {
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.5 + Math.random() * 0.8, D * 1.4), material.clone())
    plane.position.set(Math.random() * L, -D / 2, Math.random() * W)
    plane.rotation.set(0, Math.random() * Math.PI, 0.25 + Math.random() * 0.15)
    group.add(plane)
    shafts.push(plane)
  }
  const update = (t: number): void => {
    shafts.forEach((s, i) => {
      const m = s.material as THREE.MeshBasicMaterial
      m.opacity = 0.04 + 0.03 * (0.5 + 0.5 * Math.sin(t * 0.3 + i))
    })
  }
  return { object: group, update }
}

/**
 * Rising bubbles for ambience.
 * @param {number} L Pool length, m.
 * @param {number} W Pool width, m.
 * @param {number} D Pool depth, m.
 * @returns {AnimatedEffect} Points + animator.
 */
export const buildBubbles = (L: number, W: number, D: number): AnimatedEffect => {
  const count = 120
  const base = new Float32Array(count * 3)
  const speed = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    base[i * 3] = Math.random() * L
    base[i * 3 + 1] = -Math.random() * D
    base[i * 3 + 2] = Math.random() * W
    speed[i] = 0.15 + Math.random() * 0.25
  }
  const positions = new Float32Array(base)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const bubbles = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({ color: 0xeaf7ff, size: 0.035, transparent: true, opacity: 0.4 })
  )
  bubbles.name = 'bubbles'
  const attr = geometry.getAttribute('position') as THREE.BufferAttribute
  const update = (t: number): void => {
    for (let i = 0; i < count; i++) {
      const y = -D + ((base[i * 3 + 1] + D + speed[i] * t) % D)
      attr.setX(i, base[i * 3] + 0.04 * Math.sin(t + i))
      attr.setY(i, y)
    }
    attr.needsUpdate = true
  }
  return { object: bubbles, update }
}

/**
 * A vertical gradient equirectangular texture (bright surface → dark deep) used
 * as the scene environment map, so clear/metal materials pick up subtle
 * underwater reflections (cheap image-based lighting, no renderer needed).
 * @returns {THREE.Texture | null} The environment texture, or null in tests.
 */
export const gradientEnvironment = (): THREE.Texture | null => {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = 16
  canvas.height = 128
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const gradient = ctx.createLinearGradient(0, 0, 0, 128)
  gradient.addColorStop(0, '#bfe6ff')
  gradient.addColorStop(0.45, '#2f6c8c')
  gradient.addColorStop(1, '#06141d')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 16, 128)
  const texture = new THREE.CanvasTexture(canvas)
  texture.mapping = THREE.EquirectangularReflectionMapping
  return texture
}
