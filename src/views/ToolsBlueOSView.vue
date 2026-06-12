<template>
  <BaseConfigurationView>
    <template #title>BlueOS — vehicle system</template>
    <template #content>
      <div class="blueos-embed" :class="interfaceStore.isOnSmallScreen ? 'w-[92vw] h-[70vh]' : 'w-[86vw] h-[78vh]'">
        <div class="address-bar">
          <input
            v-model="addressInput"
            class="address-input"
            placeholder="Vehicle address, e.g. blueos.local or 192.168.2.2"
            @keydown.enter="load"
          />
          <button class="bar-button" @click="load">Connect</button>
          <button class="bar-button" :disabled="!frameSrc" @click="reload">Reload</button>
          <button class="bar-button" :disabled="!frameSrc" @click="openExternal">Open in window ↗</button>
        </div>
        <iframe v-if="frameSrc" :key="frameKey" :src="frameSrc" class="blueos-frame" title="BlueOS vehicle interface" />
        <div v-else class="placeholder">
          <p class="text-lg">Your vehicle's BlueOS interface, inside Cockpit.</p>
          <p class="opacity-75">
            Enter the vehicle address above (the same one Cockpit connects to) and hit <b>Connect</b> — motor setup,
            parameters, networking and the rest of BlueOS appear right here. No browser needed.
          </p>
        </div>
      </div>
    </template>
  </BaseConfigurationView>
</template>

<script setup lang="ts">
import { useStorage } from '@vueuse/core'
import { onMounted, ref } from 'vue'

import { useAppInterfaceStore } from '@/stores/appInterface'
import { useMainVehicleStore } from '@/stores/mainVehicle'

import BaseConfigurationView from './BaseConfigurationView.vue'

const interfaceStore = useAppInterfaceStore()
const vehicleStore = useMainVehicleStore()

// Last address the user connected the embedded BlueOS to (falls back to the
// vehicle address Cockpit itself is using).
const savedAddress = useStorage('cockpit-blueos-embed-address', '')
const addressInput = ref('')
const frameSrc = ref('')
const frameKey = ref(0)

/**
 * Normalize a user-typed address into a URL the BlueOS UI is served on.
 * @param {string} address Host, host:port, or full URL.
 * @returns {string} A loadable URL, or empty when the input is empty.
 */
const toUrl = (address: string): string => {
  const trimmed = address.trim()
  if (trimmed === '') return ''
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `http://${trimmed}/`
}

const load = (): void => {
  const url = toUrl(addressInput.value)
  if (url === '') return
  savedAddress.value = addressInput.value.trim()
  frameSrc.value = url
  frameKey.value += 1
}

const reload = (): void => {
  frameKey.value += 1
}

const openExternal = (): void => {
  window.open(frameSrc.value, '_blank')
}

onMounted(() => {
  addressInput.value = savedAddress.value !== '' ? savedAddress.value : vehicleStore.globalAddress
  // Auto-connect when we already know where the vehicle lives.
  if (addressInput.value.trim() !== '') load()
})
</script>

<style scoped>
.blueos-embed {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.address-bar {
  display: flex;
  gap: 8px;
  align-items: center;
}
.address-input {
  flex: 1;
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid rgb(255 255 255 / 25%);
  background-color: rgb(0 0 0 / 30%);
  color: #fff;
  font-family: monospace;
  font-size: 0.85rem;
}
.bar-button {
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid rgb(255 255 255 / 25%);
  background-color: rgb(0 0 0 / 35%);
  color: #fff;
  font-size: 0.8rem;
  white-space: nowrap;
}
.bar-button:hover:not(:disabled) {
  background-color: rgb(255 255 255 / 15%);
}
.bar-button:disabled {
  opacity: 0.4;
}
.blueos-frame {
  flex: 1;
  width: 100%;
  border: none;
  border-radius: 8px;
  background-color: #fff;
}
.placeholder {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  align-items: center;
  justify-content: center;
  text-align: center;
  color: #fff;
  padding: 2rem;
  border: 1px dashed rgb(255 255 255 / 25%);
  border-radius: 8px;
}
</style>
