import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { buildPracticeWorld } from '@/libs/practice-3d-scene'
import { mate2026IceTankEnvironment, openWaterEnvironment } from '@/types/practice-environment'

describe('buildPracticeWorld', () => {
  it('builds floor, four walls, and particles for any environment', () => {
    const world = buildPracticeWorld(openWaterEnvironment)
    const names = world.scene.children.map((c) => c.name)
    expect(names).toContain('floor')
    expect(names.filter((n) => n.startsWith('wall-'))).toHaveLength(4)
    expect(names).toContain('particles')
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

  it('positions the camera at the pose and looks toward +x at heading 0', () => {
    const world = buildPracticeWorld(openWaterEnvironment)
    world.update({ x: 5, y: 7, depth: 2, heading: 0, pitch: 0, roll: 0 })
    expect(world.camera.position.x).toBeCloseTo(5)
    expect(world.camera.position.y).toBeCloseTo(-2) // depth 2 -> y = -2
    expect(world.camera.position.z).toBeCloseTo(7)
    const forward = new THREE.Vector3()
    world.camera.getWorldDirection(forward)
    expect(forward.x).toBeCloseTo(1, 1)
    expect(forward.z).toBeCloseTo(0, 1)
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
})
