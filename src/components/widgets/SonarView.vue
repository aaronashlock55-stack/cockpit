<template>
  <div ref="container" class="sonar-widget">
    <div v-if="!readout" class="empty-state">
      <span>Sonar — practice mode off.</span>
      <span class="text-sm opacity-70">Enable Practice / Demo mode in Settings → Development.</span>
    </div>
    <template v-else>
      <canvas ref="canvas" class="sonar-canvas" />
      <div class="readouts">
        <span class="readout" :class="{ warn: altitude !== null && altitude < 0.5 }">
          ALT <b>{{ altitude !== null ? altitude.toFixed(2) : '--' }}</b> m
        </span>
        <span class="readout"
          >FWD <b>{{ forwardRange.toFixed(1) }}</b> m</span
        >
        <span class="readout"
          >SOG <b>{{ groundSpeed.toFixed(2) }}</b> m/s</span
        >
        <span class="readout"
          >DEP <b>{{ depth.toFixed(2) }}</b> m</span
        >
      </div>
      <div class="title">Ping360 · scanning sonar</div>
      <div v-if="nearest" class="nearest" :class="{ warn: nearest.range < 1.5 }">
        nearest <b>{{ nearest.range.toFixed(1) }}</b> m @ <b>{{ nearest.bearing }}</b
        >°
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { practiceSimReadout } from '@/libs/actions/demo-mode-state'

const container = ref<HTMLDivElement>()
const canvas = ref<HTMLCanvasElement>()
const readout = computed(() => practiceSimReadout.value)

const altitude = computed(() => practiceSimReadout.value?.sensors?.dvl.altitudeM ?? null)
const forwardRange = computed(() => practiceSimReadout.value?.sensors?.forwardRangeM ?? 0)
const groundSpeed = computed(() => {
  const dvl = practiceSimReadout.value?.sensors?.dvl
  return dvl ? Math.hypot(dvl.vx, dvl.vy) : 0
})
const depth = computed(() => practiceSimReadout.value?.depth ?? 0)

/** The closest sonar return for the on-screen callout. */
interface NearestContact {
  /** Range to the nearest return, meters. */
  range: number
  /** Vehicle-relative bearing, degrees (0 = ahead, clockwise). */
  bearing: number
}

// Closest sonar return: range + vehicle-relative bearing (0 = ahead, clockwise).
const nearest = computed<NearestContact | null>(() => {
  const sonar = practiceSimReadout.value?.sonar
  if (!sonar) return null
  let best = sonar.maxRangeM
  let bestBin = -1
  for (let i = 0; i < sonar.bins.length; i++) {
    if (sonar.bins[i] < best) {
      best = sonar.bins[i]
      bestBin = i
    }
  }
  if (bestBin < 0 || best >= sonar.maxRangeM) return null
  return { range: best, bearing: Math.round((bestBin / sonar.bins.length) * 360) }
})

let animationFrame: number | undefined

/**
 * Map a sonar return range to a CSS color: bright amber near, dim green far,
 * near-black for no return — the classic single-frequency sonar palette.
 * @param {number} intensity Return strength in [0, 1] (1 = close/strong).
 * @returns {string} An rgba color string.
 */
const sonarColor = (intensity: number): string => {
  if (intensity <= 0.01) return 'rgba(20, 60, 70, 0.10)'
  const r = Math.round(80 + 175 * intensity)
  const g = Math.round(190 + 40 * intensity)
  const b = Math.round(120 - 80 * intensity)
  return `rgba(${r}, ${g}, ${b}, ${0.25 + 0.65 * intensity})`
}

const draw = (): void => {
  animationFrame = requestAnimationFrame(draw)
  const ctx = canvas.value?.getContext('2d')
  const sonar = practiceSimReadout.value?.sonar
  if (!ctx || !canvas.value || !sonar || !container.value) return

  const dpr = window.devicePixelRatio || 1
  const size = Math.min(container.value.clientWidth, container.value.clientHeight - 26)
  if (size <= 0) return
  if (canvas.value.width !== size * dpr || canvas.value.height !== size * dpr) {
    canvas.value.width = size * dpr
    canvas.value.height = size * dpr
    canvas.value.style.width = `${size}px`
    canvas.value.style.height = `${size}px`
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, size, size)

  const cx = size / 2
  const cy = size / 2
  const R = size / 2 - 6
  const { bins, head, maxRangeM } = sonar
  const n = bins.length

  // Scope background.
  ctx.fillStyle = 'rgb(6, 22, 30)'
  ctx.beginPath()
  ctx.arc(cx, cy, R, 0, 2 * Math.PI)
  ctx.fill()

  // Returns: one thin wedge per bin, forward (bin 0) at the top, clockwise.
  const wedge = (2 * Math.PI) / n
  for (let i = 0; i < n; i++) {
    const range = bins[i]
    const hit = range < maxRangeM
    const intensity = hit ? Math.max(0, 1 - range / maxRangeM) : 0
    // Brighten the recently-swept bins to animate the mechanical sweep.
    const behind = (head - i + n) % n
    const sweep = behind < n * 0.12 ? 1 - behind / (n * 0.12) : 0
    const a0 = -Math.PI / 2 + i * wedge - wedge / 2
    const a1 = a0 + wedge
    const rr = hit ? (range / maxRangeM) * R : R
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.arc(cx, cy, rr, a0, a1)
    ctx.closePath()
    ctx.fillStyle = hit
      ? sonarColor(Math.min(1, intensity + sweep * 0.4))
      : `rgba(40, 120, 130, ${0.04 + sweep * 0.12})`
    ctx.fill()
  }

  // Range rings + labels.
  ctx.strokeStyle = 'rgba(120, 200, 210, 0.25)'
  ctx.fillStyle = 'rgba(150, 220, 230, 0.6)'
  ctx.font = '9px monospace'
  ctx.lineWidth = 1
  for (let ring = 1; ring <= 4; ring++) {
    const rr = (ring / 4) * R
    ctx.beginPath()
    ctx.arc(cx, cy, rr, 0, 2 * Math.PI)
    ctx.stroke()
    ctx.fillText(`${((ring / 4) * maxRangeM).toFixed(0)}m`, cx + 2, cy - rr + 10)
  }

  // Forward marker + sweep line.
  ctx.strokeStyle = 'rgba(180, 240, 250, 0.5)'
  ctx.beginPath()
  ctx.moveTo(cx, cy)
  ctx.lineTo(cx, cy - R)
  ctx.stroke()
  const sweepAngle = -Math.PI / 2 + head * wedge
  ctx.strokeStyle = 'rgba(120, 255, 180, 0.85)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(cx, cy)
  ctx.lineTo(cx + Math.cos(sweepAngle) * R, cy + Math.sin(sweepAngle) * R)
  ctx.stroke()

  // Center vehicle dot.
  ctx.fillStyle = 'rgba(120, 255, 180, 0.9)'
  ctx.beginPath()
  ctx.arc(cx, cy, 3, 0, 2 * Math.PI)
  ctx.fill()
}

// The draw loop reads the container size every frame, so canvas sizing tracks
// the widget without a separate ResizeObserver.
onMounted(() => draw())

onBeforeUnmount(() => {
  if (animationFrame !== undefined) cancelAnimationFrame(animationFrame)
})
</script>

<style scoped>
.sonar-widget {
  width: 100%;
  height: 100%;
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background-color: rgb(4 16 22);
  overflow: hidden;
}
.sonar-canvas {
  display: block;
}
.empty-state {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  align-items: center;
  justify-content: center;
  color: #fff;
  text-align: center;
  padding: 1rem;
}
.readouts {
  position: absolute;
  bottom: 4px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 0.7rem;
  font-family: var(--hud-font);
  font-size: var(--hud-font-size-sm);
  color: var(--hud-fg);
  white-space: nowrap;
  pointer-events: none;
}
.readout b {
  color: #fff;
}
.readout.warn b {
  color: var(--hud-warn);
}
.title {
  position: absolute;
  top: 5px;
  left: 8px;
  font-family: var(--hud-font);
  font-size: var(--hud-font-size-sm);
  color: var(--hud-accent);
  opacity: 0.8;
  pointer-events: none;
}
.nearest {
  position: absolute;
  top: 5px;
  right: 8px;
  font-family: var(--hud-font);
  font-size: var(--hud-font-size-sm);
  color: var(--hud-fg-dim);
  pointer-events: none;
}
.nearest b {
  color: var(--hud-fg);
}
.nearest.warn,
.nearest.warn b {
  color: var(--hud-warn);
  font-weight: 700;
}
</style>
