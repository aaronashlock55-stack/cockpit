import * as THREE from 'three'

import { type RoverProfile } from '@/types/rover-profile'

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

/** A speed-reactive effect fed the camera/vehicle state each frame. */
export interface MotionEffect {
  /** The scene object. */
  object: THREE.Object3D
  /** Advance by dt with the camera world position and vehicle world velocity. */
  update: (dt: number, camPos: THREE.Vector3, velWorld: THREE.Vector3) => void
}

/**
 * Near-camera particulate: a dense cloud of fine motes in a small box that
 * follows the camera, streaming opposite the vehicle's velocity — the
 * strongest "I am moving this fast" cue underwater. Nearly invisible parked.
 * @param {number} count Number of motes.
 * @returns {MotionEffect} Points + animator.
 */
export const buildNearFieldMotes = (count = 250): MotionEffect => {
  const BOX = new THREE.Vector3(4, 3, 4)
  const positions = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * BOX.x
    positions[i * 3 + 1] = (Math.random() - 0.5) * BOX.y
    positions[i * 3 + 2] = (Math.random() - 0.5) * BOX.z
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const material = new THREE.PointsMaterial({
    color: 0xd6ecf7,
    size: 0.016,
    transparent: true,
    opacity: 0.12,
    depthWrite: false,
  })
  const points = new THREE.Points(geometry, material)
  points.name = 'near-motes'
  points.frustumCulled = false
  const attr = geometry.getAttribute('position') as THREE.BufferAttribute
  const wrap = (v: number, half: number): number => ((((v + half) % (2 * half)) + 2 * half) % (2 * half)) - half
  const update = (dt: number, camPos: THREE.Vector3, velWorld: THREE.Vector3): void => {
    const speed = velWorld.length()
    material.opacity = 0.12 + 0.38 * Math.min(1, speed / 0.8)
    for (let i = 0; i < count; i++) {
      // Motes are world-anchored but wrapped into the camera's box, so flying
      // through them streams them past the lens.
      attr.setX(i, camPos.x + wrap(attr.getX(i) - velWorld.x * dt - camPos.x, BOX.x / 2))
      attr.setY(i, camPos.y + wrap(attr.getY(i) - velWorld.y * dt - camPos.y, BOX.y / 2))
      attr.setZ(i, camPos.z + wrap(attr.getZ(i) - velWorld.z * dt - camPos.z, BOX.z / 2))
    }
    attr.needsUpdate = true
  }
  return { object: points, update }
}

/** Prop wash handle: rover-local bubble bursts behind each thruster. */
export interface PropWashEffect {
  /** Group to add as a CHILD of the rover model group (rover-local frame). */
  object: THREE.Group
  /** Advance by dt with the spooled per-thruster outputs [-1, 1]. */
  update: (dt: number, outputs: number[]) => void
}

/**
 * Prop-wash bubbles behind each thruster, emission scaling with |output| —
 * visible thrust feedback (you SEE the motors working against the water).
 * Thruster positions/orientations come from the profile, same mapping as the
 * rover model (local frame: nose -Z, up +Y, right +X).
 * @param {RoverProfile} profile The rover profile.
 * @returns {PropWashEffect} Group + animator.
 */
export const buildPropWash = (profile: RoverProfile): PropWashEffect => {
  const PER = 22
  const LIFE = 0.6
  const group = new THREE.Group()
  group.name = 'prop-wash'
  /* eslint-disable jsdoc/require-jsdoc */
  const jets: {
    attr: THREE.BufferAttribute
    material: THREE.PointsMaterial
    origin: THREE.Vector3
    dir: THREE.Vector3
    ages: Float32Array
    jitter: Float32Array
  }[] = []
  /* eslint-enable jsdoc/require-jsdoc */
  for (const t of profile.thrusters) {
    const [px, py, pz] = t.position ?? [0, 0, 0]
    const origin = new THREE.Vector3(py, -pz, -px)
    const vertical =
      Math.abs(t.contribution.heave) >= Math.max(Math.abs(t.contribution.surge), Math.abs(t.contribution.sway), 0.01)
    const dir = vertical ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(t.contribution.sway, 0, -t.contribution.surge)
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1)
    dir.normalize()
    const positions = new Float32Array(PER * 3)
    const ages = new Float32Array(PER)
    const jitter = new Float32Array(PER * 3)
    for (let i = 0; i < PER; i++) {
      ages[i] = LIFE + 1 // start dead
      jitter[i * 3] = (Math.random() - 0.5) * 0.5
      jitter[i * 3 + 1] = (Math.random() - 0.5) * 0.5
      jitter[i * 3 + 2] = (Math.random() - 0.5) * 0.5
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const material = new THREE.PointsMaterial({
      color: 0xeaf7ff,
      size: 0.012,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    })
    const points = new THREE.Points(geometry, material)
    points.frustumCulled = false
    group.add(points)
    jets.push({ attr: geometry.getAttribute('position') as THREE.BufferAttribute, material, origin, dir, ages, jitter })
  }
  let spawnCursor = 0
  const update = (dt: number, outputs: number[]): void => {
    jets.forEach((jet, j) => {
      const output = outputs[j] ?? 0
      const power = Math.abs(output)
      jet.material.opacity = Math.min(0.45, power * 0.55)
      const washDir = jet.dir.clone().multiplyScalar(-Math.sign(output || 1))
      for (let i = 0; i < PER; i++) {
        jet.ages[i] += dt
        const emitting = power > 0.12
        if (jet.ages[i] > LIFE && emitting && (spawnCursor = (spawnCursor + 1) % 3) === 0) {
          jet.ages[i] = 0
          jet.attr.setXYZ(
            i,
            jet.origin.x + jet.jitter[i * 3] * 0.02,
            jet.origin.y + jet.jitter[i * 3 + 1] * 0.02,
            jet.origin.z + jet.jitter[i * 3 + 2] * 0.02
          )
        } else if (jet.ages[i] <= LIFE) {
          const speed = 0.5 + power * 0.6
          jet.attr.setXYZ(
            i,
            jet.attr.getX(i) + (washDir.x + jet.jitter[i * 3] * 0.3) * speed * dt,
            jet.attr.getY(i) + (washDir.y + jet.jitter[i * 3 + 1] * 0.3) * speed * dt,
            jet.attr.getZ(i) + (washDir.z + jet.jitter[i * 3 + 2] * 0.3) * speed * dt
          )
        }
      }
      jet.attr.needsUpdate = true
    })
  }
  return { object: group, update }
}
