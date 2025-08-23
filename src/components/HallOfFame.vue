<script setup lang="ts">
import { computed } from 'vue'
import { useSimulationStore } from '../composables/useSimulationStore'

const store = useSimulationStore()

// Hall of Fame from the store (cumulative, persists across generations)
const topN = 10
const hallOfFame = computed(() => store.getHallOfFameTopAll(topN))

function displayName(entry: { id: string; name?: string; liveId?: string }) {
  if (entry?.name) return entry.name
  const lid = entry?.liveId || entry?.id
  const c = (store.creatures as any).value?.find((x: any) => x.id === lid)
  return c?.name || `#${entry?.id}`
}
</script>

<template>
  <div class="overflow-x-auto">
    <table class="table table-xs">
      <thead>
        <tr>
          <th>Rank</th>
          <th>Gen</th>
          <th>Name</th>
          <th>Lifespan</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="hallOfFame.length === 0">
          <td colspan="4" class="text-center">No entries yet</td>
        </tr>
        <tr v-for="(c, idx) in hallOfFame" :key="c.id" class="hover">
          <th>{{ idx + 1 }}</th>
          <td>{{ c.gen }}</td>
          <td>{{ displayName(c) }}</td>
          <td>{{ c.lifespan }} ticks</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
