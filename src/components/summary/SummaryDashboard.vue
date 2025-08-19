<script setup lang="ts">
// Container that composes all summary sections in order
import { defineAsyncComponent, onMounted } from 'vue'
const HeaderKpis = defineAsyncComponent(() => import('./HeaderKpis.vue'))
const PopulationDynamics = defineAsyncComponent(() => import('./PopulationDynamics.vue'))
const MovementActivity = defineAsyncComponent(() => import('./MovementActivity.vue'))
const HallOfFameList = defineAsyncComponent(() => import('./HallOfFameList.vue'))
const EnvironmentSummary = defineAsyncComponent(() => import('./EnvironmentSummary.vue'))
const ComparisonsTrends = defineAsyncComponent(() => import('./ComparisonsTrends.vue'))
const GeneticsBrains = defineAsyncComponent(() => import('./GeneticsBrains.vue'))
const BehaviorEvents = defineAsyncComponent(() => import('./BehaviorEvents.vue'))
const SpatialEnvironment = defineAsyncComponent(() => import('./SpatialEnvironment.vue'))
const InsightsRecommendations = defineAsyncComponent(() => import('./InsightsRecommendations.vue'))
const ControlsPanel = defineAsyncComponent(() => import('./ControlsPanel.vue'))
const ExportsBar = defineAsyncComponent(() => import('./ExportsBar.vue'))

function jumpToControls(key: 'plantSpawnRate' | 'waterLevel') {
  const el = document.getElementById('controls-panel')
  if (el && typeof el.scrollIntoView === 'function') {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    // Briefly highlight to draw attention
    try {
      el.classList.add('ring', 'ring-primary')
      setTimeout(() => el.classList.remove('ring', 'ring-primary'), 800)
    } catch {}
  }
}
</script>

<template>
  <div id="gen-summary-container" class="space-y-4">
    <HeaderKpis />
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <PopulationDynamics class="lg:col-span-2" />
      <MovementActivity />
    </div>
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <HallOfFameList />
      <EnvironmentSummary @edit="jumpToControls" />
    </div>
    <ComparisonsTrends />
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <GeneticsBrains />
      <BehaviorEvents />
    </div>
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <SpatialEnvironment />
      <InsightsRecommendations />
    </div>
    <ControlsPanel />
    <ExportsBar />
  </div>
</template>
