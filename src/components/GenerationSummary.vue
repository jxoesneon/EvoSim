<script setup lang="ts">
import { computed } from 'vue'
import { useSimulationStore } from '../composables/useSimulationStore'

// Emits when the user starts the next generation from this summary popup
const emit = defineEmits<{
  (e: 'start-next'): void
}>()

const store = useSimulationStore()

// Read stats for the generation that just ended (reason + gen number)
const ended = computed(() => store.lastGenEnd.value)
const genNumber = computed(() => ended.value?.gen ?? (store.generation as any).value)
const reason = computed(() => ended.value?.reason ?? 'stagnation')

// Snapshot stats displayed as simple cards in the header
const avgSpeed = computed(() => store.movementStats.avgSpeed)
const hofTop = computed(() => store.getHallOfFameTop?.(5) ?? [])

// Bindings for quick tweaks for next generation (two-way with store setters)
const mutationRate = computed<number>({
  get: () => (store.simulationParams as any).mutationRate as number,
  set: (v: number) => store.setMutationRate?.(Number(v)),
})
const mutationAmount = computed<number>({
  get: () => (store.simulationParams as any).mutationAmount as number,
  set: (v: number) => store.setMutationAmount?.(Number(v)),
})
const plantSpawnRate = computed<number>({
  get: () => (store.simulationParams as any).plantSpawnRate as number,
  set: (v: number) => store.setPlantSpawnRate?.(Number(v)),
})
const waterLevel = computed<number>({
  get: () => (store.simulationParams as any).waterLevel as number,
  set: (v: number) => store.setWaterLevel?.(Number(v)),
})
const movementThreshold = computed<number>({
  get: () => (store.simulationParams as any).movementThreshold as number,
  set: (v: number) => store.setMovementThreshold?.(Number(v)),
})
const stagnantTicksLimit = computed<number>({
  get: () => (store.simulationParams as any).stagnantTicksLimit as number,
  set: (v: number) => store.setStagnantTicksLimit?.(Number(v)),
})

function onStartNext() {
  // Ensure a clean reset was done already by endGeneration; simply start
  store.startSimulation()
  emit('start-next')
}
</script>

<template>
  <!-- Generation Summary popup content -->
  <div class="space-y-4">
    <div class="text-sm text-gray-600">Ended gen {{ genNumber }} due to <strong>{{ reason }}</strong>.</div>

    <div class="grid grid-cols-2 gap-3">
      <!-- Compact KPI cards (normalized to match other summary stats) -->
      <div class="stat shadow bg-base-200/50 rounded-xl p-3 md:p-4 min-h-[96px] flex flex-col justify-between border-0 focus:outline-none">
        <div class="stat-title text-xs md:text-sm leading-tight">Avg Speed</div>
        <div class="flex flex-col gap-1">
          <div class="stat-value text-lg md:text-2xl leading-tight">{{ avgSpeed.toFixed(3) }}</div>
          <div class="stat-desc text-[10px] md:text-xs">Threshold {{ movementThreshold.toFixed(3) }}</div>
        </div>
      </div>
      <div class="stat shadow bg-base-200/50 rounded-xl p-3 md:p-4 min-h-[96px] flex flex-col justify-between border-0 focus:outline-none">
        <div class="stat-title text-xs md:text-sm leading-tight">Plants</div>
        <div class="flex flex-col gap-1">
          <div class="stat-value text-lg md:text-2xl leading-tight">Spawn {{ plantSpawnRate.toFixed(2) }}</div>
          <div class="stat-desc text-[10px] md:text-xs">Water {{ waterLevel.toFixed(2) }}</div>
        </div>
      </div>
    </div>

    <div>
      <!-- Hall of Fame list (top N creatures) -->
      <div class="font-semibold mb-2">Hall of Fame (Top)</div>
      <div class="border rounded-lg divide-y">
        <div v-if="hofTop.length === 0" class="p-2 text-sm text-gray-500">No data</div>
        <div v-for="c in hofTop" :key="c.id" class="p-2 text-sm flex justify-between">
          <span class="truncate mr-2">{{ c.name }}</span>
          <span class="opacity-70">life {{ c.lifespan }}</span>
        </div>
      </div>
    </div>

    <!-- Collapsible quick-tweaks for next generation parameters -->
    <div class="collapse collapse-arrow bg-base-100 border">
      <input type="checkbox" />
      <div class="collapse-title text-md font-semibold">Customize Next Generation</div>
      <div class="collapse-content">
        <div class="grid grid-cols-2 gap-3 mt-2">
          <div>
            <label class="label"><span class="label-text text-sm">Mutation Rate: {{ mutationRate.toFixed(2) }}</span></label>
            <input type="range" min="0" max="1" step="0.01" v-model.number="mutationRate" class="range range-sm" />
          </div>
          <div>
            <label class="label"><span class="label-text text-sm">Mutation Amount: {{ mutationAmount.toFixed(2) }}</span></label>
            <input type="range" min="0" max="1" step="0.01" v-model.number="mutationAmount" class="range range-sm" />
          </div>
          <div>
            <label class="label"><span class="label-text text-sm">Plant Spawn Rate: {{ plantSpawnRate.toFixed(2) }}</span></label>
            <input type="range" min="0" max="5" step="0.1" v-model.number="plantSpawnRate" class="range range-sm" />
          </div>
          <div>
            <label class="label"><span class="label-text text-sm">Water Level: {{ waterLevel.toFixed(2) }}</span></label>
            <input type="range" min="0" max="1" step="0.01" v-model.number="waterLevel" class="range range-sm" />
          </div>
          <div>
            <label class="label"><span class="label-text text-sm">Movement Threshold: {{ movementThreshold.toFixed(3) }}</span></label>
            <input type="range" min="0" max="0.2" step="0.005" v-model.number="movementThreshold" class="range range-sm" />
          </div>
          <div>
            <label class="label"><span class="label-text text-sm">Stagnant Ticks Limit: {{ stagnantTicksLimit }}</span></label>
            <input type="range" min="100" max="5000" step="50" v-model.number="stagnantTicksLimit" class="range range-sm" />
          </div>
        </div>
      </div>
    </div>

    <div class="flex justify-end gap-2">
      <button class="btn btn-primary" @click="onStartNext">Start Next Generation</button>
    </div>
  </div>
</template>
