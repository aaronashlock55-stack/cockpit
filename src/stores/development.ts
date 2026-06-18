import { useStorage } from '@vueuse/core'
import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

import { useBlueOsStorage } from '@/composables/settingsSyncer'
import { startDemoMode, stopDemoMode } from '@/libs/actions/demo-mode'
import { defaultShareHardwareDetails, shareHardwareDetailsKey } from '@/libs/external-telemetry/event-tracking'
import { settingsManager } from '@/libs/settings-management'

export const systemLoggingEnablingKey = 'cockpit-enable-system-logging'
export const blueOsSettingsSyncEnablingKey = 'cockpit-enable-blueos-settings-sync'
export const showSplashScreenOnStartupKey = 'cockpit-show-splash-screen-on-startup'
export const demoModeEnablingKey = 'cockpit-demo-mode'

export const useDevelopmentStore = defineStore('development', () => {
  // Whether the floating console window is open. Kept here (not in a view) so the console stays alive while
  // the user navigates away from the Dev settings menu.
  const showConsole = ref(false)
  const enableSystemLogging = useBlueOsStorage(systemLoggingEnablingKey, true)
  const enableBlueOsSettingsSync = useStorage(blueOsSettingsSyncEnablingKey, true)
  const showSplashScreenOnStartup = useStorage(showSplashScreenOnStartupKey, true)

  // Practice / Demo mode: simulate a vehicle so Cockpit is fully usable with no hardware.
  const enableDemoMode = useStorage(demoModeEnablingKey, false)
  watch(enableDemoMode, (on) => (on ? startDemoMode() : stopDemoMode()))
  if (enableDemoMode.value) {
    // Defer so the vehicle store / pinia are ready on a fresh reload with demo already on.
    setTimeout(() => startDemoMode(), 0)
  }

  const shareHardwareDetails = ref<boolean>(
    settingsManager.getKeyValue<boolean>(shareHardwareDetailsKey) ?? defaultShareHardwareDetails
  )
  watch(shareHardwareDetails, (newValue) => {
    settingsManager.setKeyValue(shareHardwareDetailsKey, newValue, Date.now())
  })
  settingsManager.registerListener(shareHardwareDetailsKey, (newSetting) => {
    const newValue = newSetting.value as boolean
    if (newValue !== shareHardwareDetails.value) shareHardwareDetails.value = newValue
  })

  return {
    showConsole,
    enableSystemLogging,
    enableBlueOsSettingsSync,
    shareHardwareDetails,
    showSplashScreenOnStartup,
    enableDemoMode,
  }
})
