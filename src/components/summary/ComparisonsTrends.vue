<script setup lang="ts">
import { computed, defineAsyncComponent, ref } from 'vue'
import { useSimulationStore } from '../../composables/useSimulationStore'

// Async-loaded EChart wrapper used for sparklines
const EChart = defineAsyncComponent(() => import('./charts/EChart.vue'))
const store = useSimulationStore()

// Telemetry series for the just-ended generation
const series = computed(() => (store.telemetry as any)?.series ?? {})

// Controls: smoothing toggle + window selection for recent data views
const smoothingOn = ref<boolean>(false)
const smoothingWin = ref<number>(5)
const windowSel = ref<'full' | '1k' | '200'>('full')

// Simple moving average (SMA) used when smoothing is enabled
function sma(arr: number[], W: number) {
  if (!Array.isArray(arr) || W <= 1) return arr || []
  const n = arr.length
  const out = new Array(n).fill(0)
  let sum = 0
  for (let i = 0; i < n; i++) {
    sum += Number(arr[i]) || 0
    if (i >= W) sum -= Number(arr[i - W]) || 0
    out[i] = i >= W - 1 ? sum / W : Number(arr[i]) || 0
  }
  return out
}

// Clip arrays to the selected time window (full/last1k/last200)
function clipToWindow<T>(x: T[], win: 'full' | '1k' | '200') {
  const n = x.length
  if (win === 'full') return x
  const k = win === '1k' ? 1000 : 200
  return n > k ? x.slice(n - k) : x
}

// Minimal sparkline option builder with hover tooltip
function sparkOption(data: number[], color = '#60a5fa', label = '') {
  const x = data.map((_, i) => i)
  return {
    grid: { left: 0, right: 0, top: 2, bottom: 0 },
    xAxis: { type: 'category', data: x, show: false },
    yAxis: { type: 'value', show: false },
    legend: { show: false },
    tooltip: {
      trigger: 'axis',
      confine: true,
      formatter: (params: any) => {
        const p = Array.isArray(params) ? params[0] : params
        const v = Number(p?.value ?? 0)
        return label ? `${label}: ${v.toFixed(2)}` : v.toFixed(2)
      },
    },
    series: [
      {
        type: 'line',
        data,
        symbol: 'none',
        smooth: true,
        lineStyle: { width: 1.5, color },
        areaStyle: { opacity: 0.15, color },
      },
    ],
  }
}

// Raw series from telemetry
const rawAvg = computed<number[]>(() => series.value?.avgSpeed ?? [])
const rawPop = computed<number[]>(() => series.value?.population?.creatures ?? [])
function diff(arr: number[]) { const out: number[] = []; for (let i=1;i<arr.length;i++){ out.push(Math.max(0,(arr[i]??0)-(arr[i-1]??0))) } return out }
const rawBirths = computed<number[]>(() => diff(series.value?.events?.births ?? []))
const rawDeaths = computed<number[]>(() => diff(series.value?.events?.deaths ?? []))

// Processed (smoothed + windowed) series used for display and exports
const procAvg = computed<number[]>(() => clipToWindow(smoothingOn.value ? sma(rawAvg.value, smoothingWin.value) : rawAvg.value, windowSel.value))
const procPop = computed<number[]>(() => clipToWindow(smoothingOn.value ? sma(rawPop.value, smoothingWin.value) : rawPop.value, windowSel.value))
const procBirths = computed<number[]>(() => clipToWindow(smoothingOn.value ? sma(rawBirths.value, smoothingWin.value) : rawBirths.value, windowSel.value))
const procDeaths = computed<number[]>(() => clipToWindow(smoothingOn.value ? sma(rawDeaths.value, smoothingWin.value) : rawDeaths.value, windowSel.value))

const optAvgSpeed = computed(() => sparkOption(procAvg.value, '#34d399', 'Avg Speed'))
const optPopulation = computed(() => sparkOption(procPop.value, '#60a5fa', 'Population'))
const optBirths = computed(() => sparkOption(procBirths.value, '#f59e0b', 'Births/step'))
const optDeaths = computed(() => sparkOption(procDeaths.value, '#ef4444', 'Deaths/step'))

// Refs for PNG download from each sparkline
const refAvg = ref<any>(null)
const refPop = ref<any>(null)
const refBirths = ref<any>(null)
const refDeaths = ref<any>(null)

// Utility to download CSV text as a file
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

// Export helper (tick, value) using the processed series
function exportCsv(filename: string, x: number[], y: number[], yLabel: string) {
  const rows = [['tick', yLabel], ...x.map((xi, i) => [`${xi}`, `${y[i] ?? ''}`])]
  downloadText(filename, rows.map(r => r.join(',')).join('\n'))
}

const xAvg = computed<number[]>(() => procAvg.value.map((_, i) => i))
const xPop = computed<number[]>(() => procPop.value.map((_, i) => i))
const xBirths = computed<number[]>(() => procBirths.value.map((_, i) => i))
const xDeaths = computed<number[]>(() => procDeaths.value.map((_, i) => i))
</script>
<template>
  <div class="card bg-base-100 border p-3" role="region" aria-label="Comparisons and Trends">
    <div class="font-semibold mb-2">Comparisons & Trends</div>
    <div class="flex items-center gap-2 mb-2 text-[11px] opacity-80">
      <label class="flex items-center gap-1"><input type="checkbox" v-model="smoothingOn" class="checkbox checkbox-xs" /> Smoothing</label>
      <select v-model.number="smoothingWin" class="select select-ghost select-xs" :disabled="!smoothingOn" aria-label="Smoothing window">
        <option :value="5">5</option>
        <option :value="9">9</option>
        <option :value="13">13</option>
      </select>
      <span class="mx-1">·</span>
      <label class="text-[11px]">Window:</label>
      <select v-model="windowSel" class="select select-ghost select-xs" aria-label="Time window">
        <option value="full">Full</option>
        <option value="1k">Last 1000</option>
        <option value="200">Last 200</option>
      </select>
    </div>
    <div class="grid grid-cols-2 md:grid-cols-4 gap-2">
      <div class="bg-base-200/30 rounded-md h-16 p-1" role="group" aria-label="Average Speed sparkline">
        <div class="flex items-center justify-between">
          <div id="trend-avg-desc" class="text-[10px] opacity-60">Avg Speed</div>
          <div class="flex gap-1">
            <button class="btn btn-ghost btn-xs" title="Download PNG" aria-describedby="trend-avg-desc" aria-label="Export Avg Speed sparkline as PNG" @click="refAvg?.downloadPNG?.('trend-avg-speed.png')">PNG</button>
            <button class="btn btn-ghost btn-xs" title="Download CSV" aria-describedby="trend-avg-desc" aria-label="Export Avg Speed data as CSV" @click="exportCsv('trend-avg-speed.csv', xAvg, procAvg, 'avgSpeed')">CSV</button>
          </div>
        </div>
        <EChart ref="refAvg" class="w-full h-12" :option="optAvgSpeed" />
      </div>
      <div class="bg-base-200/30 rounded-md h-16 p-1" role="group" aria-label="Population sparkline">
        <div class="flex items-center justify-between">
          <div id="trend-pop-desc" class="text-[10px] opacity-60">Population</div>
          <div class="flex gap-1">
            <button class="btn btn-ghost btn-xs" title="Download PNG" aria-describedby="trend-pop-desc" aria-label="Export Population sparkline as PNG" @click="refPop?.downloadPNG?.('trend-population.png')">PNG</button>
            <button class="btn btn-ghost btn-xs" title="Download CSV" aria-describedby="trend-pop-desc" aria-label="Export Population data as CSV" @click="exportCsv('trend-population.csv', xPop, procPop, 'population')">CSV</button>
          </div>
        </div>
        <EChart ref="refPop" class="w-full h-12" :option="optPopulation" />
      </div>
      <div class="bg-base-200/30 rounded-md h-16 p-1" role="group" aria-label="Births sparkline">
        <div class="flex items-center justify-between">
          <div id="trend-births-desc" class="text-[10px] opacity-60">Births</div>
          <div class="flex gap-1">
            <button class="btn btn-ghost btn-xs" title="Download PNG" aria-describedby="trend-births-desc" aria-label="Export Births sparkline as PNG" @click="refBirths?.downloadPNG?.('trend-births.png')">PNG</button>
            <button class="btn btn-ghost btn-xs" title="Download CSV" aria-describedby="trend-births-desc" aria-label="Export Births data as CSV" @click="exportCsv('trend-births.csv', xBirths, procBirths, 'birthsPerStep')">CSV</button>
          </div>
        </div>
        <EChart ref="refBirths" class="w-full h-12" :option="optBirths" />
      </div>
      <div class="bg-base-200/30 rounded-md h-16 p-1" role="group" aria-label="Deaths sparkline">
        <div class="flex items-center justify-between">
          <div id="trend-deaths-desc" class="text-[10px] opacity-60">Deaths</div>
          <div class="flex gap-1">
            <button class="btn btn-ghost btn-xs" title="Download PNG" aria-describedby="trend-deaths-desc" aria-label="Export Deaths sparkline as PNG" @click="refDeaths?.downloadPNG?.('trend-deaths.png')">PNG</button>
            <button class="btn btn-ghost btn-xs" title="Download CSV" aria-describedby="trend-deaths-desc" aria-label="Export Deaths data as CSV" @click="exportCsv('trend-deaths.csv', xDeaths, procDeaths, 'deathsPerStep')">CSV</button>
          </div>
        </div>
        <EChart ref="refDeaths" class="w-full h-12" :option="optDeaths" />
      </div>
    </div>
  </div>
</template>
