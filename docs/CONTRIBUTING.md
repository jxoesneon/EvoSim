# Contributing Guide

Last updated: 2025-08-23

This guide focuses on adding new simulation parameters and wiring them through the stack (UI ↔ Store ↔ WASM ↔ Renderer/Telemetry), consistent with existing patterns.

## Prerequisites

- Use Pipenv for Python tooling (if any scripts/tests require it).
- Run linting with Ruff via Pipenv when applicable.
- Frontend: Node + pnpm/npm. Follow existing scripts in `package.json`.

## Add a New Simulation Parameter

1. Define param in the Store

- File: `src/composables/useSimulationStore.ts`
- Add a readonly field under `simulationParams` and expose a setter `set<ParamName>(value: T)`.
- Update any derived state or guards (e.g., clamping) inside the setter.

1. Propagate to WASM Config

- In the store, add the new field to `buildWasmConfig()` so `World.set_config()` receives it.
- Ensure the config watcher re-applies `set_config(buildWasmConfig())` when your param changes.

1. Implement in WASM World

- Rust-side: add field to config struct and use it in the simulation logic.
- Expose it via bindings if needed and rebuild the WASM package.

1. UI Binding

- Bind the param in `src/App.vue` (computed with `get/set`) or a focused component.
- Use store setter in the computed setter (do not mutate readonly state directly).
- If persisted, add getters/setters in `useUiPrefs` and hydrate in `onMounted`.

1. Telemetry (if the param affects metrics)

- If applicable, extend `telemetry.series` and push values during the update sampling block.
- For counters, extend `telemetry.totals` and ensure UIs diff cumulative series when plotting rates.

1. Renderer (optional)

- If the renderer depends on the param (e.g., vision geometry), thread it into `src/webgl/renderer.ts` calls through the store.
- Keep instance update batching performant; prefer chunked updates.

1. Tests and E2E

- Add/extend unit tests (`src/__tests__/`) and e2e specs (`e2e/`) to cover new behavior or UI bindings.

1. Documentation

- Update `docs/ARCHITECTURE.md` and/or `docs/TELEMETRY.md` if relevant.
- Add a short note in `docs/COMPONENTS.md` if a new component or prop/emits is introduced.

## Coding Notes

- Apply changes through store setters; avoid mutating readonly proxies from components.
- Sanitize telemetry values before pushing to series (replace `NaN`/`Infinity` with `0`).
- Keep `MAX_SERIES` in mind to avoid unbounded telemetry memory growth.
- Favor small, focused commits with clear messages.
