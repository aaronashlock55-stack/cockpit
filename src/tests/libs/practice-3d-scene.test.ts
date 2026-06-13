import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { buildPracticeWorld } from '@/libs/practice-3d-scene'
import {
  mate2026IceTankEnvironment,
  openWaterEnvironment,
  trainingCourseEnvironment,
} from '@/types/practice-environment'

describe('buildPracticeWorld', () => {
  it('builds floor, four walls, and particles for any environment', () => {
    const world = buildPracticeWorld(openWaterEnvironment)
    const names = world.scene.children.map((c) => c.name)
    expect(names).toContain('floor')
    expect(names.filter((n) => n.startsWith('wall-'))).toHaveLength(4)
    expect(names).toContain('particles')
    world.dispose()
  })

  it('dresses the pool with lane lines and a waterline band', () => {
    const world = buildPracticeWorld(openWaterEnvironment)
    expect(world.scene.getObjectByName('lane-line')).toBeDefined()
    expect(world.scene.getObjectByName('waterline-band')).toBeDefined()
    world.dispose()
  })

  it('builds an ice sheet (no water surface) for the MATE 2026 tank, and the float prop', () => {
    const world = buildPracticeWorld(mate2026IceTankEnvironment)
    const names = world.scene.children.map((c) => c.name)
    expect(names).toContain('ice-sheet')
    expect(names).not.toContain('water-surface')
    expect(names).toContain('obstacle-float-1')
    expect(names).toContain('tether')
    world.dispose()
  })

  it('builds a water surface (no ice) for open water', () => {
    const world = buildPracticeWorld(openWaterEnvironment)
    const names = world.scene.children.map((c) => c.name)
    expect(names).toContain('water-surface')
    expect(names).not.toContain('ice-sheet')
    world.dispose()
  })

  it('mounts the first-person camera on the rover near the pose, looking +x at heading 0', () => {
    const world = buildPracticeWorld(openWaterEnvironment)
    world.update({ x: 5, y: 7, depth: 2, heading: 0, pitch: 0, roll: 0 }, { cameraMode: 'fp' })
    // Camera is a child of the rover model now; its WORLD position is near the pose.
    const worldPos = world.camera.getWorldPosition(new THREE.Vector3())
    expect(worldPos.x).toBeCloseTo(5, 0) // within the rover's own length
    expect(worldPos.y).toBeCloseTo(-2, 0)
    expect(worldPos.z).toBeCloseTo(7, 0)
    const forward = new THREE.Vector3()
    world.camera.getWorldDirection(forward)
    expect(forward.x).toBeCloseTo(1, 1)
    expect(forward.z).toBeCloseTo(0, 1)
    world.dispose()
  })

  it('camera is rigidly attached to the rover (rolls and pitches with the body)', () => {
    const world = buildPracticeWorld(openWaterEnvironment)
    const rover = world.scene.children.find((c) => c.name === 'rover')!
    world.update({ x: 5, y: 5, depth: 1, heading: 0, pitch: 0, roll: 0 }, { cameraMode: 'fp' })
    expect(world.camera.parent).toBe(rover) // one rigid body
    // Pitch the vehicle nose-up; the camera's view direction tilts up with it.
    const level = world.camera.getWorldDirection(new THREE.Vector3())
    world.update({ x: 5, y: 5, depth: 1, heading: 0, pitch: 0.5, roll: 0 }, { cameraMode: 'fp' })
    const pitched = world.camera.getWorldDirection(new THREE.Vector3())
    expect(pitched.y).toBeGreaterThan(level.y + 0.2)
    world.dispose()
  })

  it('heading 90 degrees looks toward +y (three +Z)', () => {
    const world = buildPracticeWorld(openWaterEnvironment)
    world.update({ x: 0, y: 0, depth: 1, heading: Math.PI / 2, pitch: 0, roll: 0 })
    const forward = new THREE.Vector3()
    world.camera.getWorldDirection(forward)
    expect(forward.z).toBeCloseTo(1, 1)
    expect(forward.x).toBeCloseTo(0, 1)
    world.dispose()
  })

  it('shows the rover model in both views; chase detaches the camera behind it', () => {
    const world = buildPracticeWorld(openWaterEnvironment)
    const rover = world.scene.children.find((c) => c.name === 'rover')!
    expect(rover).toBeDefined()
    const pose = { x: 10, y: 10, depth: 2, heading: 0, pitch: 0, roll: 0 }
    world.update(pose, { cameraMode: 'fp' })
    expect(rover.visible).toBe(true) // you fly inside your own rover now
    expect(world.camera.parent).toBe(rover)
    world.update(pose, { cameraMode: 'chase' })
    expect(rover.visible).toBe(true)
    expect(rover.position.x).toBeCloseTo(10)
    expect(world.camera.parent).toBe(world.scene) // detached for the chase view
    expect(world.camera.getWorldPosition(new THREE.Vector3()).x).toBeLessThan(10) // trails behind (heading 0 = +x)
    world.dispose()
  })

  it('camera zoom narrows the FOV and look-offset turns the view', () => {
    const world = buildPracticeWorld(openWaterEnvironment)
    const pose = { x: 5, y: 5, depth: 1, heading: 0, pitch: 0, roll: 0 }
    world.update(pose, { cameraMode: 'fp', cameraAdjust: { yaw: 0, pitch: 0, zoom: 1 } })
    const baseFov = world.camera.fov
    const baseDir = world.camera.getWorldDirection(new THREE.Vector3())
    world.update(pose, { cameraMode: 'fp', cameraAdjust: { yaw: 0, pitch: 0, zoom: 2 } })
    expect(world.camera.fov).toBeLessThan(baseFov) // zoomed in
    world.update(pose, { cameraMode: 'fp', cameraAdjust: { yaw: 0.6, pitch: 0, zoom: 1 } })
    const turned = world.camera.getWorldDirection(new THREE.Vector3())
    expect(turned.angleTo(baseDir)).toBeGreaterThan(0.3) // looked to the side
    world.dispose()
  })

  it('FOV widens subtly with speed (sense of speed)', () => {
    const world = buildPracticeWorld(openWaterEnvironment)
    const pose = { x: 5, y: 5, depth: 1, heading: 0, pitch: 0, roll: 0 }
    world.update(pose, { cameraMode: 'fp', speed: 0, dt: 0.5 })
    const baseFov = world.camera.fov
    for (let i = 0; i < 10; i++) world.update(pose, { cameraMode: 'fp', speed: 1.2, dt: 0.5 })
    expect(world.camera.fov).toBeGreaterThan(baseFov + 3)
    expect(world.camera.fov).toBeLessThan(baseFov + 8)
    world.dispose()
  })

  it('chase camera smoothing is frame-rate independent (same dt total, same place)', () => {
    const start = { x: 5, y: 5, depth: 1, heading: 0, pitch: 0, roll: 0 }
    const moved = { ...start, x: 12 }
    const cam = (steps: number, dt: number): number => {
      const world = buildPracticeWorld(openWaterEnvironment)
      world.update(start, { cameraMode: 'chase', dt: 0.01 }) // init the rig
      for (let i = 0; i < steps; i++) world.update(moved, { cameraMode: 'chase', dt })
      const x = world.camera.position.x
      world.dispose()
      return x
    }
    expect(cam(1, 0.2)).toBeCloseTo(cam(4, 0.05), 3)
  })

  it('forward acceleration dips the first-person view (micro-inertia weight cue)', () => {
    const world = buildPracticeWorld(openWaterEnvironment)
    const pose = { x: 5, y: 5, depth: 1, heading: 0, pitch: 0, roll: 0 }
    world.update(pose, { cameraMode: 'fp', dt: 0.5 })
    const level = world.camera.getWorldDirection(new THREE.Vector3())
    for (let i = 0; i < 10; i++) {
      world.update(pose, { cameraMode: 'fp', dt: 0.5, accel: { surge: 3, sway: 0, heave: 0 } })
    }
    const dipped = world.camera.getWorldDirection(new THREE.Vector3())
    expect(dipped.y).toBeLessThan(level.y - 0.01) // tipped down vs baseline
    world.dispose()
  })

  it('builds light shafts and bubbles for ambience', () => {
    const world = buildPracticeWorld(openWaterEnvironment)
    const names = world.scene.children.map((c) => c.name)
    expect(names).toContain('light-shafts')
    expect(names).toContain('bubbles')
    world.dispose()
  })

  it('builds near-camera speed motes and rover-mounted prop wash', () => {
    const world = buildPracticeWorld(openWaterEnvironment)
    expect(world.scene.children.map((c) => c.name)).toContain('near-motes')
    const rover = world.scene.children.find((c) => c.name === 'rover')!
    const wash = rover.children.find((c) => c.name === 'prop-wash')
    expect(wash).toBeDefined()
    // One jet per thruster, riding the rover (rover-local frame).
    expect(wash!.children.length).toBeGreaterThan(3)
    // Updating with thruster output must not throw and keeps motes following the camera.
    world.update(
      { x: 5, y: 5, depth: 1, heading: 0, pitch: 0, roll: 0 },
      { dt: 0.05, thrusterOutputs: [1, 1, 0, 0, 1, 1, 0, 0] }
    )
    world.dispose()
  })

  it('builds the animated water surface and floor caustics', () => {
    const world = buildPracticeWorld(openWaterEnvironment)
    const names = world.scene.children.map((c) => c.name)
    expect(names).toContain('water-surface')
    expect(names).toContain('caustics')
    const water = world.scene.children.find((c) => c.name === 'water-surface') as THREE.Mesh
    // Segmented so it can wave (a flat quad would have 4 vertices).
    expect(water.geometry.getAttribute('position').count).toBeGreaterThan(100)
    world.dispose()
  })

  it('shows the tether only while it is enabled (live toggle, no rebuild)', () => {
    const world = buildPracticeWorld(openWaterEnvironment) // tether disabled in this preset
    const tether = world.scene.children.find((c) => c.name === 'tether')
    expect(tether).toBeDefined()
    world.update({ x: 5, y: 5, depth: 1, heading: 0, pitch: 0, roll: 0 })
    expect(tether!.visible).toBe(false)
    openWaterEnvironment.tether.enabled = true
    world.update({ x: 5, y: 5, depth: 1, heading: 0, pitch: 0, roll: 0 })
    expect(tether!.visible).toBe(true)
    openWaterEnvironment.tether.enabled = false
    world.dispose()
  })

  it('builds hoop (ring) meshes for the training course', () => {
    const world = buildPracticeWorld(trainingCourseEnvironment)
    const names = world.scene.children.map((c) => c.name)
    expect(names).toContain('obstacle-hoop-1')
    expect(names).toContain('obstacle-basket')
    const hoop = world.scene.children.find((c) => c.name === 'obstacle-hoop-1')!
    const obstacle = trainingCourseEnvironment.obstacles.find((o) => o.id === 'hoop-1')!
    world.update({ x: 1, y: 1, depth: 1, heading: 0, pitch: 0, roll: 0 })
    // Hoop center sits at top depth + outer radius, mapped to -Y.
    expect(hoop.position.y).toBeCloseTo(-(obstacle.position[2] + obstacle.size[2] / 2))
    world.dispose()
  })

  it('ring meshes center at top + outer RADIUS — the exact torus collision center', () => {
    const env = structuredClone(trainingCourseEnvironment)
    const hoop = env.obstacles.find((o) => o.id === 'hoop-1')!
    hoop.size = [1.4, 0.08, 99] // a bogus size[2] must NOT move the visible hoop off its hitbox
    const world = buildPracticeWorld(env)
    world.update({ x: 1, y: 1, depth: 1, heading: 0, pitch: 0, roll: 0 })
    const mesh = world.scene.children.find((c) => c.name === 'obstacle-hoop-1')!
    expect(mesh.position.y).toBeCloseTo(-(hoop.position[2] + hoop.size[0] / 2))
    world.dispose()
  })

  it('places obstacles at their pool position and depth', () => {
    const world = buildPracticeWorld(mate2026IceTankEnvironment)
    const float = world.scene.children.find((c) => c.name === 'obstacle-float-1')
    expect(float).toBeDefined()
    const obstacle = mate2026IceTankEnvironment.obstacles[0]
    expect(float!.position.x).toBeCloseTo(obstacle.position[0])
    expect(float!.position.z).toBeCloseTo(obstacle.position[1])
    // Center depth = top depth + half height, mapped to -Y.
    expect(float!.position.y).toBeCloseTo(-(obstacle.position[2] + obstacle.size[2] / 2))
    world.dispose()
  })

  it('decays a snagged-obstacle highlight even after the tether is disabled', () => {
    const env = structuredClone(trainingCourseEnvironment) // tether enabled, has gate posts
    const world = buildPracticeWorld(env)
    const mesh = world.scene.getObjectByName('obstacle-gate-1l') as THREE.Mesh
    const mat = mesh.material as THREE.MeshStandardMaterial
    const pose = { x: 1, y: 1, depth: 1, heading: 0, pitch: 0, roll: 0 }
    for (let i = 0; i < 20; i++) world.update(pose, { dt: 0.05, tetherSnagged: ['gate-1l'] })
    expect(mat.emissiveIntensity).toBeGreaterThan(0.2) // lit while snagged
    // Disable the tether mid-glow and stop snagging — the highlight must fade.
    env.tether.enabled = false
    for (let i = 0; i < 50; i++) world.update(pose, { dt: 0.05 })
    expect(mat.emissiveIntensity).toBeLessThan(0.05)
    world.dispose()
  })

  it('hides the replay ghost by default and shows it at the ghost pose', () => {
    const world = buildPracticeWorld(openWaterEnvironment)
    const ghost = world.scene.children.find((c) => c.name === 'ghost-rover')!
    expect(ghost).toBeDefined()
    world.update({ x: 5, y: 5, depth: 1, heading: 0, pitch: 0, roll: 0 })
    expect(ghost.visible).toBe(false) // no ghostPose -> hidden
    world.update(
      { x: 5, y: 5, depth: 1, heading: 0, pitch: 0, roll: 0 },
      { ghostPose: { x: 8, y: 6, depth: 2, heading: Math.PI / 2, pitch: 0, roll: 0 } }
    )
    expect(ghost.visible).toBe(true)
    expect(ghost.position.x).toBeCloseTo(8)
    expect(ghost.position.y).toBeCloseTo(-2) // depth maps to -Y
    expect(ghost.position.z).toBeCloseTo(6)
    world.dispose()
  })
})
