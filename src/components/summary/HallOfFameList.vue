<script setup lang="ts">
import { computed, defineEmits } from 'vue'
import { useSimulationStore } from '../../composables/useSimulationStore'

type HofEntry = {
  id: string
  liveId?: string
  name?: string
  lifespan?: number
  gen?: number
  [k: string]: any
}
const store = useSimulationStore()
const emit = defineEmits<{
  (e: 'focus', id: string): void
  (e: 'stats', entry: HofEntry): void
  (e: 'details', entry: HofEntry): void
}>()

const hofTop = computed<HofEntry[]>(() => (store.getHallOfFameTop?.(10) as HofEntry[]) ?? [])

function colorFromId(id: string): string {
  // Simple hash -> HSL for stable avatar colors when creature not present
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  const hue = h % 360
  return `hsl(${hue} 70% 55%)`
}

function getAvatarColor(entry: HofEntry): string {
  const liveId = entry.liveId ?? entry.id
  const c = (store.creatures as any).value?.find((x: any) => x.id === liveId)
  if (c?.communicationColor) {
    const { r, g, b } = c.communicationColor
    return `rgb(${r}, ${g}, ${b})`
  }
  // fall back to stable color based on brain-hash id to remain consistent across gens
  return colorFromId(entry.id)
}

function onFocus(entry: HofEntry) {
  const liveId = entry.liveId ?? entry.id
  try {
    if (store.setSelectedCreature) store.setSelectedCreature(liveId)
    // Try to center camera on current position if creature still exists
    const c = (store.creatures as any).value?.find((x: any) => x.id === liveId)
    if (c && store.centerCameraOn) store.centerCameraOn(c.x, c.y)
  } finally {
    emit('focus', liveId)
  }
}

function onStats(entry: HofEntry) {
  emit('stats', entry)
}

function onDetails(entry: HofEntry) {
  emit('details', entry)
}
</script>
<template>
  <div class="card bg-base-100 border p-3 h-64">
    <div class="font-semibold mb-2">Hall of Fame</div>
    <div class="divide-y overflow-auto h-[calc(100%-2rem)]">
      <div v-if="hofTop.length === 0" class="p-2 text-sm opacity-70">No data</div>
      <div
        v-for="c in hofTop"
        :key="c.id"
        class="py-2 flex items-center justify-between gap-2 group"
      >
        <button
          class="flex items-center gap-2 min-w-0 text-left flex-1 hover:bg-base-200 rounded px-2"
          @click="onDetails(c)"
          :title="'Click for details'"
          aria-label="Show details"
        >
          <span
            class="inline-block w-3.5 h-3.5 rounded-full shrink-0 ring-1 ring-black/10"
            :style="{ background: getAvatarColor(c) }"
            aria-hidden="true"
          />
          <span class="truncate">{{ c.name ?? c.id }}</span>
        </button>
        <div class="flex items-center gap-2">
          <span class="badge badge-ghost" :title="'Generation'">Gen {{ c.gen ?? '—' }}</span>
          <span class="badge badge-outline" :title="'Lifespan (ticks)'"
            >life {{ c.lifespan ?? '—' }}</span
          >
          <button
            class="btn btn-xs"
            @click="onFocus(c)"
            :title="'Focus'"
            aria-label="Focus creature"
          >
            Focus
          </button>
          <button class="btn btn-xs" @click="onStats(c)" :title="'Stats'" aria-label="Show stats">
            Stats
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
