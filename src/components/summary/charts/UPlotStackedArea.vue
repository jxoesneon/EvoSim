<script setup lang="ts">
import { onMounted, onBeforeUnmount, shallowRef, ref, watch, nextTick } from 'vue'

// Props: data is [x[], y1[], y2[], ...]
interface Props {
  data: number[][]
  colors?: string[]
  fillOpacity?: number
  class?: string
}
const props = defineProps<Props>()

const rootEl = ref<HTMLDivElement | null>(null)
const chart = shallowRef<any>(null)
let uplotMod: any = null
let ro: ResizeObserver | null = null
let observedEl: Element | null = null
let lastW = 0
let lastH = 0
let fixedH = 0

function isValidData(d: any): d is number[][] {
  return (
    Array.isArray(d) &&
    d.length >= 2 &&
    d.every((a) => Array.isArray(a)) &&
    d.every((a) => a.length === d[0].length)
  )
}

// Build cumulative stacked series from y-series
function makeCumulative(d: number[][]): number[][] {
  if (!isValidData(d)) return d
  const x = d[0]
  const ys = d.slice(1)
  const cum = ys.map((arr) => arr.slice())
  for (let i = 0; i < x.length; i++) {
    let run = 0
    for (let s = 0; s < ys.length; s++) {
      run += ys[s]?.[i] ?? 0
      cum[s][i] = run
    }
  }
  return [x, ...cum]
}

function toRgba(hex: string, alpha: number): string {
  let h = (hex || '').replace('#', '')
  if (h.length === 3)
    h = h
      .split('')
      .map((ch) => ch + ch)
      .join('')
  const r = parseInt(h.slice(0, 2), 16) || 0
  const g = parseInt(h.slice(2, 4), 16) || 0
  const b = parseInt(h.slice(4, 6), 16) || 0
  const a = Math.max(0, Math.min(1, alpha))
  return `rgba(${r}, ${g}, ${b}, ${a})`
}

async function createChart() {
  if (!rootEl.value) return
  if (chart.value) destroyChart()
  if (!uplotMod) uplotMod = await import('uplot')
  const UPlot = uplotMod.default || uplotMod

  const rect = rootEl.value.getBoundingClientRect()
  const width = Math.max(100, Math.floor(rect.width || 400))
  const height = Math.max(100, Math.floor(fixedH || rect.height || 220))

  const dRaw = props.data || []
  const d = makeCumulative(dRaw)

  const yCount = isValidData(d) ? Math.max(0, d.length - 1) : 0
  const palette = (
    props.colors && props.colors.length
      ? props.colors
      : ['#60a5fa', '#fbbf24', '#34d399', '#f472b6']
  ).slice(0, yCount)
  const fill = Math.max(0, Math.min(1, props.fillOpacity ?? 0.3))

  const series = [
    {}, // x
    ...palette.map((c) => ({
      stroke: c,
      width: 1,
      fill: toRgba(c, fill),
    })),
  ]

  const opts = {
    width,
    height,
    series,
    axes: [{}, {}],
    scales: { x: { time: false } },
  }

  const initData = isValidData(d) ? d : [[], []]
  chart.value = new UPlot(opts, initData, rootEl.value)

  lastW = width
  lastH = height
}

function destroyChart() {
  try {
    chart.value?.destroy?.()
  } catch {}
  chart.value = null
}

onMounted(async () => {
  await nextTick()
  // Capture wrapper height once to avoid RO feedback loops
  if (rootEl.value) {
    const parent = rootEl.value.parentElement as HTMLElement | null
    const rect = (parent ?? rootEl.value).getBoundingClientRect()
    fixedH = Math.max(100, Math.floor(rect.height || 220))
    lastH = fixedH
  }
  await createChart()

  if (typeof window !== 'undefined' && 'ResizeObserver' in window && rootEl.value) {
    const target: Element = (rootEl.value.parentElement as Element) || (rootEl.value as Element)
    ro = new ResizeObserver((entries: ResizeObserverEntry[]) => {
      if (!chart.value) return
      const entry = entries.find((e) => e.target === target) || entries[0]
      const cr = entry?.contentRect
      const w = Math.max(100, Math.floor(cr ? cr.width : (target as HTMLElement).clientWidth))
      const h = Math.max(100, Math.floor(fixedH || 220))
      if (w === lastW && h === lastH) return
      lastW = w
      lastH = h
      try {
        chart.value.setSize({ width: w, height: h })
      } catch {}
    })
    observedEl = target
    ro.observe(target)
  }
})

onBeforeUnmount(() => {
  if (ro && observedEl) ro.unobserve(observedEl)
  ro = null
  destroyChart()
})

// Update on data changes: recreate if series count changes, else setData
watch(
  () => props.data,
  (dNew) => {
    const cum = makeCumulative(dNew || [])
    const newCount = isValidData(cum) ? Math.max(0, cum.length - 1) : 0
    const curCount = (chart.value?.series?.length || 1) - 1
    const needsRecreate = !chart.value || newCount !== curCount
    if (needsRecreate) {
      createChart()
    } else if (chart.value && isValidData(cum)) {
      try {
        chart.value.setData(cum)
      } catch {}
    }
  },
  { deep: true },
)
</script>

<template>
  <div ref="rootEl" class="relative w-full" :class="props.class"></div>
</template>
