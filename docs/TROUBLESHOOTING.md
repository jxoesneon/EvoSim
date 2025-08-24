# Troubleshooting & FAQ

Last updated: 2025-08-23

This guide lists common runtime issues and fixes across WASM, store, renderer, and UI.

## WASM initialization fails

Symptoms:

- Simulation does not start; creatures/plants arrays stay empty.
- Console shows errors loading `ecosim_bg.wasm` or dynamic import failures.

Checks:

- Confirm network path to `src/wasm/pkg/ecosim_bg.wasm` (or bundler asset) is correct.
- Ensure dynamic import of `@/wasm/ecosim/pkg/ecosim` resolves in `useSimulationStore.ts`.
- Verify correct MIME type (`application/wasm`) served by dev server.

Workarounds:

- Fall back to JS mode if provided in store; ensure UI disables WASM-only controls.
- Clear cache/hard reload; some bundlers cache stale WASM blobs.

## HMR disposal and WebGL leaks

Symptoms:

- GPU memory grows on hot-reload; canvas duplications; FPS drops over time.

Checks:

- `src/webgl/renderer.ts` should provide `disposeWebGL()` and be called by `EcosystemRenderer.vue` on unmount.
- Make sure any RAF loops check a halt token and stop on component unmount.

Fixes:

- Dispose materials/geometries/textures/instanced meshes explicitly.
- Remove event listeners on unmount.

## Low FPS or stutter

Symptoms:

- Render updates lag; charts stutter.

Checks:

- Use `enableFPSMeter()`/`disableFPSMeter()` to profile.
- Reduce instance counts or lower simulation speed in the store.
- Ensure chunked updates are used for instanced attributes in `renderer.ts`.

Fixes:

- Toggle debug overlays off from UI prefs when not needed.
- Reduce telemetry sampling windows in summary views.

## Clipboard and downloads blocked

Symptoms:

- Copy-to-clipboard or PNG/SVG downloads fail from summary views.

Checks:

- Browser permissions: clipboard write requires user gesture on some browsers.
- For downloads, ensure the page is served over `http://localhost` or `https`.

Fixes:

- Trigger actions from a direct user click; avoid programmatic triggers.
- For CSV/PNG export via charts, ensure the chart instance is mounted before calling export.

## JSON save/load issues

Symptoms:

- Snapshot save or load fails; payload malformed.

Checks:

- Validate JSON structure before calling store `load`.
- Ensure large objects (e.g., creatures with brains) do not exceed storage limits of remote services.

Fixes:

- Provide user feedback on failure; offer local file download as fallback.

## Telemetry zeros or NaN

Symptoms:

- Charts show zeros/flat lines; NaN warnings in console.

Checks:

- `useSimulationStore.ts` sanitizes series values to `0` if `NaN`/`Infinity`.
- Ensure sampling block runs after each step; verify `MAX_SERIES` retention (older values get dropped).

Fixes:

- Confirm event counters increment at actual event hooks (births, deaths, eats/drinks, attacks, hits).

## Renderer context lost

Symptoms:

- WebGL context lost message; canvas stops updating.

Checks:

- Listen for `webglcontextlost` event on canvas.

Fixes:

- Prevent default on context lost and attempt a full renderer re-init (dispose and `initWebGL()` again) when safe.

## Inconsistent spawn behavior (WASM vs JS fallback)

Symptoms:

- Spawning creatures increments counters but arrays don’t update immediately, or vice versa.

Checks:

- After WASM spawn, re-sync arrays from `wasmWorld` JSON getters before next render.

Fixes:

- Ensure spawn paths increment `telemetry.totals.births` once and re-sync state for consistency.

## Action/vision overlays misplaced

Symptoms:

- Vision cones or action rings misaligned after zoom/pan.

Checks:

- Camera transforms must be applied consistently in renderer.
- Recompute instanced attributes after camera/zoom updates.

Fixes:

- Batch attribute updates and avoid per-instance per-frame recalculation when not needed.
