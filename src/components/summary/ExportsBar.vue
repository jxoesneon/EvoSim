<script setup lang="ts">
import { ref } from 'vue'
import { useSimulationStore } from '../../composables/useSimulationStore'

const store = useSimulationStore()
const busy = ref(false)

async function exportPng() {
  const el = document.getElementById('gen-summary-container')
  if (!el) return
  busy.value = true
  try {
    const mod = await import('html-to-image')
    const dataUrl = await mod.toPng(el, { pixelRatio: 2, quality: 0.95, skipFonts: true })
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = `generation-summary-gen${(store.generation as any).value}.png`
    a.click()
  } catch (e) {
    console.warn('PNG export failed', e)
  } finally {
    busy.value = false
  }
}

async function exportSvg() {
  const el = document.getElementById('gen-summary-container')
  if (!el) return
  busy.value = true
  try {
    const mod = await import('html-to-image')
    const dataUrl = await mod.toSvg(el, { pixelRatio: 2, skipFonts: true })
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = `generation-summary-gen${(store.generation as any).value}.svg`
    a.click()
  } catch (e) {
    console.warn('SVG export failed', e)
  } finally {
    busy.value = false
  }
}

function exportJson() {
  try {
    const payload = {
      generation: (store.generation as any).value,
      lastGenEnd: (store.lastGenEnd as any).value,
      telemetry: store.telemetry,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `generation-summary-gen${(store.generation as any).value}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch (e) {
    console.warn('JSON export failed', e)
  }
}

function exportCsv() {
  try {
    const t: any = store.telemetry as any
    const avg = t?.series?.avgSpeed ?? []
    const pc = t?.series?.population?.creatures ?? []
    const pp = t?.series?.population?.plants ?? []
    const po = t?.series?.population?.corpses ?? []
    const len = Math.max(avg.length, pc.length, pp.length, po.length)
    const header = 'idx,avg_speed,creatures,plants,corpses\n'
    let rows = ''
    for (let i = 0; i < len; i++) {
      const row = [i, avg[i] ?? '', pc[i] ?? '', pp[i] ?? '', po[i] ?? ''].join(',')
      rows += row + '\n'
    }
    const csv = header + rows
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `generation-summary-gen${(store.generation as any).value}.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch (e) {
    console.warn('CSV export failed', e)
  }
}

async function copySettings() {
  try {
    const payload = {
      generation: (store.generation as any).value,
      lastGenEnd: (store.lastGenEnd as any).value,
      params: store.simulationParams,
      notes: 'Copy of current generation summary settings and metadata',
      copiedAt: new Date().toISOString(),
    }
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2))
  } catch (e) {
    console.warn('Copy settings failed', e)
  }
}
</script>
<template>
  <div class="flex items-center justify-between text-sm opacity-80">
    <div class="space-x-2">
      <button class="btn btn-xs" :disabled="busy" @click="exportPng">Export PNG</button>
      <button class="btn btn-xs" :disabled="busy" @click="exportSvg">Export SVG</button>
      <button class="btn btn-xs" @click="exportJson">Export JSON</button>
      <button class="btn btn-xs" @click="exportCsv">Export CSV</button>
    </div>
    <div class="space-x-2">
      <button class="btn btn-ghost btn-xs" @click="copySettings">Copy settings</button>
      <button class="btn btn-ghost btn-xs">Help/Docs</button>
    </div>
  </div>
</template>
