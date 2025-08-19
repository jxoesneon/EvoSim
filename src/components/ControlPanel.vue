<script setup lang="ts">
import { ref } from 'vue'
import {
  PlayIcon,
  StopIcon,
  ArrowPathIcon,
  ArrowDownTrayIcon,
  ArrowUpTrayIcon,
} from '@heroicons/vue/24/solid'
import { useSimulationStore } from '../composables/useSimulationStore'

const emit = defineEmits(['start', 'stop', 'reset', 'add-creature', 'add-plant', 'save', 'load'])

const store = useSimulationStore()
const brainSeed = ref<number>(3735928559) // 0xDEADBEEF default
function applySeed() {
  store.setBrainSeed?.(Number(brainSeed.value) >>> 0)
}

// Auto-continue toggle state mirrors store param; default ON
const autoContinue = ref<boolean>(true)
function toggleAutoContinue() {
  autoContinue.value = !autoContinue.value
  store.setAutoContinueGenerations?.(autoContinue.value)
}

// Vision cones controls
const showVision = ref<boolean>(store.simulationParams.showVisionCones ?? true)
function toggleVision() {
  showVision.value = !showVision.value
  store.setShowVisionCones?.(showVision.value)
}
const fovDeg = ref<number>(store.simulationParams.visionFovDeg ?? 90)
const visionRange = ref<number>(store.simulationParams.visionRange ?? 80)
function applyVisionParams() {
  store.setVisionFovDeg?.(Number(fovDeg.value))
  store.setVisionRange?.(Number(visionRange.value))
}

// Debugging tools
const showDebugOverlay = ref<boolean>(store.simulationParams.showDebugOverlay ?? false)
function toggleDebugOverlay() {
  showDebugOverlay.value = !showDebugOverlay.value
  store.setShowDebugOverlay?.(showDebugOverlay.value)
}

// Event/Feeling thresholds (compact controls)
const thirstThreshold = ref<number>(store.simulationParams.thirstThreshold)
const hungerEnergyThreshold = ref<number>(store.simulationParams.hungerEnergyThreshold)
const fatigueStaminaThreshold = ref<number>(store.simulationParams.fatigueStaminaThreshold)
const fearThreshold = ref<number>(store.simulationParams.fearThreshold)
const matingUrgeThreshold = ref<number>(store.simulationParams.matingUrgeThreshold)
const restlessTicks = ref<number>(store.simulationParams.restlessTicks)
const resourceDeltaEventThreshold = ref<number>(store.simulationParams.resourceDeltaEventThreshold)
const painHealthDropThreshold = ref<number>(store.simulationParams.painHealthDropThreshold)
const energyGainEatThreshold = ref<number>(store.simulationParams.energyGainEatThreshold)
const healthDropHitThreshold = ref<number>(store.simulationParams.healthDropHitThreshold)

function applyThresholds() {
  store.setThirstThreshold?.(Number(thirstThreshold.value))
  store.setHungerEnergyThreshold?.(Number(hungerEnergyThreshold.value))
  store.setFatigueStaminaThreshold?.(Number(fatigueStaminaThreshold.value))
  store.setFearThreshold?.(Number(fearThreshold.value))
  store.setMatingUrgeThreshold?.(Number(matingUrgeThreshold.value))
  store.setRestlessTicks?.(Number(restlessTicks.value))
  store.setResourceDeltaEventThreshold?.(Number(resourceDeltaEventThreshold.value))
  store.setPainHealthDropThreshold?.(Number(painHealthDropThreshold.value))
  store.setEnergyGainEatThreshold?.(Number(energyGainEatThreshold.value))
  store.setHealthDropHitThreshold?.(Number(healthDropHitThreshold.value))
}

// Zegion activations selectors
const selHidden = ref<string>(store.zegionActivations.hidden)
const selOutput = ref<string>(store.zegionActivations.output)
function applyActivations() {
  // Types are validated in store
  store.setZegionActivations(selHidden.value as any, selOutput.value as any)
}

// Download current simulation snapshot
function onDownload() {
  store.downloadSimulation?.()
}

// Upload (load) a simulation snapshot from a JSON file
const fileInput = ref<HTMLInputElement | null>(null)
function openFilePicker() {
  fileInput.value?.click()
}
async function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files && input.files[0]
  if (!file) return
  try {
    const text = await file.text()
    const json = JSON.parse(text)
    store.loadSnapshot?.(json)
  } catch (err) {
    console.warn('Failed to load save JSON', err)
  } finally {
    // reset to allow re-selecting same file
    if (input) input.value = ''
  }
}
</script>

<template>
  <div
    class="control-panel bg-white/80 backdrop-blur-md px-3 py-2 rounded-2xl shadow-xl border border-base-300 flex items-center gap-2"
  >
    <!-- Primary controls -->
    <div class="btn-group">
      <button @click="emit('start')" class="btn btn-xs md:btn-sm btn-ghost" title="Start">
        <PlayIcon class="w-4 h-4" />
        <span class="hidden md:inline ml-1">Start</span>
      </button>
      <button @click="emit('stop')" class="btn btn-xs md:btn-sm btn-ghost" title="Stop">
        <StopIcon class="w-4 h-4" />
        <span class="hidden md:inline ml-1">Stop</span>
      </button>
      <button @click="emit('reset')" class="btn btn-xs md:btn-sm btn-ghost" title="Reset">
        <ArrowPathIcon class="w-4 h-4" />
        <span class="hidden md:inline ml-1">Reset</span>
      </button>
    </div>

    <!-- Event thresholds (compact) -->
    <div class="hidden lg:flex items-center gap-2 pl-2 ml-1 border-l border-base-300">
      <span class="text-xs text-gray-600">Thresholds</span>
      <label class="text-[10px] text-gray-600 flex items-center gap-1" title="Thirst (%)">
        <span>Thirst</span>
        <input
          v-model.number="thirstThreshold"
          @change="applyThresholds"
          type="number"
          min="0"
          max="100"
          class="input input-2xs w-14"
        />
      </label>
      <label
        class="text-[10px] text-gray-600 flex items-center gap-1"
        title="Hunger energy (% of max)"
      >
        <span>Hunger</span>
        <input
          v-model.number="hungerEnergyThreshold"
          @change="applyThresholds"
          type="number"
          min="0"
          max="100"
          class="input input-2xs w-14"
        />
      </label>
      <label class="text-[10px] text-gray-600 flex items-center gap-1" title="Fatigue stamina (%)">
        <span>Fatigue</span>
        <input
          v-model.number="fatigueStaminaThreshold"
          @change="applyThresholds"
          type="number"
          min="0"
          max="100"
          class="input input-2xs w-14"
        />
      </label>
      <label class="text-[10px] text-gray-600 flex items-center gap-1" title="Fear level (0-100)">
        <span>Fear</span>
        <input
          v-model.number="fearThreshold"
          @change="applyThresholds"
          type="number"
          min="0"
          max="100"
          class="input input-2xs w-14"
        />
      </label>
      <label class="text-[10px] text-gray-600 flex items-center gap-1" title="Mating urge (0-100)">
        <span>Mating</span>
        <input
          v-model.number="matingUrgeThreshold"
          @change="applyThresholds"
          type="number"
          min="0"
          max="100"
          class="input input-2xs w-14"
        />
      </label>
      <label
        class="text-[10px] text-gray-600 flex items-center gap-1"
        title="Restless after N ticks without rest"
      >
        <span>Restless</span>
        <input
          v-model.number="restlessTicks"
          @change="applyThresholds"
          type="number"
          min="0"
          class="input input-2xs w-16"
        />
      </label>
      <label
        class="text-[10px] text-gray-600 flex items-center gap-1"
        title="Resource delta to emit +/- events"
      >
        <span>ΔRes</span>
        <input
          v-model.number="resourceDeltaEventThreshold"
          @change="applyThresholds"
          type="number"
          step="0.1"
          min="0"
          class="input input-2xs w-16"
        />
      </label>
      <label
        class="text-[10px] text-gray-600 flex items-center gap-1"
        title="Health drop to feel pain"
      >
        <span>ΔPain</span>
        <input
          v-model.number="painHealthDropThreshold"
          @change="applyThresholds"
          type="number"
          step="0.01"
          min="0"
          class="input input-2xs w-16"
        />
      </label>
      <label
        class="text-[10px] text-gray-600 flex items-center gap-1"
        title="Energy gain to infer eating action"
      >
        <span>Eat+</span>
        <input
          v-model.number="energyGainEatThreshold"
          @change="applyThresholds"
          type="number"
          step="0.1"
          min="0"
          class="input input-2xs w-16"
        />
      </label>
      <label
        class="text-[10px] text-gray-600 flex items-center gap-1"
        title="Health drop to infer gets_hit (with predator near)"
      >
        <span>Hit-</span>
        <input
          v-model.number="healthDropHitThreshold"
          @change="applyThresholds"
          type="number"
          step="0.1"
          min="0"
          class="input input-2xs w-16"
        />
      </label>
    </div>

    <!-- Add entity -->
    <div class="btn-group">
      <button
        @click="emit('add-creature')"
        class="btn btn-xs md:btn-sm btn-ghost"
        title="Add Creature"
      >
        +
        <span class="hidden md:inline ml-1">Creature</span>
      </button>
      <button @click="emit('add-plant')" class="btn btn-xs md:btn-sm btn-ghost" title="Add Plant">
        +
        <span class="hidden md:inline ml-1">Plant</span>
      </button>
    </div>

    <!-- Persistence -->
    <div class="btn-group">
      <button @click="emit('save')" class="btn btn-xs md:btn-sm btn-ghost" title="Save">
        <ArrowDownTrayIcon class="w-4 h-4" />
        <span class="hidden md:inline ml-1">Save</span>
      </button>
      <button @click="emit('load')" class="btn btn-xs md:btn-sm btn-ghost" title="Load">
        <ArrowUpTrayIcon class="w-4 h-4" />
        <span class="hidden md:inline ml-1">Load</span>
      </button>
      <button @click="onDownload" class="btn btn-xs md:btn-sm btn-ghost" title="Download Save">
        <ArrowDownTrayIcon class="w-4 h-4" />
        <span class="hidden md:inline ml-1">Download</span>
      </button>
      <button @click="openFilePicker" class="btn btn-xs md:btn-sm btn-ghost" title="Upload Save">
        <ArrowUpTrayIcon class="w-4 h-4" />
        <span class="hidden md:inline ml-1">Upload</span>
      </button>
      <input
        ref="fileInput"
        type="file"
        accept="application/json"
        class="hidden"
        @change="onFileChange"
      />
    </div>

    <!-- Brain seed -->
    <div class="hidden md:flex items-center gap-2 pl-2 ml-1 border-l border-base-300">
      <span class="text-xs text-gray-600">Seed</span>
      <input v-model.number="brainSeed" type="number" class="input input-xs w-32" />
      <button @click="applySeed" class="btn btn-xs btn-outline">Apply</button>
    </div>

    <!-- Auto-continue generations -->
    <div class="hidden md:flex items-center gap-2 pl-2 ml-1 border-l border-base-300">
      <span class="text-xs text-gray-600">Auto-continue</span>
      <input
        type="checkbox"
        class="toggle toggle-xs"
        :checked="autoContinue"
        @change="toggleAutoContinue"
      />
    </div>

    <!-- Vision cones -->
    <div class="hidden md:flex items-center gap-2 pl-2 ml-1 border-l border-base-300">
      <span class="text-xs text-gray-600">Vision</span>
      <input
        type="checkbox"
        class="toggle toggle-xs"
        :checked="showVision"
        @change="toggleVision"
      />
      <span class="text-xs text-gray-600 ml-2">FOV</span>
      <input
        v-model.number="fovDeg"
        type="number"
        min="10"
        max="180"
        class="input input-xs w-16"
        @change="applyVisionParams"
      />
      <span class="text-xs text-gray-600">Range</span>
      <input
        v-model.number="visionRange"
        type="number"
        min="5"
        max="500"
        class="input input-xs w-16"
        @change="applyVisionParams"
      />
    </div>

    <!-- Debugging Tools -->
    <div class="flex items-center gap-2 pl-2 ml-1 border-l border-base-300">
      <span class="text-xs text-gray-600">Debugging Tools</span>
      <label
        class="flex items-center gap-1 text-xs text-gray-600"
        title="Show mouse position and picking diagnostics overlay"
      >
        <span>Mouse Position Overlay</span>
        <input
          type="checkbox"
          class="toggle toggle-xs"
          :checked="showDebugOverlay"
          @change="toggleDebugOverlay"
        />
      </label>
    </div>
  </div>
</template>
