<template>
  <div class="pilot-assist">
    <v-btn
      v-for="m in availableAssistModes"
      :key="m.key"
      size="x-small"
      variant="flat"
      class="assist-btn"
      :class="{ 'assist-active': currentMode === m.key }"
      :disabled="!vehicleStore.isVehicleOnline"
      @click="setMode(m.key)"
    >
      <v-icon size="14" start>{{ m.icon }}</v-icon>
      {{ m.label }}
    </v-btn>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

import { useMainVehicleStore } from '@/stores/mainVehicle'

const vehicleStore = useMainVehicleStore()

// Curated, friendly pilot-assist modes (ArduSub). Keyed by the enum name the
// vehicle reports; only those actually available on the connected vehicle show.
const assistModes = [
  { key: 'MANUAL', label: 'Manual', icon: 'mdi-hand-back-right' },
  { key: 'STABILIZE', label: 'Stabilize', icon: 'mdi-axis-arrow' },
  { key: 'ALT_HOLD', label: 'Depth Hold', icon: 'mdi-arrow-collapse-vertical' },
  { key: 'POSHOLD', label: 'Position Hold', icon: 'mdi-map-marker-radius' },
  { key: 'ACRO', label: 'Acro', icon: 'mdi-rotate-3d-variant' },
  { key: 'SURFACE', label: 'Surface', icon: 'mdi-arrow-up-bold' },
]

const availableAssistModes = computed(() => {
  const available = vehicleStore.modesAvailable()
  return assistModes.filter((m) => available.includes(m.key))
})

const currentMode = ref<string | undefined>(undefined)
let modePollInterval: ReturnType<typeof setInterval> | undefined

const setMode = (modeKey: string): void => {
  if (modeKey === vehicleStore.mode) return
  vehicleStore.setFlightMode(modeKey)
}

onMounted(() => {
  modePollInterval = setInterval(() => (currentMode.value = vehicleStore.mode), 500)
})
onUnmounted(() => clearInterval(modePollInterval))
</script>

<style scoped>
.pilot-assist {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
  padding: 2px 4px;
}
.assist-btn {
  color: #fff;
  background-color: rgb(255 255 255 / 10%);
  text-transform: none;
  letter-spacing: normal;
}
.assist-active {
  background-color: rgb(94 192 255 / 90%);
  color: #0b1f2a;
  font-weight: 700;
}
</style>
