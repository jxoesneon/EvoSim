# Component Reference

Last updated: 2025-08-23

This reference lists key UI components, their props/emits, and primary store usage.

## Core

### `src/components/EcosystemRenderer.vue`

- Props: `width?: number`, `height?: number`, `showTelemetry?: boolean`
- Emits: `creature-selected` (payload: creature)
- Uses store: `useSimulationStore()`
  - Reads: `creatures`, `plants`, `corpses`, `camera`, `simulationParams.simulationSpeed`
  - Calls: `centerCameraOn(x,y)`, `zoomCamera(delta)`, `setSelectedCreature(id)`, `setSimulationSpeed(v)`
- Other: imports `initWebGL`, `renderScene`, `disposeWebGL` from `src/webgl/renderer.ts`; overlays (action notice, debug mouse diagnostics); `useUiPrefs` logging gates.

Usage:

```vue
<EcosystemRenderer
  :width="800"
  :height="600"
  :showTelemetry="true"
  @creature-selected="onCreatureSelected"
/>
```

### `src/components/ControlPanel.vue`

- Emits: `start`, `stop`, `reset`, `add-creature`, `add-plant`, `save`, `load`
- Uses store: `useSimulationStore()`
  - Calls: `setShowVisionCones(v)`, `setVisionFovDeg(n)`, `setVisionRange(n)`, `setShowDebugOverlay(v)`,
    thresholds setters (`setThirstThreshold`, `setHungerEnergyThreshold`, `setFatigueStaminaThreshold`, `setFearThreshold`, `setMatingUrgeThreshold`, `setRestlessTicks`, `setResourceDeltaEventThreshold`, `setPainHealthDropThreshold`, `setEnergyGainEatThreshold`, `setHealthDropHitThreshold`),
    `setZegionActivations(hidden, output)`, `setBrainSeed(n)`, `loadSnapshot(json)`
- Uses prefs: `useUiPrefs()` for logging enable/types and action noticing controls.

Usage:

```vue
<ControlPanel
  @start="store.start()"
  @stop="store.stop()"
  @reset="store.resetGeneration()"
  @add-creature="store.addCreature()"
  @add-plant="store.addPlant()"
  @save="saveSnapshot()"
  @load="loadSnapshot()"
/> 
```

### `src/App.vue`

- Composes: `EcosystemRenderer.vue`, `summary/SummaryDashboard.vue`, `StatsPanel.vue`, `ModalContainer.vue`
- Uses store: `useSimulationStore()`
  - Binds to many setters: weather, debug overlay, auto-continue, FPS/adaptive perf, instance throttling, vision (show/fov/range), brain seed, brain mode, biology (lifespan, gestation, reproductionEnergy), follow selected, mutation rate/amount, plantSpawnRate, waterLevel, movementThreshold, stagnantTicksLimit, JSONBin save/load.
- Uses prefs: `useUiPrefs()` for logging, action noticing, action range overlay, vision, JSONBin, FPS.
- Other: toggles FPS meter via `enableFPSMeter/disableFPSMeter` from `renderer.ts`.

Usage (snippet):

```vue
<template>
  <EcosystemRenderer />
  <SummaryDashboard />
</template>

<script setup lang="ts">
import EcosystemRenderer from '@/components/EcosystemRenderer.vue'
import SummaryDashboard from '@/components/summary/SummaryDashboard.vue'
import { useSimulationStore } from '@/composables/useSimulationStore'
const store = useSimulationStore()
// Bind store setters via computed get/set for UI controls
</script>
```

## Summary Dashboard (`src/components/summary/`)

### `SummaryDashboard.vue`

- Composes all summary panels. Listens to `EnvironmentSummary` `edit` emits to scroll to Controls.

### `EnvironmentSummary.vue`

- Emits: `edit` with keys `plantSpawnRate` or `waterLevel`.
- Reads store telemetry and params; exports PNG/CSV via `EChart`.

Usage:

```vue
<EnvironmentSummary @edit="scrollToControls($event)" />
```

### `HeaderKpis.vue`

- Reads: `generation`, `movementStats.avgSpeed`, counts from current arrays, world time, generation duration, `stagnantTicks`.

### `ExportsBar.vue`

- Actions: PNG/SVG/JSON/CSV export of full summary. Reads generation, telemetry, lastGenEnd for filenames/payloads.

### `PopulationDynamics.vue`

- Reads: `telemetry.series.population` (creatures, plants, corpses). Windowing/smoothing. Uses `UPlotStackedArea`.

Usage:

```vue
<PopulationDynamics />
```

### `MovementActivity.vue`

- Reads: `telemetry.series.avgSpeed`, `simulationParams.movementThreshold`. Uses `UPlotLine` and `EChart`.

Usage:

```vue
<MovementActivity />
```

### `BehaviorEvents.vue`

- Reads: `telemetry.series.events.*` cumulative; diffs to per-interval. Uses `EChart`.

Usage:

```vue
<BehaviorEvents />
```

### `SpatialEnvironment.vue`

- Calls: `store.sampleTerrain()`; overlays creature scatter. Uses `EChart`.

Usage:

```vue
<SpatialEnvironment />
```

### `ComparisonsTrends.vue`

- Reads: `avgSpeed`, `population.creatures`, diffed `births`/`deaths`. Uses `UPlotLine`.

Usage:

```vue
<ComparisonsTrends />
```

### `InsightsRecommendations.vue`

- Computes rules from telemetry + params and proposes store setter changes.

## Chart Wrappers (`src/components/summary/charts/`)

### `EChart.vue`

- Lazy-loads ECharts. Exposes `getInstance()`, `getDataURL()`, `downloadPNG()`.

### `UPlotLine.vue`

- Lazy uPlot line with resize observer. Recreate on options change.

### `UPlotStackedArea.vue`

- Builds cumulative series for stacked area; fixed height; recreate when series count changes.
