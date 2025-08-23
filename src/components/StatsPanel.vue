<script setup lang="ts">
import { ref, watch, watchEffect, computed, onBeforeUnmount } from 'vue'
import { useSimulationStore } from '../composables/useSimulationStore'
import { useUiPrefs } from '../composables/useUiPrefs'

const props = defineProps<{ creature?: Record<string, any> }>()

const emit = defineEmits(['close'])
const { getStatsPanel, setStatsPanel, getActionNoticing, setActionNoticing } = useUiPrefs()
const statsPrefs = getStatsPanel()
const activeTab = ref<'stats' | 'brain' | 'events'>(statsPrefs?.activeTab ?? 'stats')
const showInputs = ref<boolean>(typeof statsPrefs?.showInputs === 'boolean' ? statsPrefs.showInputs : true)
const showOutputs = ref<boolean>(
  typeof statsPrefs?.showOutputs === 'boolean' ? statsPrefs.showOutputs : true,
)
// Canvas rendering options
const showConnections = ref<boolean>(
  typeof statsPrefs?.showConnections === 'boolean' ? statsPrefs.showConnections : true,
)

const store = useSimulationStore()

// Action Noticing settings (global + per-action + timing/zoom)
const actionPrefs = ref(
  getActionNoticing?.() ?? {
    enabled: true,
    byAction: { eats_plant: true },
    holdMs: 3000,
    zoom: 2,
  },
)
// Persist on change
watch(
  actionPrefs,
  (v) => {
    setActionNoticing?.({
      enabled: !!v.enabled,
      byAction: { ...(v.byAction || {}), eats_plant: !!(v.byAction?.eats_plant ?? true) },
      holdMs: Math.max(100, Number(v.holdMs) || 3000),
      zoom: Math.max(0.2, Number(v.zoom) || 2),
    })
  },
  { deep: true },
)

// Pretty-print labels for UI: snake_case -> Title Case, handle common short tokens
function prettyLabel(raw: string): string {
  if (!raw) return ''
  // Replace underscores with spaces and collapse whitespace
  const spaced = String(raw).replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
  const mapToken = (t: string) => {
    const low = t.toLowerCase()
    if (low === 'vx') return 'VX'
    if (low === 'vy') return 'VY'
    if (low === 'dx') return 'DX'
    if (low === 'dy') return 'DY'
    if (low === 'uv') return 'UV'
    if (low === 'id') return 'ID'
    if (/^v\d+$/.test(low)) return low.toUpperCase() // v1, v2
    // Title-case default
    return low.charAt(0).toUpperCase() + low.slice(1)
  }
  return spaced
    .split(' ')
    .map(mapToken)
    .join(' ')
}

// Pull stable input metadata (labels + categories) from the store
type InputCategory = 'Internal' | 'External'
const inputMetaList = computed(() => {
  const brain = props.creature?.brain as any | undefined
  const total =
    (Array.isArray(brain?.inputs) ? brain.inputs.length : 0) ||
    (typeof brain?.inputNodes === 'number' ? brain.inputNodes : 0) ||
    (Array.isArray(brain?.layerSizes) ? Number(brain.layerSizes[0] || 0) : 0)
  if (!total) return [] as Array<{ idx: number; label: string; category: InputCategory }>
  return store.getInputMeta(total) as Array<{ idx: number; label: string; category: InputCategory }>
})

const labelByIdx = computed<Record<number, string>>(() => {
  const map: Record<number, string> = {}
  for (const m of inputMetaList.value) map[m.idx] = m.label
  return map
})

// Human-readable display labels (no underscores, Title Case)
const displayLabelByIdx = computed<Record<number, string>>(() => {
  const map: Record<number, string> = {}
  for (const m of inputMetaList.value) map[m.idx] = prettyLabel(m.label)
  return map
})

const internalInputIndices = computed(() =>
  inputMetaList.value.filter((m) => m.category === 'Internal').map((m) => m.idx),
)
const externalInputIndices = computed(() =>
  inputMetaList.value.filter((m) => m.category === 'External').map((m) => m.idx),
)

// Tooltip state for input node hover
const tooltip = ref<{ show: boolean; x: number; y: number; text: string }>({
  show: false,
  x: 0,
  y: 0,
  text: '',
})

// Keep last drawn input node hitboxes to support hover detection
let inputHitboxes: Array<{
  x: number
  y: number
  r: number
  label: string
  value: number
  category: InputCategory
}> = []
let hoverBound = false
let mouseMoveHandler: ((e: MouseEvent) => void) | null = null
let mouseLeaveHandler: ((e: MouseEvent) => void) | null = null

function bindCanvasHover() {
  if (hoverBound) return
  const canvas = document.getElementById('brainCanvas') as HTMLCanvasElement | null
  if (!canvas) return
  const rectAt = () => canvas.getBoundingClientRect()
  mouseMoveHandler = (e: MouseEvent) => {
    const rect = rectAt()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    let found = null as (typeof inputHitboxes)[number] | null
    for (const hb of inputHitboxes) {
      const dx = x - hb.x
      const dy = y - hb.y
      if (dx * dx + dy * dy <= (hb.r + 3) * (hb.r + 3)) {
        found = hb
        break
      }
    }
    if (found) {
      tooltip.value = {
        show: true,
        x: Math.min(rect.width - 160, Math.max(6, x + 10)),
        y: Math.min(rect.height - 40, Math.max(6, y + 10)),
        text: `${found.label}: ${found.value.toFixed(3)} (${found.category})`,
      }
    } else {
      tooltip.value.show = false
    }
  }
  mouseLeaveHandler = () => {
    tooltip.value.show = false
  }
  canvas.addEventListener('mousemove', mouseMoveHandler)
  canvas.addEventListener('mouseleave', mouseLeaveHandler)
  hoverBound = true
}

onBeforeUnmount(() => {
  const canvas = document.getElementById('brainCanvas') as HTMLCanvasElement | null
  if (canvas) {
    if (mouseMoveHandler) canvas.removeEventListener('mousemove', mouseMoveHandler)
    if (mouseLeaveHandler) canvas.removeEventListener('mouseleave', mouseLeaveHandler)
  }
  hoverBound = false
})

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
  // lifecycle
  'birth',
  'death',
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

const typeFilters = ref<Record<EventType, boolean>>(
  (statsPrefs?.typeFilters as Record<EventType, boolean>) ?? {
    feeling: true,
    event: true,
    action: true,
  },
)
const keyFilters = ref<Record<EventKey, boolean>>(
  (statsPrefs?.keyFilters as Record<EventKey, boolean>) ?? {
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
    birth: true,
    death: true,
    drinks: true,
    sprints: true,
    stops_sprinting: true,
    rests: true,
    eats_plant: true,
    eats_corpse: true,
    gets_hit: true,
    attacks: true,
  },
)

const sortBy = ref<'time_desc' | 'time_asc' | 'type'>(statsPrefs?.sortBy ?? 'time_desc')

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

// Persist watchers
watch(activeTab, (v) => setStatsPanel({ activeTab: v }))
watch(showInputs, (v) => setStatsPanel({ showInputs: v }))
watch(showOutputs, (v) => setStatsPanel({ showOutputs: v }))
watch(showConnections, (v) => setStatsPanel({ showConnections: v }))
watch(sortBy, (v) => setStatsPanel({ sortBy: v }))
watch(
  typeFilters,
  (v) => setStatsPanel({ typeFilters: { ...v } as any }),
  { deep: true },
)
watch(
  keyFilters,
  (v) => setStatsPanel({ keyFilters: { ...v } as any }),
  { deep: true },
)

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
  // also depend on rendering options
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  showConnections.value
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
  // Layout margins and inner drawing area
  const margin = { left: 90, right: 280, top: 24, bottom: 28 }
  const innerWidth = Math.max(10, canvas.width - margin.left - margin.right)
  const innerHeight = Math.max(10, canvas.height - margin.top - margin.bottom)
  const layerStepX = innerWidth / (numLayers - 1)
  // Nudge the input (first) layer to the right a bit to separate from captions/labels area
  const inputColumnOffset = 68

  const layerX = (L: number) => margin.left + (L === 0 ? inputColumnOffset : 0) + L * layerStepX
  const nodeY = (L: number, j: number) => {
    const n = layerSizes[L]
    if (n <= 0) return margin.top + innerHeight / 2
    // evenly distribute within innerHeight with half-padding top/bottom
    return margin.top + ((j + 0.5) * innerHeight) / n
  }

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
    const startX = layerX(L)
    const endX = layerX(L + 1)
    for (let i = 0; i < nIn; i++) {
      const startY = nodeY(L, i)
      for (let o = 0; o < nOut; o++) {
        const endY = nodeY(L + 1, o)
        if (showConnections.value) {
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
  }

  // Prepare input hitboxes
  inputHitboxes = []

  // Draw nodes
  for (let L = 0; L < numLayers; L++) {
    const n = layerSizes[L]
    const x = layerX(L)
    for (let j = 0; j < n; j++) {
      const y = nodeY(L, j)
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

      // Record input hitboxes for L=0
      if (L === 0) {
        const meta = inputMetaList.value[j]
        const val = Array.isArray(brain.inputs) ? Number(brain.inputs[j] ?? 0) : 0
        if (meta)
          inputHitboxes.push({
            x,
            y,
            r: radius,
            label: prettyLabel(meta.label),
            value: val,
            category: meta.category,
          })
      }
    }
  }

  // Add labels
  ctx.fillStyle = '#333'
  ctx.font = '12px Arial'
  ctx.textAlign = 'center'

  // Input labels (drawn on canvas near input layer) from store metadata
  const inputLabels = inputMetaList.value.map((m) => prettyLabel(m.label))

  // Output labels
  const outputLabels = computedOutputLabels(layerSizes[numLayers - 1])

  // Draw input labels to the left of input layer
  ctx.textAlign = 'right'
  const labelPad = 24
  const inputLabelShift = 52
  for (let i = 0; i < Math.min(layerSizes[0], inputLabels.length); i++) {
    const y = nodeY(0, i)
    ctx.fillText(inputLabels[i], margin.left - labelPad + inputLabelShift, y + 4)
  }

  // Draw output labels to the right of output layer
  ctx.textAlign = 'left'
  for (let i = 0; i < Math.min(layerSizes[numLayers - 1], outputLabels.length); i++) {
    const y = nodeY(numLayers - 1, i)
    ctx.fillText(outputLabels[i], canvas.width - margin.right + labelPad, y + 4)
  }

  // Draw Internal/External divider across the canvas at the boundary between groups
  const internalCount = internalInputIndices.value.length
  if (internalCount > 0 && internalCount < layerSizes[0]) {
    const yPrev = nodeY(0, internalCount - 1)
    const yNext = nodeY(0, internalCount)
    const ySep = (yPrev + yNext) / 2
    ctx.strokeStyle = 'rgba(100, 100, 100, 0.35)'
    ctx.setLineDash([4, 3])
    ctx.beginPath()
    ctx.moveTo(margin.left + 4, ySep)
    ctx.lineTo(canvas.width - margin.right - 4, ySep)
    ctx.stroke()
    ctx.setLineDash([])

    // Captions for groups along left side
    ctx.fillStyle = '#555'
    ctx.textAlign = 'left'
    // Internal caption near left margin
    const intMidY = nodeY(0, Math.max(0, Math.floor(internalCount / 2)))
    ctx.fillText('Internal', 16, intMidY)
    // External caption near left margin
    const extCount = layerSizes[0] - internalCount
    const extMidIndex = internalCount + Math.max(0, Math.floor(extCount / 2))
    const extMidY = nodeY(0, Math.min(layerSizes[0] - 1, extMidIndex))
    ctx.fillText('External', 16, extMidY)
  }

  // Draw a small legend (top-right, inside inner area away from output labels)
  const legendW = 190
  const legendH = 100
  const legendGap = 10
  // Place legend in the empty space at the far right of the canvas
  const legendX = canvas.width - legendW - legendGap
  const legendY = margin.top + 6
  ctx.fillStyle = 'rgba(255,255,255,0.9)'
  ctx.fillRect(legendX, legendY, legendW, legendH)
  ctx.strokeStyle = 'rgba(0,0,0,0.15)'
  ctx.strokeRect(legendX, legendY, legendW, legendH)
  ctx.fillStyle = '#333'
  // Right-align text inside legend with padding
  const padL = 10
  const padR = 10
  const textX = legendX + legendW - padR
  ctx.textAlign = 'right'
  ctx.fillText('Legend', textX, legendY + 12)
  // lines/markers with labels to their right
  // Positive weight
  ctx.strokeStyle = 'rgba(0,255,0,0.7)'
  ctx.beginPath()
  const markerEndX = textX - 105
  const markerWidth = 60
  const markerStartX = markerEndX - markerWidth
  ctx.moveTo(markerStartX, legendY + 24)
  ctx.lineTo(markerEndX, legendY + 24)
  ctx.stroke()
  ctx.fillStyle = '#333'
  ctx.fillText('Positive weight', textX, legendY + 28)
  // Negative weight
  ctx.strokeStyle = 'rgba(255,0,0,0.7)'
  ctx.beginPath()
  ctx.moveTo(markerStartX, legendY + 40)
  ctx.lineTo(markerEndX, legendY + 40)
  ctx.stroke()
  ctx.fillStyle = '#333'
  ctx.fillText('Negative weight', textX, legendY + 44)
  // Node example
  ctx.beginPath()
  // Place the node circle just left of the right-aligned text
  ctx.arc(textX - 160, legendY + 58, 6, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(100,100,255,0.8)'
  ctx.fill()
  ctx.strokeStyle = '#000'
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.fillStyle = '#333'
  ctx.fillText('Node intensity ~ |activation|', textX, legendY + 62)
  // Connections toggle hint
  ctx.fillText(`Connections: ${showConnections.value ? 'On' : 'Off'}`, textX, legendY + 80)

  // Ensure hover listeners are attached
  bindCanvasHover()
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

// Input labels now come from the store; no local fallback mapping needed

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

      <!-- Action Noticing Settings -->
      <div class="mb-4 p-3 rounded-lg border border-gray-200 bg-gray-50">
        <div class="flex items-center justify-between">
          <div class="font-semibold text-gray-800">Action Noticing</div>
          <label class="flex items-center gap-2 text-sm">
            <input type="checkbox" v-model="actionPrefs.enabled" />
            Enabled
          </label>
        </div>
        <div class="mt-3 grid grid-cols-2 gap-3 items-center">
          <label class="flex items-center gap-2 text-sm">
            <input type="checkbox" v-model="actionPrefs.byAction.eats_plant" :disabled="!actionPrefs.enabled" />
            Eats plant
          </label>
          <div class="flex items-center gap-2 text-sm">
            <span class="text-gray-600">Hold (ms)</span>
            <input
              class="input input-bordered input-xs w-24"
              type="number"
              min="100"
              step="100"
              v-model.number="actionPrefs.holdMs"
              :disabled="!actionPrefs.enabled"
            />
          </div>
          <div class="flex items-center gap-2 text-sm">
            <span class="text-gray-600">Zoom</span>
            <input
              class="input input-bordered input-xs w-20"
              type="number"
              min="0.2"
              max="5"
              step="0.1"
              v-model.number="actionPrefs.zoom"
              :disabled="!actionPrefs.enabled"
            />
          </div>
        </div>
      </div>

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
        <div class="flex items-center justify-end gap-3 mb-2">
          <label class="text-sm flex items-center gap-2">
            <input type="checkbox" v-model="showConnections" />
            Show connections
          </label>
        </div>
        <div class="mx-auto inline-block relative" style="width: 720px; height: 420px">
          <canvas id="brainCanvas" width="720" height="420" class="border border-gray-200"></canvas>
          <div
            v-if="tooltip.show"
            class="brain-tooltip"
            :style="{ left: tooltip.x + 'px', top: tooltip.y + 'px' }"
          >
            {{ tooltip.text }}
          </div>
        </div>
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
          <div v-if="showInputs && inputMetaList.length">
            <!-- Single column with Internal and External sections -->
            <div class="space-y-3">
              <div>
                <div class="text-xs uppercase tracking-wide text-gray-500 mb-1">Internal</div>
                <div class="space-y-1">
                  <div
                    v-for="idx in internalInputIndices"
                    :key="`in-int-${idx}`"
                    class="flex items-center gap-2 text-sm"
                  >
                    <div class="w-32 text-gray-700">
                      {{ displayLabelByIdx[idx] ?? `In ${idx}` }}
                    </div>
                    <div class="w-16 text-right tabular-nums">
                      {{
                        (+(
                          creature?.brain?.inputs?.[idx] ??
                          creature?.brain?.activations?.[0]?.[idx] ??
                          0
                        )).toFixed(3)
                      }}
                    </div>
                    <div class="flex-1 h-2 bg-gray-200 rounded overflow-hidden">
                      <div
                        class="h-2 bg-emerald-500"
                        :style="{
                          width: `${Math.min(
                            100,
                            Math.max(
                              0,
                              ((creature?.brain?.inputs?.[idx] ??
                                creature?.brain?.activations?.[0]?.[idx] ??
                                0) +
                                1) *
                                50,
                            ),
                          )}%`,
                        }"
                      ></div>
                    </div>
                  </div>
                </div>
              </div>
              <div>
                <div class="text-xs uppercase tracking-wide text-gray-500 mb-1">External</div>
                <div class="space-y-1">
                  <div
                    v-for="idx in externalInputIndices"
                    :key="`in-ext-${idx}`"
                    class="flex items-center gap-2 text-sm"
                  >
                    <div class="w-32 text-gray-700">
                      {{ displayLabelByIdx[idx] ?? `In ${idx}` }}
                    </div>
                    <div class="w-16 text-right tabular-nums">
                      {{
                        (+(
                          creature?.brain?.inputs?.[idx] ??
                          creature?.brain?.activations?.[0]?.[idx] ??
                          0
                        )).toFixed(3)
                      }}
                    </div>
                    <div class="flex-1 h-2 bg-gray-200 rounded overflow-hidden">
                      <div
                        class="h-2 bg-emerald-500"
                        :style="{
                          width: `${Math.min(
                            100,
                            Math.max(
                              0,
                              ((creature?.brain?.inputs?.[idx] ??
                                creature?.brain?.activations?.[0]?.[idx] ??
                                0) +
                                1) *
                                50,
                            ),
                          )}%`,
                        }"
                      ></div>
                    </div>
                  </div>
                </div>
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
<style scoped>
.brain-tooltip {
  position: absolute;
  pointer-events: none;
  background: rgba(17, 24, 39, 0.92); /* gray-900 */
  color: #fff;
  font-size: 12px;
  padding: 4px 8px;
  border-radius: 4px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
  max-width: 150px;
  z-index: 10;
}
</style>
