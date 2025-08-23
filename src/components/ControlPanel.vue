<script setup lang="ts">
import { ref, onMounted } from 'vue'
import {
  PlayIcon,
  StopIcon,
  ArrowPathIcon,
  ArrowDownTrayIcon,
  ArrowUpTrayIcon,
} from '@heroicons/vue/24/solid'
import { useSimulationStore } from '../composables/useSimulationStore'
import { useUiPrefs } from '../composables/useUiPrefs'

const emit = defineEmits(['start', 'stop', 'reset', 'add-creature', 'add-plant', 'save', 'load'])

const store = useSimulationStore()
const prefs = useUiPrefs()
const brainSeed = ref<number>(3735928559) // 0xDEADBEEF default
function applySeed() {
  store.setBrainSeed?.(Number(brainSeed.value) >>> 0)
}

// Auto-continue toggle state mirrors store param; initialize from store (persisted)
const autoContinue = ref<boolean>(store.simulationParams.autoContinueGenerations ?? true)
function toggleAutoContinue() {
  autoContinue.value = !autoContinue.value
  store.setAutoContinueGenerations?.(autoContinue.value)
}

// Vision cones controls (read from store; persistence is owned by App.vue)
const showVision = ref<boolean>(store.simulationParams.showVisionCones ?? true)
const fovDeg = ref<number>(store.simulationParams.visionFovDeg ?? 90)
const visionRange = ref<number>(store.simulationParams.visionRange ?? 80)

// Sync persisted settings into the store on mount
onMounted(() => {
  console.log('[Vision][CP] onMounted apply to store', {
    showVision: showVision.value,
    fovDeg: fovDeg.value,
    visionRange: visionRange.value,
  })
  store.setShowVisionCones?.(!!showVision.value)
  store.setVisionFovDeg?.(Number(fovDeg.value))
  store.setVisionRange?.(Number(visionRange.value))
  console.log('[Vision][CP] applied to store', {
    storeShow: (store.simulationParams as any).showVisionCones,
    storeFov: (store.simulationParams as any).visionFovDeg,
    storeRange: (store.simulationParams as any).visionRange,
  })
})

function toggleVision() {
  showVision.value = !showVision.value
  store.setShowVisionCones?.(showVision.value)
  console.log('[Vision][CP] toggleVision', { show: showVision.value })
}
function applyVisionParams() {
  const f = Number(fovDeg.value)
  const r = Number(visionRange.value)
  store.setVisionFovDeg?.(f)
  store.setVisionRange?.(r)
  console.log('[Vision][CP] applyVisionParams', { fovDeg: f, range: r })
}

// Debugging tools
const showDebugOverlay = ref<boolean>(store.simulationParams.showDebugOverlay ?? false)
function toggleDebugOverlay() {
  showDebugOverlay.value = !showDebugOverlay.value
  store.setShowDebugOverlay?.(showDebugOverlay.value)
}

// Logs prefs (global + per-type pills)
const logEnabled = ref<boolean>(!!(prefs.getLogging?.().enabled ?? true))
const defaultTypes = {
  action_notice: true,
  camera: true,
  renderer: true,
  input: true,
  world_to_screen: true,
  vision: false,
  ui_prefs: false,
}
const logTypes = ref<Record<string, boolean>>({ ...defaultTypes, ...(prefs.getLogging?.().types || {}) })
function toggleLogsEnabled() {
  logEnabled.value = !logEnabled.value
  prefs.setLogging?.({ enabled: logEnabled.value })
}
function toggleLogType(key: string) {
  const cur = !!logTypes.value[key]
  logTypes.value[key] = !cur
  prefs.setLogging?.({ types: { [key]: !cur } as any })
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

// Action Noticing controls
const an = prefs.getActionNoticing?.() || { enabled: true, byAction: { eats_plant: true }, holdMs: 5000, zoom: 2 }
const anEnabled = ref<boolean>(!!an.enabled)
const anEatsPlant = ref<boolean>(an.byAction?.eats_plant !== false)
const anHoldMs = ref<number>(Number(an.holdMs) || 5000)
const anZoom = ref<number>(Number(an.zoom) || 2)
function applyActionNoticing() {
  prefs.setActionNoticing?.({
    enabled: !!anEnabled.value,
    byAction: { ...(an.byAction || {}), eats_plant: !!anEatsPlant.value },
    holdMs: Math.max(250, Number(anHoldMs.value) || 5000),
    zoom: Math.max(0.2, Number(anZoom.value) || 2),
  })
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
    class="control-panel bg-white/80 backdrop-blur-md px-3 py-2 rounded-2xl shadow-xl border border-base-300 flex items-center gap-2 overflow-x-auto whitespace-nowrap"
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

    <!-- Action Noticing (dropdown for compact visibility) -->
    <div class="dropdown dropdown-bottom">
      <label tabindex="0" class="btn btn-xs md:btn-sm btn-outline">🔭 Action Noticing</label>
      <div
        tabindex="0"
        class="dropdown-content z-[60] menu p-3 shadow bg-base-100 rounded-box w-72"
      >
        <div class="flex items-center justify-between mb-2">
          <span class="text-sm font-medium">Enabled</span>
          <input type="checkbox" class="toggle toggle-xs" v-model="anEnabled" @change="applyActionNoticing" />
        </div>
        <div class="flex items-center justify-between mb-2">
          <span class="text-sm">eats_plant</span>
          <input type="checkbox" class="toggle toggle-xs" v-model="anEatsPlant" @change="applyActionNoticing" />
        </div>
        <div class="flex items-center justify-between mb-2">
          <span class="text-sm">Hold (ms)</span>
          <input
            v-model.number="anHoldMs"
            @change="applyActionNoticing"
            type="number"
            min="250"
            step="250"
            class="input input-2xs w-24"
          />
        </div>
        <div class="flex items-center justify-between">
          <span class="text-sm">Zoom</span>
          <input
            v-model.number="anZoom"
            @change="applyActionNoticing"
            type="number"
            min="0.2"
            max="10"
            step="0.1"
            class="input input-2xs w-20"
          />
        </div>
      </div>
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
        data-testid="vision-toggle"
        @change="toggleVision"
      />
      <span class="text-xs text-gray-600 ml-2">FOV</span>
      <input
        v-model.number="fovDeg"
        type="number"
        min="10"
        max="180"
        class="input input-xs w-16"
        data-testid="vision-fov"
        @change="applyVisionParams"
      />
      <span class="text-xs text-gray-600">Range</span>
      <input
        v-model.number="visionRange"
        type="number"
        min="5"
        max="500"
        class="input input-xs w-16"
        data-testid="vision-range"
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
      <!-- Logs controls -->
      <div class="dropdown dropdown-bottom">
        <label tabindex="0" class="btn btn-xs md:btn-sm btn-outline">🧪 Logs</label>
        <div tabindex="0" class="dropdown-content z-[60] menu p-3 shadow bg-base-100 rounded-box w-80">
          <div class="flex items-center justify-between mb-2">
            <span class="text-sm font-medium">Enable all logs</span>
            <input type="checkbox" class="toggle toggle-xs" :checked="logEnabled" @change="toggleLogsEnabled" />
          </div>
          <div class="text-xs text-gray-600 mb-1">Types</div>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="(on, key) in logTypes"
              :key="key"
              class="btn btn-ghost btn-xs"
              :class="on ? 'btn-active' : 'opacity-60'"
              @click="toggleLogType(String(key))"
            >
              {{ String(key).replace(/_/g, ' ') }}
            </button>
          </div>
        </div>
      </div>
    </div>

    
  </div>
</template>
