<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, shallowRef, watch, nextTick } from 'vue'

interface Props {
  option: any
  autoresize?: boolean
  class?: string
}
const props = defineProps<Props>()

const rootEl = ref<HTMLDivElement | null>(null)
let echartsMod: any = null
const chart = shallowRef<any>(null)
let ro: ResizeObserver | null = null

async function ensureLib() {
  if (!echartsMod) echartsMod = await import('echarts')
  return echartsMod.default || echartsMod
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
function getDataURL(options?: any) {
  try {
    return chart.value?.getDataURL?.(options)
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
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  } catch {}
}

defineExpose({ getInstance, getDataURL, downloadPNG })
</script>

<template>
  <div :class="props.class" ref="rootEl" class="w-full h-full"></div>
</template>
