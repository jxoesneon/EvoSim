<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, shallowRef, watch, nextTick } from 'vue'
import type { ECharts, EChartsOption } from 'echarts'

interface Props {
  option: EChartsOption
  autoresize?: boolean
  class?: string
}
const props = defineProps<Props>()

const rootEl = ref<HTMLDivElement | null>(null)
let echartsMod: typeof import('echarts') | null = null
const chart = shallowRef<ECharts | null>(null)
let ro: ResizeObserver | null = null

async function ensureLib() {
  if (!echartsMod) echartsMod = await import('echarts')
  const mod = echartsMod.default ?? echartsMod
  return mod as typeof import('echarts')
}

async function createChart() {
  if (!rootEl.value) return
  const echarts = await ensureLib()
  // dispose previous instance if any
  try {
    chart.value?.dispose?.()
  } catch {}
  chart.value = echarts.init(rootEl.value)
  if (props.option) chart.value.setOption(props.option, true)
}

onMounted(async () => {
  await nextTick()
  await createChart()
  if ((props.autoresize ?? true) && 'ResizeObserver' in window) {
    ro = new ResizeObserver(() => {
      const el = rootEl.value
      if (!el || !chart.value) return
      try {
        chart.value.resize()
      } catch {}
    })
    if (rootEl.value) ro.observe(rootEl.value)
  }
})

onBeforeUnmount(() => {
  if (ro && rootEl.value) ro.unobserve(rootEl.value)
  ro = null
  try {
    chart.value?.dispose?.()
  } catch {}
  chart.value = null
})

watch(
  () => props.option,
  (opt) => {
    if (!chart.value) {
      createChart()
    } else if (opt) {
      try {
        chart.value.setOption(opt, true)
      } catch {}
    }
  },
  { deep: true },
)

// Expose helpers for parent components (PNG export, instance access)
function getInstance() {
  return chart.value
}
function getDataURL(options?: Parameters<ECharts['getDataURL']>[0]) {
  try {
    return chart.value?.getDataURL?.(options as Parameters<ECharts['getDataURL']>[0])
  } catch {
    return null
  }
}
function downloadPNG(filename = 'chart.png') {
  try {
    const url = chart.value?.getDataURL?.({
      type: 'png',
      pixelRatio: 2,
      backgroundColor: '#ffffff',
    })
    if (!url) return
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
  } catch {}
}

defineExpose({ getInstance, getDataURL, downloadPNG })
</script>

<template>
  <div :class="props.class" ref="rootEl" class="w-full h-full"></div>
</template>
