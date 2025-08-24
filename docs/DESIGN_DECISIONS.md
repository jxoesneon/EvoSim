# Design Decisions

Last updated: 2025-08-23

This document captures key architectural choices, their rationale, trade-offs, and pointers to implementation sites in the codebase.

## Instanced Rendering in `src/webgl/renderer.ts`

- Rationale:
  - Rendering thousands of ecosystem entities (creatures, plants, corpses) requires batching to sustain >60 FPS.
  - Instanced meshes minimize draw calls and CPU-GPU synchronization overhead.
- Implementation:
  - `renderer.ts` builds `InstancedMesh` objects for each entity class and updates per-instance matrices/attributes in chunks.
  - Overlays (vision cones, action rings) are optional layers to avoid constant GPU pressure.
- Trade-offs:
  - More complex buffer management and disposal logic, especially under HMR.
  - Attribute packing and partial updates require careful bounds and dirty-region tracking.
- Alternatives Considered:
  - Individual meshes: simplest but prohibitive draw call count at scale.
  - GPU particles: poor fit for oriented/animated geometry and selection picking.

## Telemetry Ring Buffers in Store

- Rationale:
  - Keep a time-windowed history for charts without unbounded memory growth.
  - `MAX_SERIES = 3600` retains ~1 hour at 1 Hz or shorter windows at higher sampling rates.
- Implementation:
  - `useSimulationStore.ts` appends each step to `telemetry.series.*` arrays and drops the oldest when capacity is exceeded.
  - Event counters live in `telemetry.totals` for cheap accumulation.
- Trade-offs:
  - Historical data outside the window is discarded (acceptable for interactive monitoring).
  - Ring maintenance introduces minor per-step overhead.
- Alternatives Considered:
  - Full history with downsampling: higher complexity and memory pressure.
  - Sparse sampling: simpler but lowers chart fidelity.

## Cumulative Event Diffing for Rates

- Rationale:
  - WASM increments cumulative event counters once per event (births, deaths, eats, drinks, attacks, gets_hit).
  - UI requires per-interval rates; diffing cumulative totals is robust and cheap.
- Implementation:
  - Summary components compute `delta = totals[t] - totals[t-1]` over the display interval.
- Trade-offs:
  - First sample has no prior point; handled by defaulting to zero.
  - Spikes reflect true bursts; optional smoothing can be applied per chart.
- Alternatives Considered:
  - Push per-step event counts from WASM: larger payloads and more coupling.

## WASM Config Propagation via Store Setters

- Rationale:
  - Centralize parameter changes in the store to ensure `buildWasmConfig()` stays authoritative.
  - A watcher reapplies `wasmWorld.set_config(buildWasmConfig())` when params change, keeping JS and WASM in sync.
- Implementation:
  - Store exposes setters (e.g., `setMutationRate`, `setPlantSpawnRate`, `setWaterLevel`, `setMovementThreshold`, etc.).
  - `buildWasmConfig(params)` compiles the current reactive state into a config object.
- Trade-offs:
  - Requires diligence when adding new params to update both setters and the config builder.
- Alternatives Considered:
  - Direct component-to-WASM writes: fast but brittle, bypassing central validation and telemetry coupling.

## Store as Orchestrator

- Rationale:
  - A single orchestrator improves predictability: UI → Store → WASM/Renderer/Telemetry.
- Implementation:
  - `useSimulationStore.ts` manages the RAF loop, entity lists, camera, telemetry, and persistence.
- Trade-offs:
  - Store becomes a high-fan-in module; mitigated by clear sections, typed params, and focused helpers.
- Alternatives Considered:
  - Multiple feature stores: increased coordination cost and potential update ordering issues.

## Testing and Observability Considerations

- Add debug toggles in `useUiPrefs` to gate heavy overlays and logs.
- Prefer composable helpers (e.g., for smoothing, windowing) used by charts to keep logic testable.
- Expose CSV/PNG export APIs on chart wrappers for deterministic artifact checks.

## References

- `src/webgl/renderer.ts` — instanced meshes, overlays, disposal.
- `src/composables/useSimulationStore.ts` — RAF loop, telemetry, setters, config builder.
- `docs/TELEMETRY.md` — series/totals structure and pipeline.
- `docs/ARCHITECTURE.md` — data flow and WASM config propagation diagram.
