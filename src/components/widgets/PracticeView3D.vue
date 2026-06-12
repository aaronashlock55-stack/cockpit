<template>
  <div ref="container" class="practice-3d-widget">
    <div v-if="!readout" class="empty-state">
      <span>Practice mode is off.</span>
      <span class="text-sm opacity-70">Enable Practice / Demo mode in Settings → Development.</span>
    </div>
    <template v-else>
      <canvas ref="canvas" class="render-canvas" />
      <VideoHudOverlay v-if="widget.options.showHud" />
      <div class="bottom-hints">
        <span v-if="readout.collidedWith" class="collision">⚠ {{ readout.collidedWith }}</span>
        <span v-if="heldName" class="holding">✊ holding: {{ heldName }}</span>
        <span v-else-if="(readout.gripper ?? 0) > 0.5" class="holding dim">claw closed</span>
        <span class="keys">W A S D move · ← → turn · ↑ ↓ depth · G claw</span>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import * as THREE from 'three'
import { computed, onBeforeUnmount, onMounted, ref, toRefs, watch } from 'vue'

import VideoHudOverlay from '@/components/VideoHudOverlay.vue'
import { activePracticeEnvironment, practiceSimReadout } from '@/libs/actions/demo-mode-state'
import { type PracticeWorld, buildPracticeWorld } from '@/libs/practice-3d-scene'
import { useMainVehicleStore } from '@/stores/mainVehicle'
import type { Widget } from '@/types/widgets'

const props = defineProps<{
  /**
   * Widget reference
   */
  widget: Widget
}>()
const widget = toRefs(props).widget

const vehicleStore = useMainVehicleStore()
const container = ref<HTMLDivElement>()
const canvas = ref<HTMLCanvasElement>()
const readout = computed(() => practiceSimReadout.value)

const heldName = computed(() => {
  const id = practiceSimReadout.value?.heldObstacleId
  if (!id) return undefined
  return activePracticeEnvironment.value.obstacles.find((o) => o.id === id)?.name ?? id
})

let renderer: THREE.WebGLRenderer | undefined
let world: PracticeWorld | undefined
let animationFrame: number | undefined
let resizeObserver: ResizeObserver | undefined

const buildWorld = (): void => {
  world?.dispose()
  world = buildPracticeWorld(activePracticeEnvironment.value)
  resize()
}

const resize = (): void => {
  if (!renderer || !world || !container.value) return
  const { clientWidth: w, clientHeight: h } = container.value
  if (w === 0 || h === 0) return
  renderer.setSize(w, h, false)
  world.camera.aspect = w / h
  world.camera.updateProjectionMatrix()
}

const renderLoop = (): void => {
  animationFrame = requestAnimationFrame(renderLoop)
  if (!renderer || !world) return
  const r = practiceSimReadout.value
  if (!r) return
  world.update(
    {
      x: r.x,
      y: r.y,
      depth: r.depth,
      heading: r.heading,
      pitch: vehicleStore.attitude.pitch ?? 0,
      roll: vehicleStore.attitude.roll ?? 0,
    },
    r.gripper ?? 0
  )
  renderer.render(world.scene, world.camera)
}

const startRenderer = (): void => {
  if (renderer || !canvas.value) return
  renderer = new THREE.WebGLRenderer({ canvas: canvas.value, antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  buildWorld()
  renderLoop()
}

onMounted(() => {
  widget.value.options = { showHud: true, ...widget.value.options }
  if (container.value) {
    resizeObserver = new ResizeObserver(() => resize())
    resizeObserver.observe(container.value)
  }
  // The canvas only exists while practice mode is on (v-else branch).
  watch(
    () => [practiceSimReadout.value !== null, canvas.value] as const,
    () => {
      if (practiceSimReadout.value !== null && canvas.value) startRenderer()
    },
    { immediate: true, flush: 'post' }
  )
  watch(activePracticeEnvironment, () => {
    if (renderer) buildWorld()
  })
})

onBeforeUnmount(() => {
  if (animationFrame !== undefined) cancelAnimationFrame(animationFrame)
  resizeObserver?.disconnect()
  world?.dispose()
  renderer?.dispose()
  renderer = undefined
})
</script>

<style scoped>
.practice-3d-widget {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
  background-color: rgb(12 38 52);
}
.render-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
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
.bottom-hints {
  position: absolute;
  bottom: 6px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 1rem;
  align-items: center;
  font-family: monospace;
  font-size: 0.7rem;
  color: rgb(255 255 255 / 75%);
  background-color: rgb(0 0 0 / 40%);
  padding: 2px 10px;
  border-radius: 10px;
  white-space: nowrap;
  pointer-events: none;
  z-index: 5;
}
.bottom-hints .collision {
  color: rgb(255 110 110);
  font-weight: 700;
}
.bottom-hints .holding {
  color: rgb(120 230 140);
  font-weight: 700;
}
.bottom-hints .holding.dim {
  color: rgb(200 220 200 / 80%);
  font-weight: 400;
}
</style>
