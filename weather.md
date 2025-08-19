# EvoSim Weather Architecture

This document specifies the weather system, data flow, and its effects on terrain, decay, health, plants, and behavior. It aligns with `time.md` (world time), `inputs.md` (brain inputs), and `Cost.md` (cost tunables).

## Goals
- Deterministic yet rich spatiotemporal patterns (noise-based + time-driven).
- Minimal overhead per tick; chunk-friendly updates.
- Clear coupling to world time (day/night + seasons) for diurnal/seasonal variability.

## Weather Fields
Represent weather as continuous scalar/vector fields sampled at world coordinates (x, y):
- `Light L(x, y, t)` ∈ [0,1] — sunlight exposure (day/night baseline with cloud occlusion).
- `Temp T(x, y, t)` ∈ [0,1] — normalized temperature proxy (season + diurnal + weather noise).
- `Humidity H(x, y, t)` ∈ [0,1] — humidity proxy (season + precipitation feedback).
- `Rain R(x, y, t)` ∈ [0,1] — precipitation intensity.
- `Wind W(x, y, t)` — 2D vector; magnitude normalized ∈ [0,1].

Optional derived:
- `Baro B(x, y, t)` ∈ [0,1] — barometric proxy from large-scale noise; falling baro → storms.
- `Storm S(x, y, t)` ∈ {0,1} or [0,1] — storm likelihood/intensity.

## Time Coupling (see `time.md`)
- Use `worldDayFloat` for phases to decouple from FPS.
- Seasonal amplitude via `season_norm = fract(worldYearFloat)`.
- Example base forms:
  - `L = baseDayNight(h) * (1 - cloudCover)`; `h = worldHourFloat`.
  - `T = 0.5 + 0.4*sin(2π*S) + 0.1*sin(2π*h/24) + tempNoise(x,y,t)` (clamp to [0,1]).
  - `H = 0.5 + 0.3*sin(2π*(S+0.25)) + humidNoise` (clamp to [0,1]).
  - `R = clamp(clouds^k * moistureFactor, 0, 1)`; moistureFactor from H and baro.
  - `W = amp(S) * vecNoise(x,y,t)`; amp increases in certain seasons/storms.

## Noise and Performance
- Use band-limited simplex/perlin noise with tiled octaves.
- Large-scale field low frequency; add a small high-frequency detail layer.
- Advection phase: `phase = worldDayFloat * 2π * weatherSpeed`.
- Cache per-chunk field samples each N frames to amortize cost; interpolate per tick.

## Simulation Params (`simulationParams.weather`)
- `enabled: true`
- `weatherSpeed: 0.2` — cycles/day for advection.
- `cloudOpacity: 0.6` — scales L attenuation.
- `rainToMudStrength: 0.4` — how much rain reduces terrain speed.
- `mudDryingRatePerSec: 0.02` — recovery toward baseline when R low.
- `windFrictionCoeff: 0.05` — extra locomotion cost multiplier from wind.
- `tempEffects: { coldThresh: 0.25, hotThresh: 0.75, hypothermiaPenaltyPerSec: 0.006, heatPenaltyPerSec: 0.006 }`
- `humidityEffects: { decayBoostAtHighH: 0.25, decaySlowAtLowH: 0.2 }`
- `storm: { baroDropThresh: 0.35, rainBoost: 0.5, windBoost: 0.4 }`
- `lighting: { minAmbient: 0.2, maxAmbient: 1.0 }`

Tune values in `Cost.md` if stronger/weaker effects are desired.

## Terrain Effects
- Maintain a `wetness(x,y)` scalar ∈ [0,1]. Update:
  - `wetness += rainAccrualRate * R - dryingRate * (1 - R) * (1 - H)` (dt-scaled)
  - Clamp to [0,1]. Persist in a grid/sparse map per tile.
- Convert to terrain speed multiplier:
  - `terrain_speed_mult_weather = 1 - rainToMudStrength * wetness`
  - Combined with base terrain: `terrain_speed_mult = baseMult * terrain_speed_mult_weather`, clamped by `minTerrainSpeedMult`.
- Wind head/tail effect (optional):
  - Multiply locomotion cost by `1 + windFrictionCoeff * max(0, cos(angleBetween(vel, W_dir)) * |W|)`.

## Corpse Decay Effects
- Modify decay duration days in `time.md`:
  - `decayDurationDays' = decayDurationDays * (1 - humidityEffects.decayBoostAtHighH * H + decaySlowAtLowH * (1 - H)) * tempDecayFactor(T)`
  - `tempDecayFactor(T) = lerp(0.9, 1.1, T)` (warmer → slightly faster decay).
- Rain accelerates scavenger access (optional): small increase to scavenge success near R peaks.

## Health and Physiology
- Ambient penalties (RT per-second; see `Cost.md`):
  - If `T < coldThresh`: `ambientHealthDecayPerSec += hypothermiaPenaltyPerSec * (coldThresh - T)`.
  - If `T > hotThresh`: `ambientHealthDecayPerSec += heatPenaltyPerSec * (T - hotThresh)`.
- Dehydration risk increases when `H` is very low and `T` is high:
  - `dehydrationEnergyLossPerSec *= (1 + 0.5 * max(0, T - hotThresh) + 0.5 * max(0, 0.3 - H))`.
- Resting at night: increase `restHealthRegenPerSec` slightly when `L` is low.

## Plants and Water
- Plant spawn/growth rates scale with season and local weather:
  - `spawnRate *= (0.6 + 0.8*T) * (0.5 + 0.5*H)`.
- Temporary puddles/water availability (optional):
  - Create shallow water tiles when `R` sustained > threshold; decay their depth over time for drinking.

## Renderer and Visuals
- Use `L` to modulate ambient/directional lights: `ambient = lerp(minAmbient, maxAmbient, L)`.
- Cloud layer already present: bind its alpha/intensity to `R` and `H` to reflect heavier clouds.
- Add simple rain streak particles when `R` above threshold; wind affects direction.

## Brain Inputs (see `inputs.md`)
Add normalized signals:
- `light_norm = L`
- `temp_norm = T`
- `humidity_norm = H`
- `rain_norm = R`
- `wind_speed_norm = |W|`
- `wind_dir_sin`, `wind_dir_cos` for direction encoding (optional)
- `baro_norm = B` and `storm_alert_norm = S` (optional)

## Integration Order (per tick)
1. Update world clock (see `time.md`).
2. Sample/update weather fields for needed chunks/positions.
3. Update terrain wetness and resulting speed multipliers.
4. Apply weather modifiers to costs/health (RT dt-based).
5. Step creatures (brains + physics), using inputs that include weather.
6. Update corpses (decay fraction considering weather modifiers).
7. Render lighting/clouds/rain using current weather.

## Determinism and Parity
- Seed noise with a fixed seed for reproducibility.
- Centralize all weather tunables in `simulationParams.weather`.
- Mirror weather usage in WASM and JS fallback. If WASM computes decay based on weather, expose `decay_fraction` so renderer need not recompute.

## Telemetry
- Track rolling averages: area mean `R`, `T`, `H`, `|W|`.
- Per creature: sampled `L`, `T`, `H`, `R`, `|W|`, terrain wetness at position.
- Surface in overlays for debugging and balancing.

---

## Visibility and Fog
- Define a visibility scalar `V(x,y,t)` ∈ [0,1] separate from `L`:
  - Base from humidity and particulates: `V = clamp(1 - 0.6*H - particulateNoise, 0, 1)`.
  - Rain reduces `V` modestly; dust/smoke events (see Hazards) reduce `V` sharply.
- Effects:
  - Renderer fog factor from `1 - V`.
  - Vision effective range = `baseRange * V` (prefer this over changing cost rates).
  - Add `visibility_norm = V` to brain inputs.

## Noise / Soundscape
- Ambient noise level `N(x,y,t)` ∈ [0,1] driven by wind, rain, storms, crowds.
- Effects:
  - Communication effectiveness penalty proportional to `N` (optionally small energy overhead).
  - Add `noise_floor_norm = N` to brain inputs.

## Radiation / UV & Shadowing
- UV proxy `UV(x,y,t)` ∈ [0,1]: diurnal peak at noon, seasonal dependence, cloud attenuation, altitude increase.
- Shadow factor `Sh(x,y,t)` from terrain/obstacles (see `terrain.md`).
- Effects:
  - Plant growth boost with moderate `UV`.
  - Optional UV stress penalties at extreme `UV`.
  - Add `uv_norm` and `shadow_norm` to brain inputs.

## Disease / Pathogens Coupling
- Weather modulates transmission:
  - High humidity and low temperature can increase survival of certain pathogens.
- Hooks:
  - Define a simple infection risk field that scales with local corpse density and `H`.
  - Add `infection_risk_norm` input.
  - See `Cost.md` for periodic health drains and recovery modifiers.

## Natural Hazards / Disasters
- Event scheduler driven by `worldDayFloat` and barometric trends:
  - Floods (sustained `R`), heatwaves (high `T`), cold snaps (low `T`), wildfires (dry + wind).
- Effects:
  - Strong short-term penalties (health drain, movement limits), visibility drops (smoke/dust), temporary obstacle creation.
  - Add `hazard_alert_norm` input and per-event flags.

## Microclimates & Altitude
- Microclimate offsets (cooler under canopy, moderated near water): modify `T` and `L` locally.
- Altitude increases UV, reduces temperature and oxygen (see `terrain.md`).
- Expose `altitude_norm`, `oxygen_norm` via terrain sampling; weather uses them to bias `UV` and `T`.

## Seasonal Phenology Hooks
- Tie resource cycles to `season_norm` (see `time.md`): plant fruiting windows, migratory winds.
- Provide `resource_abundance_norm` as an optional aggregate input (plants/corpses availability).
