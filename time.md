# EvoSim Time Architecture

This document defines the time model, units, and how various subsystems (lifespan, decay, weather, lighting, behavior) reference world time.

## Core Concepts

- **World Time (WT)**: Continuous simulation time measured in world days.
- **Real Time (RT)**: Wall-clock seconds while the app runs.
- **Time Scale**: Mapping of RT to WT.

## Canonical Units

- **World day**: 1.0 day (24 world hours).
- **World hour**: 1/24 day.
- **Tick**: One simulation step. We treat `dt` as RT seconds between steps.

## Global Parameters (config)

- **`time.realSecondsPerWorldDay`**: RT seconds that equal 1 world day. Default: `600` (10 minutes per world day).
- **`time.timeScale`**: Multiplier over the above mapping. Default: `1.0`.
- **`time.startDay`**: Initial day counter. Default: `0`.
- **`time.dayNight.enabled`**: Toggle for day/night cycle. Default: `true`.
- **`time.seasons.enabled`**: Toggle for seasonal modulation. Default: `true`.
- **`time.seasons.worldDaysPerYear`**: Length of a world year. Default: `120`.

Derived constants:

- `worldSecondsPerWorldDay = 24 * 60 * 60 = 86_400` (for ratios only)
- `worldHoursPerDay = 24`

## World Clock

Maintain a single monotonically increasing counter:

- `worldDayFloat` (float days)
- `worldDay = floor(worldDayFloat)`
- `worldHourFloat = fract(worldDayFloat) * 24`
- `worldHour = floor(worldHourFloat)`
- `worldYearFloat = worldDayFloat / seasons.worldDaysPerYear`

Update per step using RT `dt` (seconds):

```
ΔWT(days) = dt * time.timeScale / time.realSecondsPerWorldDay
worldDayFloat += ΔWT
```

## Biological Defaults

- **Adult lifespan (baseline)**: `time.bio.defaultAdultLifespanDays = 30` world days.
  - Size affects lifespan mildly: `lifespanDays = default * clamp(0.8 + radius / 10, 0.8, 1.2)`.
  - Behavior can modulate via costs already present; the above is an upper bound when healthy.
- **Gestation**: `time.bio.gestationDaysBase = 2` days (stamina/energy and genes still apply).

## Corpse Decay

- Corpse stores:
  - `birthWorldDayFloat` (when created)
  - `decayDurationDays` (target duration in days)
- Decay duration rule of thumb (size-based):
  - `decayDurationDays = clamp(1.0 + radius * 0.1, 1.0, 8.0)`
- Decay fraction (0..1):
  - `tDays = worldDayFloat - birthWorldDayFloat`
  - `frac = clamp(tDays / decayDurationDays, 0, 1)`
- Rendering/physics can reference `frac`:
  - Scale: `radius * lerp(1.0, 0.6, frac)` (never disappears due to scale alone)
  - Color:
    - Fresh (frac < 0.25): gray ~ rgb(100,100,100)
    - Mid (0.25 ≤ frac < 0.75): interpolate gray→brownish→purple
    - Late (frac ≥ 0.75): purple ~ rgb(120,50,120)
- Removal: when `frac >= 1.0`.

Note: This deprecates the current fixed `initialDecayTime`/`decay_timer` seconds-like model in favor of days. We can bridge by maintaining both during migration.

## Day/Night Cycle

- **Sunlight factor** `L` for [0..1] based on hour of day:
  - `h = worldHourFloat` (0..24)
  - `L = 0.5 + 0.5 * sin((h - 6) / 24 * 2π)` (peak around noon, low at midnight)
- Consumers:
  - Renderer ambient light and sky color
  - Plant growth tick (optional: grow faster at dawn/morning)
  - Creature behavior modifiers (vision range penalty at night for non-nocturnal species)

## Seasons

- **Season fraction** `S = fract(worldYearFloat)`
- Simple sinusoidal modulation:
  - Temperature proxy `T = 0.5 + 0.5 * sin(2π * S)` (peak mid-year)
  - Humidity proxy `H = 0.5 + 0.5 * sin(2π * (S + 0.25))`
- Consumers:
  - Plant spawn rate, fertility fields
  - Weather vector field magnitude
  - Creature ambient health delta (mild effect)

## Weather

- Weather noise advection gets an extra time term:
  - Replace `phase = frameCount * k` with `phase = worldDayFloat * 2π` (scaled by a speed factor)
  - Add seasonal amplitude modulation: `amp = 0.7 + 0.3 * T`
  - Final: `noise(x, y, phase) * amp`

## Implementation Plan

- **Store (`src/composables/useSimulationStore.ts`)**
  - Add `simulationTime` state:
    - `{ worldDayFloat, worldDay, worldHourFloat, worldHour, worldYearFloat }`
  - Add `time` config under `simulationParams`:
    - `{ realSecondsPerWorldDay, timeScale, startDay, dayNight: { enabled }, seasons: { enabled, worldDaysPerYear }, bio: { defaultAdultLifespanDays, gestationDaysBase } }`
  - Update per `update(dt)`.
  - Expose readonly getters for consumers.

- **WASM (`src/wasm/ecosim/src/lib.rs`)**
  - Add fields to `World`:
    - `world_day_float: f32`, `real_seconds_per_world_day: f32`, `time_scale: f32`, `world_days_per_year: f32`
  - Step update uses same ΔWT formula.
  - Creatures:
    - Track `age_days += ΔWT` and compare to `lifespanDays` bound.
    - Gestation timers accumulate in days.
  - Corpses:
    - Store `birth_world_day_float` and `decay_duration_days` instead of timers.
    - Expose `decay_fraction` in JSON for the renderer (optional but convenient).

- **Renderer (`src/webgl/renderer.ts`)**
  - Accept `worldDayFloat` and compute `frac` for corpse color/scale if not provided by WASM.
  - Add ambient/directional light modulation by day/night `L`.
  - Weather phase uses `worldDayFloat` and seasonal amplitude.

## Backward Compatibility

- During migration keep mapping:
  - If `decayTimer/initialDecayTime` exist, compute `frac = 1 - (decayTimer / max(1e-3, initialDecayTime))`.
  - Prefer WASM `decay_fraction` if present.

## Tuning Recommendations

- Start with `realSecondsPerWorldDay = 600`, `timeScale = 1.0`.
- Lifespan: 30 days baseline, clamp 24–36 via size.
- Corpse decay: 1–8 days depending on radius.
- Seasons: 120 days/year; adjust once plant/creature dynamics feel right.

## Telemetry & Debug

- Overlay: show `worldDayFloat` (1 decimal), `hour`, `season%`, and average corpse `frac`.
- Add dev hotkeys to speed up/slow down `timeScale`.

---

## Alignment With Cost.md (dt normalization)

- All per-sec coefficients in `Cost.md` must multiply RT `dt` (seconds): `delta = ratePerSec * dt`.
- Time scaling only affects world time passage; it should NOT inadvertently scale metabolic rates. Keep costs tied to RT to avoid doubling effects.
  - Example: if `timeScale = 2`, day/night moves twice as fast, but energy drains per real second remain the same.
- Optional feature: expose `time.affectMetabolism` (default `false`). If `true`, apply a global multiplier `metabolismTimeScale = time.timeScale` to per-sec rates.

Recommended invariants:

- Lifespan, gestation, corpse decay progress by WT (days), derived from `worldDayFloat`.
- Energy/stamina/health rates use RT `dt` and remain stable under timeScale unless explicitly allowed.

## Alignment With inputs.md (brain inputs)

Add time-derived normalized inputs:

- `hour_norm = worldHourFloat / 24` ∈ [0,1]
- `day_norm = fract(worldDayFloat)` ∈ [0,1]
- `season_norm = fract(worldYearFloat)` ∈ [0,1]
- `age_norm` should be based on days: `min(1, age_days / lifespanDays)`

Optional modifiers for learning stability:

- Provide `light_norm = L` (from Day/Night) as an external input.
- Provide `temperature_norm = T` and `humidity_norm = H` from Seasons.

## Circadian/Seasonal Effects on Costs

Circadian (by hour):

- Vision: reduce effective range at night for non-nocturnal species, not the cost coefficient itself. If you prefer to modulate costs, apply a small factor (e.g., +10% at night for active scanning).
- Resting bonuses: slightly increase `restHealthRegenPerSec` at night.

Seasonal:

- Plant spawn rates scale by `T` (temperature proxy).
- Ambient penalties can be nudged by season: `ambientHealthDecayPerSec *= (0.9 + 0.2 * (1 - T))`.

## Simulation Params (time) — Consolidated

Add under `simulationParams.time`:

- `realSecondsPerWorldDay: number = 600`
- `timeScale: number = 1.0`
- `startDay: number = 0`
- `affectMetabolism: boolean = false`
- `dayNight: { enabled: boolean = true }`
- `seasons: { enabled: boolean = true, worldDaysPerYear: number = 120 }`
- `bio: { defaultAdultLifespanDays: number = 30, gestationDaysBase: number = 2 }`

## Integrators and Substeps

- If physics/brains run at a fixed substep `h` (e.g., 1/60 s), accumulate variable frame `dt` into `accum` and step in fixed quanta:
  - `while (accum >= h) { step(h); accum -= h }`
- Use `h` for cost integration (per-sec rates) and world clock accumulation for consistent results.

## Age, Lifespan, and Removal (WT)

- Track `creature.age_days += ΔWT`. Death can occur by costs or when `age_days > lifespanDays`.
- `lifespanDays` can be phenotype-modulated: `default * clamp(0.8 + radius/10, 0.8, 1.2)`.
- Brain input `age_norm = min(1, age_days / lifespanDays)`.

## Corpse Gradient (definitive)

Using decay fraction `frac ∈ [0,1]`:

- Scale: `s = radius * (1.0 - 0.4 * frac)`
- Color ramp (suggested):
  - 0.00–0.25: gray (100,100,100)
  - 0.25–0.50: lerp(gray → brown(120,90,60))
  - 0.50–1.00: lerp(brown → purple(120,50,120))
    This provides a smooth progression and matches the OG endpoints.

## Weather Coupling (deterministic)

- Replace frame-dependent phases with `worldDayFloat`-based phases to decouple visuals from FPS.
- Seasonal amplitude modulation uses `T`.
- Optional: add wind direction seasonal drift via a slow phase offset from `worldYearFloat`.

## JS/WASM Parity and Migration

- Bridge model: while `decayTimer/initialDecayTime` still exist, compute `frac = 1 - decayTimer / max(1e-3, initialDecayTime)` in JS.
- Prefer WASM fields once added: `birth_world_day_float`, `decay_duration_days`, and optional `decay_fraction` for direct use.
- Centralize time config in JS and push to WASM on world init/reset to avoid drift.

## Telemetry (time)

- Add to overlays:
  - `worldDayFloat.toFixed(2)`, `hour`, `season%`.
  - Mean `age_days`, mean `lifespanDays`, corpse count, mean corpse `frac`.
- Log timeScale changes and realSecondsPerWorldDay for replayability.

---

## Simulation Parameters Appendix (consolidated)

All parameters live under `simulationParams` and should be hot-reloadable unless noted.

- time
  - `realSecondsPerWorldDay = 600`
  - `timeScale = 1.0`
  - `startDay = 0`
  - `affectMetabolism = false`
  - `dayNight = { enabled: true }`
  - `seasons = { enabled: true, worldDaysPerYear: 120 }`
  - `bio = { defaultAdultLifespanDays: 30, gestationDaysBase: 2 }`

- weather (see `weather.md`)
  - `enabled = true`
  - `weatherSpeed = 0.2`
  - `cloudOpacity = 0.6`
  - `rainToMudStrength = 0.4`
  - `mudDryingRatePerSec = 0.02`
  - `windFrictionCoeff = 0.05`
  - `tempEffects = { coldThresh: 0.25, hotThresh: 0.75, hypothermiaPenaltyPerSec: 0.006, heatPenaltyPerSec: 0.006 }`
  - `humidityEffects = { decayBoostAtHighH: 0.25, decaySlowAtLowH: 0.2 }`
  - `storm = { baroDropThresh: 0.35, rainBoost: 0.5, windBoost: 0.4 }`

- terrain (see `terrain.md`)
  - `minTerrainSpeedMult = 0.2`
  - `substrateSpeedMult = { grass:1.0, sand:0.8, rock:1.0, mud:0.6 }`
  - `slopeCostCoeff = 0.4`
  - `roughnessJitterCoeff = 0.2`
  - `obstacleAvoidanceRadius = 8`
  - `fertilityRegenPerDay = 0.01`
  - `hydrology = { swimCostCoeff: 0.4, flowPushCoeff: 0.3, turbidityVisionPenalty: 0.4 }`

- disease (placeholder)
  - `enabled = false`
  - `baseInfectionRate = 0.0`
  - `corpseProximityInfectionBoost = 0.0`
  - `recoveryRatePerSec = 0.0`
  - `immunityDurationDays = 0`
