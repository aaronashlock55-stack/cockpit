<template>
  <div ref="container" class="practice-3d-widget">
    <div v-if="!readout" class="empty-state">
      <span>Practice mode is off.</span>
      <span class="text-sm opacity-70">Enable Practice / Demo mode in Settings → Development.</span>
    </div>
    <template v-else>
      <canvas
        ref="canvas"
        class="render-canvas"
        :class="{ grabbing: dragging }"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointerleave="onPointerUp"
        @wheel.prevent="onWheel"
        @dblclick="resetCamera"
      />
      <VideoHudOverlay v-if="widget.options.showHud && cameraMode === 'fp'" />
      <PracticeMissionPanel />
      <div class="view-controls">
        <button class="view-button" @click="toggleCamera">
          {{ cameraMode === 'fp' ? '🎥 Chase cam' : '🤿 ROV cam' }}
        </button>
        <button v-if="cameraAdjusted" class="view-button" title="Recenter camera" @click="resetCamera">
          ⟳ Recenter
        </button>
      </div>
      <div class="bottom-hints">
        <span v-if="readout.recentPass" class="passed">✔ {{ readout.recentPass }}</span>
        <span v-if="readout.collidedWith" class="collision">⚠ {{ readout.collidedWith }}</span>
        <span v-if="heldName" class="holding">✊ holding: {{ heldName }}</span>
        <span v-else-if="(readout.gripper ?? 0) > 0.5" class="holding dim">claw closed</span>
        <span v-if="env.tether.enabled" class="keys" :class="{ taut: tetherTaut }">
          tether {{ readout.tetherDeployed.toFixed(1) }}/{{ env.tether.length }} m
        </span>
        <span class="keys">W A S D move · ← → turn · ↑ ↓ depth · G claw · C camera · drag look · scroll zoom</span>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import * as THREE from 'three'
import { computed, onBeforeUnmount, onMounted, ref, toRefs, watch } from 'vue'

import PracticeMissionPanel from '@/components/PracticeMissionPanel.vue'
import VideoHudOverlay from '@/components/VideoHudOverlay.vue'
import {
  activePracticeEnvironment,
  activeRoverProfile,
  practicePoseFrames,
  practiceSimReadout,
} from '@/libs/actions/demo-mode-state'
import { activeReplay, replayMode } from '@/libs/actions/dive-session-state'
import { type PracticePost, buildPracticePost } from '@/libs/practice-3d-post'
import { type PracticeWorld, buildPracticeWorld } from '@/libs/practice-3d-scene'
import { frameAlpha, interpolatePose } from '@/libs/practice-interp'
import type { Widget } from '@/types/widgets'

const props = defineProps<{
  /**
   * Widget reference
   */
  widget: Widget
}>()
const widget = toRefs(props).widget

const container = ref<HTMLDivElement>()
const canvas = ref<HTMLCanvasElement>()
const readout = computed(() => practiceSimReadout.value)
const cameraMode = ref<'fp' | 'chase'>('fp')

const toggleCamera = (): void => {
  cameraMode.value = cameraMode.value === 'fp' ? 'chase' : 'fp'
}

const onViewKey = (event: KeyboardEvent): void => {
  const target = event.target as HTMLElement | null
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
  if (!event.repeat && event.key.toLowerCase() === 'c' && practiceSimReadout.value) toggleCamera()
}

// Adjustable camera: drag to look around, wheel to zoom, double-click/⟳ to reset.
const cameraAdjust = ref({ yaw: 0, pitch: 0, zoom: 1 })
const dragging = ref(false)
let lastPointer = { x: 0, y: 0 }
const cameraAdjusted = computed(
  () => cameraAdjust.value.yaw !== 0 || cameraAdjust.value.pitch !== 0 || cameraAdjust.value.zoom !== 1
)
const clampN = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

const onPointerDown = (event: PointerEvent): void => {
  dragging.value = true
  lastPointer = { x: event.clientX, y: event.clientY }
  ;(event.target as HTMLElement).setPointerCapture?.(event.pointerId)
}
const onPointerMove = (event: PointerEvent): void => {
  if (!dragging.value) return
  const dx = event.clientX - lastPointer.x
  const dy = event.clientY - lastPointer.y
  lastPointer = { x: event.clientX, y: event.clientY }
  cameraAdjust.value.yaw = clampN(cameraAdjust.value.yaw - dx * 0.005, -Math.PI, Math.PI)
  cameraAdjust.value.pitch = clampN(cameraAdjust.value.pitch - dy * 0.005, -1, 1)
}
const onPointerUp = (): void => {
  dragging.value = false
}
const onWheel = (event: WheelEvent): void => {
  cameraAdjust.value.zoom = clampN(cameraAdjust.value.zoom * (event.deltaY < 0 ? 1.1 : 0.9), 0.5, 4)
}
const resetCamera = (): void => {
  cameraAdjust.value = { yaw: 0, pitch: 0, zoom: 1 }
}

const heldName = computed(() => {
  const id = practiceSimReadout.value?.heldObstacleId
  if (!id) return undefined
  return activePracticeEnvironment.value.obstacles.find((o) => o.id === id)?.name ?? id
})

const env = computed(() => activePracticeEnvironment.value)
const tetherTaut = computed(() => {
  if (!readout.value || !env.value.tether.enabled) return false
  return readout.value.tetherDeployed >= env.value.tether.length * 0.98
})

// Rebuild signature: everything that changes the world's GEOMETRY. Obstacle
// positions are excluded on purpose — the sim mutates them every frame while
// an object is held, and meshes re-sync per frame anyway.
const structuralSig = computed(() => {
  const e = activePracticeEnvironment.value
  return JSON.stringify([
    e.name,
    e.pool,
    e.iceSheet,
    e.tether.attachPoint,
    e.flow,
    e.obstacles.map((o) => [o.id, o.shape, o.size, o.yawDeg, o.color]),
  ])
})

let renderer: THREE.WebGLRenderer | undefined
let world: PracticeWorld | undefined
let post: PracticePost | undefined
let animationFrame: number | undefined
let resizeObserver: ResizeObserver | undefined

const buildWorld = (): void => {
  world?.dispose()
  world = buildPracticeWorld(activePracticeEnvironment.value, activeRoverProfile.value)
  // The post chain holds scene/camera refs — rebuild it with the world.
  post?.dispose()
  post = renderer ? buildPracticePost(renderer, world.scene, world.camera) : undefined
  resize()
}

const resize = (): void => {
  if (!renderer || !world || !container.value) return
  const { clientWidth: w, clientHeight: h } = container.value
  if (w === 0 || h === 0) return
  // High-DPI, re-applied so moving between displays tracks the new ratio.
  // Capped at 1.75: bloom at a native 4K/Retina ratio is the main fps risk.
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.75)
  renderer.setPixelRatio(pixelRatio)
  renderer.setSize(w, h, false)
  post?.setSize(w, h, pixelRatio)
  world.camera.aspect = w / h
  world.camera.updateProjectionMatrix()
}

// Body acceleration derived from successive sim frames (for camera weight cues).
let lastFrameT = 0
const accel = { surge: 0, sway: 0, heave: 0 }

const renderLoop = (): void => {
  animationFrame = requestAnimationFrame(renderLoop)
  if (!renderer || !world) return
  const r = practiceSimReadout.value
  const frames = practicePoseFrames.value
  if (!r || !frames) return
  // Glassy motion at any refresh rate: blend the sim's prev/curr snapshots by
  // wall-clock alpha instead of snapping to the latest tick.
  const livePose = interpolatePose(
    frames.prev,
    frames.curr,
    frameAlpha(frames.prev.t, frames.curr.t, performance.now())
  )
  if (frames.curr.t !== lastFrameT) {
    const fdt = Math.max((frames.curr.t - frames.prev.t) / 1000, 1e-3)
    accel.surge = (frames.curr.surgeVel - frames.prev.surgeVel) / fdt
    accel.sway = (frames.curr.swayVel - frames.prev.swayVel) / fdt
    accel.heave = (frames.curr.heaveVel - frames.prev.heaveVel) / fdt
    lastFrameT = frames.curr.t
  }

  // Replay overlay (V2 Mission Engine): in 'watch' mode the displayed vehicle
  // IS the recording; in 'ghost' mode the recording flies alongside as a
  // translucent ghost while the live sim drives the main rover.
  const replay = activeReplay.value
  const replayFrame = replay ? replay.frameNow() : null
  const watching = replayFrame !== null && replayMode.value === 'watch'
  const pose = watching
    ? {
        x: replayFrame.x ?? livePose.x,
        y: replayFrame.y ?? livePose.y,
        depth: replayFrame.depth,
        heading: replayFrame.heading,
        pitch: replayFrame.pitch,
        roll: replayFrame.roll,
      }
    : livePose
  const ghostPose =
    replayFrame !== null && replayMode.value === 'ghost'
      ? {
          x: replayFrame.x ?? livePose.x,
          y: replayFrame.y ?? livePose.y,
          depth: replayFrame.depth,
          heading: replayFrame.heading,
          pitch: replayFrame.pitch,
          roll: replayFrame.roll,
        }
      : null

  world.update(
    { x: pose.x, y: pose.y, depth: pose.depth, heading: pose.heading, pitch: pose.pitch, roll: pose.roll },
    {
      gripper: watching ? 0 : r.gripper ?? 0,
      cameraMode: cameraMode.value,
      speed: watching ? replayFrame?.speed ?? 0 : livePose.speed,
      tetherPath: watching ? undefined : r.tetherPath,
      cameraAdjust: cameraAdjust.value,
      accel: watching ? { surge: 0, sway: 0, heave: 0 } : accel,
      thrusterOutputs: watching ? replayFrame?.thrusterOutputs : r.thrusterOutputs,
      ghostPose,
    }
  )
  if (post) post.render()
  else renderer.render(world.scene, world.camera)
}

const startRenderer = (): void => {
  if (renderer || !canvas.value) return
  renderer = new THREE.WebGLRenderer({ canvas: canvas.value, antialias: true })
  renderer.setPixelRatio(window.devicePixelRatio || 1)
  // Realism pass: filmic tone mapping + soft shadows.
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  buildWorld()
  renderLoop()
}

onMounted(() => {
  widget.value.options = { showHud: true, ...widget.value.options }
  window.addEventListener('keydown', onViewKey)
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
  // Rebuild on any geometry change (preset switch, pool/ice/obstacle edits,
  // rover profile change) — tether on/off is handled live without a rebuild.
  watch([structuralSig, activeRoverProfile], () => {
    if (renderer) buildWorld()
  })
})

onBeforeUnmount(() => {
  if (animationFrame !== undefined) cancelAnimationFrame(animationFrame)
  window.removeEventListener('keydown', onViewKey)
  resizeObserver?.disconnect()
  post?.dispose()
  post = undefined
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
  cursor: grab;
  touch-action: none;
}
.render-canvas.grabbing {
  cursor: grabbing;
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
.bottom-hints .passed {
  color: rgb(110 255 160);
  font-weight: 700;
}
.bottom-hints .keys.taut {
  color: rgb(255 110 110);
  font-weight: 700;
}
.view-controls {
  position: absolute;
  top: 8px;
  right: 10px;
  z-index: 6;
}
.view-button {
  font-family: monospace;
  font-size: 0.72rem;
  color: rgb(255 255 255 / 90%);
  background-color: rgb(0 0 0 / 45%);
  border: 1px solid rgb(255 255 255 / 25%);
  border-radius: 8px;
  padding: 3px 10px;
  cursor: pointer;
}
.view-button:hover {
  background-color: rgb(0 0 0 / 65%);
}
</style>
