import * as THREE from 'three'

import { type PracticeObstacle } from '@/types/practice-environment'

/**
 * Procedural textures and pool dressing for the practice trainer — everything
 * that takes the world from "toy shapes" to "real competition pool": worn
 * high-res tiles with grout variation and stains, lane lines with T end
 * markers, a dark waterline band, and prop materials (hazard-striped gates and
 * hoops, labeled canisters, scuffed crates). All canvas-procedural — no asset
 * files — and every builder degrades to a plain material/null outside a
 * browser (jsdom tests have no 2D canvas).
 */

/**
 * Deterministic tiny PRNG so textures look identical every build.
 * @param {number} seed PRNG seed.
 * @returns {() => number} Generator of values in [0, 1).
 */
const makeRand = (seed: number): (() => number) => {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0xffffffff
  }
}

const make2dCanvas = (px: number): CanvasRenderingContext2D | null => {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = px
  canvas.height = px
  return canvas.getContext('2d')
}

/**
 * Worn pool-tile texture: per-tile tint jitter, grout-line variation, and
 * low-alpha stains/scuffs, at 1024 px so tiles stay crisp up close.
 * @param {string} base Base tile CSS color.
 * @param {string} grout Grout line CSS color.
 * @returns {THREE.Texture | null} The texture, or null outside a browser.
 */
export const makePoolTileTexture = (base: string, grout: string): THREE.Texture | null => {
  const px = 1024
  const tile = 128
  const ctx = make2dCanvas(px)
  if (!ctx) return null
  const rand = makeRand(7)
  ctx.fillStyle = base
  ctx.fillRect(0, 0, px, px)
  // Per-tile lightness jitter (worn, hand-laid look).
  for (let ty = 0; ty < px; ty += tile) {
    for (let tx = 0; tx < px; tx += tile) {
      const v = (rand() - 0.5) * 0.16
      ctx.fillStyle = v > 0 ? `rgba(255,255,255,${v})` : `rgba(10,30,40,${-v})`
      ctx.fillRect(tx, ty, tile, tile)
    }
  }
  // Grout with slight darkness variation per line.
  for (let i = 0; i <= px; i += tile) {
    for (const [x0, y0, x1, y1] of [
      [i, 0, i, px],
      [0, i, px, i],
    ]) {
      ctx.strokeStyle = grout
      ctx.globalAlpha = 0.75 + rand() * 0.25
      ctx.lineWidth = 5 + rand() * 3
      ctx.beginPath()
      ctx.moveTo(x0, y0)
      ctx.lineTo(x1, y1)
      ctx.stroke()
    }
  }
  ctx.globalAlpha = 1
  // Stains / algae scuffs: soft radial gradients.
  for (let i = 0; i < 14; i++) {
    const x = rand() * px
    const y = rand() * px
    const r = 30 + rand() * 120
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, `rgba(18, 46, 52, ${0.04 + rand() * 0.08})`)
    g.addColorStop(1, 'rgba(18, 46, 52, 0)')
    ctx.fillStyle = g
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
  }
  const texture = new THREE.CanvasTexture(ctx.canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  return texture
}

/**
 * Tiled pool material for the floor or walls (walls darker/desaturated, like a
 * real pool below the waterline).
 * @param {number} color Material tint.
 * @param {number} length Surface length in meters (sets tile repeat).
 * @param {number} height Surface height in meters (sets tile repeat).
 * @param {'floor' | 'wall'} kind Palette: bright floor or darker wall.
 * @returns {THREE.MeshStandardMaterial} The material.
 */
export const tiledMaterial = (
  color: number,
  length: number,
  height: number,
  kind: 'floor' | 'wall' = 'wall'
): THREE.MeshStandardMaterial => {
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: kind === 'floor' ? 0.85 : 0.9,
    metalness: 0,
  })
  const texture =
    kind === 'floor' ? makePoolTileTexture('#a7cbdc', '#7da9bd') : makePoolTileTexture('#8fb4c6', '#6f9cb0')
  if (texture) {
    // 8 tiles per repeat at ~0.5 m per tile.
    texture.repeat.set(Math.max(1, Math.round(length / 4)), Math.max(1, Math.round(height / 4)))
    material.map = texture
  }
  return material
}

/**
 * Diagonal hazard stripes (competition gates/hoops).
 * @param {string} colorA Stripe color (usually the obstacle's color).
 * @param {string} colorB Contrast stripe color.
 * @returns {THREE.Texture | null} The texture, or null outside a browser.
 */
export const makeHazardStripeTexture = (colorA: string, colorB: string): THREE.Texture | null => {
  const px = 128
  const ctx = make2dCanvas(px)
  if (!ctx) return null
  ctx.fillStyle = colorA
  ctx.fillRect(0, 0, px, px)
  ctx.fillStyle = colorB
  const w = px / 4
  for (let x = -px; x < px * 2; x += w * 2) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x + w, 0)
    ctx.lineTo(x + w + px, px)
    ctx.lineTo(x + px, px)
    ctx.closePath()
    ctx.fill()
  }
  const texture = new THREE.CanvasTexture(ctx.canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  return texture
}

/**
 * Grayscale multiply texture: white body, dark mid label band + hairlines.
 * Tinted by the material color so the obstacle's configured color shows.
 * @returns {THREE.Texture | null} The texture, or null outside a browser.
 */
export const makeLabelBandTexture = (): THREE.Texture | null => {
  const px = 128
  const ctx = make2dCanvas(px)
  if (!ctx) return null
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, px, px)
  ctx.fillStyle = '#3a3f45'
  ctx.fillRect(0, px * 0.42, px, px * 0.16)
  ctx.fillStyle = '#cfd4d8'
  ctx.fillRect(0, px * 0.47, px, px * 0.015)
  ctx.fillRect(0, px * 0.52, px, px * 0.015)
  const texture = new THREE.CanvasTexture(ctx.canvas)
  texture.wrapS = THREE.RepeatWrapping
  return texture
}

/**
 * Grayscale multiply texture: near-white with scuffs/scratches, for crates.
 * @returns {THREE.Texture | null} The texture, or null outside a browser.
 */
export const makeScuffTexture = (): THREE.Texture | null => {
  const px = 256
  const ctx = make2dCanvas(px)
  if (!ctx) return null
  const rand = makeRand(13)
  ctx.fillStyle = '#f4f4f2'
  ctx.fillRect(0, 0, px, px)
  for (let i = 0; i < 26; i++) {
    ctx.strokeStyle = `rgba(40, 44, 48, ${0.05 + rand() * 0.12})`
    ctx.lineWidth = 1 + rand() * 3
    ctx.beginPath()
    const x = rand() * px
    const y = rand() * px
    ctx.moveTo(x, y)
    ctx.lineTo(x + (rand() - 0.5) * 90, y + (rand() - 0.5) * 90)
    ctx.stroke()
  }
  const texture = new THREE.CanvasTexture(ctx.canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  return texture
}

/**
 * Material for a mission prop, dressed by shape: hoops and tall pillars get
 * hazard stripes, small cylinders (canisters/floats) a label band, crates a
 * scuffed finish. Falls back to a plain colored material outside a browser.
 * @param {PracticeObstacle} obstacle The obstacle being built.
 * @returns {THREE.MeshStandardMaterial} The dressed material.
 */
export const obstacleMaterial = (obstacle: PracticeObstacle): THREE.MeshStandardMaterial => {
  const cssColor = obstacle.color ?? '#ffd24a'
  if (obstacle.shape === 'ring' || (obstacle.shape === 'cylinder' && obstacle.size[2] > 1.5)) {
    const stripes = makeHazardStripeTexture(cssColor, '#15181c')
    if (stripes) {
      stripes.repeat.set(
        obstacle.shape === 'ring' ? 10 : 2,
        obstacle.shape === 'ring' ? 1 : Math.round(obstacle.size[2])
      )
      return new THREE.MeshStandardMaterial({ color: 0xffffff, map: stripes, roughness: 0.55, metalness: 0.25 })
    }
  } else if (obstacle.shape === 'cylinder') {
    const band = makeLabelBandTexture()
    if (band) {
      return new THREE.MeshStandardMaterial({
        color: new THREE.Color(cssColor),
        map: band,
        roughness: 0.5,
        metalness: 0.3,
      })
    }
  } else {
    const scuffs = makeScuffTexture()
    if (scuffs) {
      return new THREE.MeshStandardMaterial({
        color: new THREE.Color(cssColor),
        map: scuffs,
        roughness: 0.75,
        metalness: 0.05,
      })
    }
  }
  return new THREE.MeshStandardMaterial({ color: new THREE.Color(cssColor), roughness: 0.7, metalness: 0.05 })
}

/**
 * Pool dressing: dark lane lines with T end markers on the floor and a dark
 * waterline band around the top of the walls — the visual anchors of a real
 * competition pool (and strong optic-flow references for speed perception).
 * @param {number} L Pool length, m.
 * @param {number} W Pool width, m.
 * @param {number} D Pool depth, m.
 * @returns {THREE.Group} Group of named 'lane-line' / 'waterline-band' meshes.
 */
export const buildPoolDetails = (L: number, W: number, D: number): THREE.Group => {
  const group = new THREE.Group()
  group.name = 'pool-details'
  const navy = new THREE.MeshStandardMaterial({ color: 0x16324a, roughness: 0.88, metalness: 0 })

  const addFlat = (w: number, h: number, x: number, z: number, name: string): void => {
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), navy)
    plane.name = name
    plane.rotation.x = -Math.PI / 2
    plane.position.set(x, -D + 0.012, z)
    group.add(plane)
  }
  // Lane lines down the length at 1/3 and 2/3 width, with T crossbars.
  for (const frac of [1 / 3, 2 / 3]) {
    const z = W * frac
    addFlat(L - 1.6, 0.25, L / 2, z, 'lane-line')
    addFlat(0.25, 1.0, 0.9, z, 'lane-line')
    addFlat(0.25, 1.0, L - 0.9, z, 'lane-line')
  }

  // Waterline band: a dark strip just below the surface on each wall.
  /* eslint-disable jsdoc/require-jsdoc */
  const bands: { size: [number, number]; pos: [number, number, number]; rotY: number }[] = [
    { size: [W, 0.3], pos: [0.012, -0.15, W / 2], rotY: Math.PI / 2 },
    { size: [W, 0.3], pos: [L - 0.012, -0.15, W / 2], rotY: -Math.PI / 2 },
    { size: [L, 0.3], pos: [L / 2, -0.15, 0.012], rotY: 0 },
    { size: [L, 0.3], pos: [L / 2, -0.15, W - 0.012], rotY: Math.PI },
  ]
  /* eslint-enable jsdoc/require-jsdoc */
  for (const band of bands) {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(band.size[0], band.size[1]), navy)
    strip.name = 'waterline-band'
    strip.position.set(...band.pos)
    strip.rotation.y = band.rotY
    group.add(strip)
  }
  return group
}
