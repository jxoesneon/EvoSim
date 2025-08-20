<script setup lang="ts">
import { computed, ref } from 'vue'
import { useSimulationStore } from '../../composables/useSimulationStore'
const store = useSimulationStore()
const mutationRate = computed<number>({
  get: () => (store.simulationParams as any).mutationRate,
  set: (v) => store.setMutationRate?.(Number(v)),
})
const mutationAmount = computed<number>({
  get: () => (store.simulationParams as any).mutationAmount,
  set: (v) => store.setMutationAmount?.(Number(v)),
})
const movementThreshold = computed<number>({
  get: () => (store.simulationParams as any).movementThreshold,
  set: (v) => store.setMovementThreshold?.(Number(v)),
})
const stagnantTicksLimit = computed<number>({
  get: () => (store.simulationParams as any).stagnantTicksLimit,
  set: (v) => store.setStagnantTicksLimit?.(Number(v)),
})
const plantSpawnRate = computed<number>({
  get: () => (store.simulationParams as any).plantSpawnRate,
  set: (v) => store.setPlantSpawnRate?.(Number(v)),
})
const waterLevel = computed<number>({
  get: () => (store.simulationParams as any).waterLevel,
  set: (v) => store.setWaterLevel?.(Number(v)),
})
function startNext() {
  store.startSimulation()
}

type PresetKey = 'Balanced' | 'Rapid Growth' | 'Harsh Climate' | 'Explorers'
const presets: Record<PresetKey, Partial<Record<string, number>>> = {
  Balanced: {
    mutationRate: 0.2,
    mutationAmount: 0.1,
    plantSpawnRate: 0.2,
    waterLevel: 0.35,
    movementThreshold: 0.02,
    stagnantTicksLimit: 600,
  },
  'Rapid Growth': {
    mutationRate: 0.25,
    mutationAmount: 0.12,
    plantSpawnRate: 0.6,
    waterLevel: 0.45,
    movementThreshold: 0.015,
    stagnantTicksLimit: 900,
  },
  'Harsh Climate': {
    mutationRate: 0.15,
    mutationAmount: 0.08,
    plantSpawnRate: 0.05,
    waterLevel: 0.15,
    movementThreshold: 0.03,
    stagnantTicksLimit: 400,
  },
  Explorers: {
    mutationRate: 0.22,
    mutationAmount: 0.11,
    plantSpawnRate: 0.18,
    waterLevel: 0.3,
    movementThreshold: 0.012,
    stagnantTicksLimit: 1200,
  },
}

const lastApplied = ref<PresetKey | null>(null)
function applyPreset(key: PresetKey) {
  const p = presets[key]
  if (!p) return
  if (typeof p.mutationRate === 'number') store.setMutationRate?.(p.mutationRate)
  if (typeof p.mutationAmount === 'number') store.setMutationAmount?.(p.mutationAmount)
  if (typeof p.plantSpawnRate === 'number') store.setPlantSpawnRate?.(p.plantSpawnRate)
  if (typeof p.waterLevel === 'number') store.setWaterLevel?.(p.waterLevel)
  if (typeof p.movementThreshold === 'number')
    store.setMovementThreshold?.(p.movementThreshold as number)
  if (typeof p.stagnantTicksLimit === 'number')
    store.setStagnantTicksLimit?.(p.stagnantTicksLimit as number)
  lastApplied.value = key
}
</script>
<template>
  <div id="controls-panel" class="collapse collapse-arrow bg-base-100 border">
    <input type="checkbox" checked />
    <div class="collapse-title text-md font-semibold">Customize Next Generation</div>
    <div class="collapse-content">
      <div class="flex flex-wrap gap-2 mb-3" aria-label="Presets">
        <button
          class="btn btn-xs"
          :class="lastApplied === 'Balanced' ? 'btn-primary' : 'btn-ghost'"
          @click="applyPreset('Balanced')"
          aria-label="Apply Balanced preset"
        >
          Balanced
        </button>
        <button
          class="btn btn-xs"
          :class="lastApplied === 'Rapid Growth' ? 'btn-primary' : 'btn-ghost'"
          @click="applyPreset('Rapid Growth')"
          aria-label="Apply Rapid Growth preset"
        >
          Rapid Growth
        </button>
        <button
          class="btn btn-xs"
          :class="lastApplied === 'Harsh Climate' ? 'btn-primary' : 'btn-ghost'"
          @click="applyPreset('Harsh Climate')"
          aria-label="Apply Harsh Climate preset"
        >
          Harsh Climate
        </button>
        <button
          class="btn btn-xs"
          :class="lastApplied === 'Explorers' ? 'btn-primary' : 'btn-ghost'"
          @click="applyPreset('Explorers')"
          aria-label="Apply Explorers preset"
        >
          Explorers
        </button>
        <span v-if="lastApplied" class="badge badge-ghost badge-xs" aria-live="polite"
          >Applied: {{ lastApplied }}</span
        >
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
        <div>
          <label class="label"
            ><span class="label-text text-sm"
              >Mutation Rate: {{ mutationRate.toFixed?.(2) }}</span
            ></label
          >
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            v-model.number="mutationRate"
            class="range range-sm"
          />
        </div>
        <div>
          <label class="label"
            ><span class="label-text text-sm"
              >Mutation Amount: {{ mutationAmount.toFixed?.(2) }}</span
            ></label
          >
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            v-model.number="mutationAmount"
            class="range range-sm"
          />
        </div>
        <div>
          <label class="label"
            ><span class="label-text text-sm"
              >Plant Spawn Rate: {{ plantSpawnRate.toFixed?.(2) }}</span
            ></label
          >
          <input
            type="range"
            min="0"
            max="5"
            step="0.1"
            v-model.number="plantSpawnRate"
            class="range range-sm"
          />
        </div>
        <div>
          <label class="label"
            ><span class="label-text text-sm"
              >Water Level: {{ waterLevel.toFixed?.(2) }}</span
            ></label
          >
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            v-model.number="waterLevel"
            class="range range-sm"
          />
        </div>
        <div>
          <label class="label"
            ><span class="label-text text-sm"
              >Movement Threshold: {{ movementThreshold.toFixed?.(3) }}</span
            ></label
          >
          <input
            type="range"
            min="0"
            max="0.2"
            step="0.005"
            v-model.number="movementThreshold"
            class="range range-sm"
          />
        </div>
        <div>
          <label class="label"
            ><span class="label-text text-sm"
              >Stagnant Ticks Limit: {{ stagnantTicksLimit }}</span
            ></label
          >
          <input
            type="range"
            min="100"
            max="5000"
            step="50"
            v-model.number="stagnantTicksLimit"
            class="range range-sm"
          />
        </div>
      </div>
      <div class="flex justify-end gap-2 mt-3">
        <div class="dropdown dropdown-end">
          <div tabindex="0" role="button" class="btn">Start with Preset ▾</div>
          <ul
            tabindex="0"
            class="dropdown-content z-[1] menu p-2 shadow bg-base-100 rounded-box w-52"
          >
            <li><a @click.prevent="applyPreset('Balanced')">Balanced</a></li>
            <li><a @click.prevent="applyPreset('Rapid Growth')">Rapid Growth</a></li>
            <li><a @click.prevent="applyPreset('Harsh Climate')">Harsh Climate</a></li>
            <li><a @click.prevent="applyPreset('Explorers')">Explorers</a></li>
          </ul>
        </div>
        <button class="btn btn-primary" @click="startNext">Start Next Generation</button>
      </div>
    </div>
  </div>
</template>
