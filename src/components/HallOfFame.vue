<script setup lang="ts">
import { computed } from 'vue'
import { useSimulationStore } from '../composables/useSimulationStore'

const store = useSimulationStore()

// Hall of Fame (per-generation) from the store
const topN = 10
const hallOfFame = computed(() => store.getHallOfFameTop(topN))
</script>

<template>
  <div class="overflow-x-auto">
    <table class="table table-xs">
      <thead>
        <tr>
          <th>Rank</th>
          <th>Name</th>
          <th>Lifespan</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="hallOfFame.length === 0">
          <td colspan="3" class="text-center">No entries yet</td>
        </tr>
        <tr v-for="(c, idx) in hallOfFame" :key="c.id" class="hover">
          <th>{{ idx + 1 }}</th>
          <td>{{ c.name }}</td>
          <td>{{ c.lifespan }} ticks</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
