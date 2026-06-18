import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { buildRoverModel } from '@/libs/practice-3d-rover'
import { blueRov2HeavyProfile, blueRov2Profile } from '@/types/rover-profile'

describe('buildRoverModel', () => {
  it('places one thruster per profile entry, at the profile positions', () => {
    const stock = buildRoverModel(blueRov2Profile)
    const heavy = buildRoverModel(blueRov2HeavyProfile)
    const thrusters = (g: THREE.Group): THREE.Object3D[] => g.children.filter((c) => c.name.startsWith('thruster-'))
    expect(thrusters(stock.group)).toHaveLength(6)
    expect(thrusters(heavy.group)).toHaveLength(8)
    // Thruster 1 sits at body (0.15, -0.18, 0) -> local (y, -z, -x) = (-0.18, 0, -0.15).
    const t1 = thrusters(heavy.group).find((t) => t.name === 'thruster-1')!
    expect(t1.position.x).toBeCloseTo(-0.18)
    expect(t1.position.z).toBeCloseTo(-0.15)
  })

  it('sizes the hull from the profile dimensions', () => {
    const model = buildRoverModel(blueRov2HeavyProfile)
    const box = new THREE.Box3().setFromObject(model.group)
    const size = box.getSize(new THREE.Vector3())
    const dims = blueRov2HeavyProfile.dimensions
    // Plan-view extents track the real dims (thruster ducts/claw add a margin).
    expect(size.x).toBeGreaterThan(dims.width * 0.8)
    expect(size.x).toBeLessThan(dims.width * 1.6)
    expect(size.z).toBeGreaterThan(dims.length * 0.8)
    expect(size.z).toBeLessThan(dims.length * 1.6)
  })

  it('animates the claw and the propellers', () => {
    const model = buildRoverModel(blueRov2HeavyProfile)
    const claw = model.group.children.find((c) => c.name === 'claw') as THREE.Group
    expect(claw).toBeDefined()
    const jaw = claw.children.find((c) => c instanceof THREE.Group) as THREE.Group
    const openAngle = jaw.rotation.y
    model.setClawClosure(1)
    expect(jaw.rotation.y).not.toBeCloseTo(openAngle)
    const thruster = model.group.children.find((c) => c.name === 'thruster-1')!
    const prop = thruster.children.find((c) => c instanceof THREE.Group) as THREE.Group
    const before = prop.rotation.y
    model.spinProps(0.5)
    expect(prop.rotation.y).toBeCloseTo(before + 0.5)
  })
})
