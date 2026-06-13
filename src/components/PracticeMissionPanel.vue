<template>
  <div class="mission-panel" :class="{ open }">
    <button class="panel-toggle" @click="open = !open">{{ open ? '✕' : '🎛 Mission' }}</button>
    <div v-if="open" class="panel-body">
      <!-- Recording status / save -->
      <div class="section">
        <div class="row">
          <span class="rec-dot">●</span>
          <span>recording this run</span>
          <button class="mini" title="Save the run so far and start a fresh one" @click="saveRunNow">✂ Save run</button>
        </div>
      </div>

      <!-- Stored runs -->
      <div class="section">
        <div class="section-title">Runs (practice + real dives)</div>
        <select v-model="selectedId" class="run-select">
          <option v-for="log in logs" :key="log.id" :value="log.id">
            {{ log.source === 'vehicle' ? '🌊' : '🎮' }} {{ log.name }} · {{ Math.round(log.durationS) }}s
          </option>
        </select>
        <div class="row">
          <button class="mini" :disabled="!selectedId" @click="startReplay('watch')">▶ Watch</button>
          <button class="mini" :disabled="!selectedId" @click="startReplay('ghost')">👻 Ghost</button>
          <button class="mini" :disabled="!selectedId" @click="exportSelected">💾</button>
          <button class="mini" @click="importInput?.click()">📂</button>
          <button class="mini danger" :disabled="!selectedId" @click="deleteSelected">🗑</button>
        </div>
        <input ref="importInput" type="file" accept=".json" class="hidden-input" @change="importFile" />
      </div>

      <!-- Replay transport -->
      <div v-if="replay" class="section">
        <div class="section-title">Replay — {{ replayMode === 'watch' ? 'watching' : 'ghost race' }}</div>
        <div class="row">
          <button class="mini" @click="replay.playing ? replay.pause() : replay.play()">
            {{ replay.playing ? '⏸' : '▶' }}
          </button>
          <select class="speed-select" :value="replay.speed" @change="setSpeed">
            <option :value="0.5">0.5×</option>
            <option :value="1">1×</option>
            <option :value="2">2×</option>
            <option :value="4">4×</option>
          </select>
          <span class="time">{{ replay.timeS.toFixed(1) }} / {{ replay.duration.toFixed(1) }}s</span>
        </div>
        <input
          type="range"
          class="scrub"
          min="0"
          :max="replay.duration"
          step="0.1"
          :value="replay.timeS"
          @input="scrub"
        />
        <div class="row">
          <button
            class="mini"
            title="Take control of the vehicle right here (reposition + unfreeze)"
            @click="reflyHere"
          >
            ⏎ Re-fly from here
          </button>
          <button class="mini" @click="endReplay">✕ End replay</button>
        </div>
      </div>

      <!-- Instructor (failure injection) -->
      <div class="section">
        <div class="section-title">Instructor</div>
        <div class="row wrap">
          <label v-for="(t, i) in thrusters" :key="i" class="thruster-box" :title="`Fail thruster ${i + 1}`">
            <input type="checkbox" :checked="instructor.disabledThrusters.includes(i)" @change="toggleThruster(i)" />
            T{{ i + 1 }}
          </label>
        </div>
        <div class="row">
          <span class="lbl">Thrust {{ Math.round(instructor.thrustScale * 100) }}%</span>
          <input type="range" min="0.2" max="1" step="0.05" :value="instructor.thrustScale" @input="setThrust" />
        </div>
        <div class="row">
          <span class="lbl">Leak {{ instructor.extraBallastN.toFixed(0) }} N</span>
          <input type="range" min="0" max="20" step="1" :value="instructor.extraBallastN" @input="setBallast" />
        </div>
        <div class="row">
          <button class="mini" :class="{ active: instructor.frozen }" @click="instructor.frozen = !instructor.frozen">
            {{ instructor.frozen ? '▶ Unfreeze' : '⏸ Freeze' }}
          </button>
          <button class="mini" @click="resetInstructorState">Reset failures</button>
        </div>
      </div>

      <!-- Debrief -->
      <div v-if="lastDiveSummary" class="section">
        <div class="section-title">Last run — {{ lastDiveSummary.name }}</div>
        <div class="row wrap metrics">
          <span>⏱ {{ lastDiveSummary.durationS }}s</span>
          <span>📏 {{ lastDiveSummary.distanceM }}m</span>
          <span>⌀ {{ lastDiveSummary.avgSpeedMs }}m/s</span>
          <span :class="{ bad: lastDiveSummary.collisions > 0 }">💥 {{ lastDiveSummary.collisions }}</span>
          <span>🎯 {{ lastDiveSummary.hoopsPassed }}</span>
          <span>✊ {{ lastDiveSummary.grabs }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'

import { finishPracticeRun, repositionPracticeSim, resetPracticeSim } from '@/libs/actions/demo-mode'
import { activePracticeEnvironment, activeRoverProfile } from '@/libs/actions/demo-mode-state'
import {
  activeReplay,
  diveLogsVersion,
  instructorState,
  lastDiveSummary,
  replayMode,
  resetInstructorState,
} from '@/libs/actions/dive-session-state'
import {
  deleteDiveLog,
  exportDiveLogText,
  importDiveLogText,
  listDiveLogs,
  loadDiveLog,
  saveDiveLog,
} from '@/libs/dive-recorder'
import { type Replay, createReplay } from '@/libs/dive-replay'
import { type DiveLogSummary } from '@/types/dive-log'
import { type PracticeEnvironment } from '@/types/practice-environment'

const open = ref(false)
const logs = ref<DiveLogSummary[]>([])
const selectedId = ref<string>('')
const importInput = ref<HTMLInputElement>()
// The live world to return to after replaying a run recorded in a DIFFERENT course.
const envBeforeReplay = ref<PracticeEnvironment | null>(null)

const replay = computed(() => activeReplay.value)
const instructor = computed(() => instructorState.value)
const thrusters = computed(() => activeRoverProfile.value.thrusters)

const refreshLogs = async (): Promise<void> => {
  logs.value = await listDiveLogs()
  if (!selectedId.value && logs.value.length > 0) selectedId.value = logs.value[0].id
}
onMounted(refreshLogs)
watch(diveLogsVersion, refreshLogs)
watch(open, (isOpen) => isOpen && refreshLogs())

const saveRunNow = (): void => finishPracticeRun()

const startReplay = async (mode: 'watch' | 'ghost'): Promise<void> => {
  const log = await loadDiveLog(selectedId.value)
  if (!log) return
  // Practice logs carry their world: load it so the ghost flies the same
  // course, remembering the live world so we can return to it afterward.
  if (log.environment && log.environment.name !== activePracticeEnvironment.value.name) {
    envBeforeReplay.value = structuredClone(activePracticeEnvironment.value)
    activePracticeEnvironment.value = structuredClone(log.environment)
    resetPracticeSim()
  }
  const session = reactive(createReplay(log)) as Replay
  activeReplay.value = session
  replayMode.value = mode
  instructorState.value.frozen = mode === 'watch' // watching pauses your own vehicle
  session.play()
}

const endReplay = (): void => {
  activeReplay.value = null
  replayMode.value = null
  instructorState.value.frozen = false
  // Return to the course the pilot was flying before a cross-course replay.
  if (envBeforeReplay.value) {
    activePracticeEnvironment.value = envBeforeReplay.value
    envBeforeReplay.value = null
    resetPracticeSim()
  }
}

const reflyHere = (): void => {
  const session = activeReplay.value
  if (!session) return
  session.pause()
  repositionPracticeSim(session.frameNow())
  // Keep the RECORDED course and take over right here (don't snap back to the
  // previous world — the reposition pose is in this world's coordinates).
  envBeforeReplay.value = null
  endReplay()
}

const scrub = (event: Event): void => {
  activeReplay.value?.seek(Number((event.target as HTMLInputElement).value))
}
const setSpeed = (event: Event): void => {
  activeReplay.value?.setSpeed(Number((event.target as HTMLSelectElement).value))
}

const toggleThruster = (index: number): void => {
  const list = instructorState.value.disabledThrusters
  instructorState.value.disabledThrusters = list.includes(index) ? list.filter((i) => i !== index) : [...list, index]
}
const setThrust = (event: Event): void => {
  instructorState.value.thrustScale = Number((event.target as HTMLInputElement).value)
}
const setBallast = (event: Event): void => {
  instructorState.value.extraBallastN = Number((event.target as HTMLInputElement).value)
}

const exportSelected = async (): Promise<void> => {
  const log = await loadDiveLog(selectedId.value)
  if (!log) return
  const blob = new Blob([exportDiveLogText(log)], { type: 'application/json' })
  const anchor = document.createElement('a')
  anchor.href = URL.createObjectURL(blob)
  anchor.download = `${log.name.replace(/[^\w\- ]+/g, '')}.dive.json`
  anchor.click()
  URL.revokeObjectURL(anchor.href)
}

const importFile = async (event: Event): Promise<void> => {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  try {
    const log = importDiveLogText(await file.text())
    await saveDiveLog(log)
    diveLogsVersion.value++
    selectedId.value = log.id
  } catch (error) {
    console.error('Could not import dive log:', error)
  } finally {
    if (importInput.value) importInput.value.value = ''
  }
}

const deleteSelected = async (): Promise<void> => {
  await deleteDiveLog(selectedId.value)
  selectedId.value = ''
  diveLogsVersion.value++
}
</script>

<style scoped>
.mission-panel {
  position: absolute;
  top: 8px;
  left: 10px;
  z-index: 7;
  font-family: monospace;
  font-size: 0.72rem;
  color: rgb(255 255 255 / 90%);
}
.panel-toggle {
  background-color: rgb(0 0 0 / 45%);
  border: 1px solid rgb(255 255 255 / 25%);
  border-radius: 8px;
  padding: 3px 10px;
  cursor: pointer;
  color: inherit;
}
.panel-toggle:hover {
  background-color: rgb(0 0 0 / 65%);
}
.panel-body {
  margin-top: 6px;
  width: 252px;
  max-height: calc(100% - 60px);
  overflow-y: auto;
  background-color: rgb(0 0 0 / 60%);
  border: 1px solid rgb(255 255 255 / 20%);
  border-radius: 10px;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.section-title {
  font-weight: 700;
  color: rgb(140 220 255);
}
.row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.row.wrap {
  flex-wrap: wrap;
}
.mini {
  background-color: rgb(255 255 255 / 12%);
  border: 1px solid rgb(255 255 255 / 25%);
  border-radius: 6px;
  padding: 2px 7px;
  cursor: pointer;
  color: inherit;
  font-family: inherit;
  font-size: inherit;
}
.mini:hover:not(:disabled) {
  background-color: rgb(255 255 255 / 22%);
}
.mini:disabled {
  opacity: 0.4;
  cursor: default;
}
.mini.active {
  background-color: rgb(255 170 60 / 45%);
}
.mini.danger:hover:not(:disabled) {
  background-color: rgb(255 80 80 / 45%);
}
.rec-dot {
  color: rgb(255 90 90);
  animation: blink 1.6s infinite;
}
@keyframes blink {
  50% {
    opacity: 0.25;
  }
}
.run-select,
.speed-select {
  width: 100%;
  background-color: rgb(20 40 52);
  color: inherit;
  border: 1px solid rgb(255 255 255 / 25%);
  border-radius: 6px;
  padding: 2px 4px;
  font-family: inherit;
  font-size: inherit;
}
.speed-select {
  width: auto;
}
.scrub {
  width: 100%;
}
.time {
  margin-left: auto;
  opacity: 0.8;
}
.lbl {
  min-width: 86px;
}
.thruster-box {
  display: flex;
  align-items: center;
  gap: 2px;
  cursor: pointer;
}
.metrics span {
  background-color: rgb(255 255 255 / 10%);
  border-radius: 6px;
  padding: 1px 6px;
}
.metrics .bad {
  background-color: rgb(255 80 80 / 35%);
}
.hidden-input {
  display: none;
}
</style>
