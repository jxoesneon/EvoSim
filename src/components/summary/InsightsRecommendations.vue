<script setup lang="ts">
import { computed } from 'vue'
import { useSimulationStore } from '../../composables/useSimulationStore'

// Pull telemetry for the just-ended generation
const store = useSimulationStore()
const totals = computed(() => (store.telemetry as any)?.totals ?? {})
const avgSpeed = computed<number[]>(() => (store.telemetry as any)?.series?.avgSpeed ?? [])

// Derived signals used to drive rule-based recommendations
const recentAvgSpeed = computed(() => {
  const s = avgSpeed.value
  const N = Math.min(s.length, 600)
  if (N === 0) return 0
  let sum = 0
  for (let i = s.length - N; i < s.length; i++) sum += Number(s[i]) || 0
  return sum / N
})

// Insight factories (add simple rule checks here and return actionable items)
const insights = computed(() => {
  const out: Array<{
    id: string
    text: string
    apply: () => void
  }> = []

  // 1) Low mobility -> relax stagnation detection via store setters
  if (recentAvgSpeed.value < 0.03) {
    out.push({
      id: 'low-mobility',
      text: `Low movement detected (avg=${recentAvgSpeed.value.toFixed(3)}). Relax stagnation detection (lower movement threshold, extend stagnantTicksLimit).`,
      apply: () => {
        const p: any = store.simulationParams
        const mt = Math.max(0, Number(p.movementThreshold || 0) * 0.8)
        const st = Math.min(5000, Number(p.stagnantTicksLimit || 600) + 200)
        ;(store as any)?.setMovementThreshold?.(mt)
        ;(store as any)?.setStagnantTicksLimit?.(st)
      },
    })
  }

  // 2) Deaths > Births -> increase resource availability slightly (plants)
  if ((totals.value.deaths ?? 0) > (totals.value.births ?? 0)) {
    out.push({
      id: 'deaths-gt-births',
      text: 'Deaths exceed births. Increase plant spawn rate slightly to support population recovery.',
      apply: () => {
        const p: any = store.simulationParams
        const cur = Number(p.plantSpawnRate || 0)
        ;(store as any)?.setPlantSpawnRate?.(Math.min(1, cur + 0.05))
      },
    })
  }

  return out
})
</script>
<template>
  <div class="card bg-base-100 border p-3">
    <div class="font-semibold mb-2">Insights & Recommendations</div>
    <div class="space-y-2">
      <!-- Empty-state guidance -->
      <div v-if="insights.length === 0" class="text-sm opacity-70">No insights yet. Let the simulation run…</div>
      <div v-for="ins in insights" :key="ins.id" class="alert alert-info flex items-center justify-between">
        <!-- Each insight is descriptive text + an Apply button that calls its handler -->
        <div class="text-sm">{{ ins.text }}</div>
        <button class="btn btn-xs" @click="ins.apply">Apply</button>
      </div>
    </div>
  </div>
</template>
