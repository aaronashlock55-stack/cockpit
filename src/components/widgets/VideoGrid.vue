<template>
  <div class="video-grid-widget">
    <div v-if="streams.length === 0" class="empty-state">
      <span>No video streams configured.</span>
      <span class="text-sm opacity-70">Configure streams in the Video page or connect to a vehicle.</span>
    </div>
    <template v-else>
      <!-- Layout mode switcher -->
      <div class="mode-switcher">
        <v-btn
          v-for="mode in layoutModes"
          :key="mode.value"
          :icon="mode.icon"
          size="x-small"
          variant="text"
          :class="{ 'mode-active': widget.options.layoutMode === mode.value }"
          @click.stop="widget.options.layoutMode = mode.value"
        />
        <v-btn
          icon="mdi-gauge"
          size="x-small"
          variant="text"
          :class="{ 'mode-active': widget.options.showHud }"
          @click.stop="widget.options.showHud = !widget.options.showHud"
        />
      </div>
      <!-- Grid mode: all feeds tiled equally. PiP/Focused: active feed full-bleed. -->
      <div class="feeds-container" :class="widget.options.layoutMode" :style="gridStyle">
        <div
          v-for="stream in visibleStreams"
          :key="stream.name"
          class="feed-tile"
          :class="{ 'feed-active': stream.name === activeStreamName, 'feed-main': isMainFeed(stream.name) }"
          @click="onTileClick(stream.name)"
        >
          <video
            :ref="(el) => setVideoRef(stream.name, el as HTMLVideoElement | null)"
            muted
            autoplay
            playsinline
            disablePictureInPicture
          />
          <span class="feed-label">{{ stream.name }}</span>
          <VideoHudOverlay v-if="widget.options.showHud && stream.name === activeStreamName" />
          <div v-if="!connectedStreams[stream.name]" class="feed-connecting">
            <v-progress-circular indeterminate size="22" width="2" />
          </div>
        </div>
        <!-- PiP thumbnails of the non-active feeds -->
        <div v-if="widget.options.layoutMode === 'pip' && otherStreams.length > 0" class="pip-thumbnails">
          <div
            v-for="stream in otherStreams"
            :key="stream.name"
            class="feed-tile pip-thumb"
            @click.stop="videoStore.setActiveStream(stream.name)"
          >
            <video
              :ref="(el) => setVideoRef(stream.name, el as HTMLVideoElement | null)"
              muted
              autoplay
              playsinline
              disablePictureInPicture
            />
            <span class="feed-label">{{ stream.name }}</span>
          </div>
        </div>
      </div>
      <!-- Focused mode indicator -->
      <div v-if="widget.options.layoutMode === 'focused' && streams.length > 1" class="focused-indicator">
        {{ activeStreamPosition }} — press your 'Cycle video stream' button or click to switch
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeMount, onBeforeUnmount, reactive, toRefs } from 'vue'

import VideoHudOverlay from '@/components/VideoHudOverlay.vue'
import { useVideoStore } from '@/stores/video'
import type { Widget } from '@/types/widgets'

const videoStore = useVideoStore()

const props = defineProps<{
  /**
   * Widget reference
   */
  widget: Widget
}>()

const widget = toRefs(props).widget

const layoutModes = [
  { value: 'grid', icon: 'mdi-view-grid' },
  { value: 'pip', icon: 'mdi-picture-in-picture-bottom-right' },
  { value: 'focused', icon: 'mdi-fullscreen' },
]

onBeforeMount(() => {
  const defaultOptions = { layoutMode: 'grid', showHud: false }
  widget.value.options = { ...defaultOptions, ...widget.value.options }
})

const streams = computed(() => videoStore.streamsCorrespondency)
const activeStreamName = computed(() => videoStore.activeStreamName)

const otherStreams = computed(() => streams.value.filter((stream) => stream.name !== activeStreamName.value))

const visibleStreams = computed(() => {
  if (widget.value.options.layoutMode === 'grid') return streams.value
  // PiP and focused modes render the active stream as the main feed
  return streams.value.filter((stream) => stream.name === activeStreamName.value)
})

const isMainFeed = (name: string): boolean => {
  return widget.value.options.layoutMode !== 'grid' && name === activeStreamName.value
}

const activeStreamPosition = computed(() => {
  const names = streams.value.map((stream) => stream.name)
  const index = activeStreamName.value ? names.indexOf(activeStreamName.value) : -1
  return `${index + 1}/${names.length} · ${activeStreamName.value ?? ''}`
})

const gridStyle = computed(() => {
  if (widget.value.options.layoutMode !== 'grid') return {}
  const columns = Math.ceil(Math.sqrt(streams.value.length))
  return { 'grid-template-columns': `repeat(${columns}, minmax(0, 1fr))` }
})

// Clicking a tile makes it the active feed; in focused mode, clicking the
// (only visible) main feed advances to the next stream instead.
const onTileClick = (name: string): void => {
  if (widget.value.options.layoutMode === 'focused' && name === activeStreamName.value) {
    videoStore.cycleActiveStream()
    return
  }
  videoStore.setActiveStream(name)
}

const videoElements = new Map<string, HTMLVideoElement>()
const attachedMediaStreams = new Map<string, MediaStream | undefined>()
const connectedStreams = reactive<Record<string, boolean>>({})

const setVideoRef = (name: string, el: HTMLVideoElement | null): void => {
  if (el === null) {
    videoElements.delete(name)
    attachedMediaStreams.delete(name)
    return
  }
  videoElements.set(name, el)
}

// Mirror VideoPlayer's connection routine: poll for MediaStream availability and
// (re)attach to the corresponding video element whenever the stream object changes.
const streamConnectionRoutine = setInterval(() => {
  // Default the active stream to the first available one
  if (activeStreamName.value === undefined && streams.value.length > 0) {
    videoStore.setActiveStream(streams.value[0].name)
  }

  for (const stream of streams.value) {
    const element = videoElements.get(stream.name)
    if (!element) continue

    const mediaStream = videoStore.getMediaStream(stream.externalId)
    connectedStreams[stream.name] = videoStore.getStreamData(stream.externalId)?.connected ?? false

    if (mediaStream !== attachedMediaStreams.get(stream.name) || (mediaStream && element.srcObject !== mediaStream)) {
      attachedMediaStreams.set(stream.name, mediaStream)
      element.srcObject = mediaStream ?? null
      if (mediaStream) {
        element.play().catch((reason) => console.error(`[VideoGrid] Failed to play stream '${stream.name}':`, reason))
      }
    }
  }
}, 1000)

onBeforeUnmount(() => {
  clearInterval(streamConnectionRoutine)
})
</script>

<style scoped>
.video-grid-widget {
  width: 100%;
  height: 100%;
  position: relative;
  background-color: rgb(20 28 36);
}
.empty-state {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  align-items: center;
  justify-content: center;
  color: white;
  text-align: center;
  padding: 1rem;
}
.mode-switcher {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 10;
  display: flex;
  gap: 2px;
  padding: 2px;
  border-radius: 8px;
  background-color: rgb(0 0 0 / 45%);
  color: white;
  opacity: 0.35;
  transition: opacity 0.15s;
}
.video-grid-widget:hover .mode-switcher {
  opacity: 1;
}
.mode-active {
  background-color: rgb(255 255 255 / 25%);
}
.feeds-container {
  width: 100%;
  height: 100%;
}
.feeds-container.grid {
  display: grid;
  gap: 4px;
  padding: 4px;
}
.feeds-container.pip,
.feeds-container.focused {
  position: relative;
}
.feed-tile {
  position: relative;
  overflow: hidden;
  border-radius: 6px;
  border: 2px solid transparent;
  cursor: pointer;
  background-color: rgb(0 0 0 / 60%);
  min-height: 0;
}
.feed-tile video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.grid .feed-active {
  border-color: rgb(70 160 255);
}
.feed-main {
  position: absolute;
  inset: 0;
  border-radius: 0;
  cursor: default;
}
.focused .feed-main {
  cursor: pointer;
}
.feed-label {
  position: absolute;
  bottom: 4px;
  left: 6px;
  z-index: 2;
  font-size: 0.75rem;
  color: white;
  padding: 1px 6px;
  border-radius: 4px;
  background-color: rgb(0 0 0 / 55%);
  pointer-events: none;
}
.feed-connecting {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
}
.pip-thumbnails {
  position: absolute;
  right: 8px;
  bottom: 8px;
  z-index: 5;
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 22%;
  max-width: 260px;
}
.pip-thumb {
  aspect-ratio: 16 / 9;
  border: 1px solid rgb(255 255 255 / 40%);
  box-shadow: 0 2px 8px rgb(0 0 0 / 50%);
}
.focused-indicator {
  position: absolute;
  bottom: 8px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 5;
  font-size: 0.75rem;
  color: white;
  padding: 2px 10px;
  border-radius: 10px;
  background-color: rgb(0 0 0 / 45%);
  white-space: nowrap;
  pointer-events: none;
}
</style>
