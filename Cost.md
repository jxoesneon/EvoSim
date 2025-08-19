# EvoSim Cost System Specification

This document proposes a unified, extensible energy/stamina/health cost model for all properties (phenotype/genotype), actions, inactions, and mutations. It is designed to be:

- Predictable: same formula shapes across domains.
- Tunable: all coefficients exposed via `simulationParams`.
- Fair: costs scale with capability (e.g., faster, larger FOV costs more).
- Performant: per-tick formulas are O(1) per creature and amenable to chunked updates.

All costs are expressed as per-tick deltas unless otherwise noted. Energy and stamina are in the same units as used in `useSimulationStore.ts` (energy ∈ [0, 100] nominal; stamina ∈ [0, 100]). Health loss is applied when energy < 0 (starvation) or on explicit damage.

## Core Resources

- Energy (E): primary metabolic currency. Consumption reduces E; food increases E.
- Stamina (S): short-term exertion buffer. Sprinting/attacking uses S before E.
- Health (H): reduces on damage or severe deficit (E ≪ 0).

Coupling rules:

- When S is available, high-exertion actions draw from S first. If S ≤ 0, overflow draws from E at `sprintEnergyOverflowCoeff`.
- If E < 0, apply health loss at `starvationHealthLossPerNegEnergy` per tick while negative.

## Global Normalization

Let dt be the simulation step in seconds, or use 1 tick if normalized updates.

- energyDeltaApplied = sum(costs) \* dt
- staminaDeltaApplied = sum(stamina_costs) \* dt

All coefficients are calibrated per-second; multiply by dt accordingly if your loop uses real dt.

Time coupling: `timeScale` (see `time.md`) only affects world time passage (day/night/seasons). Per-second cost rates remain tied to real time unless explicitly enabled via a global metabolism multiplier.

## New/Adjusted `simulationParams` (proposed)

Add these tunables (names chosen to match current style):

- Basal metabolism
  - baseMetabolicCostPerSec = 0.08
  - sizeMetabolicCostPerSec = 0.04 per +1.0 size
  - brainMetabolicCostPerNeuronPerSec = 0.0008
  - visionMetabolicCostBasePerSec = 0.01
  - visionMetabolicCostPerEyePerSec = 0.005
  - visionMetabolicCostPer100RangePerSec = 0.008
  - visionMetabolicCostPer90FovPerSec = 0.006
- Locomotion
  - moveCostCoeffPerSpeedPerSec = 0.06 (applied to |v|)
  - turnCostCoeffPerRadPerSec = 0.02 (applied to |dHeading/dt|)
  - accelerationCostCoeffPerAccelPerSec = 0.03
  - sprintStaminaDrainPerSpeedPerSec = 0.12
  - sprintEnergyOverflowCoeff = 0.5 (fraction of sprint drain that overflows to E when S depleted)
  - panicLocomotionCostMultiplier = 1.3 (applies to locomotion costs when fear > threshold)
  - terrainCostMultiplierK = 1.0 (global tuning for terrain difficulty; see terrain notes)
  - minTerrainSpeedMult = 0.2 (clamp for terrain multiplier to avoid explosion near 0)
- Actions (per second of action unless noted)
  - communicationCostPerBytePerSec = 0.001
  - glowCostPerUnitPerSec = 0.004 (if using communicationColor intensity)
  - attackCostPerHit = 2.5 energy, 10 stamina
  - mateActionCostPerAttempt = 1.2 energy, 5 stamina
  - drinkCostPerSecond = 0.01 (minor effort)
  - harvestPlantActionCostPerSecond = 0.015
  - scavengeCorpseActionCostPerSecond = 0.02
  - thirstRecoveryPerSec = 0.5 (reduce thirst metric while drinking)
- Reproduction / Lifecycle
  - gestationBaseCostPerSec = 0.02
  - gestationCostPerOffspringPerSec = 0.015
  - birthEventCostEnergy = 4.0
  - mutationCostEnergyBase = 0.5 per expressed mutation
  - mutationCostPerStdChange = 0.8 per 1.0 SD change (see mutation section)
- Recovery
  - restStaminaRegenPerSec = 0.15
  - restEnergyRegenCoeff = 0.2 (fraction of incoming food routed to E while resting)
  - restHealthRegenPerSec = 0.01
- Penalties
  - starvationHealthLossPerNegEnergyPerSec = 0.02 (consider clamping effect to avoid spikes with large negative E)
  - collisionDamageHealthPerUnitImpulse = 0.1
  - dehydrationEnergyLossPerSec = 0.03 (if water systems used)
  - ambientHealthDecayPerSec = 0.002 (when not resting)
  - agingHealthDecayCoeff = 0.5 (scales ambient decay by normalized age)

These are starting points; tune via the UI later.

## Property Costs (Phenotype/Genotype expression)

Charged continuously (metabolic) or on-change (mutation). Continuous costs scale with expressed phenotype:

- Size: E_cost = sizeMetabolicCostPerSec \* size
- Brain: E_cost = brainMetabolicCostPerNeuronPerSec \* neuronCount
  - neuronCount = sum(layerSizes)
- Vision:
  - base: visionMetabolicCostBasePerSec
  - per-eye: visionMetabolicCostPerEyePerSec \* eyesCount
  - range: visionMetabolicCostPer100RangePerSec \* (sightRange / 100)
  - FOV: visionMetabolicCostPer90FovPerSec \* (fieldOfViewDeg / 90)
  - Total vision per-sec: sum of above

Apply per tick: energy -= (size + brain + vision + baseMetabolicCostPerSec) \* dt

## Locomotion Costs

Let speed = hypot(vx, vy), heading change rate ~ |atan2(vy, vx) - lastHeading| / dt.

- Movement: E_cost = moveCostCoeffPerSpeedPerSec \* speed
- Turning: E_cost = turnCostCoeffPerRadPerSec \* |dHeading/dt|
- Acceleration: E_cost = accelerationCostCoeffPerAccelPerSec \* |a|
- Sprinting:
  - If sprint flag true, per-sec drain sDrain = sprintStaminaDrainPerSpeedPerSec \* speed.
  - Apply partial drain from S first; any remainder in the same tick overflows to energy: E_cost += sprintEnergyOverflowCoeff \* (max(0, sDrain - S_available_per_sec)).

- Terrain difficulty multiplier (optional):
  - Let terrainSpeedMult ∈ (0, 1] be the local terrain speed multiplier (1 = easy, <1 = difficult).
  - Apply cost multiplier: locomotionCost _= clamp(1 / max(minTerrainSpeedMult, terrainSpeedMult), 1, 1/minTerrainSpeedMult) _ terrainCostMultiplierK.
  - Hydrology (see `terrain.md`): when water depth > swim threshold, use swimming locomotion path:
    - `swimCostPerSec = baseSwimCostPerSec + swimCostCoeff * speed`
    - Total locomotion per-sec cost becomes `locomotionCostPerSec += swimCostPerSec`
    - Movement gets a flow push term handled in physics; this does not alter cost directly but may increase effective effort if compensating against flow (can be modeled via headwind analog using flow vector).

- Panic/fear exertion multiplier (optional):
  - If `fear` > fearThreshold, multiply locomotion-related costs by `panicLocomotionCostMultiplier` (e.g., 1.2–1.5).

## Inaction Costs

Even idle creatures pay metabolism, and a tiny "posture maintenance" surcharge.

- Posture: E_cost = 0.25 \* moveCostCoeffPerSpeedPerSec (applied only when speed < small epsilon and NOT resting)
- Resting state reduces movement costs to 0 and increases stamina regen (see Recovery).
- Rest posture discount: when resting, do not apply posture maintenance cost.

## Sensory/Communication Costs

- Communication (if emitting signals or color):
  - E_cost = communicationCostPerBytePerSec _ payloadBytes + glowCostPerUnitPerSec _ glowIntensity
- Frequent sensory polling can be implicitly accounted for by the vision metabolic costs above. If you throttle vision updates, you may discount costs proportionally to effectiveUpdateRate/targetUpdateRate.

## Reproduction / Gestation Costs

- While pregnant: E_cost = gestationBaseCostPerSec + gestationCostPerOffspringPerSec \* offspringCount
- On birth event: energy -= birthEventCostEnergy
- Post-birth stamina penalty: stamina = max(0, stamina - 10) (optional)

## Eating/Drinking Gains and Action Costs

- Eating plant:
  - During action: E_cost += harvestPlantActionCostPerSecond
  - Net delta = foodEnergyGain - action costs
- Eating corpse:
  - During action: E_cost += scavengeCorpseActionCostPerSecond
- Drinking:
  - During action: E_cost += drinkCostPerSecond

- Thirst recovery (optional):
  - While drinking, apply `thirstRecoveryPerSec` to reduce thirst metric; optionally grant small stamina regen bonus.

Note: hooks already detect eating via energy delta spikes; keep that logic but subtract the action cost first so spike represents net gain.

## Combat Costs

- Attack attempt:
  - On hit or miss: energy -= attackCostPerHit; stamina -= 10 (if available)
- Being hit:
  - health -= damageAmount (separate system), optionally apply brief stamina drain due to shock.

## Mutation Costs

Charge on-mutation (child creation) as a one-time energy fee taken from the parent at conception or distributed over gestation.

Define normalized mutation magnitude as SD units relative to initial variance sigmas:

- Let σ_range = initialVarianceAmount \* baseRange
- Let σ_fov = initialVarianceAmount \* baseFov
- Let σ_eyeAngle = initialVarianceEyeAnglesJitterDeg
- Let Δ represent absolute mutation change versus parent phenotype or gene-derived baseline.

Per mutation:

- Eyes count change: energy -= mutationCostEnergyBase + mutationCostPerStdChange \* |Δ_eyes|
- Range change: energy -= mutationCostEnergyBase + mutationCostPerStdChange \* (Δ_range / σ_range)
- FOV change: energy -= mutationCostEnergyBase + mutationCostPerStdChange \* (Δ_fov / σ_fov)
- Eye angle redistribution: energy -= 0.25 _ mutationCostPerStdChange _ mean(|Δ_angles| / σ_eyeAngle)
- Diet switch (Herbivore <-> Carnivore): energy -= 2 \* mutationCostEnergyBase (rare, systemic impact)

Cap total mutation cost to avoid impossible births: clamp to ≤ 25% of parent current energy.

## Recovery

- Resting:
  - stamina += restStaminaRegenPerSec
  - If receiving food while resting, route extra 20% to energy reserve: energy += restEnergyRegenCoeff \* foodDelta
  - health += restHealthRegenPerSec (align with native behavior if present)

## Penalties and Conversions

- Starvation:
  - if energy < 0: health -= starvationHealthLossPerNegEnergyPerSec \* |energy|
- Collisions:
  - health -= collisionDamageHealthPerUnitImpulse \* impulse
- Dehydration (optional system):
  - energy -= dehydrationEnergyLossPerSec

- Ambient health decay (aging, optional):
  - When not resting: health -= ambientHealthDecayPerSec
  - Optionally scale with normalized age: `health -= agingHealthDecayCoeff * normalizedAge`

### Oxygen and Altitude (see `terrain.md`)

- Let `oxygen_norm ∈ [0.6,1]` (remap to [0,1] internally as needed):
  - Stamina regeneration penalty: `staminaRegenPerSec *= (0.6 + 0.4*oxygen_norm)`
  - Optional ambient health decay when very low oxygen: `ambientHealthDecayPerSec += hypoxiaPenaltyPerSec * max(0, 0.7 - oxygen_norm)`

### Disease (optional subsystem)

- If enabled (`simulationParams.disease.enabled`):
  - Per-creature infection state drains: `health -= infectionHealthLossPerSec * infectionSeverity`
  - Recovery: `infectionSeverity -= recoveryRatePerSec * (1 - infectionSeverity)`
  - Base infection pressure per tick can be a function of `infection_risk_norm` (see `weather.md`) and crowding; clamp severity to [0,1].

### Communication and Noise (optional)

- Let `noise_floor_norm = N` (see `weather.md`):
  - Communication effectiveness `eff = clamp(1 - commNoiseCoeff * N, 0, 1)`
  - Optional per-sec cost when broadcasting: `communicationCostPerSec *= 1 + commEnergyOverheadCoeff * N`

## Weather Effects (see `weather.md` and `time.md`)

All effects below are per-real-second and multiply existing costs; integrate with `dt`.

- Temperature penalties (from `simulationParams.weather.tempEffects`):
  - If `temp_norm < coldThresh`: `ambientHealthDecayPerSec += hypothermiaPenaltyPerSec * (coldThresh - temp_norm)`.
  - If `temp_norm > hotThresh`: `ambientHealthDecayPerSec += heatPenaltyPerSec * (temp_norm - hotThresh)`.

- Humidity/dehydration:
  - When `humidity_norm` is low and `temp_norm` high, increase `dehydrationEnergyLossPerSec` by a factor: `*(1 + 0.5*max(0,temp_norm-hotThresh) + 0.5*max(0,0.3-humidity_norm))`.

- Wind locomotion modifier:
  - Extra exertion when moving against wind: multiply locomotion-related costs by `1 + windFrictionCoeff * headwind`, where `headwind = max(0, cos(angleBetween(vel, W_dir)) * |W|)`.

- Rain → terrain wetness → speed multiplier:
  - Maintain `wetness ∈ [0,1]` per tile; increase with `rain_norm`, decrease with drying rate.
  - Convert to `terrain_speed_mult_weather = 1 - rainToMudStrength * wetness` and feed into the locomotion terrain multiplier above.

- Day/night and light:
  - Prefer to modulate effective vision range by `light_norm` (not vision cost rates). If desired, a small scanning cost bump at night can be added (e.g., +10%).

- Corpse decay (link to `time.md`):
  - Decay progression operates in world days; weather modifies `decayDurationDays` via humidity and temperature factors.

### Simulation Parameters (weather-related, referenced)

- `simulationParams.weather.weatherSpeed`
- `simulationParams.weather.cloudOpacity`
- `simulationParams.weather.rainToMudStrength`
- `simulationParams.weather.mudDryingRatePerSec`
- `simulationParams.weather.windFrictionCoeff`
- `simulationParams.weather.tempEffects.{coldThresh,hotThresh,hypothermiaPenaltyPerSec,heatPenaltyPerSec}`
- `simulationParams.weather.humidityEffects.{decayBoostAtHighH,decaySlowAtLowH}`
- `simulationParams.weather.storm.{baroDropThresh,rainBoost,windBoost}`

## Event Hooks and Integration Points

Wire the following in `src/composables/useSimulationStore.ts`:

- Per-tick in `update()` or equivalent JS fallback/WASM bridge:
  - Compute metabolic + property costs and subtract from energy.
  - Compute locomotion costs using current speed, heading delta, acceleration.
  - Apply sprint drains from stamina with overflow to energy.
  - Apply posture cost when idle; apply rest regen when resting.
- During actions:
  - Eating/drinking: apply action costs before adding food gains; current event emitters that infer eating from energy delta should see correct net.
  - Attack: deduct hit cost on action trigger.
  - Communicate: deduct based on payload size and glow intensity.
- Lifecycle:
  - Pregnancy tick: apply gestation costs.
  - Birth: apply birthEventCostEnergy once.
  - Mutation: apply one-time mutation costs at child gene generation.
- Penalties:
  - After energy update, if < 0, apply starvation health loss.
  - On physics collision callback, apply collision damage.

Keep these computations deterministic given the same inputs to help debugging and reproducibility.

## Diet-Specific Modifiers (Optional)

- Herbivores: reduce sprint drain by 10%, increase posture cost by 10%.
- Carnivores: increase sprint drain by 10%, reduce posture cost by 10%.

Apply as simple multipliers to the relevant coefficients.

## Telemetry

Log rolling averages per creature for:

- Total energy out
- Total stamina out
- Top contributors (vision, locomotion, reproduction)

Expose summary in `GeneralStats.vue` for balancing.

## Aging Modifiers (Optional)

- Metabolic cost multiplier: `metabolicAgingMultiplier = 1 + agingMetabolicCostCoeff * normalizedAge`
- Regen scaling: reduce `restStaminaRegenPerSec` and `restHealthRegenPerSec` slightly with age if desired.

## JS/WASM Parity Notes

- Current native (WASM) baselines often include:
  - Baseline energy drain per tick (match via `baseMetabolicCostPerSec`).
  - Resting grants small energy and health regen; mirror via `restEnergyRegenCoeff` and `restHealthRegenPerSec`.
  - Sprinting drains energy directly if stamina is not yet integrated; until stamina is wired, approximate with an energy-only sprint drain.
- Keep JS fallback and WASM stepping consistent by aligning defaults for: base drains, resting effects (energy + health), sprint drains.
  - If WASM does not model stamina, route sprint drain directly to energy in WASM path (energy-only sprint drain).
- Document any divergences and track them in telemetry to validate equivalence.

## Example Pseudocode (Per-Tick)

```ts
// Use the integrator's dt (e.g., effDt in substeps)
const dt = integratorDt
const ph = c.phenotype
const brainNeurons = c.brain?.layerSizes?.reduce((a, b) => a + b, 0) ?? 0
const speed = Math.hypot(c.vx, c.vy)
const dHead = speed > epsilon ? Math.abs(wrapAngle(currHeading - prevHeading)) / dt : 0
// Derive acceleration from velocity deltas if ax, ay not tracked
const accel = Math.hypot((vx - prevVx) / dt, (vy - prevVy) / dt)

let Eout = 0,
  Sout = 0
// Metabolism
Eout += baseMetabolicCostPerSec
Eout += sizeMetabolicCostPerSec * (ph.size ?? 1)
Eout += brainMetabolicCostPerNeuronPerSec * brainNeurons
Eout += visionMetabolicCostBasePerSec
Eout += visionMetabolicCostPerEyePerSec * ph.eyesCount
Eout += visionMetabolicCostPer100RangePerSec * (ph.sightRange / 100)
Eout += visionMetabolicCostPer90FovPerSec * (ph.fieldOfViewDeg / 90)
// Locomotion
Eout += moveCostCoeffPerSpeedPerSec * speed
Eout += turnCostCoeffPerRadPerSec * dHead
Eout += accelerationCostCoeffPerAccelPerSec * accel
if (c.isSprinting) {
  const sDrain = sprintStaminaDrainPerSpeedPerSec * speed
  const sDrainTick = sDrain * dt
  const takeS = Math.min(c.stamina, sDrainTick)
  c.stamina -= takeS
  const excess = sDrainTick - takeS
  if (excess > 0) Eout += (excess / dt) * sprintEnergyOverflowCoeff
}
// Inaction posture
if (!c.isResting && speed < 0.02) Eout += 0.25 * moveCostCoeffPerSpeedPerSec
// Apply dt
// Apply deltas and clamp after updates
c.energy -= Eout * dt
c.stamina -= Sout * dt
c.stamina = Math.max(0, Math.min(c.stamina, c.maxStamina ?? 100))
if (c.energy < 0)
  c.health -= starvationHealthLossPerNegEnergyPerSec * Math.min(1, -c.energy / 20) * dt
```

## Balancing Guidance

- Start with all per-sec coefficients small; ensure average net for a typical herbivore at idle is a slow decline (encourages foraging).
- Measure average net for sprinting carnivores; tune sprint drain until sustained sprint is unsustainable without frequent food.
- Vision costs: increase until wider FOV and long-range meaningfully trade off against metabolism.
- Mutation costs: light-touch to avoid penalizing evolution; cap prevents extinction spiral.

## Roadmap

1. Add `simulationParams` keys listed above and default values.
2. Implement per-tick cost aggregation in store `update()`.
3. Integrate action hooks (eat/drink/attack/mate/communicate).
4. Add telemetry to `GeneralStats.vue`.
5. Iterate balance with real runs and histograms.
