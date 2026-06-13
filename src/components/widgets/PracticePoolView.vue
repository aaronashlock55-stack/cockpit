<template>
  <div class="pool-view-widget">
    <div v-if="!readout" class="empty-state">
      <span>Practice mode is off.</span>
      <span class="text-sm opacity-70">Enable Practice / Demo mode in Settings → Development.</span>
    </div>
    <template v-else>
      <svg class="pool-svg" :viewBox="`-1 -1 ${env.pool.length + 2} ${env.pool.width + 2}`">
        <!-- Pool -->
        <rect x="0" y="0" :width="env.pool.length" :height="env.pool.width" class="pool-rect" :rx="0.5" />
        <!-- Ice sheet (hatch) + launch hole -->
        <template v-if="env.iceSheet">
          <rect x="0" y="0" :width="env.pool.length" :height="env.pool.width" class="ice-rect" :rx="0.5" />
          <rect
            :x="env.iceSheet.holeCenter[0] - env.iceSheet.holeSize / 2"
            :y="env.iceSheet.holeCenter[1] - env.iceSheet.holeSize / 2"
            :width="env.iceSheet.holeSize"
            :height="env.iceSheet.holeSize"
            class="ice-hole"
          />
        </template>
        <!-- Obstacles -->
        <template v-for="obstacle in env.obstacles" :key="obstacle.id">
          <line
            v-if="obstacle.shape === 'ring'"
            v-bind="ringLine(obstacle)"
            class="hoop"
            :style="{ stroke: obstacle.color ?? '#56e08e' }"
          />
          <circle
            v-else-if="obstacle.shape === 'cylinder'"
            :cx="obstacle.position[0]"
            :cy="obstacle.position[1]"
            :r="Math.max(obstacle.size[0] / 2, 0.15)"
            class="obstacle"
            :class="{ snagged: snaggedIds.has(obstacle.id) }"
            :style="{ fill: obstacle.color ?? '#ffd24a' }"
          />
          <rect
            v-else
            :x="obstacle.position[0] - obstacle.size[0] / 2"
            :y="obstacle.position[1] - obstacle.size[1] / 2"
            :width="obstacle.size[0]"
            :height="obstacle.size[1]"
            class="obstacle"
            :class="{ snagged: snaggedIds.has(obstacle.id) }"
            :style="{ fill: obstacle.color ?? '#ffd24a' }"
          />
        </template>
        <!-- Tether (routed through the ice launch hole when there is one) -->
        <polyline
          v-if="env.tether.enabled"
          :points="tetherPoints"
          fill="none"
          class="tether"
          :class="{ taut: tetherTaut }"
        />
        <!-- Rover (triangle pointing along heading) -->
        <g :transform="`translate(${readout.x}, ${readout.y}) rotate(${(readout.heading * 180) / Math.PI})`">
          <polygon points="0.6,0 -0.4,0.35 -0.4,-0.35" class="rover" :class="{ bumped: !!readout.collidedWith }" />
        </g>
        <!-- Scale bar (a real-world ruler that scales with the map), bottom-left.
             Its numeric label is an HTML overlay so it stays readable. -->
        <g :transform="`translate(0.6, ${env.pool.width - 0.6})`" class="legend">
          <line x1="0" y1="0" :x2="scaleM" y2="0" class="scale-bar" />
          <line x1="0" y1="-0.12" x2="0" y2="0.12" class="scale-bar" />
          <line :x1="scaleM" y1="-0.12" :x2="scaleM" y2="0.12" class="scale-bar" />
        </g>
        <!-- Heading reference arrow: pool +x (heading 0 / "north" on the map). -->
        <g :transform="`translate(${env.pool.length - 1.4}, 1.1)`" class="legend">
          <line x1="-0.5" y1="0" x2="0.7" y2="0" class="north-arrow" />
          <polygon points="0.9,0 0.5,-0.18 0.5,0.18" class="north-head" />
        </g>
      </svg>
      <div class="map-legend">
        <span>⤢ {{ scaleM }} m</span>
        <span>N → +x</span>
      </div>
      <div class="status-bar">
        <span>{{ env.name }}</span>
        <span>depth {{ readout.depth.toFixed(1) }} m / {{ env.pool.depth }} m</span>
        <span v-if="env.tether.enabled" :class="{ 'text-red-400': tetherTaut }">
          tether {{ readout.tetherDeployed.toFixed(1) }} / {{ env.tether.length }} m
        </span>
        <span v-if="readout.recentPass" class="text-green-400">✔ {{ readout.recentPass }}</span>
        <span v-if="readout.collidedWith" class="text-red-400">⚠ {{ readout.collidedWith }}</span>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { activePracticeEnvironment, practiceSimReadout } from '@/libs/actions/demo-mode-state'
import { tetherWorldPath } from '@/libs/rover-simulator'
import { type PracticeObstacle } from '@/types/practice-environment'

// Note: the widget system passes a :widget prop; this widget has no per-instance
// options, so it is intentionally left undeclared (falls through as an attr).

const env = computed(() => activePracticeEnvironment.value)
const readout = computed(() => practiceSimReadout.value)

/**
 * A hoop seen from above is its edge-on line across the ring plane.
 * @param {PracticeObstacle} obstacle The ring obstacle.
 * @returns {Record<string, number>} SVG line endpoints.
 */
const ringLine = (obstacle: PracticeObstacle): Record<string, number> => {
  const gamma = ((obstacle.yawDeg ?? 0) * Math.PI) / 180
  const r = obstacle.size[0] / 2
  const [dx, dy] = [-Math.sin(gamma) * r, Math.cos(gamma) * r]
  return {
    x1: obstacle.position[0] - dx,
    y1: obstacle.position[1] - dy,
    x2: obstacle.position[0] + dx,
    y2: obstacle.position[1] + dy,
  }
}

const tetherTaut = computed(() => {
  if (!readout.value || !env.value.tether.enabled) return false
  return readout.value.tetherDeployed >= env.value.tether.length * 0.98
})

const tetherPoints = computed(() => {
  if (!readout.value) return ''
  const r = readout.value
  // Prefer the sim's real path (through the ice hole and around any snags).
  if (r.tetherPath) return r.tetherPath.map(([x, y]) => `${x},${y}`).join(' ')
  return tetherWorldPath({ x: r.x, y: r.y, depth: r.depth }, env.value)
    .map((p) => `${p.x},${p.y}`)
    .join(' ')
})

// Obstacles the tether is currently caught on (highlighted on the map).
const snaggedIds = computed(() => new Set(readout.value?.tetherSnagged ?? []))

// A round scale-bar length that fits ~a quarter of the pool length.
const scaleM = computed(() => {
  const target = env.value.pool.length / 4
  const steps = [0.5, 1, 2, 5, 10, 20]
  return steps.reduce((best, s) => (Math.abs(s - target) < Math.abs(best - target) ? s : best), steps[0])
})
</script>

<style scoped>
.pool-view-widget {
  width: 100%;
  height: 100%;
  position: relative;
  display: flex;
  flex-direction: column;
  background-color: rgb(13 25 35);
  border-radius: 6px;
  overflow: hidden;
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
.pool-svg {
  flex: 1;
  width: 100%;
  min-height: 0;
}
.pool-rect {
  fill: rgb(20 60 90);
  stroke: rgb(120 180 220);
  stroke-width: 0.15;
}
.ice-rect {
  fill: rgb(220 240 255 / 25%);
}
.ice-hole {
  fill: rgb(20 60 90);
  stroke: rgb(220 240 255 / 80%);
  stroke-width: 0.08;
}
.obstacle {
  stroke: rgb(0 0 0 / 40%);
  stroke-width: 0.05;
}
.obstacle.snagged {
  stroke: rgb(255 120 70);
  stroke-width: 0.16;
}
.hoop {
  stroke-width: 0.14;
  stroke-linecap: round;
}
.tether {
  stroke: rgb(255 230 100 / 80%);
  stroke-width: 0.1;
  stroke-linejoin: round;
}
.tether.taut {
  stroke: rgb(255 80 80);
}
.legend {
  pointer-events: none;
}
.scale-bar,
.north-arrow {
  stroke: rgb(200 230 240 / 75%);
  stroke-width: 0.06;
}
.north-head {
  fill: rgb(200 230 240 / 85%);
}
.map-legend {
  position: absolute;
  top: 6px;
  left: 8px;
  display: flex;
  gap: 0.7rem;
  font-family: monospace;
  font-size: 0.64rem;
  color: rgb(200 230 240 / 85%);
  background-color: rgb(0 0 0 / 35%);
  padding: 2px 8px;
  border-radius: 8px;
  pointer-events: none;
}
.rover {
  fill: rgb(94 192 255);
  stroke: #fff;
  stroke-width: 0.06;
}
.rover.bumped {
  fill: rgb(255 80 80);
}
.status-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem 1.2rem;
  padding: 4px 10px;
  font-size: 0.72rem;
  font-family: monospace;
  color: #fff;
  background-color: rgb(0 0 0 / 45%);
}
</style>
