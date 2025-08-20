<script setup lang="ts">
import { computed, defineAsyncComponent, ref } from 'vue'
import { useSimulationStore } from '../../composables/useSimulationStore'

// Async EChart wrapper used to render the heatmap + scatter overlay
const EChart = defineAsyncComponent(() => import('./charts/EChart.vue'))
const store = useSimulationStore()
const chartRef = ref<any>(null)

// Camera is used to center the sampled window; creatures provide overlay points
const camera = computed(() => store.camera as any)
const creatures = computed<any[]>(() => {
  const src: any = (store as any)?.creatures
  const arr = src && 'value' in (src as any) ? (src as any).value : src
  return Array.isArray(arr) ? arr : []
})

// Grid resolution and sampled world span (centered around camera)
const gridSize = 32
const span = 800 // world units across the sampled window

// Build heatmap + scatter option each render based on camera and creatures
const heatOption = computed(() => {
  const cx = Number((camera.value as any)?.x || 0)
  const cy = Number((camera.value as any)?.y || 0)
  const half = span / 2
  const step = span / (gridSize - 1)
  const data: number[][] = []
  for (let iy = 0; iy < gridSize; iy++) {
    const wy = cy - half + iy * step
    for (let ix = 0; ix < gridSize; ix++) {
      const wx = cx - half + ix * step
      const t = store.sampleTerrain(wx, wy)
      // Visualize water depth primarily; fallback to elevation if dry
      const v = Math.max(t.waterDepth || 0, 0)
      data.push([ix, iy, v])
    }
  }

  // Creature overlay (nearby only)
  const pts: number[][] = []
  const maxDist = half
  const maxDist2 = maxDist * maxDist
  for (const c of creatures.value) {
    const dx = Number(c.x) - cx
    const dy = Number(c.y) - cy
    const d2 = dx * dx + dy * dy
    if (d2 <= maxDist2) {
      const ix = Math.max(0, Math.min(gridSize - 1, Math.round((dx + half) / step)))
      const iy = Math.max(0, Math.min(gridSize - 1, Math.round((dy + half) / step)))
      pts.push([ix, iy])
    }
  }

  return {
    animation: false,
    grid: { left: 10, right: 10, top: 10, bottom: 10 },
    xAxis: { type: 'category', data: Array.from({ length: gridSize }, (_, i) => i), show: false },
    yAxis: { type: 'category', data: Array.from({ length: gridSize }, (_, i) => i), show: false },
    visualMap: {
      min: 0,
      max: 1.5,
      calculable: false,
      orient: 'horizontal',
      left: 'center',
      bottom: 0,
      inRange: { color: ['#0ea5e9', '#0369a1', '#022c22'] },
      show: false,
    },
    series: [
      { type: 'heatmap', data, emphasis: { itemStyle: { borderColor: '#000', borderWidth: 0 } } },
      { type: 'scatter', data: pts, symbolSize: 4, itemStyle: { color: '#fbbf24' } },
    ],
  }
})
</script>
<template>
  <div class="card bg-base-100 border p-3 h-64">
    <div class="flex items-center justify-between mb-2">
      <div class="font-semibold">Spatial & Environment</div>
      <!-- Export current heatmap as PNG via EChart ref -->
      <button
        class="btn btn-ghost btn-xs"
        title="Download PNG"
        aria-label="Export spatial heatmap as PNG"
        @click="chartRef?.downloadPNG?.('spatial-environment.png')"
      >
        PNG
      </button>
    </div>
    <EChart ref="chartRef" class="w-full h-52" :option="heatOption" />
  </div>
</template>
