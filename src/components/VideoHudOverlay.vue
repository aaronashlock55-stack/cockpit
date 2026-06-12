<template>
  <div class="hud-overlay">
    <!-- Heading tape (top) -->
    <svg class="heading-tape" viewBox="-150 0 300 26" preserveAspectRatio="xMidYMin meet">
      <g :transform="`translate(${-headingDeg * tapePxPerDeg}, 0)`">
        <template v-for="tick in headingTicks" :key="tick.deg">
          <line :x1="tick.deg * tapePxPerDeg" :x2="tick.deg * tapePxPerDeg" y1="12" :y2="tick.major ? 4 : 8" />
          <text v-if="tick.major" :x="tick.deg * tapePxPerDeg" y="24" text-anchor="middle">{{ tick.label }}</text>
        </template>
      </g>
      <polygon points="-6,0 6,0 0,8" transform="translate(0,2)" class="hud-fill" />
    </svg>
    <div class="heading-readout">
      {{
        Math.round((headingDeg + 360) % 360)
          .toString()
          .padStart(3, '0')
      }}°
    </div>

    <!-- Attitude indicator (center) -->
    <svg class="attitude" viewBox="-100 -100 200 200" preserveAspectRatio="xMidYMid meet">
      <g :transform="`rotate(${-rollDeg})`">
        <g :transform="`translate(0, ${pitchDeg * 1.8})`">
          <line x1="-120" x2="120" y1="0" y2="0" class="horizon" />
          <line v-for="p in [10, 20, -10, -20]" :key="p" :x1="-20" :x2="20" :y1="-p * 1.8" :y2="-p * 1.8" />
          <text x="26" :y="-10 * 1.8 + 4" class="pitch-label">10</text>
          <text x="26" :y="10 * 1.8 + 4" class="pitch-label">-10</text>
        </g>
      </g>
      <!-- Fixed aircraft reference -->
      <path d="M -28 0 L -8 0 L 0 8 L 8 0 L 28 0" class="reference" />
    </svg>

    <!-- Depth (left) -->
    <div class="readout depth">
      <div class="label">DEPTH</div>
      <div class="value">{{ depthMeters.toFixed(1) }}<span class="unit"> m</span></div>
    </div>

    <!-- Speed + battery (right) -->
    <div class="readout right">
      <div class="label">SPD</div>
      <div class="value">{{ groundSpeed.toFixed(1) }}<span class="unit"> m/s</span></div>
      <div class="label mt">BATT</div>
      <div class="value">{{ batteryVolts.toFixed(1) }}<span class="unit"> V</span></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { degrees } from '@/libs/utils'
import { useMainVehicleStore } from '@/stores/mainVehicle'

const store = useMainVehicleStore()

// Pixels of heading tape per degree (tape viewBox is 300 wide ≈ ±83°).
const tapePxPerDeg = 1.8

const headingDeg = computed(() => degrees(store.attitude.yaw ?? 0))
const rollDeg = computed(() => degrees(store.attitude.roll ?? 0))
const pitchDeg = computed(() => degrees(store.attitude.pitch ?? 0))

const depthMeters = computed(() => {
  const rel = store.altitude.rel
  return rel !== undefined && !Number.isNaN(rel) ? Math.max(0, -rel) : 0
})

const groundSpeed = computed(() => store.velocity.ground ?? 0)
const batteryVolts = computed(() => store.powerSupply.voltage ?? 0)

/**
 * Label for a heading tape tick — cardinal letter on the 90° marks, else the degree number.
 * @param {number} deg The tick heading in degrees.
 * @returns {string} The tick label.
 */
const compassLabel = (deg: number): string => {
  const norm = ((deg % 360) + 360) % 360
  const cardinals: Record<number, string> = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }
  return cardinals[norm] ?? norm.toString()
}

/** A single tick on the heading tape. */
interface HeadingTick {
  /** Tick heading in degrees. */
  deg: number
  /** Whether this is a major (90°) tick. */
  major: boolean
  /** Display label (cardinal letter or degree number). */
  label: string
}

// Ticks every 15° across a window around the current heading.
const headingTicks = computed(() => {
  const ticks: HeadingTick[] = []
  const center = Math.round(headingDeg.value / 15) * 15
  for (let d = center - 120; d <= center + 120; d += 15) {
    const major = ((d % 90) + 360) % 90 === 0
    ticks.push({ deg: d, major, label: compassLabel(d) })
  }
  return ticks
})
</script>

<style scoped>
.hud-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  color: #fff;
  font-family: 'Fira Mono for Powerline', monospace;
  text-shadow: 0 0 3px rgb(0 0 0 / 90%);
  z-index: 4;
}
.heading-tape {
  position: absolute;
  top: 2%;
  left: 50%;
  transform: translateX(-50%);
  width: 60%;
  height: 7%;
  min-height: 34px;
  overflow: hidden;
}
.heading-tape line {
  stroke: #fff;
  stroke-width: 1;
  opacity: 0.9;
}
.heading-tape text {
  fill: #fff;
  font-size: 9px;
}
.hud-fill {
  fill: #5ec0ff;
}
.heading-readout {
  position: absolute;
  top: calc(2% + 36px);
  left: 50%;
  transform: translateX(-50%);
  font-size: 1rem;
  font-weight: 700;
  color: #5ec0ff;
}
.attitude {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 26%;
  height: 40%;
  transform: translate(-50%, -50%);
}
.attitude .horizon {
  stroke: #5ec0ff;
  stroke-width: 2;
}
.attitude line {
  stroke: #fff;
  stroke-width: 1;
}
.attitude .reference {
  fill: none;
  stroke: #ffd24a;
  stroke-width: 3;
}
.attitude .pitch-label {
  fill: #fff;
  font-size: 9px;
}
.readout {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  font-size: 0.85rem;
}
.readout.depth {
  left: 3%;
  text-align: left;
}
.readout.right {
  right: 3%;
  text-align: right;
}
.readout .label {
  font-size: 0.65rem;
  opacity: 0.75;
  letter-spacing: 0.1em;
}
.readout .label.mt {
  margin-top: 0.5rem;
}
.readout .value {
  font-size: 1.1rem;
  font-weight: 700;
}
.readout .unit {
  font-size: 0.7rem;
  font-weight: 400;
  opacity: 0.8;
}
</style>
