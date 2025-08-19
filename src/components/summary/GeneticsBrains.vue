<script setup lang="ts">
import { computed, defineAsyncComponent, ref } from 'vue'
import { useSimulationStore } from '../../composables/useSimulationStore'
import { useUserPrefs } from '../../composables/useUserPrefs'

// Async EChart wrapper used by the three histograms
const EChart = defineAsyncComponent(() => import('./charts/EChart.vue'))
const store = useSimulationStore()
const chartEyesRef = ref<any>(null)
const chartSightRef = ref<any>(null)
const chartFovRef = ref<any>(null)

// Source data (phenotypes) for histograms
const creatures = computed<any[]>(() => {
  const src: any = (store as any)?.creatures
  const arr = src && 'value' in (src as any) ? (src as any).value : src
  return Array.isArray(arr) ? arr : []
})

const eyesCounts = computed<number[]>(() => {
  const list = Array.isArray(creatures.value) ? creatures.value : []
  return list.map((c: any) => Number(c?.phenotype?.eyesCount ?? 2) || 2)
})
const sightRanges = computed<number[]>(() => {
  const list = Array.isArray(creatures.value) ? creatures.value : []
  return list.map((c: any) => Number(c?.phenotype?.sightRange ?? 90) || 90)
})
const fovs = computed<number[]>(() => {
  const list = Array.isArray(creatures.value) ? creatures.value : []
  return list.map((c: any) => Number(c?.phenotype?.fieldOfViewDeg ?? 180) || 180)
})

// Discrete eyes count (1..6) frequency
function countByEyes(arr: number[]) {
  const res = [0, 0, 0, 0, 0, 0]
  for (const v of arr) {
    const i = Math.min(6, Math.max(1, Math.round(v))) - 1
    res[i]++
  }
  return res
}
// Generic histogram helper for continuous ranges
function hist(arr: number[], min: number, max: number, bins: number) {
  const res = new Array(bins).fill(0)
  if (max <= min) return res
  const w = (max - min) / bins
  for (const v of arr) {
    const idx = Math.max(0, Math.min(bins - 1, Math.floor((Number(v) - min) / w)))
    res[idx]++
  }
  return res
}

// Bar chart option: Eyes count distribution
const eyesOption = computed(() => ({
  grid: { left: 30, right: 10, top: 20, bottom: 20 },
  xAxis: { type: 'category', data: ['1','2','3','4','5','6'] },
  yAxis: { type: 'value', minInterval: 1 },
  legend: { show: false },
  series: [{ type: 'bar', data: countByEyes(eyesCounts.value), itemStyle: { color: '#60a5fa' } }],
  tooltip: {
    trigger: 'axis',
    confine: true,
    formatter: (params: any[]) => {
      const p = params?.[0]
      if (!p) return ''
      return `Eyes=${p.axisValue}: ${p.data} creatures`
    },
  },
}))

// Sight histogram with selectable bin counts
const sightBins = ref<number>(10)
const sightMin = 20, sightMax = 200
const sightOption = computed(() => {
  const bins = sightBins.value
  const data = hist(sightRanges.value, sightMin, sightMax, bins)
  const labels = Array.from({ length: bins }, (_, i) => Math.round(sightMin + (i + 0.5) * ((sightMax - sightMin) / bins)))
  return {
    grid: { left: 30, right: 10, top: 20, bottom: 20 },
    xAxis: { type: 'category', data: labels },
    yAxis: { type: 'value', minInterval: 1 },
    legend: { show: false },
    series: [{ type: 'bar', data, itemStyle: { color: '#34d399' } }],
    tooltip: {
      trigger: 'axis',
      confine: true,
      formatter: (params: any[]) => {
        const p = params?.[0]
        if (!p) return ''
        return `Sight ~${p.axisValue}: ${p.data} creatures`
      },
    },
  }
})

// CSV download utility shared by export functions
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

// Export preferences (remember last used and preferred format per chart)
const { setLastExport, getLastExport, getPreferredExport, setPreferredExport } = useUserPrefs()
const PREF_EYES = 'summary:gen-eyes'
const PREF_SIGHT = 'summary:gen-sight'
const PREF_FOV = 'summary:gen-fov'
const lastEyesFmt = computed(() => getLastExport(PREF_EYES))
const lastSightFmt = computed(() => getLastExport(PREF_SIGHT))
const lastFovFmt = computed(() => getLastExport(PREF_FOV))
const prefEyes = computed({ get: () => getPreferredExport(PREF_EYES) ?? lastEyesFmt.value ?? 'png', set: (v: 'png' | 'csv') => setPreferredExport(PREF_EYES, v) })
const prefSight = computed({ get: () => getPreferredExport(PREF_SIGHT) ?? lastSightFmt.value ?? 'png', set: (v: 'png' | 'csv') => setPreferredExport(PREF_SIGHT, v) })
const prefFov = computed({ get: () => getPreferredExport(PREF_FOV) ?? lastFovFmt.value ?? 'png', set: (v: 'png' | 'csv') => setPreferredExport(PREF_FOV, v) })

// CSV/PNG exports for Eyes
function exportEyesCsv() {
  setLastExport(PREF_EYES, 'csv')
  const counts = countByEyes(eyesCounts.value)
  const rows = [['eyes','count']]
  for (let i = 0; i < counts.length; i++) rows.push([`${i+1}`, `${counts[i]}`])
  downloadText('genetics-eyes.csv', rows.map(r => r.join(',')).join('\n'))
}

// CSV export respects current sightBins
function exportSightCsv() {
  setLastExport(PREF_SIGHT, 'csv')
  const bins = sightBins.value
  const data = hist(sightRanges.value, sightMin, sightMax, bins)
  const labels = Array.from({ length: bins }, (_, i) => Math.round(sightMin + (i + 0.5) * ((sightMax - sightMin) / bins)))
  const rows = [['sight_mid','count']]
  for (let i = 0; i < data.length; i++) rows.push([`${labels[i]}`, `${data[i]}`])
  downloadText('genetics-sight.csv', rows.map(r => r.join(',')).join('\n'))
}

// CSV export respects current fovBins
function exportFovCsv() {
  setLastExport(PREF_FOV, 'csv')
  const bins = fovBins.value
  const data = hist(fovs.value, fovMin, fovMax, bins)
  const labels = Array.from({ length: bins }, (_, i) => Math.round(fovMin + (i + 0.5) * ((fovMax - fovMin) / bins)))
  const rows = [['fov_mid_deg','count']]
  for (let i = 0; i < data.length; i++) rows.push([`${labels[i]}`, `${data[i]}`])
  downloadText('genetics-fov.csv', rows.map(r => r.join(',')).join('\n'))
}

// PNG exports via EChart refs
function exportEyesPng() {
  setLastExport(PREF_EYES, 'png')
  ;(chartEyesRef as any)?.downloadPNG?.('genetics-eyes.png')
}
function exportSightPng() {
  setLastExport(PREF_SIGHT, 'png')
  ;(chartSightRef as any)?.downloadPNG?.('genetics-sight.png')
}
function exportFovPng() {
  setLastExport(PREF_FOV, 'png')
  ;(chartFovRef as any)?.downloadPNG?.('genetics-fov.png')
}

function exportEyesUsingPreferred() {
  const fmt = prefEyes.value
  setPreferredExport(PREF_EYES, fmt)
  if (fmt === 'png') return exportEyesPng()
  return exportEyesCsv()
}
function exportSightUsingPreferred() {
  const fmt = prefSight.value
  setPreferredExport(PREF_SIGHT, fmt)
  if (fmt === 'png') return exportSightPng()
  return exportSightCsv()
}
function exportFovUsingPreferred() {
  const fmt = prefFov.value
  setPreferredExport(PREF_FOV, fmt)
  if (fmt === 'png') return exportFovPng()
  return exportFovCsv()
}

// Small helpers for header summary stats
const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + (Number(b) || 0), 0) / arr.length : 0)
function modeEyes(arr: number[]) {
  const counts = new Map<number, number>()
  for (const v of arr) counts.set(v, (counts.get(v) || 0) + 1)
  let best = 2, bestC = -1
  for (const [k, c] of counts) {
    if (c > bestC || (c === bestC && k < best)) { best = k; bestC = c }
  }
  return best
}
const avgEyes = computed(() => avg(eyesCounts.value))
const avgSight = computed(() => avg(sightRanges.value))
const avgFov = computed(() => avg(fovs.value))
const modeEyesCount = computed(() => modeEyes(eyesCounts.value))

// Hall of Fame summary (top creatures this generation)
type HofRow = { id: string; name?: string; lifespan?: number; eyes: number; sight: number; fov: number }
// Hall of Fame table mapped to genetic vision specs
const hofTop = computed<HofRow[]>(() => {
  const list = (store.getHallOfFameTop?.(5) as any[]) ?? []
  return list.map((e: any) => {
    const vs = store.getVisionSpec?.(e.id) || { eyesCount: 2, sightRange: 90, fieldOfViewDeg: 180 }
    return {
      id: e.id,
      name: e.name || e.id?.slice?.(0, 6),
      lifespan: Number(e.lifespan) || 0,
      eyes: Number(vs.eyesCount) || 2,
      sight: Math.round(Number(vs.sightRange) || 90),
      fov: Math.round(Number(vs.fieldOfViewDeg) || 180),
    }
  })
})

const fovBins = ref<number>(9)
const fovMin = 60, fovMax = 300
const fovOption = computed(() => {
  const bins = fovBins.value
  const data = hist(fovs.value, fovMin, fovMax, bins)
  const labels = Array.from({ length: bins }, (_, i) => Math.round(fovMin + (i + 0.5) * ((fovMax - fovMin) / bins)))
  return {
    grid: { left: 30, right: 10, top: 20, bottom: 20 },
    xAxis: { type: 'category', data: labels },
    yAxis: { type: 'value', minInterval: 1 },
    legend: { show: false },
    series: [{ type: 'bar', data, itemStyle: { color: '#f59e0b' } }],
    tooltip: {
      trigger: 'axis',
      confine: true,
      formatter: (params: any[]) => {
        const p = params?.[0]
        if (!p) return ''
        return `FOV ~${p.axisValue}°: ${p.data} creatures`
      },
    },
  }
})
</script>
<template>
  <div class="card bg-base-100 border p-3 h-64" role="region" aria-label="Genetics and Brains summary">
    <div class="font-semibold mb-2">Genetics & Brains</div>
    <div class="text-[11px] md:text-xs opacity-80 mb-1" role="note" aria-live="polite">
      Avg Eyes: {{ avgEyes.toFixed(2) }} · Most Common: {{ modeEyesCount }} · Avg Sight: {{ avgSight.toFixed(0) }} · Avg FOV: {{ avgFov.toFixed(0) }}°
    </div>
    <div class="grid grid-cols-3 gap-2 h-full">
      <div class="bg-base-200/30 rounded-md p-2" role="group" aria-label="Eyes count histogram">
        <div class="flex items-center justify-between">
          <div id="gen-eyes-desc" class="text-[10px] opacity-60">Eyes Count</div>
          <div class="flex gap-1 items-center">
            <label for="gen-eyes-pref" class="sr-only">Preferred export format</label>
            <select id="gen-eyes-pref" v-model="prefEyes" class="select select-ghost select-xs" aria-label="Preferred export format">
              <option value="png">PNG</option>
              <option value="csv">CSV</option>
            </select>
            <button class="btn btn-primary btn-xs" @click="exportEyesUsingPreferred" aria-describedby="gen-eyes-desc" aria-label="Export using preferred format">Export</button>
            <span v-if="lastEyesFmt" class="badge badge-ghost badge-xs" aria-live="polite" title="Last used export format">Last: {{ lastEyesFmt?.toUpperCase?.() }}</span>
          </div>
        </div>
        <EChart ref="chartEyesRef" class="w-full h-44" :option="eyesOption" />
      </div>
      <div class="bg-base-200/30 rounded-md p-2" role="group" aria-label="Sight range histogram">
        <div class="flex items-center justify-between">
          <div id="gen-sight-desc" class="text-[10px] opacity-60">Sight Range</div>
          <div class="flex gap-1 items-center">
            <label for="gen-sight-bins" class="sr-only">Sight bins</label>
            <select id="gen-sight-bins" v-model.number="sightBins" class="select select-ghost select-xs" aria-label="Sight histogram bins">
              <option :value="7">7 bins</option>
              <option :value="10">10 bins</option>
              <option :value="13">13 bins</option>
            </select>
            <label for="gen-sight-pref" class="sr-only">Preferred export format</label>
            <select id="gen-sight-pref" v-model="prefSight" class="select select-ghost select-xs" aria-label="Preferred export format">
              <option value="png">PNG</option>
              <option value="csv">CSV</option>
            </select>
            <button class="btn btn-primary btn-xs" @click="exportSightUsingPreferred" aria-describedby="gen-sight-desc" aria-label="Export using preferred format">Export</button>
            <span v-if="lastSightFmt" class="badge badge-ghost badge-xs" aria-live="polite" title="Last used export format">Last: {{ lastSightFmt?.toUpperCase?.() }}</span>
          </div>
        </div>
        <EChart ref="chartSightRef" class="w-full h-44" :option="sightOption" />
      </div>
      <div class="bg-base-200/30 rounded-md p-2" role="group" aria-label="Field of view histogram">
        <div class="flex items-center justify-between">
          <div id="gen-fov-desc" class="text-[10px] opacity-60">Field of View (deg)</div>
          <div class="flex gap-1 items-center">
            <label for="gen-fov-bins" class="sr-only">FOV bins</label>
            <select id="gen-fov-bins" v-model.number="fovBins" class="select select-ghost select-xs" aria-label="FOV histogram bins">
              <option :value="7">7 bins</option>
              <option :value="9">9 bins</option>
              <option :value="13">13 bins</option>
            </select>
            <label for="gen-fov-pref" class="sr-only">Preferred export format</label>
            <select id="gen-fov-pref" v-model="prefFov" class="select select-ghost select-xs" aria-label="Preferred export format">
              <option value="png">PNG</option>
              <option value="csv">CSV</option>
            </select>
            <button class="btn btn-primary btn-xs" @click="exportFovUsingPreferred" aria-describedby="gen-fov-desc" aria-label="Export using preferred format">Export</button>
            <span v-if="lastFovFmt" class="badge badge-ghost badge-xs" aria-live="polite" title="Last used export format">Last: {{ lastFovFmt?.toUpperCase?.() }}</span>
          </div>
        </div>
        <EChart ref="chartFovRef" class="w-full h-44" :option="fovOption" />
      </div>
    </div>
    <div class="mt-2">
      <div class="text-[11px] md:text-xs opacity-70 mb-1">Top Creatures (Hall of Fame)</div>
      <div class="overflow-x-auto">
        <table class="table table-xs">
          <thead>
            <tr>
              <th scope="col">ID</th>
              <th scope="col">Eyes</th>
              <th scope="col">Sight</th>
              <th scope="col">FOV</th>
              <th scope="col">Lifespan</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in hofTop" :key="r.id">
              <td class="font-mono" :title="r.id">{{ r.name }}</td>
              <td>{{ r.eyes }}</td>
              <td>{{ r.sight }}</td>
              <td>{{ r.fov }}°</td>
              <td>{{ r.lifespan }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
