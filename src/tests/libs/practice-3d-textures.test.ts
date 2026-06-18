import { describe, expect, it } from 'vitest'

import {
  buildPoolDetails,
  makeHazardStripeTexture,
  makePoolTileTexture,
  obstacleMaterial,
  tiledMaterial,
} from '@/libs/practice-3d-textures'
import { type PracticeObstacle } from '@/types/practice-environment'

// jsdom has no 2D canvas context: every texture builder must degrade cleanly.

describe('procedural textures (jsdom degradation)', () => {
  it('texture builders return null without a 2D canvas, not throw', () => {
    expect(makePoolTileTexture('#aaccdd', '#88aabb')).toBeNull()
    expect(makeHazardStripeTexture('#ff8c42', '#15181c')).toBeNull()
  })

  it('tiledMaterial still yields a usable material without textures', () => {
    const material = tiledMaterial(0xffffff, 30, 15, 'floor')
    expect(material.map).toBeNull()
    expect(material.roughness).toBeGreaterThan(0)
  })

  it('obstacleMaterial keeps the configured color in the fallback path', () => {
    const obstacle: PracticeObstacle = {
      id: 'o1',
      name: 'o1',
      shape: 'cylinder',
      position: [1, 1, 0],
      size: [0.2, 0.2, 1],
      color: '#ff0000',
    }
    const material = obstacleMaterial(obstacle)
    expect(material.color.r).toBeCloseTo(1)
    expect(material.color.g).toBeCloseTo(0)
  })
})

describe('buildPoolDetails', () => {
  it('builds lane lines with T markers and a waterline band on all four walls', () => {
    const details = buildPoolDetails(30, 15, 4)
    const names = details.children.map((c) => c.name)
    expect(names.filter((n) => n === 'lane-line')).toHaveLength(6) // 2 lanes x (line + 2 crossbars)
    expect(names.filter((n) => n === 'waterline-band')).toHaveLength(4)
    // Lane lines lie just above the floor.
    const lane = details.children.find((c) => c.name === 'lane-line')!
    expect(lane.position.y).toBeCloseTo(-4 + 0.012)
  })
})
