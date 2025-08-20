<script setup lang="ts">
import { computed, defineAsyncComponent } from 'vue'
import { useSimulationStore } from '../../composables/useSimulationStore'
import { useUserPrefs } from '../../composables/useUserPrefs'
// Emit inline edit requests so parent can focus Controls for specific param
const emit = defineEmits<{
  (e: 'edit', key: 'plantSpawnRate' | 'waterLevel'): void
}>()
const store = useSimulationStore()
const params = computed(() => store.simulationParams as any)
const prevParams = computed<Record<string, any> | null>(() => (store as any).lastGenParams ?? null)

function fmtDelta(curr?: number, prev?: number) {
  if (typeof curr !== 'number' || typeof prev !== 'number') return null
  const d = curr - prev
  if (!Number.isFinite(d) || d === 0) return { text: '±0', sign: 0 }
  const sign = d > 0 ? 1 : -1
  const mag = Math.abs(d)
  const places = mag < 0.01 ? 3 : mag < 0.1 ? 2 : 2
  return { text: `${sign > 0 ? '+' : '−'}${mag.toFixed(places)}`, sign }
}

const deltaPlantSpawn = computed(() =>
  fmtDelta(params.value?.plantSpawnRate, prevParams.value?.plantSpawnRate),
)
const deltaWaterLevel = computed(() =>
  fmtDelta(params.value?.waterLevel, prevParams.value?.waterLevel),
)

const EChart = defineAsyncComponent(() => import('./charts/EChart.vue'))
import { ref } from 'vue'
const chartTempRef = ref<any>(null)
const chartUvRef = ref<any>(null)
const envSeries = computed(() => ((store.telemetry as any)?.series?.environment ?? {}) as any)
const envX = computed<number[]>(() => {
  const t: number[] = envSeries.value?.temperatureC ?? []
  return t.map((_, i) => i)
})
const envOption = computed(() => {
  const t: number[] = envSeries.value?.temperatureC ?? []
  const h: number[] = envSeries.value?.humidity01 ?? []
  const p: number[] = envSeries.value?.precipitation01 ?? []
  return {
    tooltip: {
      trigger: 'axis',
      confine: true,
      formatter: (params: any[]) => {
        const lines = (params || []).map((p: any) => {
          const name = p?.seriesName || ''
          const v = Number(p?.value ?? 0)
          if (name.includes('Temp')) return `${name}: ${v.toFixed(1)} °C`
          return `${name}: ${v.toFixed(2)}`
        })
        return lines.join('<br/>')
      },
    },
    legend: { top: 0 },
    grid: { left: 40, right: 10, top: 30, bottom: 28 },
    xAxis: { type: 'category', data: envX.value },
    yAxis: [
      { type: 'value', name: 'Temp (C)' },
      { type: 'value', name: 'Rel', min: 0, max: 1 },
    ],
    series: [
      { name: 'Temp (C)', type: 'line', symbol: 'none', smooth: true, data: t, yAxisIndex: 0 },
      { name: 'Humidity', type: 'line', symbol: 'none', smooth: true, data: h, yAxisIndex: 1 },
      { name: 'Precip', type: 'line', symbol: 'none', smooth: true, data: p, yAxisIndex: 1 },
    ],
  }
})

const envOption2 = computed(() => {
  const uv: number[] = envSeries.value?.uv01 ?? []
  const vis: number[] = envSeries.value?.visibility01 ?? []
  const wind: number[] = envSeries.value?.windSpeed ?? []
  const x = (uv.length ? uv : vis.length ? vis : wind).map((_, i) => i)
  return {
    tooltip: {
      trigger: 'axis',
      confine: true,
      formatter: (params: any[]) => {
        const lines = (params || []).map((p: any) => {
          const name = p?.seriesName || ''
          const v = Number(p?.value ?? 0)
          if (name.includes('Wind')) return `${name}: ${v.toFixed(2)} m/s`
          return `${name}: ${v.toFixed(2)}`
        })
        return lines.join('<br/>')
      },
    },
    legend: { top: 0 },
    grid: { left: 40, right: 10, top: 30, bottom: 28 },
    xAxis: { type: 'category', data: x },
    yAxis: [
      { type: 'value', name: 'Wind (m/s)' },
      { type: 'value', name: 'Rel', min: 0, max: 1 },
    ],
    series: [
      { name: 'Wind', type: 'line', symbol: 'none', smooth: true, data: wind, yAxisIndex: 0 },
      { name: 'UV', type: 'line', symbol: 'none', smooth: true, data: uv, yAxisIndex: 1 },
      { name: 'Visibility', type: 'line', symbol: 'none', smooth: true, data: vis, yAxisIndex: 1 },
    ],
  }
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

const { setLastExport, getLastExport, getPreferredExport, setPreferredExport } = useUserPrefs()
const PREF_TEMP = 'summary:env-temp'
const PREF_UV = 'summary:env-uv'
const lastTempFmt = computed(() => getLastExport(PREF_TEMP))
const lastUvFmt = computed(() => getLastExport(PREF_UV))
const preferredTemp = computed({
  get: () => getPreferredExport(PREF_TEMP) ?? lastTempFmt.value ?? 'png',
  set: (fmt: 'png' | 'csv') => setPreferredExport(PREF_TEMP, fmt),
})
const preferredUv = computed({
  get: () => getPreferredExport(PREF_UV) ?? lastUvFmt.value ?? 'png',
  set: (fmt: 'png' | 'csv') => setPreferredExport(PREF_UV, fmt),
})

function exportTempCsv() {
  setLastExport(PREF_TEMP, 'csv')
  const t: number[] = envSeries.value?.temperatureC ?? []
  const h: number[] = envSeries.value?.humidity01 ?? []
  const p: number[] = envSeries.value?.precipitation01 ?? []
  const n = Math.max(t.length, h.length, p.length)
  const rows = [['tick', 'temperatureC', 'humidity01', 'precipitation01']]
  for (let i = 0; i < n; i++) rows.push([`${i}`, `${t[i] ?? ''}`, `${h[i] ?? ''}`, `${p[i] ?? ''}`])
  const csv = rows.map((r) => r.join(',')).join('\n')
  downloadText('environment-temp.csv', csv)
}

function exportUvCsv() {
  setLastExport(PREF_UV, 'csv')
  const uv: number[] = envSeries.value?.uv01 ?? []
  const vis: number[] = envSeries.value?.visibility01 ?? []
  const wind: number[] = envSeries.value?.windSpeed ?? []
  const n = Math.max(uv.length, vis.length, wind.length)
  const rows = [['tick', 'uv01', 'visibility01', 'windSpeed']]
  for (let i = 0; i < n; i++)
    rows.push([`${i}`, `${uv[i] ?? ''}`, `${vis[i] ?? ''}`, `${wind[i] ?? ''}`])
  const csv = rows.map((r) => r.join(',')).join('\n')
  downloadText('environment-uv-wind.csv', csv)
}

function exportTempPng() {
  setLastExport(PREF_TEMP, 'png')
  ;(chartTempRef as any)?.downloadPNG?.('environment-temp.png')
}

function exportUvPng() {
  setLastExport(PREF_UV, 'png')
  ;(chartUvRef as any)?.downloadPNG?.('environment-uv-wind.png')
}

function exportTempUsingPreferred() {
  const fmt = preferredTemp.value
  setPreferredExport(PREF_TEMP, fmt)
  if (fmt === 'png') return exportTempPng()
  return exportTempCsv()
}
function exportUvUsingPreferred() {
  const fmt = preferredUv.value
  setPreferredExport(PREF_UV, fmt)
  if (fmt === 'png') return exportUvPng()
  return exportUvCsv()
}
</script>
<template>
  <div class="card bg-base-100 border p-3 h-64" role="region" aria-label="Environment summary">
    <div class="font-semibold mb-2">Environment</div>
    <div class="grid grid-cols-2 gap-3 h-full">
      <div class="stat bg-base-100 rounded-xl p-3 border">
        <div class="flex items-center justify-between">
          <div class="stat-title text-xs">Plant Spawn Rate</div>
          <button
            class="btn btn-ghost btn-xs"
            @click="emit('edit', 'plantSpawnRate')"
            aria-label="Edit Plant Spawn Rate in Controls"
          >
            Edit
          </button>
        </div>
        <div class="flex items-center gap-2">
          <div class="stat-value text-lg">{{ params.plantSpawnRate?.toFixed?.(2) ?? '—' }}</div>
          <span
            v-if="deltaPlantSpawn"
            class="badge badge-sm"
            :class="
              deltaPlantSpawn.sign > 0
                ? 'badge-success'
                : deltaPlantSpawn.sign < 0
                  ? 'badge-error'
                  : 'badge-ghost'
            "
            :title="`Δ vs prev gen: ${deltaPlantSpawn.text}`"
            aria-live="polite"
            >{{ deltaPlantSpawn.text }}</span
          >
        </div>
      </div>
      <div class="stat bg-base-100 rounded-xl p-3 border">
        <div class="flex items-center justify-between">
          <div class="stat-title text-xs">Water Level</div>
          <button
            class="btn btn-ghost btn-xs"
            @click="emit('edit', 'waterLevel')"
            aria-label="Edit Water Level in Controls"
          >
            Edit
          </button>
        </div>
        <div class="flex items-center gap-2">
          <div class="stat-value text-lg">{{ params.waterLevel?.toFixed?.(2) ?? '—' }}</div>
          <span
            v-if="deltaWaterLevel"
            class="badge badge-sm"
            :class="
              deltaWaterLevel.sign > 0
                ? 'badge-success'
                : deltaWaterLevel.sign < 0
                  ? 'badge-error'
                  : 'badge-ghost'
            "
            :title="`Δ vs prev gen: ${deltaWaterLevel.text}`"
            aria-live="polite"
            >{{ deltaWaterLevel.text }}</span
          >
        </div>
      </div>
      <div class="bg-base-200/30 rounded-xl p-2 border col-span-2 min-h-0 overflow-hidden">
        <div class="flex items-center justify-between mb-1">
          <div id="env-temp-desc" class="text-xs opacity-70">Temp / Humidity / Precip</div>
          <div class="flex gap-1 items-center">
            <label for="env-temp-pref" class="sr-only">Preferred export format</label>
            <select
              id="env-temp-pref"
              v-model="preferredTemp"
              class="select select-ghost select-xs"
              aria-label="Preferred export format"
            >
              <option value="png">PNG</option>
              <option value="csv">CSV</option>
            </select>
            <button
              class="btn btn-primary btn-xs"
              @click="exportTempUsingPreferred"
              aria-describedby="env-temp-desc"
              aria-label="Export using preferred format"
            >
              Export
            </button>
            <span
              v-if="lastTempFmt"
              class="badge badge-ghost badge-xs"
              aria-live="polite"
              title="Last used export format"
              >Last: {{ lastTempFmt?.toUpperCase?.() }}</span
            >
          </div>
        </div>
        <EChart ref="chartTempRef" class="w-full h-32" :option="envOption" />
      </div>
      <div class="bg-base-200/30 rounded-xl p-2 border col-span-2 min-h-0 overflow-hidden">
        <div class="flex items-center justify-between mb-1">
          <div id="env-uv-desc" class="text-xs opacity-70">UV / Visibility / Wind</div>
          <div class="flex gap-1 items-center">
            <label for="env-uv-pref" class="sr-only">Preferred export format</label>
            <select
              id="env-uv-pref"
              v-model="preferredUv"
              class="select select-ghost select-xs"
              aria-label="Preferred export format"
            >
              <option value="png">PNG</option>
              <option value="csv">CSV</option>
            </select>
            <button
              class="btn btn-primary btn-xs"
              @click="exportUvUsingPreferred"
              aria-describedby="env-uv-desc"
              aria-label="Export using preferred format"
            >
              Export
            </button>
            <span
              v-if="lastUvFmt"
              class="badge badge-ghost badge-xs"
              aria-live="polite"
              title="Last used export format"
              >Last: {{ lastUvFmt?.toUpperCase?.() }}</span
            >
          </div>
        </div>
        <EChart ref="chartUvRef" class="w-full h-32" :option="envOption2" />
      </div>
    </div>
  </div>
</template>
