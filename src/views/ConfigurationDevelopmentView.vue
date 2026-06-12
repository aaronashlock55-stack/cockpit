<template>
  <BaseConfigurationView>
    <template #title>Development configuration</template>
    <template #content>
      <div
        class="max-h-[85vh] overflow-y-auto -mr-2 mb-2"
        :class="interfaceStore.isOnSmallScreen ? 'max-w-[85vw]' : 'max-w-[50vw]'"
      >
        <div
          class="flex flex-col justify-between items-center w-full"
          :class="interfaceStore.isOnSmallScreen ? 'scale-[80%] mt-0 -mb-3' : 'scale-95 mt-4'"
        >
          <div class="flex flex-row flex-wrap justify-start gap-x-[20px]">
            <v-switch
              v-model="devStore.enableBlueOsSettingsSync"
              label="BlueOS settings sync"
              color="white"
              hide-details
              class="min-w-[155px]"
              @update:model-value="reloadCockpitAndWarnUser()"
            />
            <v-switch
              v-model="devStore.enableSystemLogging"
              label="Enable system logging"
              color="white"
              hide-details
              class="min-w-[155px]"
              @update:model-value="reloadCockpitAndWarnUser()"
            />
            <v-switch
              v-model="devStore.showSplashScreenOnStartup"
              label="Show splashscreen on startup"
              color="white"
              hide-details
              class="min-w-[155px]"
            />
            <v-switch
              v-model="devStore.enableDemoMode"
              label="Practice / Demo mode (no vehicle)"
              color="white"
              hide-details
              class="min-w-[155px]"
            />
          </div>
          <div v-if="devStore.enableDemoMode" class="flex flex-col w-full mt-2 px-1 gap-y-2">
            <span class="text-xs text-gray-300">
              Rover profile used by the practice simulator — pick a preset, upload your own, or import from a connected
              vehicle. The sim then handles like that rover.
            </span>
            <div class="flex flex-row flex-wrap items-center gap-2">
              <v-select
                v-model="selectedProfileName"
                :items="profileNames"
                label="Rover profile"
                density="compact"
                variant="outlined"
                theme="dark"
                hide-details
                class="min-w-[220px] max-w-[300px]"
                @update:model-value="selectBuiltInProfile"
              />
              <v-btn variant="outlined" color="white" size="small" prepend-icon="mdi-tray-arrow-up">
                Upload
                <input type="file" accept="application/json" class="hidden-file-input" @change="onUploadProfile" />
              </v-btn>
              <v-btn
                variant="outlined"
                color="white"
                size="small"
                prepend-icon="mdi-tray-arrow-down"
                @click="onDownloadProfile"
              >
                Download
              </v-btn>
              <v-btn
                variant="outlined"
                color="white"
                size="small"
                prepend-icon="mdi-import"
                @click="onImportFromVehicle"
              >
                Import from vehicle
              </v-btn>
            </div>
            <span class="text-xs text-gray-400"
              >Active: {{ activeRoverProfile.name }} ({{ activeRoverProfile.thrusters.length }} thrusters)</span
            >
            <v-divider class="my-1" />
            <span class="text-xs text-gray-300">
              Practice environment — pool, water, ice, tether, and obstacles (e.g. the MATE 2026 ice-tank mission). Add
              the <b>PracticePoolView</b> widget to watch the rover in the pool.
            </span>
            <div class="flex flex-row flex-wrap items-center gap-2">
              <v-select
                v-model="selectedEnvName"
                :items="envNames"
                label="Environment"
                density="compact"
                variant="outlined"
                theme="dark"
                hide-details
                class="min-w-[260px] max-w-[320px]"
                @update:model-value="selectBuiltInEnv"
              />
              <v-btn variant="outlined" color="white" size="small" prepend-icon="mdi-tray-arrow-up">
                Upload
                <input type="file" accept="application/json" class="hidden-file-input" @change="onUploadEnv" />
              </v-btn>
              <v-btn
                variant="outlined"
                color="white"
                size="small"
                prepend-icon="mdi-tray-arrow-down"
                @click="downloadPracticeEnvironment(activePracticeEnvironment)"
              >
                Download
              </v-btn>
              <v-btn variant="outlined" color="white" size="small" prepend-icon="mdi-restart" @click="onResetSim">
                Reset rover
              </v-btn>
            </div>
            <div class="flex flex-row flex-wrap items-center gap-x-4 gap-y-1">
              <v-text-field
                v-model.number="activePracticeEnvironment.pool.length"
                label="Pool length (m)"
                type="number"
                density="compact"
                variant="outlined"
                theme="dark"
                hide-details
                class="max-w-[130px]"
              />
              <v-text-field
                v-model.number="activePracticeEnvironment.pool.width"
                label="Width (m)"
                type="number"
                density="compact"
                variant="outlined"
                theme="dark"
                hide-details
                class="max-w-[110px]"
              />
              <v-text-field
                v-model.number="activePracticeEnvironment.pool.depth"
                label="Depth (m)"
                type="number"
                density="compact"
                variant="outlined"
                theme="dark"
                hide-details
                class="max-w-[110px]"
              />
              <v-text-field
                v-model.number="activePracticeEnvironment.water.salinityPpt"
                label="Salinity (ppt)"
                type="number"
                density="compact"
                variant="outlined"
                theme="dark"
                hide-details
                class="max-w-[120px]"
              />
              <v-text-field
                v-model.number="activePracticeEnvironment.water.temperatureC"
                label="Water temp (°C)"
                type="number"
                density="compact"
                variant="outlined"
                theme="dark"
                hide-details
                class="max-w-[130px]"
              />
            </div>
            <div class="flex flex-row flex-wrap items-center gap-x-4 gap-y-1">
              <v-switch
                v-model="activePracticeEnvironment.tether.enabled"
                label="Tether"
                color="white"
                hide-details
                density="compact"
              />
              <v-text-field
                v-if="activePracticeEnvironment.tether.enabled"
                v-model.number="activePracticeEnvironment.tether.length"
                label="Tether length (m)"
                type="number"
                density="compact"
                variant="outlined"
                theme="dark"
                hide-details
                class="max-w-[150px]"
              />
              <span class="text-xs text-gray-400">
                {{ activePracticeEnvironment.obstacles.length }} obstacle(s)
                <template v-if="activePracticeEnvironment.iceSheet"> · ice sheet with launch hole</template>
                — edit via Download → JSON → Upload
              </span>
            </div>
            <div class="flex flex-row flex-wrap items-center gap-x-4 gap-y-1">
              <v-select
                :model-value="activePracticeEnvironment.flow?.type ?? 'none'"
                :items="flowTypes"
                label="Water motion"
                density="compact"
                variant="outlined"
                theme="dark"
                hide-details
                class="max-w-[180px]"
                @update:model-value="setFlowType"
              />
              <template v-if="activePracticeEnvironment.flow">
                <v-text-field
                  v-model.number="activePracticeEnvironment.flow.speed"
                  label="Flow speed (m/s)"
                  type="number"
                  density="compact"
                  variant="outlined"
                  theme="dark"
                  hide-details
                  class="max-w-[150px]"
                />
                <v-text-field
                  v-model.number="activePracticeEnvironment.flow.directionDeg"
                  label="Direction (°)"
                  type="number"
                  density="compact"
                  variant="outlined"
                  theme="dark"
                  hide-details
                  class="max-w-[130px]"
                />
                <span class="text-xs text-gray-400">
                  {{ flowHint }}
                </span>
              </template>
            </div>
          </div>
        </div>
        <ExpansiblePanel :is-expanded="!interfaceStore.isOnPhoneScreen" no-bottom-divider>
          <template #title>
            <div class="flex justify-between items-center">
              <span>System logs</span>
              <div class="flex items-center gap-2">
                <v-btn
                  variant="outlined"
                  color="white"
                  size="small"
                  prepend-icon="mdi-console-line"
                  @click.stop="devStore.showConsole = true"
                >
                  Open console
                </v-btn>
                <span class="text-sm text-gray-300 cursor-pointer" @click.stop="deleteOldLogs">
                  <v-tooltip text="Delete old logs">
                    <template #activator="{ props }">
                      <v-icon left class="mr-2" v-bind="props">mdi-delete-sweep</v-icon>
                    </template>
                  </v-tooltip>
                </span>
              </div>
            </div>
          </template>
          <template #content>
            <v-data-table
              :items="systemLogsData"
              density="compact"
              theme="dark"
              :headers="headers"
              class="bg-[#FFFFFF11] rounded-lg"
            >
              <template #item.name="{ item }">
                <div class="flex items-center gap-2">
                  <span>{{ item.name }}</span>
                  <div v-if="item.isCurrentSession" class="current-session-indicator" />
                </div>
              </template>
              <template #item.dateTimeMs="{ item }">
                {{ item.dateTimeFormatted }}
              </template>
              <template #item.sizeBytes="{ item }">
                {{ item.sizeFormatted }}
              </template>
              <template #item.actions="{ item }">
                <div class="flex justify-center space-x-2">
                  <div class="cursor-pointer icon-btn mdi mdi-download" @click="downloadLog(item.name)" />
                  <div class="cursor-pointer icon-btn mdi mdi-delete" @click="deleteLog(item.name)" />
                </div>
              </template>
            </v-data-table>
          </template>
        </ExpansiblePanel>
      </div>
    </template>
  </BaseConfigurationView>
</template>

<script setup lang="ts">
// @ts-nocheck
// TODO:  As of now Vuetify does not export the necessary types for VDataTable, so we can't fix the type error.

import { parse } from 'date-fns'
import { saveAs } from 'file-saver'
import { onBeforeMount, onBeforeUnmount } from 'vue'
import { computed, ref } from 'vue'

import ExpansiblePanel from '@/components/ExpansiblePanel.vue'
import { useSnackbar } from '@/composables/snackbar'
import { resetPracticeSim } from '@/libs/actions/demo-mode'
import { activePracticeEnvironment, activeRoverProfile } from '@/libs/actions/demo-mode-state'
import { downloadPracticeEnvironment, readPracticeEnvironmentFile } from '@/libs/practice-env-io'
import { downloadRoverProfile, importRoverProfileFromVehicle, readRoverProfileFile } from '@/libs/rover-profile-io'
import {
  type SystemLog,
  cockpitSytemLogsDB,
  getCurrentSessionLogFileName,
  getCurrentSessionLogInfo,
  systemLogDateTimeFormat,
} from '@/libs/system-logging'
import { formatBytes, isElectron } from '@/libs/utils'
import { reloadCockpitAndWarnUser } from '@/libs/utils-vue'
import { useAppInterfaceStore } from '@/stores/appInterface'
import { useDevelopmentStore } from '@/stores/development'
import { useMainVehicleStore } from '@/stores/mainVehicle'
import { type FlowField, builtInPracticeEnvironments } from '@/types/practice-environment'
import { builtInRoverProfiles } from '@/types/rover-profile'

import BaseConfigurationView from './BaseConfigurationView.vue'
const devStore = useDevelopmentStore()
const interfaceStore = useAppInterfaceStore()
const vehicleStore = useMainVehicleStore()
const { openSnackbar } = useSnackbar()

const selectedProfileName = ref(activeRoverProfile.value.name)
const profileNames = computed(() => {
  const names = builtInRoverProfiles.map((p) => p.name)
  if (!names.includes(activeRoverProfile.value.name)) names.unshift(activeRoverProfile.value.name)
  return names
})

const selectBuiltInProfile = (name: string): void => {
  const profile = builtInRoverProfiles.find((p) => p.name === name)
  if (profile) activeRoverProfile.value = profile
}

const onUploadProfile = async (event: Event): Promise<void> => {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  try {
    const profile = await readRoverProfileFile(file)
    activeRoverProfile.value = profile
    selectedProfileName.value = profile.name
    openSnackbar({ variant: 'success', message: `Loaded rover profile "${profile.name}".`, duration: 3000 })
  } catch (error) {
    openSnackbar({ variant: 'error', message: `${error instanceof Error ? error.message : error}`, duration: 5000 })
  }
}

const onDownloadProfile = (): void => {
  downloadRoverProfile(activeRoverProfile.value)
}

const selectedEnvName = ref(activePracticeEnvironment.value.name)
const envNames = computed(() => {
  const names = builtInPracticeEnvironments.map((e) => e.name)
  if (!names.includes(activePracticeEnvironment.value.name)) names.unshift(activePracticeEnvironment.value.name)
  return names
})

const selectBuiltInEnv = (name: string): void => {
  const env = builtInPracticeEnvironments.find((e) => e.name === name)
  if (!env) return
  activePracticeEnvironment.value = structuredClone(env)
  resetPracticeSim()
}

const onUploadEnv = async (event: Event): Promise<void> => {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  try {
    const env = await readPracticeEnvironmentFile(file)
    activePracticeEnvironment.value = env
    selectedEnvName.value = env.name
    resetPracticeSim()
    openSnackbar({ variant: 'success', message: `Loaded practice environment "${env.name}".`, duration: 3000 })
  } catch (error) {
    openSnackbar({ variant: 'error', message: `${error instanceof Error ? error.message : error}`, duration: 5000 })
  }
}

const onResetSim = (): void => {
  resetPracticeSim()
  openSnackbar({ variant: 'info', message: 'Rover reset to start position.', duration: 2000 })
}

const flowTypes = [
  { title: 'None (still water)', value: 'none' },
  { title: 'Steady current', value: 'current' },
  { title: 'Wave pool', value: 'waves' },
  { title: 'Jet stream', value: 'jet' },
]

const flowHint = computed(() => {
  const f = activePracticeEnvironment.value.flow
  if (!f) return ''
  if (f.type === 'waves') return 'Surface chop — strongest near the top, calms with depth.'
  if (f.type === 'jet') return 'Fast band across the pool middle; the rest is calm.'
  return 'Uniform push across the whole pool.'
})

const setFlowType = (type: string): void => {
  const env = activePracticeEnvironment.value
  if (type === 'none') {
    env.flow = undefined
    return
  }
  const speed = env.flow?.speed ?? (type === 'jet' ? 1.1 : 0.6)
  const directionDeg = env.flow?.directionDeg ?? (type === 'jet' ? 90 : 0)
  const flow: FlowField = { type: type as FlowField['type'], speed, directionDeg }
  if (type === 'jet') {
    flow.jetCenter = env.flow?.jetCenter ?? env.pool.width / 2
    flow.jetWidth = env.flow?.jetWidth ?? Math.max(2, env.pool.width / 4)
  }
  env.flow = flow
}

const onImportFromVehicle = (): void => {
  if (!vehicleStore.isVehicleOnline) {
    openSnackbar({ variant: 'warning', message: 'No vehicle connected to import from.', duration: 4000 })
    return
  }
  const profile = importRoverProfileFromVehicle(vehicleStore.icon ?? undefined)
  activeRoverProfile.value = profile
  selectedProfileName.value = profile.name
  openSnackbar({
    variant: 'success',
    message: `Imported "${profile.name}" from the connected vehicle.`,
    duration: 3000,
  })
}

/* eslint-disable jsdoc/require-jsdoc */
interface SystemLogsData {
  name: string
  dateTimeFormatted: string
  sizeFormatted: string
  sizeBytes: number
  dateTimeMs: number
  isCurrentSession: boolean
}
/* eslint-enable jsdoc/require-jsdoc */

const systemLogsData = ref<SystemLogsData[]>([])
const isRunningInElectron = isElectron()
const currentSessionLogFileName = ref<string | null>(null)
let updateInterval: ReturnType<typeof setInterval> | null = null

/* eslint-disable jsdoc/require-jsdoc */
interface CurrentLogInfo {
  fileName: string
  size: number
}
/* eslint-enable jsdoc/require-jsdoc */

const headers = [
  { title: 'Name', key: 'name', sortable: false },
  { title: 'Date/Time', key: 'dateTimeMs', sortable: true },
  { title: 'Size', key: 'sizeBytes', sortable: true },
  { title: 'Actions', key: 'actions', sortable: false },
]

const updateCurrentSessionLogSize = async (): Promise<void> => {
  if (!currentSessionLogFileName.value) {
    return
  }

  try {
    let logInfo: CurrentLogInfo | null = null

    if (isRunningInElectron) {
      // Get current log info (name and size) directly
      logInfo = (await window.electronAPI?.getCurrentElectronLogInfo()) ?? null
    } else {
      // Get current log info from IndexedDB
      logInfo = await getCurrentSessionLogInfo()
    }

    if (logInfo && logInfo.fileName === currentSessionLogFileName.value) {
      // Update the size in systemLogsData
      const index = systemLogsData.value.findIndex((log) => log.name === currentSessionLogFileName.value)
      if (index !== -1) {
        systemLogsData.value[index].sizeBytes = logInfo.size
        if (isRunningInElectron) {
          systemLogsData.value[index].sizeFormatted = formatBytes(logInfo.size)
        } else {
          // For web version, show event count
          systemLogsData.value[index].sizeFormatted = `${logInfo.size} event${logInfo.size !== 1 ? 's' : ''}`
        }
      }
    }
  } catch (error) {
    // Silently fail - don't spam console with errors
  }
}

onBeforeMount(async () => {
  // Get the current session's log file name
  if (isRunningInElectron) {
    const logInfo = await window.electronAPI?.getCurrentElectronLogInfo()
    currentSessionLogFileName.value = logInfo?.fileName ?? null
    await loadElectronLogs()
  } else {
    currentSessionLogFileName.value = getCurrentSessionLogFileName()
    await loadIndexedDBLogs()
  }

  // Start updating the current session log size every second
  updateInterval = setInterval(updateCurrentSessionLogSize, 1000)
})

onBeforeUnmount(() => {
  if (updateInterval) {
    clearInterval(updateInterval)
    updateInterval = null
  }
})

const loadElectronLogs = async (): Promise<void> => {
  try {
    const electronLogs = await window.electronAPI?.getElectronLogs()
    if (electronLogs) {
      const dateTimeFormatWithoutOffset = systemLogDateTimeFormat.replace(' O', '')
      const logs = electronLogs.map((log) => {
        const dateTimeString = log.path.split('(')[1]?.split(' GMT')[0] ?? ''
        const dateTime = parse(dateTimeString, dateTimeFormatWithoutOffset, new Date())
        return {
          name: log.path,
          dateTimeFormatted: `${log.initialDate} - ${log.initialTime}`,
          sizeFormatted: formatBytes(log.size),
          sizeBytes: log.size,
          dateTimeMs: dateTime.getTime(),
          isCurrentSession: log.path === currentSessionLogFileName.value,
        }
      })
      systemLogsData.value = getSortedLogs(logs)
    }
  } catch (error) {
    console.error('Error loading electron logs:', error)
  }
}

const loadIndexedDBLogs = async (): Promise<void> => {
  const logs: SystemLogsData[] = []
  const dateTimeFormatWithoutOffset = systemLogDateTimeFormat.replace(' O', '')
  await cockpitSytemLogsDB.iterate((log: SystemLog, logName) => {
    // Use event count for web version (lighter than estimating size)
    const eventCount = log.events.length
    const dateTimeString = logName.split('(')[1]?.split(' GMT')[0] ?? ''
    const dateTime = parse(dateTimeString, dateTimeFormatWithoutOffset, new Date())
    logs.push({
      name: logName,
      dateTimeFormatted: `${log.initialDate} - ${log.initialTime}`,
      sizeFormatted: `${eventCount} event${eventCount !== 1 ? 's' : ''}`,
      sizeBytes: eventCount, // Use event count for sorting
      dateTimeMs: dateTime.getTime(),
      isCurrentSession: logName === currentSessionLogFileName.value,
    })
  })
  systemLogsData.value = getSortedLogs(logs)
}

const getSortedLogs = (logs: SystemLogsData[]): SystemLogsData[] => {
  return logs.sort((a, b) => b.dateTimeMs - a.dateTimeMs)
}

const downloadLog = async (logName: string): Promise<void> => {
  try {
    if (isRunningInElectron) {
      await downloadLogFromElectron(logName)
    } else {
      await downloadLogFromDB(logName)
    }
  } catch (error) {
    console.error('Error downloading log:', error)
  }
}

const downloadLogFromElectron = async (logName: string): Promise<void> => {
  try {
    const content = await window.electronAPI?.getElectronLogContent(logName)
    if (!content) {
      throw new Error('Failed to get electron log content')
    }

    const logBlob = new Blob([content], { type: 'text/plain' })
    saveAs(logBlob, logName)
  } catch (error) {
    console.error('Error downloading electron log:', error)
    throw error
  }
}

const downloadLogFromDB = async (logName: string): Promise<void> => {
  const log = await cockpitSytemLogsDB.getItem(logName)
  const logParts = JSON.stringify(log, null, 2)
  const logBlob = new Blob([logParts], { type: 'application/json' })
  saveAs(logBlob, logName)
}

const deleteLog = async (logName: string): Promise<void> => {
  try {
    if (isRunningInElectron) {
      // Delete from electron-log
      await window.electronAPI?.deleteElectronLog(logName)
      systemLogsData.value = systemLogsData.value.filter((log) => log.name !== logName)
    } else {
      // Delete from IndexedDB
      await cockpitSytemLogsDB.removeItem(logName)
      systemLogsData.value = systemLogsData.value.filter((log) => log.name !== logName)
    }
  } catch (error) {
    console.error('Error deleting log:', error)
  }
}

const deleteOldLogs = async (): Promise<void> => {
  try {
    if (isRunningInElectron) {
      // Delete old logs from electron-log
      const deletedFiles = await window.electronAPI?.deleteOldElectronLogs()
      if (deletedFiles) {
        systemLogsData.value = systemLogsData.value.filter((log) => !deletedFiles.includes(log.name))
      }
    } else {
      await deleteOldLogsFromDB()
    }
  } catch (error) {
    console.error('Error deleting old logs:', error)
  }
}

const deleteOldLogsFromDB = async (): Promise<void> => {
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)

  const logsToDelete: string[] = []
  await cockpitSytemLogsDB.iterate((log: SystemLog, logName: string) => {
    const logDate = new Date(log.initialDate)
    if (logDate < yesterday) {
      logsToDelete.push(logName)
    }
  })

  for (const logName of logsToDelete) {
    await cockpitSytemLogsDB.removeItem(logName)
  }

  systemLogsData.value = systemLogsData.value.filter((log) => {
    const logDate = new Date(log.initialDate)
    return logDate >= yesterday
  })
}
</script>
<style scoped>
.custom-header {
  background-color: #333 !important;
  color: #fff;
}

.hidden-file-input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

.current-session-indicator {
  width: 8px;
  height: 8px;
  margin-top: 2px;
  border-radius: 50%;
  background-color: #ef4444;
  animation: blink 1.5s infinite;
}

@keyframes blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.3;
  }
}
</style>
