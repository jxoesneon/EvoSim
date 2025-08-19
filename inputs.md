# Brain Inputs Specification (external vs internal)

This document defines the inputs a creature’s brain receives each simulation tick. Inputs are grouped into external (world/perception) and internal (physiology/state) signals. Each input includes a normalization rule so values are in stable ranges for learning. Unless otherwise noted, ranges are clamped to the specified bounds after normalization.

Conventions:

- All per-tick values are provided once per `update()` step.
- Distances are in world units; angles are radians.
- Norm: [0,1] unless stated; signed values use [-1,1].
- Use `wrapAngle()` semantics for angle deltas and normalize by π.

## External Inputs

- **[terrain_speed_mult]**
  - Meaning: Effective terrain speed multiplier at current position (`speedMult`), considering terrain type.
  - Raw: ~[minTerrainSpeedMult, 1]
  - Norm: `(m - minTerrainSpeedMult) / (1 - minTerrainSpeedMult)` ∈ [0,1]

- **[terrain_type_onehot: grass, sand, rock, water]**
  - Meaning: One-hot encoding of local terrain class (if applicable in renderer/world). If unknown, all zeros.
  - Raw: categorical
  - Norm: one-hot bits ∈ {0,1}

- **[near_plant]**, **[near_corpse]**, **[near_prey]**, **[near_predator]**, **[near_mate]**
  - Meaning: Proximity booleans (within interaction radius used by actions/events).
  - Raw: boolean
  - Norm: {0,1}

- **[dist_to_plant]**, **[dist_to_corpse]**, **[dist_to_prey]**, **[dist_to_predator]**, **[dist_to_mate]**
  - Meaning: Distance to nearest target of each category within vision; if none, treat as max range.
  - Raw: [0, sightRange]
  - Norm: `1 - clamp(d / sightRange, 0, 1)` (nearer → larger signal)

- **[angle_to_plant]**, **[angle_to_corpse]**, **[angle_to_prey]**, **[angle_to_predator]**, **[angle_to_mate]**
  - Meaning: Angular offset from facing to nearest target in vision (signed, left negative/right positive).
  - Raw: [-π, π]
  - Norm: `wrap(angle)/π` ∈ [-1,1]

- **[targets_in_fov_count_norm]**
  - Meaning: Total count of recognizable targets in FOV (plants+prey+predators+mates) normalized.
  - Raw: integer ≥ 0
  - Norm: `tanh(count / 6)` ∈ (0,1)

- **[vision_density_norm]**
  - Meaning: Fraction of rays/eyes hitting any object.
  - Raw: [0,1]
  - Norm: identity

### Weather Inputs

- **[light_norm]**
  - Meaning: Local sunlight factor `L` from weather/day-night (see `time.md`, `weather.md`).
  - Raw: [0,1]
  - Norm: identity
- **[temp_norm]**
  - Meaning: Local temperature proxy `T`.
  - Raw: [0,1]
  - Norm: identity
- **[humidity_norm]**
  - Meaning: Local humidity proxy `H`.
  - Raw: [0,1]
  - Norm: identity
- **[rain_norm]**
  - Meaning: Local precipitation intensity `R`.
  - Raw: [0,1]
  - Norm: identity
- **[wind_speed_norm]**
  - Meaning: Local wind magnitude `|W|`.
  - Raw: [0,1]
  - Norm: identity
- **[wind_dir_sin]**, **[wind_dir_cos]** (optional)
  - Meaning: Encodes wind direction as sine/cosine of heading.
  - Raw: [-1,1]
  - Norm: identity
- **[baro_norm]**, **[storm_alert_norm]** (optional)
  - Meaning: Barometric proxy and storm likelihood.
  - Raw: [0,1]
  - Norm: identity

### Visibility and Noise

- **[visibility_norm]**
  - Meaning: Atmospheric visibility `V` (fog/smoke/dust), separate from light.
  - Raw: [0,1]
  - Norm: identity
- **[noise_floor_norm]**
  - Meaning: Ambient noise level `N` affecting communication/sensing.
  - Raw: [0,1]
  - Norm: identity

### Radiation and Shadowing

- **[uv_norm]**
  - Meaning: UV/insolation proxy.
  - Raw: [0,1]
  - Norm: identity
- **[shadow_norm]**
  - Meaning: Terrain/obstacle shadow factor.
  - Raw: [0,1]
  - Norm: identity

### Disease and Hazards

- **[infection_risk_norm]**
  - Meaning: Local infection risk (corpses, humidity/temp, crowding).
  - Raw: [0,1]
  - Norm: identity
- **[hazard_alert_norm]**
  - Meaning: Active natural hazard intensity/proximity.
  - Raw: [0,1]
  - Norm: identity

### Terrain and Hydrology

- **[slope_norm]**
  - Meaning: Local slope magnitude.
  - Raw: [0,1]
  - Norm: identity
- **[roughness_norm]**
  - Meaning: Local terrain roughness.
  - Raw: [0,1]
  - Norm: identity
- **[obstacle_density_norm]**
  - Meaning: Density of obstacles within avoidance radius.
  - Raw: [0,1]
  - Norm: identity
- **[near_water]**, **[dist_to_water]**
  - Meaning: Presence and distance to nearest drinkable water.
  - Raw: boolean; distance in world units
  - Norm: {0,1}; `tanh(dist/k)`
- **[water_flow_speed_norm]**
  - Meaning: Local flow magnitude for rivers/streams.
  - Raw: [0,1]
  - Norm: identity
- **[turbidity_norm]**
  - Meaning: Water turbidity affecting visibility.
  - Raw: [0,1]
  - Norm: identity

### Altitude and Oxygen

- **[altitude_norm]**
  - Meaning: Normalized altitude.
  - Raw: [0,1]
  - Norm: identity
- **[oxygen_norm]**
  - Meaning: Oxygen availability proxy.
  - Raw: [0.6,1]
  - Norm: remap to [0,1] if needed via `(val-0.6)/0.4`

- **[recent_damage_norm]**
  - Meaning: Damage received over a short moving window (e.g., last 1s).
  - Raw: health lost per second equivalent
  - Norm: `tanh(dps / 10)` ∈ (0,1)

- **[ambient_difficulty_norm]**
  - Meaning: A scalar summarizing costly context (e.g., high slope/roughness or panic multiplier active).
  - Raw: multiplier ≥ 1 (when active)
  - Norm: `(min(mult, 3) - 1) / 2` ∈ [0,1]

Note: If full multi-ray vision is used, these aggregates can be provided alongside per-ray channels. A compact aggregate set keeps networks smaller and training simpler.

## Internal Inputs

- **[energy_norm]**
  - Meaning: Energy store.
  - Raw: [-50, 100] (clamped in sim)
  - Norm: `(energy + 50) / 150` ∈ [0,1]

- **[stamina_norm]**
  - Meaning: Stamina store.
  - Raw: [0, maxStamina]
  - Norm: `stamina / maxStamina` ∈ [0,1]

- **[health_norm]**
  - Meaning: Health.
  - Raw: [0,100]
  - Norm: `health / 100`

- **[thirst_norm]**
  - Meaning: Thirst level (higher is better hydration).
  - Raw: [0,100]
  - Norm: `thirst / 100`

- **[hunger_norm]**
  - Meaning: Derived hunger drive.
  - Raw: from energy; e.g., `hunger = 1 - energy_norm`
  - Norm: [0,1]

- **[sdrive_norm]**
  - Meaning: Sex drive signal (`sDrive`).
  - Raw: [0,1] (by design)
  - Norm: identity

- **[fear_norm]**
  - Meaning: Fear level.
  - Raw: [0,1]
  - Norm: identity

- **[fatigue_norm]**
  - Meaning: Derived inverse of stamina.
  - Raw: `fatigue = 1 - stamina_norm`
  - Norm: [0,1]

- **[age_norm]**
  - Meaning: Age scaled by lifespan in world days (see `time.md`).
  - Raw: `age_days` with lifespan bound `lifespanDays`
  - Norm: `min(1, age_days / lifespanDays)`

- **[is_resting]**, **[is_sprinting]**, **[is_pregnant]**
  - Meaning: Action/state flags.
  - Raw: boolean
  - Norm: {0,1}

- **[gestation_timer_norm]**
  - Meaning: Time remaining or progress for gestation.
  - Raw: [0, G]
  - Norm: `1 - clamp(timer / G, 0, 1)` (progress)

- **[speed_norm]**
  - Meaning: Current speed magnitude.
  - Raw: [0, vmax]
  - Norm: `min(1, speed / vmax)` with `vmax` from phenotype.

- **[turn_rate_norm]**
  - Meaning: Signed turning rate.
  - Raw: [-ωmax, ωmax]
  - Norm: `turnRate / ωmax` ∈ [-1,1]

## Notes on Source and Parity

- Many internal values come directly from `Creature` fields in `src/composables/useSimulationStore.ts`:
  - `energy`, `stamina`, `health`, `thirst`, `sDrive`, `fear`, `lifespan`, `isResting`, `isSprinting`, `isPregnant`, `gestationTimer`, `vx`, `vy`, `radius`, `phenotype`.
- External aggregates (distances/angles/near flags) should be computed from the same proximity queries used for events to ensure JS and WASM parity.
- Normalization constants should be centralized to avoid drift between JS fallback and WASM.

## Recommended Minimal Set (for small brains)

If you prefer a compact input vector:

- External: `terrain_speed_mult`, `near_plant`, `near_corpse`, `near_prey`, `near_predator`, `dist_to_plant`, `dist_to_predator`, `angle_to_plant`, `angle_to_predator`.
- Internal: `energy_norm`, `stamina_norm`, `health_norm`, `thirst_norm`, `sdrive_norm`, `fear_norm`, `age_norm`, `speed_norm`.

### Time-Derived Inputs (recommended)

- `hour_norm = worldHourFloat / 24`
- `day_norm = fract(worldDayFloat)`
- `season_norm = fract(worldYearFloat)`

### Optional Aggregates

- **[resource_abundance_norm]**
  - Meaning: Local aggregate for accessible plants/corpses abundance.
  - Raw: [0,1]
  - Norm: identity

## Inputs Vector Ordering and Versioning

- Define and freeze an ordering for the active input vector used by brains.
- Maintain a mapping table in code: `InputIndexMap`.
- Version bump: v0.2 — adds visibility, noise, UV/shadow, infection risk, hazards, hydrology, terrain features, altitude/oxygen, and resource abundance.

## Update Frequency and Smoothing

- Provide raw per-tick values, but apply EMA smoothing to noisy signals for stability:
  - Suggested α = 0.2 for distances/angles and 0.1 for state stores (energy/stamina/health/thirst).
- Clamp after smoothing to keep within target ranges.

## Versioning

- v0.1 (this spec): aligned to Cost.md and current store fields; prepared for JS/WASM parity.
- Future versions may add richer per-ray vision channels or environment features (e.g., temperature, obstacles).
