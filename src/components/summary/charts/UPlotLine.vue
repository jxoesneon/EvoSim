<script setup lang="ts">
import { onMounted, onBeforeUnmount, shallowRef, watch, ref, nextTick } from 'vue'

// Minimal uPlot line wrapper. Lazy-loads uplot at runtime.
interface Props {
  // uPlot expects data as [x[], y1[], y2[], ...]
  data: number[][]
  options?: any
  class?: string
}
const props = defineProps<Props>()

const rootEl = ref<HTMLDivElement | null>(null)
let uplotMod: any = null
const chart = shallowRef<any>(null)
let ro: ResizeObserver | null = null

async function createChart() {
  if (!rootEl.value) return
  if (!uplotMod) uplotMod = await import('uplot')
  const UPlot = uplotMod.default || uplotMod
  const size = rootEl.value.getBoundingClientRect()
  const baseOpts = {
    width: Math.max(100, Math.floor(size.width || 400)),
    height: Math.max(80, Math.floor(size.height || 200)),
    series: (props.options?.series ?? []).length > 0 ? props.options.series : [{}, ...(props.data?.slice(1) || []).map(() => ({}))],
    axes: props.options?.axes ?? [ {}, {} ],
    ...props.options,
  }
  // Ensure container is empty
  rootEl.value.innerHTML = ''
  chart.value = new UPlot(baseOpts, props.data || [[], []], rootEl.value)
}

function destroyChart() {
  try { chart.value?.destroy?.() } catch {}
  chart.value = null
}

onMounted(async () => {
  await nextTick()
  await createChart()
  // Handle resize
  if (window && 'ResizeObserver' in window) {
    ro = new ResizeObserver(() => {
      const el = rootEl.value
      if (!el || !chart.value) return
      const rect = el.getBoundingClientRect()
      try { chart.value.setSize({ width: Math.max(100, rect.width), height: Math.max(80, rect.height) }) } catch {}
    })
    if (rootEl.value) ro.observe(rootEl.value)
  }
})

onBeforeUnmount(() => {
  if (ro && rootEl.value) ro.unobserve(rootEl.value)
  ro = null
  destroyChart()
})

watch(() => props.data, (d) => {
  if (chart.value && d) {
    try { chart.value.setData(d) } catch {}
  } else {
    createChart()
  }
}, { deep: true })

watch(() => props.options, () => {
  // Recreate to apply structural option changes
  destroyChart()
  createChart()
}, { deep: true })
</script>

<template>
  <div :class="props.class" ref="rootEl" class="w-full h-full"></div>
</template>
