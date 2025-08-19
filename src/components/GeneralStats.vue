<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { useSimulationStore } from '../composables/useSimulationStore'

const store = useSimulationStore()

// High-level counts shown as KPI cards in the summary popup
const creatureCount = computed(() => store.creatures.value.length)
const plantCount = computed(() => store.plants.value.length)
const corpseCount = computed(() => store.corpses.value.length)

// Average of creature lifespans over currently alive creatures
const avgAge = computed(() => {
  const list = store.creatures.value as unknown as Array<{ lifespan: number }>
  if (!list.length) return 0
  const sum = list.reduce((a, c) => a + (c.lifespan || 0), 0)
  return sum / list.length
})

// Average energy for currently alive creatures
const avgEnergy = computed(() => {
  const list = store.creatures.value as unknown as Array<{ energy: number }>
  if (!list.length) return 0
  const sum = list.reduce((a, c) => a + (c.energy || 0), 0)
  return sum / list.length
})

// Rough diet breakdown (defaulting to Herbivore if not Carnivore)
const dietBreakdown = computed(() => {
  const list = store.creatures.value as unknown as Array<{ phenotype?: { diet?: string } }>
  let herb = 0,
    carn = 0
  for (const c of list) {
    const d = c.phenotype?.diet
    if (d === 'Carnivore') carn++
    else herb++
  }
  return { herb, carn }
})

// Dynamic card width based on widest card content.
// Important in a popup: when initially hidden, layout widths are 0. We defer
// measuring until visible and also observe size changes to keep widths correct.
const statsWrap = ref<HTMLElement | null>(null)
const cardWidth = ref<string>('14rem')

// Returns true if the container has a non-zero rendered size (visible)
function isVisible(el: HTMLElement | null) {
  if (!el) return false
  const rect = el.getBoundingClientRect?.()
  return !!rect && rect.width > 0 && rect.height > 0
}

let pendingRetry = 0
// Computes a uniform card width by scanning children for their scrollWidth.
// "retries" helps when the popup has just opened but hasn't laid out yet.
function computeCardWidth(retries = 8) {
  nextTick(() => {
    const root = statsWrap.value
    if (!root) return
    // If inside a hidden popup, defer until visible
    if (!isVisible(root)) {
      if (retries > 0) {
        clearTimeout(pendingRetry as any)
        pendingRetry = window.setTimeout(() => computeCardWidth(retries - 1), 80)
      }
      return
    }
    const cards = Array.from(root.querySelectorAll('.stat')) as HTMLElement[]
    if (!cards.length) return
    let maxW = 0
    for (const card of cards) {
      const title = card.querySelector('.stat-title') as HTMLElement | null
      const value = card.querySelector('.stat-value') as HTMLElement | null
      const desc = card.querySelector('.stat-desc') as HTMLElement | null
      const wChildren = Math.max(
        title?.scrollWidth || 0,
        value?.scrollWidth || 0,
        desc?.scrollWidth || 0,
      )
      // Fallback to card's own scrollWidth to catch any other content
      const w = Math.max(wChildren, card.scrollWidth)
      // include horizontal padding (~1.5rem each side)
      maxW = Math.max(maxW, w + 48)
    }
    const minPx = 192 // 12rem
    const maxPx = 360 // 22.5rem clamp to avoid overly wide cards
    const clamped = Math.max(minPx, Math.min(maxW, maxPx))
    cardWidth.value = `${Math.ceil(clamped)}px`
  })
}

let resizeObs: (() => void) | null = null
let ro: ResizeObserver | null = null
// When mounted: compute width, react to window resizes, and observe size changes
onMounted(() => {
  computeCardWidth()
  const handler = () => computeCardWidth()
  window.addEventListener('resize', handler)
  resizeObs = () => window.removeEventListener('resize', handler)
  // Observe size/content changes (e.g., when a dialog opens and renders this block)
  try {
    ro = new ResizeObserver(() => computeCardWidth())
    if (statsWrap.value) ro.observe(statsWrap.value)
  } catch {}
})
onBeforeUnmount(() => {
  resizeObs?.()
  try { ro?.disconnect() } catch {}
})

// Recompute when reactive stats change
watch(
  [creatureCount, plantCount, corpseCount, avgAge, avgEnergy, dietBreakdown],
  () => {
    computeCardWidth()
  },
  { flush: 'post' },
)
</script>

<template>
  <div ref="statsWrap" class="flex flex-wrap gap-2 items-stretch w-full">
    <div class="flex-none" :style="{ width: cardWidth }">
      <div
        class="stat shadow bg-base-200/50 h-full w-full p-3 md:p-4 flex flex-col justify-between min-h-[96px] overflow-hidden break-words"
      >
        <div class="stat-title text-xs md:text-sm leading-tight block w-full break-words">
          Creatures
        </div>
        <div class="flex flex-col gap-1 w-full">
          <div
            class="stat-value text-primary text-lg md:text-2xl leading-tight block w-full break-words"
          >
            {{ creatureCount }}
          </div>
          <div class="stat-desc text-[10px] md:text-xs opacity-0">&nbsp;</div>
        </div>
      </div>
    </div>

    <div class="flex-none" :style="{ width: cardWidth }">
      <div
        class="stat shadow bg-base-200/50 h-full w-full p-3 md:p-4 flex flex-col justify-between min-h-[96px]"
      >
        <div class="stat-title text-xs md:text-sm leading-tight block w-full break-words">
          Plants
        </div>
        <div class="flex flex-col gap-1 w-full">
          <div
            class="stat-value text-secondary text-lg md:text-2xl leading-tight block w-full break-words"
          >
            {{ plantCount }}
          </div>
          <div class="stat-desc text-[10px] md:text-xs opacity-0">&nbsp;</div>
        </div>
      </div>
    </div>

    <div class="flex-none" :style="{ width: cardWidth }">
      <div
        class="stat shadow bg-base-200/50 h-full w-full p-3 md:p-4 flex flex-col justify-between min-h-[96px]"
      >
        <div class="stat-title text-xs md:text-sm leading-tight block w-full break-words">
          Corpses
        </div>
        <div class="flex flex-col gap-1 w-full">
          <div class="stat-value text-lg md:text-2xl leading-tight block w-full break-words">
            {{ corpseCount }}
          </div>
          <div class="stat-desc text-[10px] md:text-xs opacity-0">&nbsp;</div>
        </div>
      </div>
    </div>

    <div class="flex-none" :style="{ width: cardWidth }">
      <div
        class="stat shadow bg-base-200/50 h-full w-full p-3 md:p-4 flex flex-col justify-between min-h-[96px]"
      >
        <div class="stat-title text-xs md:text-sm leading-tight block w-full break-words">
          Avg Age
        </div>
        <div class="flex flex-col gap-1 w-full">
          <div class="stat-value text-lg md:text-2xl leading-tight block w-full break-words">
            {{ avgAge.toFixed(1) }}
          </div>
          <div class="stat-desc text-[10px] md:text-xs">ticks</div>
        </div>
      </div>
    </div>

    <div class="flex-none" :style="{ width: cardWidth }">
      <div
        class="stat shadow bg-base-200/50 h-full w-full p-3 md:p-4 flex flex-col justify-between min-h-[96px]"
      >
        <div class="stat-title text-xs md:text-sm leading-tight block w-full break-words">
          Avg Energy
        </div>
        <div class="flex flex-col gap-1 w-full">
          <div class="stat-value text-lg md:text-2xl leading-tight block w-full break-words">
            {{ avgEnergy.toFixed(1) }}
          </div>
          <div class="stat-desc text-[10px] md:text-xs opacity-0">&nbsp;</div>
        </div>
      </div>
    </div>

    <div class="flex-none" :style="{ width: cardWidth }">
      <div
        class="stat shadow bg-base-200/50 h-full w-full p-3 md:p-4 flex flex-col justify-between min-h-[96px]"
      >
        <div class="stat-title text-xs md:text-sm leading-tight block w-full break-words">
          Diet Breakdown
        </div>
        <div class="flex flex-col gap-1 w-full">
          <div
            class="stat-value text-xs md:text-sm leading-tight block w-full break-words whitespace-normal"
          >
            H: {{ dietBreakdown.herb }} / C: {{ dietBreakdown.carn }}
          </div>
          <div class="stat-desc text-[10px] md:text-xs opacity-0">&nbsp;</div>
        </div>
      </div>
    </div>
  </div>
</template>
