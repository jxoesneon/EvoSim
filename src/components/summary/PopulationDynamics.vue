<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch, onMounted } from 'vue'
import { useSimulationStore } from '../../composables/useSimulationStore'
import { useUserPrefs } from '../../composables/useUserPrefs'
import { useUiPrefs } from '../../composables/useUiPrefs'
const UPlotStackedArea = defineAsyncComponent(() => import('./charts/UPlotStackedArea.vue'))

const store = useSimulationStore()
const pop = computed<any>(() => (store.telemetry as any)?.series?.population ?? {})
const baseC = computed<number[]>(() => pop.value?.creatures ?? [])
const baseP = computed<number[]>(() => pop.value?.plants ?? [])
const baseCo = computed<number[]>(() => pop.value?.corpses ?? [])

// Empty-state fallback: if no series, use current live counts as a single sample
const fallbackCounts = computed(() => ({
  creatures: (((store as any)?.creatures as any)?.value?.length ?? 0) as number,
  plants: (((store as any)?.plants as any)?.value?.length ?? 0) as number,
  corpses: (((store as any)?.corpses as any)?.value?.length ?? 0) as number,
}))

function ensureSeries(arr: number[], fallback: number) {
  if (arr && arr.length) return arr
  // Provide at least two points so uPlot can render an area/line
  return [fallback, fallback]
}

// Legend toggles
const { getPopulationDynamics, setPopulationDynamics } = useUiPrefs()
const popPrefs = getPopulationDynamics()
const hidden = ref<{ c: boolean; p: boolean; co: boolean }>(
  (popPrefs?.hidden as any) ?? { c: false, p: false, co: false },
)

// Smoothing
const smoothing = ref<boolean>(
  typeof popPrefs?.smoothing === 'boolean' ? popPrefs.smoothing : false,
)
const smoothWin = ref<5 | 9 | 13>((([5, 9, 13] as const).includes(popPrefs?.smoothWin as any)
  ? (popPrefs?.smoothWin as any)
  : 5) as 5 | 9 | 13)
function smooth(arr: number[], win: number) {
  if (!smoothing.value) return arr
  const n = arr.length
  if (n === 0 || win <= 1) return arr
  const half = Math.floor(win / 2)
  const out = new Array(n).fill(0)
  let sum = 0
  for (let i = 0; i < n; i++) {
    sum += arr[i] ?? 0
    if (i >= win) sum -= arr[i - win] ?? 0
    const count = i < win - 1 ? i + 1 : win
    out[i] = sum / count
  }
  // shift to centered average
  for (let i = n - 1; i >= half; i--) out[i] = out[i - half]
  return out
}

// Zoom window selector (simple): full, last 1000, last 200
const windowSel = ref<'full' | '1k' | '200'>(
  (['full', '1k', '200'] as const).includes(popPrefs?.windowSel as any)
    ? (popPrefs?.windowSel as any)
    : 'full',
)
function sliceWindow(arr: number[]) {
  const n = arr.length
  if (windowSel.value === 'full') return arr
  const size = windowSel.value === '1k' ? 1000 : 200
  return n <= size ? arr : arr.slice(n - size)
}

const processed = computed(() => {
  const c0 = ensureSeries(baseC.value, fallbackCounts.value.creatures)
  const p0 = ensureSeries(baseP.value, fallbackCounts.value.plants)
  const co0 = ensureSeries(baseCo.value, fallbackCounts.value.corpses)
  const c1 = hidden.value.c ? c0.map(() => 0) : smooth(c0, smoothWin.value)
  const p1 = hidden.value.p ? p0.map(() => 0) : smooth(p0, smoothWin.value)
  const co1 = hidden.value.co ? co0.map(() => 0) : smooth(co0, smoothWin.value)
  const maxLen = Math.max(c1.length, p1.length, co1.length)
  const xAll = Array.from({ length: maxLen }, (_, i) => i)
  const x2 = sliceWindow(xAll)
  const take = x2.length
  // left-pad helper to ensure equal-length arrays
  const pad = (arr: number[], n: number) => {
    const sliced = arr.slice(Math.max(0, arr.length - n))
    return sliced.length < n
      ? Array(n - sliced.length)
          .fill(0)
          .concat(sliced)
      : sliced
  }
  const c2 = pad(c1, take)
  const p2 = pad(p1, take)
  const co2 = pad(co1, take)
  return { x: x2, c: c2, p: p2, co: co2 }
})

const data = computed<number[][]>(() => [
  processed.value.x,
  processed.value.c,
  processed.value.p,
  processed.value.co,
])

// Debug: lifecycle + data shape logging
onMounted(() => {
  try {
    console.debug('[PopulationDynamics] mounted')
  } catch {}
})

watch(
  processed,
  (p) => {
    try {
      console.debug('[PopulationDynamics] processed', {
        x: p?.x?.length ?? 0,
        c: p?.c?.length ?? 0,
        p: p?.p?.length ?? 0,
        co: p?.co?.length ?? 0,
        smoothing: smoothing.value,
        smoothWin: smoothWin.value,
        windowSel: windowSel.value,
      })
    } catch {}
  },
  { deep: true },
)

watch(data, (d) => {
  try {
    const lens = Array.isArray(d) ? d.map((a) => (Array.isArray(a) ? a.length : 0)) : []
    console.debug('[PopulationDynamics] data', { lens })
  } catch {}
})

// Exports for uPlot
const areaRef = ref<any>(null)
const { setLastExport, getLastExport, getPreferredExport, setPreferredExport } = useUserPrefs()
const PREF_KEY = 'summary:population-dynamics'
const lastFmt = computed(() => getLastExport(PREF_KEY))
const preferred = computed({
  get: () => getPreferredExport(PREF_KEY) ?? lastFmt.value ?? 'png',
  set: (fmt: 'png' | 'csv') => setPreferredExport(PREF_KEY, fmt),
})
function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
function exportCsv() {
  setLastExport(PREF_KEY, 'csv')
  const rows: string[][] = [['tick', 'creatures', 'plants', 'corpses']]
  const xArr = processed.value.x
  const cArr = processed.value.c
  const pArr = processed.value.p
  const coArr = processed.value.co
  const n = Math.max(cArr.length, pArr.length, coArr.length)
  for (let i = 0; i < n; i++)
    rows.push([`${xArr[i] ?? i}`, `${cArr[i] ?? 0}`, `${pArr[i] ?? 0}`, `${coArr[i] ?? 0}`])
  downloadText('population-dynamics.csv', rows.map((r) => r.join(',')).join('\n'))
}
function downloadPng() {
  setLastExport(PREF_KEY, 'png')
  const comp = areaRef.value as any
  const root: HTMLElement | null = comp?.$el ?? comp ?? null
  if (!root) return
  const canvas = root.querySelector('canvas') as HTMLCanvasElement | null
  if (!canvas) return
  const url = canvas.toDataURL('image/png')
  const a = document.createElement('a')
  a.href = url
  a.download = 'population-dynamics.png'
  a.click()
}

function exportUsingPreferred() {
  const fmt = preferred.value
  // persist preference explicitly
  setPreferredExport(PREF_KEY, fmt)
  if (fmt === 'png') return downloadPng()
  return exportCsv()
}

// Persist watchers
watch(
  hidden,
  (v) => setPopulationDynamics({ hidden: { ...v } }),
  { deep: true },
)
watch(smoothing, (v) => setPopulationDynamics({ smoothing: !!v }))
watch(smoothWin, (v) => setPopulationDynamics({ smoothWin: v }))
watch(windowSel, (v) => setPopulationDynamics({ windowSel: v }))
</script>
<template>
  <div
    class="card shadow bg-base-200/50 border-0 p-3 min-h-[220px] md:min-h-[260px] lg:min-h-[320px] flex flex-col"
  >
    <div class="font-semibold mb-2">Population Dynamics</div>
    <div class="flex-1 flex flex-col overflow-hidden gap-1">
      <div class="flex items-center justify-between px-1.5 pt-0.5 gap-2">
        <div
          id="pop-chart-desc"
          class="text-[10px] opacity-60 whitespace-nowrap leading-tight mr-2"
        >
          Creatures / Plants / Corpses
        </div>
        <div class="flex gap-x-2 gap-y-1 items-center whitespace-nowrap">
          <label class="label cursor-pointer gap-1 text-[10px] p-0 h-6 items-center">
            <input
              type="checkbox"
              class="toggle toggle-xs"
              v-model="smoothing"
              aria-label="Enable smoothing"
            />
            <span>Smooth</span>
          </label>
          <select
            v-model="smoothWin"
            class="select select-ghost select-xs min-w-[4.25rem] h-6 min-h-6 px-2 pr-5 py-0"
            :class="{ 'opacity-60': !smoothing }"
            :disabled="!smoothing"
            aria-label="Smoothing window"
          >
            <option :value="5">W=5</option>
            <option :value="9">W=9</option>
            <option :value="13">W=13</option>
          </select>
          <select
            v-model="windowSel"
            class="select select-ghost select-xs min-w-[5.5rem] h-6 min-h-6 px-2 pr-0 py-0"
            aria-label="Window"
          >
            <option value="full">Full</option>
            <option value="1k">Last 1000</option>
            <option value="200">Last 200</option>
          </select>
          <label for="pop-pref" class="sr-only">Preferred export format</label>
          <select
            id="pop-pref"
            v-model="preferred"
            class="select select-ghost select-xs min-w-[3.75rem] h-6 min-h-6 px-2 pr-3 py-0"
            aria-label="Preferred export format"
          >
            <option value="png">PNG</option>
            <option value="csv">CSV</option>
          </select>
          <button
            class="btn btn-primary btn-xs h-6 min-h-6 px-2"
            @click="exportUsingPreferred"
            aria-describedby="pop-chart-desc"
            aria-label="Export using preferred format"
          >
            Export
          </button>
          <span
            v-if="lastFmt"
            class="badge badge-ghost badge-xs"
            aria-live="polite"
            title="Last used export format"
            >Last: {{ lastFmt?.toUpperCase?.() }}</span
          >
        </div>
      </div>
      <div class="flex items-center gap-2 px-2 text-xs mt-1">
        <button
          class="badge badge-outline"
          :class="{ 'opacity-50': hidden.c }"
          @click="hidden.c = !hidden.c"
          aria-label="Toggle Creatures"
        >
          Creatures
        </button>
        <button
          class="badge badge-outline"
          :class="{ 'opacity-50': hidden.p }"
          @click="hidden.p = !hidden.p"
          aria-label="Toggle Plants"
        >
          Plants
        </button>
        <button
          class="badge badge-outline"
          :class="{ 'opacity-50': hidden.co }"
          @click="hidden.co = !hidden.co"
          aria-label="Toggle Corpses"
        >
          Corpses
        </button>
      </div>
      <div
        class="relative flex-1 w-full min-h-[180px] sm:min-h-[200px] md:min-h-[220px] lg:min-h-[260px] overflow-hidden"
      >
        <UPlotStackedArea
          ref="areaRef"
          :data="data"
          :fillOpacity="0.35"
          :epsilonFloor="0.5"
          class="absolute inset-0"
        />
      </div>
    </div>
  </div>
</template>
