# EvoSim Terrain Architecture

Defines terrain representation, sampling, and its effects on locomotion, sensing, collisions, fertility, hydrology, and microclimates. Aligns with `time.md`, `weather.md`, `inputs.md`, and `Cost.md`.

## Terrain Layers

- Elevation `Z(x,y)` — meters or normalized [0,1].
- Slope `S(x,y)` — gradient magnitude from elevation.
- Roughness `Rgh(x,y)` — local variance of elevation/normals.
- Substrate `Sub(x,y)` — categorical: grass, sand, rock, mud, waterbed.
- Obstacles `Obs(x,y)` — static colliders (boulders, logs) and dynamic (fallen trees).
- Fertility `F(x,y)` — plant nutrient availability field.
- Hydrology `Hyd(x,y)` — water presence: depth, flow vector, turbidity.

## Data Representation

- Tile grid with per-tile attributes for performance. Derive slope/roughness from elevation.
- Obstacles as instanced colliders; broadphase grid for queries.
- Hydrology depth and flow stored as 2D textures/grids; rain from `weather.md` updates puddles.

## Simulation Params (`simulationParams.terrain`)

- `minTerrainSpeedMult = 0.2` (clamp)
- `substrateSpeedMult = { grass:1.0, sand:0.8, rock:1.0, mud:0.6 }`
- `slopeCostCoeff = 0.4` (cost multiplier per normalized slope)
- `roughnessJitterCoeff = 0.2` (adds heading jitter)
- `obstacleAvoidanceRadius = 8`
- `fertilityRegenPerDay = 0.01`
- `hydrology`: `{ swimCostCoeff: 0.4, flowPushCoeff: 0.3, turbidityVisionPenalty: 0.4 }`

## Locomotion and Costs (see `Cost.md`)

- Base terrain speed multiplier:
  - `terrain_speed_mult = substrateSpeedMult[Sub] * (1 - clamp(S,0,1)*0.5) * (1 - rainMudFactor)`
  - Clamp with `minTerrainSpeedMult`.
- Additional per-RT-second cost scalar:
  - `locomotionCost *= clamp(1 / terrain_speed_mult, 1, 1/minTerrainSpeedMult)`
- Slope adds stamina/energy load proportional to `S` and facing uphill.
- Water depth > threshold → swimming:
  - Add `swimCostCoeff * speed`; apply `flowPushCoeff * Hyd.flow` to velocity; drowning risk if stamina low.

## Sensing and Visibility

- Turbidity near/underwater reduces vision range by `turbidityVisionPenalty * Hyd.turbidity`.
- Fog/visibility handled in `weather.md`; combine multiplicatively.
- Roughness increases occlusion probability for raycasts.

## Fertility and Plants

- Fertility drives plant spawn and growth:
  - `spawnRate *= lerp(0.3, 1.5, F)`; `growth *= lerp(0.5, 1.3, F)`
- Corpses slowly recycle into fertility locally over days.

## Obstacles and Collisions

- Obstacles contribute to collision events; increase `collisionDamageHealthPerUnitImpulse` outcomes.
- Steering: simple avoidance using `obstacleAvoidanceRadius` and density sampling.

## Hydrology Details

- Depth increases from rain and rivers; decreases by evaporation/drainage.
- Flow vectors advect lightweight particles (visual) and affect movement.
- Drinking allowed at shallow edges; thirst recovery per `Cost.md`.

## Microclimates and Altitude

- Altitude reduces temperature and oxygen (links to `weather.md`):
  - `tempOffset = -k * altitude`
  - `oxygen_norm = clamp(1 - k_o2 * altitude, 0.6, 1)` impacts stamina regen.
- Shade from terrain/obstacles reduces `L` locally.

## Inputs (see `inputs.md`)

Suggest adding:

- `terrain_speed_mult`, `slope_norm`, `roughness_norm`, `obstacle_density_norm`
- `near_water`, `dist_to_water`, `water_flow_speed_norm`, `turbidity_norm`
- `fertility_norm`, `altitude_norm`, `oxygen_norm`

## Telemetry

- Track average `terrain_speed_mult`, slope histograms, water coverage, fertility maps, obstacle density.
