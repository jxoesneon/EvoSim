<script setup lang="ts">
import { computed } from 'vue'
import { useSimulationStore } from '../../composables/useSimulationStore'
const store = useSimulationStore()

// Base fields
const ended = computed(() => store.lastGenEnd.value)
const gen = computed(() => ended.value?.gen ?? (store.generation as any).value)
const reason = computed(() => ended.value?.reason ?? 'stagnation')
const avgSpeed = computed(() => store.movementStats.avgSpeed)
const liveCreatures = computed(() => (store.creatures as any).value?.length ?? 0)
const livePlants = computed(() => (store.plants as any).value?.length ?? 0)
const liveCorpses = computed(() => (store.corpses as any).value?.length ?? 0)
const births = computed(() => (store.telemetry as any)?.totals?.births ?? 0)
const deaths = computed(() => (store.telemetry as any)?.totals?.deaths ?? 0)
const worldSec = computed(() => Number((store.worldTimeSec as any).value ?? 0))

// Timing: end timestamp and duration
const endTimestampMs = computed(() => ended.value?.timestamp ?? null)
const genStartMs = computed(() => (store.currentGenStartTs as any).value as number)
const durationSec = computed(() => {
  const endMs = endTimestampMs.value ?? Date.now()
  const startMs = Number(genStartMs.value) || Date.now()
  return Math.max(0, (endMs - startMs) / 1000)
})

// Other KPIs
const stagTicks = computed(() => (store.stagnantTicks as any).value ?? 0)

// UX helpers: formatters and copy-to-clipboard
function fmtSeconds(s: number) {
  if (!isFinite(s)) return '0s'
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  const rem = s - m * 60
  return `${m}m ${rem.toFixed(0)}s`
}
function fmtDate(ms: number | null) {
  if (!ms) return '—'
  try {
    return new Date(ms).toLocaleString()
  } catch {
    return String(ms)
  }
}
async function copyToClipboard(text: string) {
  try {
    if (navigator?.clipboard?.writeText) await navigator.clipboard.writeText(text)
  } catch {}
}
</script>
<template>
  <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
    <div class="stat shadow bg-base-200/50 rounded-xl p-3 md:p-4 min-h-[96px] flex flex-col justify-between border-0 focus:outline-none">
      <div class="stat-title text-xs">Generation</div>
      <div
        class="stat-value text-lg md:text-2xl leading-tight cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:rounded-md px-0.5 -mx-0.5"
        :title="`Click to copy gen`"
        role="button"
        tabindex="0"
        @click="copyToClipboard(String(gen))"
        @keydown.enter="copyToClipboard(String(gen))"
        aria-label="Copy generation number"
      >
        {{ gen }}
      </div>
      <div class="stat-desc text-[10px] md:text-xs whitespace-normal break-words">Reason: {{ reason }}</div>
    </div>
    <div class="stat shadow bg-base-200/50 rounded-xl p-3 md:p-4 min-h-[96px] flex flex-col justify-between border-0 focus:outline-none">
      <div class="stat-title text-xs md:text-sm leading-tight">Avg Speed</div>
      <div class="stat-value text-lg md:text-2xl leading-tight" :title="'Average creature speed this gen'">
        {{ avgSpeed.toFixed(3) }}
      </div>
      <div class="stat-desc text-[10px] md:text-xs whitespace-normal break-words">per gen</div>
    </div>
    <div class="stat shadow bg-base-200/50 rounded-xl p-3 md:p-4 min-h-[96px] flex flex-col justify-between border-0 focus:outline-none">
      <div class="stat-title text-xs md:text-sm leading-tight">Population</div>
      <div class="stat-value text-lg md:text-2xl leading-tight">{{ liveCreatures }}</div>
      <div class="stat-desc text-[10px] md:text-xs whitespace-normal break-words">live • births {{ births }} • deaths {{ deaths }}</div>
    </div>
    <div class="stat shadow bg-base-200/50 rounded-xl p-3 md:p-4 min-h-[96px] flex flex-col justify-between border-0 focus:outline-none">
      <div class="stat-title text-xs md:text-sm leading-tight">World Time</div>
      <div class="stat-value text-lg md:text-2xl leading-tight" :title="'Seconds since sim start'">
        {{ worldSec.toFixed(1) }}s
      </div>
      <div class="stat-desc text-[10px] md:text-xs whitespace-normal break-words">since start</div>
    </div>
    <div class="stat shadow bg-base-200/50 rounded-xl p-3 md:p-4 min-h-[96px] flex flex-col justify-between border-0 focus:outline-none">
      <div class="stat-title text-xs md:text-sm leading-tight">Gen Duration</div>
      <div class="stat-value text-lg md:text-2xl leading-tight focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:rounded-md px-0.5 -mx-0.5" :title="'Click to copy duration'" role="button" tabindex="0" @click="copyToClipboard(fmtSeconds(durationSec))" @keydown.enter="copyToClipboard(fmtSeconds(durationSec))" aria-label="Copy generation duration">
        {{ fmtSeconds(durationSec) }}
      </div>
      <div class="stat-desc text-[10px] md:text-xs whitespace-normal break-words">{{ ended ? 'final' : 'running' }}</div>
    </div>
    <div class="stat shadow bg-base-200/50 rounded-xl p-3 md:p-4 min-h-[96px] flex flex-col justify-between border-0 focus:outline-none">
      <div class="stat-title text-xs md:text-sm leading-tight">Gen End</div>
      <div class="stat-value text-sm md:text-base leading-tight truncate" :title="fmtDate(endTimestampMs)">
        {{ fmtDate(endTimestampMs) }}
      </div>
      <div class="stat-desc text-[10px] md:text-xs whitespace-normal break-words">local time</div>
    </div>
    <div class="stat shadow bg-base-200/50 rounded-xl p-3 md:p-4 min-h-[96px] flex flex-col justify-between border-0 focus:outline-none">
      <div class="stat-title text-xs md:text-sm leading-tight">Stagnation</div>
      <div class="stat-value text-lg md:text-2xl leading-tight" :title="'Ticks below movement threshold'">
        {{ stagTicks }}
      </div>
      <div class="stat-desc text-[10px] md:text-xs whitespace-normal break-words">ticks</div>
    </div>
    <div class="stat shadow bg-base-200/50 rounded-xl p-3 md:p-4 min-h-[96px] flex flex-col justify-between border-0 focus:outline-none">
      <div class="stat-title text-xs md:text-sm leading-tight">Plants</div>
      <div class="stat-value text-lg md:text-2xl leading-tight focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:rounded-md px-0.5 -mx-0.5" :title="'Click to copy count'" role="button" tabindex="0" @click="copyToClipboard(String(livePlants))" @keydown.enter="copyToClipboard(String(livePlants))" aria-label="Copy plants count">
        {{ livePlants }}
      </div>
      <div class="stat-desc text-[10px] md:text-xs whitespace-normal break-words">at end</div>
    </div>
    <div class="stat shadow bg-base-200/50 rounded-xl p-3 md:p-4 min-h-[96px] flex flex-col justify-between border-0 focus:outline-none">
      <div class="stat-title text-xs md:text-sm leading-tight">Corpses</div>
      <div class="stat-value text-lg md:text-2xl leading-tight focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:rounded-md px-0.5 -mx-0.5" :title="'Click to copy count'" role="button" tabindex="0" @click="copyToClipboard(String(liveCorpses))" @keydown.enter="copyToClipboard(String(liveCorpses))" aria-label="Copy corpses count">
        {{ liveCorpses }}
      </div>
      <div class="stat-desc text-[10px] md:text-xs whitespace-normal break-words">at end</div>
    </div>
  </div>
</template>

