# EvoSim

This template should help get you started developing with Vue 3 in Vite.

## Recommended IDE Setup

[VSCode](https://code.visualstudio.com/) + [Volar](https://marketplace.visualstudio.com/items?itemName=Vue.volar) (and disable Vetur).

## Type Support for `.vue` Imports in TS

TypeScript cannot handle type information for `.vue` imports by default, so we replace the `tsc` CLI with `vue-tsc` for type checking. In editors, we need [Volar](https://marketplace.visualstudio.com/items?itemName=Vue.volar) to make the TypeScript language service aware of `.vue` types.

## Customize configuration

See [Vite Configuration Reference](https://vite.dev/config/).

## Project Setup

```sh
npm install
```

### Compile and Hot-Reload for Development

```sh
npm run dev
```

### Type-Check, Compile and Minify for Production

```sh
npm run build
```

### Run Unit Tests with [Vitest](https://vitest.dev/)

```sh
npm run test:unit
```

### Run End-to-End Tests with [Playwright](https://playwright.dev)

```sh
# Install browsers for the first run
npx playwright install

# When testing on CI, must build the project first
npm run build

# Runs the end-to-end tests
npm run test:e2e
# Runs the tests only on Chromium
npm run test:e2e -- --project=chromium
# Runs the tests of a specific file
npm run test:e2e -- tests/example.spec.ts
# Runs the tests in debug mode
npm run test:e2e -- --debug
```

### Lint with [ESLint](https://eslint.org/)

```sh
npm run lint
```

## Telemetry and Parity Validators

This project includes runtime telemetry from the WASM backend and lightweight validators in the Vue store to help tune and verify parity between the Rust and JS models.

- Enable in `src/composables/useSimulationStore.ts` by setting:
  - `simulationParams.enableCostTelemetry = true`
  - `simulationParams.debugLogging = true`
- Environmental cost parity (per creature):
  - Logs: `[WASM EnvCost JS-Recompute]`, `[WASM Locomotion JS-Recompute]`
  - Compares WASM-reported components (wind, cold, heat, humidity, oxygen, noise, disease, locomotion) with a JS recomputation.
- Corpse decay parity (per corpse, sampled up to 5):
  - Logs: `[WASM CorpseDecay Validator]` ensures `total ≈ base + temp + humid + rain + wet`.
  - Logs: `[WASM CorpseDecay JS-Recompute]` and `... Total` compare WASM telemetry vs JS recomputation using the same formula.

Corpse decay formula (Rust and JS mirror):

```
base = max(0, corpseBaseDecayPerSec)
tempTerm = clamp((temperatureC - 20) / 15, 0, 2)
temp  = base * corpseTempDecayCoeff     * tempTerm
humid = base * corpseHumidityDecayCoeff * humidity01
rain  = base * corpseRainDecayCoeff     * precipitation01
wet   = base * corpseWetnessDecayCoeff  * wetness01
total = max(0, base + temp + humid + rain + wet)
```

Use the console logs to tune the coefficients in `simulationParams` (mirrored into the WASM config via `buildWasmConfig()`) until drift is within tolerances.
