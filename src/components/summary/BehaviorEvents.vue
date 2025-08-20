<script setup lang="ts">
import { computed, defineAsyncComponent, ref } from 'vue'
import { useSimulationStore } from '../../composables/useSimulationStore'
import { useUserPrefs } from '../../composables/useUserPrefs'

const EChart = defineAsyncComponent(() => import('./charts/EChart.vue'))
const store = useSimulationStore()

const totals = computed(() => (store.telemetry as any)?.totals ?? {})
const events = computed(() => (store.telemetry as any)?.series?.events ?? {})

// Build per-interval rates from cumulative series
function diff(arr: number[]): number[] {
  const out: number[] = []
  for (let i = 1; i < arr.length; i++) {
    const d = (arr[i] ?? 0) - (arr[i - 1] ?? 0)
    out.push(Number.isFinite(d) ? Math.max(0, d) : 0)
  }
  return out
}

const x = computed<number[]>(() => {
  const births: number[] = events.value?.births ?? []
  return Array.from({ length: Math.max(0, births.length - 1) }, (_, i) => i)
})

const seriesDefs = [
  { key: 'births', name: 'Births' },
  { key: 'deaths', name: 'Deaths' },
  { key: 'eats_plant', name: 'Eats Plant' },
  { key: 'eats_corpse', name: 'Eats Corpse' },
  { key: 'drinks', name: 'Drinks' },
  { key: 'attacks', name: 'Attacks' },
  { key: 'gets_hit', name: 'Gets Hit' },
]

const timelineOption = computed(() => {
  const ev = events.value as any
  const dataSeries = seriesDefs.map((s) => ({
    name: s.name,
    type: 'line',
    symbol: 'none',
    smooth: true,
    data: diff(ev?.[s.key] ?? []),
  }))

  return {
    tooltip: { trigger: 'axis' },
    legend: { top: 0 },
    grid: { left: 40, right: 10, top: 30, bottom: 28 },
    xAxis: { type: 'category', data: x.value },
    yAxis: { type: 'value' },
    series: dataSeries,
  }
})

// Exports
const chartRef = ref<any>(null)
const { setLastExport, getLastExport, getPreferredExport, setPreferredExport } = useUserPrefs()
const PREF_KEY = 'summary:behavior-events'
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

function exportEventsCsv() {
  setLastExport(PREF_KEY, 'csv')
  const ev = events.value as any
  const cols = ['tick', ...seriesDefs.map((s) => s.key)]
  const arrays: number[][] = seriesDefs.map((s) => diff(ev?.[s.key] ?? []))
  const n = Math.max(0, ...arrays.map((a) => a.length))
  const rows: string[][] = [cols]
  for (let i = 0; i < n; i++) {
    const row = [String(i), ...arrays.map((a) => String(a[i] ?? 0))]
    rows.push(row)
  }
  downloadText('behavior-events.csv', rows.map((r) => r.join(',')).join('\n'))
}

function exportEventsPng() {
  setLastExport(PREF_KEY, 'png')
  const inst = chartRef as any
  // call the wrapper's downloadPNG if available
  ;(inst as any)?.downloadPNG?.('behavior-events.png')
}

function exportUsingPreferred() {
  const fmt = preferred.value
  setPreferredExport(PREF_KEY, fmt)
  if (fmt === 'png') return exportEventsPng()
  return exportEventsCsv()
}
</script>
<template>
  <div class="card bg-base-100 border p-3 h-64">
    <div class="font-semibold mb-2">Behavior & Events</div>
    <div class="grid grid-cols-3 gap-2 h-full">
      <div class="bg-base-200/30 rounded-md p-2 text-xs space-y-1 overflow-auto">
        <div class="font-medium opacity-70">Totals</div>
        <div class="grid grid-cols-2 gap-x-2 gap-y-1">
          <div>Births</div>
          <div class="text-right font-semibold">{{ totals.births ?? 0 }}</div>
          <div>Deaths</div>
          <div class="text-right font-semibold">{{ totals.deaths ?? 0 }}</div>
          <div>Eats Plant</div>
          <div class="text-right font-semibold">{{ totals.eats_plant ?? 0 }}</div>
          <div>Eats Corpse</div>
          <div class="text-right font-semibold">{{ totals.eats_corpse ?? 0 }}</div>
          <div>Drinks</div>
          <div class="text-right font-semibold">{{ totals.drinks ?? 0 }}</div>
          <div>Attacks</div>
          <div class="text-right font-semibold">{{ totals.attacks ?? 0 }}</div>
          <div>Gets Hit</div>
          <div class="text-right font-semibold">{{ totals.gets_hit ?? 0 }}</div>
        </div>
      </div>
      <div class="bg-base-200/30 rounded-md overflow-hidden col-span-2">
        <div class="flex items-center justify-between px-2 pt-1">
          <div id="events-chart-desc" class="text-[10px] opacity-60">Event Rates</div>
          <div class="flex gap-1 items-center">
            <label for="events-pref" class="sr-only">Preferred export format</label>
            <select
              id="events-pref"
              v-model="preferred"
              class="select select-ghost select-xs"
              aria-label="Preferred export format"
            >
              <option value="png">PNG</option>
              <option value="csv">CSV</option>
            </select>
            <button
              class="btn btn-primary btn-xs"
              @click="exportUsingPreferred"
              aria-describedby="events-chart-desc"
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
        <EChart ref="chartRef" class="w-full h-[calc(100%-1.25rem)]" :option="timelineOption" />
      </div>
    </div>
  </div>
</template>
