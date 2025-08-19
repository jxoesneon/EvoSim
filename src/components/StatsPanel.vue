<script setup lang="ts">
import { ref, watchEffect, computed } from 'vue'
import { useSimulationStore } from '../composables/useSimulationStore'

const props = defineProps<{ creature?: Record<string, any> }>()

const emit = defineEmits(['close'])
const activeTab = ref<'stats' | 'brain' | 'events'>('stats')
const showInputs = ref(true)
const showOutputs = ref(true)

const store = useSimulationStore()

// Events tab state
const EVENT_TYPES = ['feeling', 'event', 'action'] as const
type EventType = (typeof EVENT_TYPES)[number]
const EVENT_KEYS = [
  // feelings
  'thirst',
  'hunger',
  'fatigue',
  'fear',
  'pain',
  'mating_urge',
  'restless',
  // perception
  'finds_water',
  'loses_water',
  'finds_mate',
  'loses_mate',
  'finds_prey',
  'loses_prey',
  'finds_predator',
  'loses_predator',
  'finds_corpse',
  'loses_corpse',
  'finds_food_plant',
  'loses_food_plant',
  // resources
  'energy_gain',
  'energy_loss',
  'stamina_gain',
  'stamina_loss',
  'health_gain',
  'health_loss',
  // actions
  'drinks',
  'sprints',
  'stops_sprinting',
  'rests',
  'eats_plant',
  'eats_corpse',
  'gets_hit',
  'attacks',
] as const
type EventKey = (typeof EVENT_KEYS)[number]

const typeFilters = ref<Record<EventType, boolean>>({ feeling: true, event: true, action: true })
const keyFilters = ref<Record<EventKey, boolean>>({
  thirst: true,
  hunger: true,
  fatigue: true,
  fear: true,
  pain: true,
  mating_urge: true,
  restless: true,
  finds_water: true,
  loses_water: true,
  finds_mate: true,
  loses_mate: true,
  finds_prey: true,
  loses_prey: true,
  finds_predator: true,
  loses_predator: true,
  finds_corpse: true,
  loses_corpse: true,
  finds_food_plant: true,
  loses_food_plant: true,
  energy_gain: true,
  energy_loss: true,
  stamina_gain: true,
  stamina_loss: true,
  health_gain: true,
  health_loss: true,
  drinks: true,
  sprints: true,
  stops_sprinting: true,
  rests: true,
  eats_plant: true,
  eats_corpse: true,
  gets_hit: true,
  attacks: true,
})

const sortBy = ref<'time_desc' | 'time_asc' | 'type'>('time_desc')

const rawEvents = computed(() => {
  const id = props.creature?.id as string | undefined
  if (!id) return [] as Array<{ ts: number; type: EventType; key: EventKey; label: string }>
  return store.getCreatureEvents(id) as Array<{
    ts: number
    type: EventType
    key: EventKey
    label: string
  }>
})

const filteredEvents = computed(() => {
  const list = rawEvents.value.filter((e) => typeFilters.value[e.type] && keyFilters.value[e.key])
  if (sortBy.value === 'time_desc') return [...list].sort((a, b) => b.ts - a.ts)
  if (sortBy.value === 'time_asc') return [...list].sort((a, b) => a.ts - b.ts)
  return [...list].sort((a, b) => a.type.localeCompare(b.type) || a.key.localeCompare(b.key))
})

function setActiveTab(tab: 'stats' | 'brain' | 'events') {
  activeTab.value = tab
}

function selectAllKeys(v: boolean) {
  for (const k of EVENT_KEYS) keyFilters.value[k] = v
}

// Render brain visualization when brain tab is active and brain data changes
watchEffect(() => {
  if (activeTab.value !== 'brain' || !props.creature) return
  const brain = props.creature.brain
  // Touch reactive deps so updates re-render (outputs/activations/weights may change)
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  brain?.output && brain.output.length
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  brain?.activations && brain.activations.length
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  brain?.inputs && brain.inputs.length
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  brain?.weights && brain.weights.length
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  brain?.biases && brain.biases.length
  // Schedule after DOM updates
  requestAnimationFrame(() => renderBrainVisualization(brain))
})

function renderBrainVisualization(brain: any) {
  const canvas = document.getElementById('brainCanvas') as HTMLCanvasElement
  if (!canvas) return

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  // Clear canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height)

  // Brain visualization logic will be implemented here
  // This is a placeholder for the actual neural network visualization

  const layerSizes = brain.layerSizes || [
    brain.inputNodes || 14,
    brain.hiddenNodes || 8,
    brain.outputNodes || 8,
  ]
  const numLayers = layerSizes.length
  const layerWidth = canvas.width / (numLayers + 1)

  // Draw connections first (to be behind nodes)
  ctx.strokeStyle = 'rgba(200, 200, 200, 0.2)'

  const getWeight = (L: number, outIdx: number, inIdx: number) => {
    // Support flat arrays (nOut*nIn) or nested [nOut][nIn]
    const wL = brain?.weights?.[L]
    if (!wL) return 0
    const nIn = layerSizes[L]
    const nOut = layerSizes[L + 1]
    if (Array.isArray(wL) && typeof wL[0] === 'number') {
      const flat = wL as number[]
      const idx = outIdx * nIn + inIdx
      return flat[idx] ?? 0
    }
    if (Array.isArray(wL) && Array.isArray(wL[outIdx])) {
      return wL[outIdx][inIdx] ?? 0
    }
    return 0
  }

  const hasWeights = Array.isArray(brain?.weights) && brain.weights.length > 0
  for (let L = 0; L < numLayers - 1; L++) {
    const nIn = layerSizes[L]
    const nOut = layerSizes[L + 1]
    const startX = (L + 1) * layerWidth
    const endX = (L + 2) * layerWidth
    for (let i = 0; i < nIn; i++) {
      const startY = (i + 0.5) * (canvas.height / (nIn + 1))
      for (let o = 0; o < nOut; o++) {
        const endY = (o + 0.5) * (canvas.height / (nOut + 1))
        const weight = getWeight(L, o, i)
        if (!hasWeights) {
          // No weight data: draw neutral faint connection
          ctx.strokeStyle = 'rgba(180, 180, 180, 0.15)'
        } else if (weight < 0) {
          const alpha = Math.max(0.06, Math.min(Math.abs(weight), 1) * 0.8)
          ctx.strokeStyle = `rgba(255, 0, 0, ${alpha})`
        } else if (weight > 0) {
          const alpha = Math.max(0.06, Math.min(weight, 1) * 0.8)
          ctx.strokeStyle = `rgba(0, 255, 0, ${alpha})`
        } else {
          ctx.strokeStyle = 'rgba(180, 180, 180, 0.06)'
        }
        ctx.beginPath()
        ctx.moveTo(startX, startY)
        ctx.lineTo(endX, endY)
        ctx.stroke()
      }
    }
  }

  // Draw nodes
  for (let L = 0; L < numLayers; L++) {
    const n = layerSizes[L]
    const x = (L + 1) * layerWidth
    for (let j = 0; j < n; j++) {
      const y = (j + 0.5) * (canvas.height / (n + 1))
      let activation = 0
      if (Array.isArray(brain.activations) && Array.isArray(brain.activations[L])) {
        activation = brain.activations[L][j] ?? 0
      }
      const radius = 10
      ctx.beginPath()
      ctx.arc(x, y, radius, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(100, 100, 255, ${0.3 + Math.max(0, Math.min(1, activation)) * 0.7})`
      ctx.fill()
      ctx.strokeStyle = '#000'
      ctx.lineWidth = 1
      ctx.stroke()
    }
  }

  // Add labels
  ctx.fillStyle = '#333'
  ctx.font = '12px Arial'
  ctx.textAlign = 'center'

  // Input labels (drawn on canvas near input layer)
  const inputLabels = computedInputLabels(layerSizes[0])

  // Output labels
  const outputLabels = computedOutputLabels(layerSizes[numLayers - 1])

  // Draw input labels
  for (let i = 0; i < Math.min(layerSizes[0], inputLabels.length); i++) {
    const y = (i + 0.5) * (canvas.height / (layerSizes[0] + 1))
    ctx.fillText(inputLabels[i], layerWidth / 2, y + 4)
  }

  // Draw output labels
  for (let i = 0; i < Math.min(layerSizes[numLayers - 1], outputLabels.length); i++) {
    const y = (i + 0.5) * (canvas.height / (layerSizes[numLayers - 1] + 1))
    ctx.fillText(outputLabels[i], numLayers * layerWidth + layerWidth / 2, y + 4)
  }
}

// Provide adaptive output labels based on brain.output length
const outputLabels = computed(() => {
  const outLen = props.creature?.brain?.output?.length ?? 0
  // Common sets: 6 (Zegion) or 8 (OG). Fallback to generic labels.
  if (outLen === 6) {
    return ['Turn', 'Thrust', 'Ax2', 'Eat', 'Rest', 'Boost']
  }
  if (outLen === 8) {
    return ['Turn', 'Thrust', 'Sprint', 'Attack', 'Mate', 'Rest', 'Comm R', 'Comm B']
  }
  return Array.from({ length: outLen }, (_, i) => `Out ${i}`)
})

function computedInputLabels(len: number): string[] {
  if (len === 14) {
    return [
      'x',
      'y',
      'vx',
      'vy',
      'energy',
      'health',
      'sin t',
      'cos t',
      'herb dx',
      'herb dy',
      'herb dist',
      'bias',
      'i12',
      'i13',
    ]
  }
  if (len === 24) {
    return [
      'x',
      'y',
      'vx',
      'vy',
      'energy',
      'health',
      'sin t',
      'cos t',
      'herb dx',
      'herb dy',
      'herb dist',
      'carn dx',
      'carn dy',
      'carn dist',
      'terrain',
      'terrain n',
      'speed |v|',
      'dot herb',
      'dot carn',
      'sin2',
      'cos2',
      'isCarn',
      'inv energy',
      'bias',
    ]
  }
  return Array.from({ length: len }, (_, i) => `In ${i}`)
}

function computedOutputLabels(len: number): string[] {
  if (len === 6) return ['Turn', 'Thrust', 'Ax2', 'Eat', 'Rest', 'Boost']
  if (len === 8) return ['Turn', 'Thrust', 'Sprint', 'Attack', 'Mate', 'Rest', 'Comm R', 'Comm B']
  return Array.from({ length: len }, (_, i) => `Out ${i}`)
}
</script>

<template>
  <div
    id="statsPanel"
    class="fixed inset-0 flex justify-center items-center bg-black bg-opacity-60 z-20"
    @click.self="emit('close')"
  >
    <div id="statsContent" class="bg-white p-6 rounded-xl shadow-xl w-11/12 max-w-3xl relative">
      <span
        id="closePanelButton"
        @click="emit('close')"
        class="absolute top-2 right-4 text-3xl font-bold cursor-pointer text-gray-400 hover:text-gray-700"
      >
        &times;
      </span>

      <h2 class="text-2xl font-bold mb-4 text-gray-800">
        {{ creature?.name || 'Creature' }} Stats
      </h2>

      <div class="border-b border-gray-200">
        <nav class="-mb-px flex space-x-8" aria-label="Tabs">
          <button
            id="statsTab"
            @click="setActiveTab('stats')"
            class="tab-button py-2 px-4 cursor-pointer"
            :class="{ 'active border-blue-600 font-semibold': activeTab === 'stats' }"
          >
            Stats
          </button>
          <button
            id="brainTab"
            @click="setActiveTab('brain')"
            class="tab-button py-2 px-4 cursor-pointer"
            :class="{ 'active border-blue-600 font-semibold': activeTab === 'brain' }"
          >
            Brain
          </button>
          <button
            id="eventsTab"
            @click="setActiveTab('events')"
            class="tab-button py-2 px-4 cursor-pointer"
            :class="{ 'active border-blue-600 font-semibold': activeTab === 'events' }"
          >
            Events
          </button>
        </nav>
      </div>

      <div
        id="statsTabContent"
        class="tab-content pt-4"
        :class="{ active: activeTab === 'stats' }"
        v-show="activeTab === 'stats'"
      >
        <div v-if="creature" class="grid grid-cols-2 gap-4">
          <!-- Basic Stats -->
          <div>
            <h3 class="font-semibold mb-2 text-lg">Basic Info</h3>
            <div class="space-y-1">
              <p><span class="font-medium">Name:</span> {{ creature.name }}</p>
              <p>
                <span class="font-medium">Health:</span> {{ Number(creature.health).toFixed(1) }}%
              </p>
              <p>
                <span class="font-medium">Energy:</span> {{ Number(creature.energy).toFixed(1) }}
              </p>
              <p>
                <span class="font-medium">Thirst:</span> {{ Number(creature.thirst).toFixed(1) }}
              </p>
              <p><span class="font-medium">Age:</span> {{ creature.lifespan }} ticks</p>
            </div>
          </div>

          <!-- Phenotype Stats -->
          <div>
            <h3 class="font-semibold mb-2 text-lg">Phenotype</h3>
            <div class="space-y-1">
              <template v-if="creature.phenotype">
                <p><span class="font-medium">Diet:</span> {{ creature.phenotype.diet }}</p>
                <p>
                  <span class="font-medium">Size:</span>
                  {{ Number(creature.phenotype.size).toFixed(1) }}
                </p>
                <p>
                  <span class="font-medium">Speed:</span>
                  {{ Number(creature.phenotype.speed).toFixed(1) }}
                </p>
                <p>
                  <span class="font-medium">Sight Range:</span>
                  {{ Number(creature.phenotype.sightRange).toFixed(0) }}
                </p>
                <p>
                  <span class="font-medium">Hardiness:</span>
                  {{ Number(creature.phenotype.hardiness).toFixed(1) }}
                </p>
              </template>
            </div>
          </div>

          <!-- Genes -->
          <div class="col-span-2">
            <h3 class="font-semibold mb-2 text-lg">Genotype</h3>
            <div class="grid grid-cols-3 gap-2">
              <template v-if="creature.genes">
                <div
                  v-for="(value, key) in creature.genes"
                  :key="key"
                  class="bg-gray-50 p-2 rounded"
                >
                  <p class="text-sm">
                    <span class="font-medium">{{ key }}:</span>
                    {{ value[0] }}{{ value[1] }}
                  </p>
                </div>
              </template>
            </div>
          </div>
        </div>
        <div v-else class="text-center py-8 text-gray-500">No creature selected</div>
      </div>

      <div
        id="brainTabContent"
        class="tab-content pt-4"
        :class="{ active: activeTab === 'brain' }"
        v-show="activeTab === 'brain'"
      >
        <canvas
          id="brainCanvas"
          width="550"
          height="400"
          class="mx-auto border border-gray-200"
        ></canvas>
        <div class="mt-4">
          <div class="flex items-center justify-between mb-2">
            <h3 class="font-semibold text-lg">Inputs</h3>
            <button
              type="button"
              class="text-sm px-2 py-1 rounded border border-gray-300 hover:bg-gray-50"
              @click="showInputs = !showInputs"
            >
              {{ showInputs ? 'Hide' : 'Show' }}
            </button>
          </div>
          <div
            v-if="showInputs && creature?.brain?.inputs && creature.brain.inputs.length"
            class="space-y-1"
          >
            <div
              v-for="(val, idx) in creature.brain.inputs"
              :key="idx"
              class="flex items-center gap-2 text-sm"
            >
              <div class="w-28 text-gray-700">
                {{ computedInputLabels(creature.brain.inputs.length)[idx] ?? `In ${idx}` }}
              </div>
              <div class="w-16 text-right tabular-nums">{{ (+val).toFixed(3) }}</div>
              <div class="flex-1 h-2 bg-gray-200 rounded overflow-hidden">
                <div
                  class="h-2 bg-emerald-500"
                  :style="{ width: `${Math.min(100, Math.max(0, (val + 1) * 50))}%` }"
                ></div>
              </div>
            </div>
          </div>
          <div v-else class="text-sm text-gray-500">No inputs available.</div>
        </div>
        <div class="mt-4">
          <div class="flex items-center justify-between mb-2">
            <h3 class="font-semibold text-lg">Outputs</h3>
            <button
              type="button"
              class="text-sm px-2 py-1 rounded border border-gray-300 hover:bg-gray-50"
              @click="showOutputs = !showOutputs"
            >
              {{ showOutputs ? 'Hide' : 'Show' }}
            </button>
          </div>
          <div
            v-if="showOutputs && creature?.brain?.output && creature.brain.output.length"
            class="space-y-1"
          >
            <div
              v-for="(val, idx) in creature.brain.output"
              :key="idx"
              class="flex items-center gap-2 text-sm"
            >
              <div class="w-28 text-gray-700">{{ outputLabels[idx] ?? `Out ${idx}` }}</div>
              <div class="w-16 text-right tabular-nums">{{ (+val).toFixed(3) }}</div>
              <div class="flex-1 h-2 bg-gray-200 rounded overflow-hidden">
                <div
                  class="h-2 bg-indigo-500"
                  :style="{ width: `${Math.min(100, Math.max(0, (val + 1) * 50))}%` }"
                ></div>
              </div>
            </div>
          </div>
          <div v-else class="text-sm text-gray-500">No outputs available.</div>
        </div>
      </div>

      <div
        id="eventsTabContent"
        class="tab-content pt-4"
        :class="{ active: activeTab === 'events' }"
        v-show="activeTab === 'events'"
      >
        <div v-if="creature" class="space-y-4">
          <div class="flex flex-wrap items-center gap-4">
            <div class="flex items-center gap-2">
              <span class="text-sm text-gray-600">Types:</span>
              <label v-for="t in EVENT_TYPES" :key="t" class="flex items-center gap-1 text-sm">
                <input type="checkbox" v-model="typeFilters[t]" /> {{ t }}
              </label>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-sm text-gray-600">Sort:</span>
              <select v-model="sortBy" class="select select-bordered select-xs">
                <option value="time_desc">Newest first</option>
                <option value="time_asc">Oldest first</option>
                <option value="type">Type/Key</option>
              </select>
            </div>
          </div>

          <div class="bg-gray-50 p-2 rounded">
            <div class="flex items-center justify-between mb-2">
              <span class="text-sm text-gray-600">Event filters</span>
              <div class="flex gap-2">
                <button class="btn btn-xs" @click="selectAllKeys(true)">Select All</button>
                <button class="btn btn-xs" @click="selectAllKeys(false)">Select None</button>
              </div>
            </div>
            <div class="flex flex-wrap gap-3">
              <label v-for="k in EVENT_KEYS" :key="k" class="flex items-center gap-1 text-sm">
                <input type="checkbox" v-model="keyFilters[k]" /> {{ k }}
              </label>
            </div>
          </div>

          <div class="max-h-64 overflow-auto border rounded">
            <table class="table table-xs">
              <thead>
                <tr>
                  <th class="w-28">Time</th>
                  <th class="w-24">Type</th>
                  <th class="w-36">Key</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="filteredEvents.length === 0">
                  <td colspan="4" class="text-center text-gray-500">No events yet</td>
                </tr>
                <tr v-for="(e, i) in filteredEvents" :key="i" class="hover">
                  <td>{{ new Date(e.ts).toLocaleTimeString() }}</td>
                  <td>{{ e.type }}</td>
                  <td>{{ e.key }}</td>
                  <td>{{ e.label }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div v-else class="text-center py-8 text-gray-500">No creature selected</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tab-button {
  border-bottom: 2px solid transparent;
}
.tab-button.active {
  border-color: #4f46e5;
  font-weight: 600;
}
.tab-content {
  display: none;
}
.tab-content.active {
  display: block;
}
</style>
