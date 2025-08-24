# EvoSim Architecture: WASM, Zegion, and UI/Data Flow

Last updated: 2025-08-23

## Overview

- __Frontend__: Vue 3 Composition API, Tailwind UI, Headless UI.
- __Renderer__: Three.js-based WebGL in `src/webgl/renderer.ts` hosted by `src/components/EcosystemRenderer.vue`.
- __State Orchestrator__: `src/composables/useSimulationStore.ts` manages world state, RAF loop, telemetry, and bridges UI ↔ WASM ↔ Renderer.
- __Neural System (Zegion)__: Modular activations, modulators, plasticity, structure in `src/zegion/` with a JSON spec loader.
- __Backend Runtime__: Rust-generated WASM world at `@/wasm/ecosim/pkg/ecosim` with JSON serializers for entities and config hooks.

## WASM Lifecycle and Integration

Source references:

- `src/composables/useSimulationStore.ts`
- `src/types/wasm-ecosim.d.ts`

Lifecycle:

- __Dynamic import__: `import('@/wasm/ecosim/pkg/ecosim')` and `import('@/wasm/ecosim/pkg/ecosim_bg.wasm?url')`.
- __Init__: create `wasmWorld` then call:
  - `wasmWorld.set_brain_mode(simulationParams.brainMode)`
  - `wasmWorld.set_config(buildWasmConfig())`
- __Step__: each frame `wasmWorld.step(dt)` then pull arrays:
  - `creatures_json()`, `plants_json()`, optional `corpses_json()`, `env_costs_json()`, `corpse_costs_json()`.
- __Spawn/Mutate__: `spawn_creature(x,y)`, `spawn_plant(x,y,r)` with JS fallbacks when WASM is absent.
- __Sync lists__: `set_bad_brain_hashes([...])` to avoid problematic genomes.
- __Config watcher__: store watches simulation params and reapplies `set_config(buildWasmConfig())`.

## Store Responsibilities (`useSimulationStore.ts`)

- __Simulation params__: single source of truth; exposes readonly view + setters.
- __RAF loop__: timestep control, adaptive throttling (instance batching, FPS target), and stepping either WASM or JS fallback.
- __Telemetry__: accumulates series for population, speed, births/deaths, event rates, environment costs.
- __Entities__: maintains `creatures`, `plants`, and `corpses` arrays; merges WASM outputs into reactive state.
- __Camera__: pan/zoom/follow selected; used by renderer and summary overlays.
- __Persistence__: JSONBin save/load and local snapshot download/upload.
- __Zegion__: seeds RNG, loads spec, maintains selected activations, and bridges brain mode to WASM.

## Renderer (`src/webgl/renderer.ts`)

- __Exports__: `initWebGL`, `renderScene`, `disposeWebGL`, `enableFPSMeter`, `disableFPSMeter`, `isHeadless`.
- __Features__: instanced meshes for creatures/plants/corpses, vision cones, action-range rings; chunked instance updates; safe disposal for HMR.
- __Host__: `src/components/EcosystemRenderer.vue` wires canvas events, selection, mouse diagnostics, speed control, and action-noticing overlays.

## Zegion Modules (`src/zegion/`)

- __Activations__: `activations/index.ts` with `ActivationRegistry`, `ActivationName`, and >25 functions (ReLU family, GELU, SiLU, Mish, periodic, shrinkage).
- __Modulators__: `modulators/types.ts` defines `ComputeModulators(prev,curr)` on minimal sim snapshots.
- __Plasticity__: `plasticity/types.ts` + `plasticity/neuromod_hebbian.ts` implementing neuromodulated Hebbian rule with eligibility traces.
- __Structure__: `structure/types.ts` stubs for growth/pruning and activation swaps.
- __Utils__: `utils/seeding.ts` LCG RNG with uniform/normal.
- __Spec IO__: `io/spec.ts` async JSON loader with validation and defaults.
- __Evolution Types__: `evolution/types.ts` for `Genome`, `MutationParams`, and operators.

## UI Composition and Summaries

- __Root__: `src/App.vue` composes `EcosystemRenderer`, `SummaryDashboard`, modals, stats panel. Binds many store setters and persists `useUiPrefs`.
- __Control Toolbar__: `src/components/ControlPanel.vue` emits primary actions and syncs vision/debug/logs/thresholds/seed; supports local save I/O.
- __Summary Panels__: `src/components/summary/` visualize telemetry (uPlot/ECharts wrappers) and environment maps, export CSV/PNG, and suggest insights.

## Data Flow Diagram

```mermaid
flowchart LR
  subgraph UI
    App[App.vue]
    CP[ControlPanel.vue]
    Eco[EcosystemRenderer.vue]
    Sum[SummaryDashboard.vue]
    Prefs[useUiPrefs]
  end

  subgraph Store
    S[useSimulationStore.ts]
  end

  subgraph Renderer
    R[renderer.ts]
  end

  subgraph WASM
    W[WASM ecosim World]
  end

  subgraph Zegion
    ZA[activations]
    ZP[plasticity]
    ZM[modulators]
    ZS[structure]
    ZU[utils/seeding]
    ZI[io spec]
  end

  App -->|binds setters, reads state| S
  CP -->|emits actions| App
  Eco -->|init/render/dispose| R
  S <--> R
  S <--> W
  S <--> ZI
  S <--> ZU
  S --> ZA
  Sum -->|reads telemetry| S
  App <--> Prefs
  ```

## WASM Config Propagation

This flow shows how UI changes propagate into the WASM world configuration.

```mermaid
flowchart LR
  subgraph UI
    App[App.vue]
    CP[ControlPanel.vue]
  end

  subgraph Store
    S[useSimulationStore.ts]
    Set[setters]
    Build[buildWasmConfig]
    Watch[config_watcher]
  end

  subgraph WASM
    W[WASM ecosim World]
  end

  CP -->|emits slider/input| App
  App -->|calls| Set
  Set -->|updates reactive params| S
  S --> Build
  Build -->|config JSON| W
  W -->|apply| Wset[wasmWorld.set_config]
  Set --> Watch
  Watch -->|on_param_change| Wset
  ```

Notes:

- Prefer changing simulation parameters through store setters so the watcher reapplies `set_config(buildWasmConfig())` reliably.
- Commonly propagated params: `mutationRate`, `mutationAmount`, `plantSpawnRate`, `waterLevel`, `movementThreshold`, `stagnantTicksLimit`, brain `mode/seed`, vision `fovDeg/range`, performance toggles.
- When adding new params, extend store state/setter and `buildWasmConfig()`, then consume in WASM.

## Key Import Points

- `src/composables/useSimulationStore.ts`
  - `@/wasm/ecosim/pkg/ecosim`, `@/wasm/ecosim/pkg/ecosim_bg.wasm?url`
  - `src/zegion/io/spec.ts`, `src/zegion/utils/seeding.ts`, `src/zegion/activations/index.ts`
- `src/components/EcosystemRenderer.vue`
  - `src/webgl/renderer.ts`, `useSimulationStore`, `useUiPrefs`
- `src/App.vue`
  - `EcosystemRenderer.vue`, `summary/SummaryDashboard.vue`, `enableFPSMeter/disableFPSMeter`

## Telemetry Surfaces

- __Population__: stacked areas and trends (births/deaths per step).
- __Movement__: avg speed histograms and line trends; threshold overlays.
- __Environment__: terrain heatmaps, resource costs, weather opacity.
- __Hall of Fame__: selection, camera centering, stats/details emit.

## Maintenance Notes

- Prefer applying changes via store setters to keep WASM `set_config()` in sync.
- When adding new simulation params, update:
  - Store: state + setter + `buildWasmConfig()` and config watcher.
  - WASM World: accept/configure the new parameter.
  - UI: bindings in `App.vue` or relevant panels.
  - Telemetry: expose aggregates if needed for summaries.
