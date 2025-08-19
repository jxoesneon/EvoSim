<script setup lang="ts">
import { computed, defineAsyncComponent, ref } from 'vue'
import { useSimulationStore } from '../../composables/useSimulationStore'
import { useUserPrefs } from '../../composables/useUserPrefs'
const UPlotLine = defineAsyncComponent(() => import('./charts/UPlotLine.vue'))
const EChart = defineAsyncComponent(() => import('./charts/EChart.vue'))

const store = useSimulationStore()
const avgSeries = computed<number[]>(() => (store.telemetry as any)?.series?.avgSpeed ?? [])
const xData = computed<number[]>(() => avgSeries.value.map((_, i) => i))
const showThreshold = ref(true)
const threshold = computed<number>(() => (store as any)?.simulationParams?.movementThreshold ?? 0.02)
const threshSeries = computed<number[]>(() => avgSeries.value.map(() => threshold.value))
const uData = computed<number[][]>(() => showThreshold.value ? [xData.value, avgSeries.value, threshSeries.value] : [xData.value, avgSeries.value])
const uOpts = computed(() => ({
  axes: [
    { grid: { show: false } },
    { grid: { show: false } },
  ],
  series: showThreshold.value
    ? [{}, { stroke: '#2563eb' }, { stroke: '#ef4444', dash: [6, 6] }]
    : [{}, { stroke: '#2563eb' }],
}))

// Histogram of avg speeds (last N samples)
const HIST_BINS = ref(20)
const histOption = computed(() => {
  const src = avgSeries.value
  const N = Math.min(src.length, 600) // recent window
  const data = N > 0 ? src.slice(src.length - N) : []
  const finite = data.filter((v) => Number.isFinite(v) && v >= 0)
  if (finite.length === 0) {
    return {
      xAxis: { type: 'category', data: [] },
      yAxis: { type: 'value' },
      series: [{ type: 'bar', data: [] }],
      grid: { left: 30, right: 10, top: 10, bottom: 25 },
    }
  }
  const min = 0
  const max = Math.max(...finite)
  const binCount = Math.max(1, HIST_BINS.value)
  const binSize = (max - min) / binCount || 1
  const bins = new Array(binCount).fill(0)
  for (const v of finite) {
    const idx = Math.min(binCount - 1, Math.floor((v - min) / binSize))
    bins[idx]++
  }
  const labels = bins.map((_, i) => {
    const start = min + i * binSize
    const end = start + binSize
    return `${start.toFixed(2)}-${end.toFixed(2)}`
  })
  return {
    xAxis: { type: 'category', data: labels, axisLabel: { interval: Math.ceil(binCount / 6) } },
    yAxis: { type: 'value' },
    series: [{ type: 'bar', data: bins, barWidth: '90%' }],
    tooltip: { trigger: 'axis' },
    grid: { left: 30, right: 10, top: 10, bottom: 25 },
  }
})

// Percentiles for badges (recent window)
function pct(arr: number[], p: number) {
  if (!arr.length) return 0
  const a = [...arr].sort((x, y) => x - y)
  const idx = Math.min(a.length - 1, Math.max(0, Math.floor(p * (a.length - 1))))
  return a[idx]
}
const percentiles = computed(() => {
  const src = avgSeries.value
  const N = Math.min(src.length, 600)
  const finite = (N > 0 ? src.slice(src.length - N) : []).filter((v) => Number.isFinite(v) && v >= 0)
  if (finite.length === 0) return { p50: 0, p90: 0, p99: 0 }
  return { p50: pct(finite, 0.5), p90: pct(finite, 0.9), p99: pct(finite, 0.99) }
})

// Exports
const histRef = ref<any>(null)
const lineRef = ref<HTMLDivElement | null>(null)
const { setLastExport, getLastExport, getPreferredExport, setPreferredExport } = useUserPrefs()
const PREF_HIST = 'summary:move-hist'
const PREF_LINE = 'summary:move-line'
const lastHistFmt = computed(() => getLastExport(PREF_HIST))
const lastLineFmt = computed(() => getLastExport(PREF_LINE))
const prefHist = computed({ get: () => getPreferredExport(PREF_HIST) ?? lastHistFmt.value ?? 'png', set: (v: 'png' | 'csv') => setPreferredExport(PREF_HIST, v) })
const prefLine = computed({ get: () => getPreferredExport(PREF_LINE) ?? lastLineFmt.value ?? 'png', set: (v: 'png' | 'csv') => setPreferredExport(PREF_LINE, v) })

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

function exportHistCsv() {
  setLastExport(PREF_HIST, 'csv')
  const opt: any = histOption.value
  const labels: string[] = opt?.xAxis?.data ?? []
  const bins: number[] = opt?.series?.[0]?.data ?? []
  const rows = [['bin','count'], ...labels.map((l, i) => [l, `${bins[i] ?? 0}`])]
  downloadText('movement-histogram.csv', rows.map(r => r.join(',')).join('\n'))
}

function exportLineCsv() {
  setLastExport(PREF_LINE, 'csv')
  const x = xData.value
  const y = avgSeries.value
  const rows = [['tick','avgSpeed'], ...x.map((xi, i) => [`${xi}`, `${y[i] ?? ''}`])]
  downloadText('movement-line.csv', rows.map(r => r.join(',')).join('\n'))
}

function downloadLinePng() {
  setLastExport(PREF_LINE, 'png')
  const root = lineRef.value as any
  if (!root) return
  const host: any = typeof root.querySelector === 'function' ? root : root.$el
  if (!host || typeof host.querySelector !== 'function') return
  const canvas = host.querySelector('canvas') as HTMLCanvasElement | null
  if (!canvas) return
  const url = canvas.toDataURL('image/png')
  const a = document.createElement('a')
  a.href = url
  a.download = 'movement-line.png'
  a.click()
}
function downloadHistPng() {
  setLastExport(PREF_HIST, 'png')
  ;(histRef as any)?.downloadPNG?.('movement-histogram.png')
}

function exportHistUsingPreferred() {
  const fmt = prefHist.value
  setPreferredExport(PREF_HIST, fmt)
  if (fmt === 'png') return downloadHistPng()
  return exportHistCsv()
}
function exportLineUsingPreferred() {
  const fmt = prefLine.value
  setPreferredExport(PREF_LINE, fmt)
  if (fmt === 'png') return downloadLinePng()
  return exportLineCsv()
}
</script>
<template>
  <div class="card bg-base-100 border p-3 h-64">
    <div class="font-semibold mb-2">Movement & Activity</div>
    <div class="grid grid-cols-2 gap-2 h-full">
      <div class="bg-base-200/30 rounded-md overflow-hidden">
        <div class="flex items-center justify-between px-2 pt-1">
          <div id="move-hist-desc" class="text-[10px] opacity-60">Speed Histogram</div>
          <div class="flex gap-1 items-center">
            <select v-model.number="HIST_BINS" class="select select-ghost select-xs" aria-label="Histogram bins">
              <option :value="10">10 bins</option>
              <option :value="20">20 bins</option>
              <option :value="40">40 bins</option>
            </select>
            <label for="move-hist-pref" class="sr-only">Preferred export format</label>
            <select id="move-hist-pref" v-model="prefHist" class="select select-ghost select-xs" aria-label="Preferred export format">
              <option value="png">PNG</option>
              <option value="csv">CSV</option>
            </select>
            <button class="btn btn-primary btn-xs" @click="exportHistUsingPreferred" aria-describedby="move-hist-desc" aria-label="Export using preferred format">Export</button>
            <span v-if="lastHistFmt" class="badge badge-ghost badge-xs" aria-live="polite">Last: {{ lastHistFmt?.toUpperCase?.() }}</span>
          </div>
        </div>
        <EChart ref="histRef" class="w-full h-[calc(100%-1.25rem)]" :option="histOption" />
      </div>
      <div class="bg-base-200/30 rounded-md rounded-md overflow-hidden">
        <div class="flex items-center justify-between px-2 pt-1">
          <div id="move-line-desc" class="text-[10px] opacity-60">Avg Speed Timeline</div>
          <div class="flex gap-1 items-center">
            <label class="label cursor-pointer gap-1 text-[10px]" :title="`Threshold ${threshold.toFixed?.(3) ?? threshold}`">
              <input type="checkbox" class="toggle toggle-xs" v-model="showThreshold" aria-label="Toggle threshold line" />
              <span>Threshold</span>
            </label>
            <div class="hidden md:flex gap-1">
              <span class="badge badge-outline" :title="'P50 recent avg speed'">P50: {{ percentiles.p50.toFixed(3) }}</span>
              <span class="badge badge-outline" :title="'P90 recent avg speed'">P90: {{ percentiles.p90.toFixed(3) }}</span>
              <span class="badge badge-outline" :title="'P99 recent avg speed'">P99: {{ percentiles.p99.toFixed(3) }}</span>
            </div>
            <label for="move-line-pref" class="sr-only">Preferred export format</label>
            <select id="move-line-pref" v-model="prefLine" class="select select-ghost select-xs" aria-label="Preferred export format">
              <option value="png">PNG</option>
              <option value="csv">CSV</option>
            </select>
            <button class="btn btn-primary btn-xs" @click="exportLineUsingPreferred" aria-describedby="move-line-desc" aria-label="Export using preferred format">Export</button>
            <span v-if="lastLineFmt" class="badge badge-ghost badge-xs" aria-live="polite">Last: {{ lastLineFmt?.toUpperCase?.() }}</span>
          </div>
        </div>
        <UPlotLine ref="lineRef" :data="uData" :options="uOpts" class="w-full h-[calc(100%-1.25rem)]" />
      </div>
    </div>
  </div>
</template>
