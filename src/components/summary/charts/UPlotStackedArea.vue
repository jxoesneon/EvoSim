<script setup lang="ts">
import { onMounted, onBeforeUnmount, shallowRef, watch, ref, nextTick } from 'vue'
import type UPlot from 'uplot'
import type { Options as UPlotOptions, AlignedData } from 'uplot'

interface Props {
  // uPlot expects data as [x[], y1[], y2[], ...]
  data: AlignedData
  options?: Partial<UPlotOptions>
  class?: string
}
const props = defineProps<Props>()

const rootEl = ref<HTMLDivElement | null>(null)
let uplotMod: typeof import('uplot') | null = null
const chart = shallowRef<UPlot | null>(null)
let ro: ResizeObserver | null = null
let observedEl: Element | null = null
let lastW = 0
let lastH = 0
let fixedH = 0

function isValidData(d: AlignedData): d is AlignedData {
  return (
    Array.isArray(d) &&
    d.length >= 2 &&
    Array.isArray(d[0]) &&
    Array.isArray(d[1]) &&
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
  if (!rootEl.value || !isValidData(props.data)) return
  if (chart.value) destroyChart()
  if (!uplotMod) uplotMod = await import('uplot')
  const UPlotCtor = (uplotMod.default ?? uplotMod) as typeof UPlot
  const size = rootEl.value.getBoundingClientRect()
  const targetH = fixedH || Math.max(120, Math.floor(size.height || 240))
  const baseOpts: UPlotOptions = {
    width: Math.max(160, Math.floor(size.width || 400)),
    height: targetH,
    ...(props.options ?? {}),
  }

  const palette: string[] = (props.options?.series ?? [])
    .slice(1)
    .map((s) =>
      typeof s === 'object' && 'stroke' in s
        ? (s as { stroke?: string }).stroke || '#0ea5e9'
        : '#0ea5e9',
    )
  const fillAlpha = typeof props.options?.series?.[1]?.fill === 'string' ? 0.4 : 0.35

  const series = [
    {}, // x
    ...palette.map((c) => ({
      stroke: c,
      width: 1,
      fill: toRgba(c, fillAlpha),
    })),
  ]

  const opts: UPlotOptions = {
    ...baseOpts,
    series,
    axes: baseOpts.axes ?? [{}, {}],
    scales: baseOpts.scales ?? { x: { time: false } },
  }

  const initData = isValidData(props.data) ? props.data : [[], []]
  chart.value = new UPlotCtor(opts, initData, rootEl.value)

  lastW = opts.width ?? 0
  lastH = opts.height ?? 0
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
  <div ref="rootEl" class="relative w-full" :class="props.class" data-testid="uplot-root"></div>
</template>
