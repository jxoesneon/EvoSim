use wasm_bindgen::prelude::*;
use serde::{Serialize, Deserialize};
use std::collections::HashSet;

#[wasm_bindgen]
pub struct World {
    width: f32,
    height: f32,
    tick: u64,
    creatures: Vec<Creature>,
    plants: Vec<Plant>,
    corpses: Vec<Corpse>,
    brain_mode: BrainMode,
    rng: RngLCG,
    bad_brain_hashes: HashSet<String>,
    config: Config,
}

// Simulation cost configuration (subset mirrored from JS simulationParams)
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub rest_stamina_regen_per_sec: f32,
    pub rest_health_regen_per_sec: f32,
    pub harvest_plant_action_cost_per_second: f32,
    pub attack_cost_per_hit_stamina: f32,
    pub sprint_overflow_cost_per_sec: f32,
    pub posture_cost_per_sec: f32,
    pub attack_cost_per_hit_energy: f32,
    pub thirst_threshold: f32,
    pub thirst_recovery_per_sec: f32,
    pub drink_cost_per_second: f32,
    pub move_cost_coeff_per_speed_per_sec: f32,
    pub ambient_health_decay_per_sec: f32,
    pub aging_health_decay_coeff: f32,
    pub gestation_base_cost_per_sec: f32,
    pub gestation_cost_per_offspring_per_sec: f32,
    pub gestation_period: f32, // measured in 'frames' units since we advance timer by dt*60
    pub birth_event_cost_energy: f32,
    pub mutation_cost_energy_base: f32,
    pub mutation_cost_per_std_change: f32,
    // Telemetry thresholds (parity with JS simulationParams)
    pub hunger_energy_threshold: f32,
    pub fatigue_stamina_threshold: f32,
    pub movement_threshold: f32,
    pub stagnant_ticks_limit: u32,
    // Environmental costs (parity scaffolding)
    pub swim_energy_cost_per_sec: f32,
    pub wind_drag_coeff: f32,
    pub temp_cold_penalty_per_sec: f32,
    pub temp_heat_penalty_per_sec: f32,
    pub comfort_low_c: f32,
    pub comfort_high_c: f32,
    pub humidity_dehydration_coeff_per_sec: f32,
    pub humidity_threshold: f32,
    pub oxygen_thin_air_penalty_per_sec: f32,
    pub thin_air_elevation_cutoff01: f32,
    pub noise_stress_penalty_per_sec: f32,
    pub disease_energy_drain_per_sec: f32,
    // Corpse decay tunables
    pub corpse_base_decay_per_sec: f32,
    pub corpse_temp_decay_coeff: f32,
    pub corpse_humidity_decay_coeff: f32,
    pub corpse_rain_decay_coeff: f32,
    pub corpse_wetness_decay_coeff: f32,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            rest_stamina_regen_per_sec: 2.0,
            rest_health_regen_per_sec: 0.2,
            harvest_plant_action_cost_per_second: 0.02,
            attack_cost_per_hit_stamina: 2.0,
            sprint_overflow_cost_per_sec: 0.03,
            posture_cost_per_sec: 0.005,
            attack_cost_per_hit_energy: 0.04,
            thirst_threshold: 30.0,
            thirst_recovery_per_sec: 5.0,
            drink_cost_per_second: 0.01,
            move_cost_coeff_per_speed_per_sec: 0.02,
            ambient_health_decay_per_sec: 0.02,
            aging_health_decay_coeff: 0.5,
            gestation_base_cost_per_sec: 0.02,
            gestation_cost_per_offspring_per_sec: 0.015,
            gestation_period: 60.0 * 20.0, // ~20s at 60fps
            birth_event_cost_energy: 4.0,
            mutation_cost_energy_base: 0.5,
            mutation_cost_per_std_change: 0.8,
            hunger_energy_threshold: 30.0,
            fatigue_stamina_threshold: 30.0,
            movement_threshold: 0.02,
            stagnant_ticks_limit: 600,
            // Environmental defaults (mostly disabled until configured from JS)
            swim_energy_cost_per_sec: 0.0,
            wind_drag_coeff: 0.0,
            temp_cold_penalty_per_sec: 0.0,
            temp_heat_penalty_per_sec: 0.0,
            comfort_low_c: 10.0,
            comfort_high_c: 28.0,
            humidity_dehydration_coeff_per_sec: 0.0,
            humidity_threshold: 0.7,
            oxygen_thin_air_penalty_per_sec: 0.0,
            thin_air_elevation_cutoff01: 0.8,
            noise_stress_penalty_per_sec: 0.0,
            disease_energy_drain_per_sec: 0.0,
            corpse_base_decay_per_sec: 0.5,
            corpse_temp_decay_coeff: 0.0,
            corpse_humidity_decay_coeff: 0.0,
            corpse_rain_decay_coeff: 0.0,
            corpse_wetness_decay_coeff: 0.0,
        }
    }
}

fn nearest_carnivore(x: f32, y: f32, a: &[Creature], b: &[Creature]) -> Option<(f32,f32)> {
    let mut best: Option<(f32,f32,f32)> = None;
    for c in a.iter().chain(b.iter()) {
        if c.diet != Diet::Carnivore { continue; }
        let dx = c.x - x; let dy = c.y - y; let d = (dx*dx + dy*dy).sqrt();
        match best { Some((_,_,bd)) if d >= bd => {}, _ => { best = Some((c.x, c.y, d)); } }
    }
    best.map(|(x,y,_)| (x,y))
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Creature {
    pub id: String,
    pub x: f32,
    pub y: f32,
    pub vx: f32,
    pub vy: f32,
    pub radius: f32,
    pub health: f32,
    pub energy: f32,
    pub stamina: f32,
    pub max_stamina: f32,
    pub thirst: f32, // 0..100, lower = thirstier
    pub lifespan: u32,
    pub diet: Diet,
    pub brain: Brain,
    // Reproduction (parity scaffolding)
    pub is_pregnant: bool,
    pub gestation_timer: f32,
    pub offspring_count: u32,
    // Telemetry
    pub actions_mask: u32,
    pub feelings_mask: u32,
    pub stagnant_ticks: u32,
    // Last-tick telemetry (not serialized in creatures_json)
    #[serde(skip_serializing)] pub last_env_total: f32,
    #[serde(skip_serializing)] pub last_env_swim: f32,
    #[serde(skip_serializing)] pub last_env_wind: f32,
    #[serde(skip_serializing)] pub last_env_cold: f32,
    #[serde(skip_serializing)] pub last_env_heat: f32,
    #[serde(skip_serializing)] pub last_env_humid: f32,
    #[serde(skip_serializing)] pub last_env_oxy: f32,
    #[serde(skip_serializing)] pub last_env_noise: f32,
    #[serde(skip_serializing)] pub last_env_disease: f32,
    #[serde(skip_serializing)] pub last_locomotion: f32,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Plant {
    pub x: f32,
    pub y: f32,
    pub radius: f32,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Corpse {
    pub x: f32,
    pub y: f32,
    pub radius: f32,
    pub energy_remaining: f32,
    pub initial_decay_time: f32,
    pub decay_timer: f32,
    // Last-tick decay telemetry (not serialized in corpses_json)
    #[serde(skip_serializing)] pub last_decay_total: f32,
    #[serde(skip_serializing)] pub last_decay_base: f32,
    #[serde(skip_serializing)] pub last_decay_temp: f32,
    #[serde(skip_serializing)] pub last_decay_humid: f32,
    #[serde(skip_serializing)] pub last_decay_rain: f32,
    #[serde(skip_serializing)] pub last_decay_wet: f32,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Brain {
    pub layer_sizes: Vec<u32>,
    pub weights: Option<Vec<Vec<f32>>>,
    pub biases: Option<Vec<Vec<f32>>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub activations: Option<Vec<Vec<f32>>>,
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "PascalCase")]
pub enum Diet { Herbivore, Carnivore }

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "PascalCase")]
pub enum BrainMode { OG, Zegion }

#[wasm_bindgen]
impl World {
    #[wasm_bindgen(constructor)]
    pub fn new(width: f32, height: f32, seed: u32) -> World {
        // Deterministic LCG RNG (parity with JS RNG)
        let mut rng = RngLCG::new(seed);

        let mut creatures = Vec::new();
        let bad_brains: HashSet<String> = HashSet::new();
        for i in 0..50 {
            creatures.push(Creature{
                id: format!("c{}", i),
                x: rng.uniform(0.0, width),
                y: rng.uniform(0.0, height),
                vx: rng.uniform(-1.0, 1.0) * 2.0,
                vy: rng.uniform(-1.0, 1.0) * 2.0,
                radius: 5.0,
                health: 100.0,
                energy: 100.0,
                stamina: 100.0,
                max_stamina: 100.0,
                thirst: 100.0,
                lifespan: 0,
                diet: if rng.next_f32_01() > 0.8 { Diet::Carnivore } else { Diet::Herbivore },
                brain: init_brain_avoiding_bad(vec![14, 8, 8], &mut rng, &bad_brains),
                is_pregnant: false,
                gestation_timer: 0.0,
                offspring_count: 1,
                actions_mask: 0,
                feelings_mask: 0,
                stagnant_ticks: 0,
                last_env_total: 0.0,
                last_env_swim: 0.0,
                last_env_wind: 0.0,
                last_env_cold: 0.0,
                last_env_heat: 0.0,
                last_env_humid: 0.0,
                last_env_oxy: 0.0,
                last_env_noise: 0.0,
                last_env_disease: 0.0,
                last_locomotion: 0.0,
            });
        }
        let mut plants = Vec::new();
        for _ in 0..150 {
            plants.push(Plant{ x: rng.uniform(0.0, width), y: rng.uniform(0.0, height), radius: 3.0 });
        }
        World { width, height, tick: 0, creatures, plants, corpses: Vec::new(), brain_mode: BrainMode::OG, rng, bad_brain_hashes: bad_brains, config: Config::default() }
    }

    pub fn step(&mut self, dt: f32) {
        self.tick += 1;
        // Simple behavior: herbivores drift, carnivores chase nearest herbivore
        // Collect offspring to append after the main iteration to avoid borrow conflicts
        let mut newborns: Vec<Creature> = Vec::new();
        for i in 0..self.creatures.len() {
            let (left, right) = self.creatures.split_at_mut(i);
            // Split again to keep current creature disjoint from the rest to satisfy the borrow checker
            let (cur_slice, rest) = right.split_at_mut(1);
            let c = &mut cur_slice[0];
            // Terrain influence reduces effective speed on rough terrain
            let speed_mult = terrain_speed_at(c.x, c.y, self.tick);
            // Build inputs and run brain forward pass to steer
            let inputs = build_inputs(self.width, self.height, self.tick, c, left, &rest, self.brain_mode);
            let (out, acts) = brain_forward(&mut c.brain, &inputs, self.brain_mode);
            // Use outputs
            let ax = out.get(0).cloned().unwrap_or(0.0).tanh();
            let ay = out.get(1).cloned().unwrap_or(0.0).tanh();
            let a_scale = (out.get(2).cloned().unwrap_or(0.0)).tanh().abs();
            let eat_sig = out.get(3).cloned().unwrap_or(0.0).tanh();
            let rest_sig = out.get(4).cloned().unwrap_or(0.0).tanh();
            let boost_sig = out.get(5).cloned().unwrap_or(0.0).tanh();
            let mut accel = 0.35 * speed_mult * (0.5 + a_scale);
            let wants_boost = boost_sig > 0.5;
            if wants_boost { accel *= 1.5; }
            c.vx += ax * accel;
            c.vy += ay * accel;
            c.x += c.vx * dt * 60.0 * speed_mult;
            c.y += c.vy * dt * 60.0 * speed_mult;
            c.vx *= 0.99;
            c.vy *= 0.99;
            // Reset telemetry masks
            c.actions_mask = 0;
            c.feelings_mask = 0;
            // Rest behavior: damp and regen small amounts
            let wants_rest = rest_sig > 0.5;
            if wants_rest {
                c.vx *= 0.9;
                c.vy *= 0.9;
                // rest regen (scaled by config)
                c.stamina = (c.stamina + self.config.rest_stamina_regen_per_sec * dt * 60.0).min(c.max_stamina);
                if c.health < 100.0 { c.health = (c.health + self.config.rest_health_regen_per_sec * dt * 60.0).min(100.0); }
                c.actions_mask |= 1 << 0; // RESTING
            }
            // Eat behavior: small trickle near a plant
            let wants_eat = eat_sig > 0.5;
            if wants_eat {
                if plants_near(&self.plants, c.x, c.y, c.radius + 5.0) {
                    // intake and action cost
                    c.energy = (c.energy + 0.15).min(100.0);
                    c.energy = (c.energy - self.config.harvest_plant_action_cost_per_second * dt * 60.0).max(0.0);
                    c.actions_mask |= 1 << 1; // EATING
                }
            }
            // Sprint energy drain
            if wants_boost {
                c.energy = (c.energy - 0.1).max(0.0);
                c.stamina = (c.stamina - self.config.attack_cost_per_hit_stamina * 0.0).max(0.0); // placeholder, stamina not heavily used here
                c.actions_mask |= 1 << 2; // SPRINTING
            }
            // Sprint overflow: if moving fast while boosting, extra cost
            let speed_mag = (c.vx * c.vx + c.vy * c.vy).sqrt();
            if wants_boost && speed_mag > 2.5 { c.energy = (c.energy - self.config.sprint_overflow_cost_per_sec * dt * 60.0).max(0.0); }
            // Posture maintenance when nearly idle and not explicitly resting
            if !wants_rest && speed_mag < 0.05 { c.energy = (c.energy - self.config.posture_cost_per_sec * dt * 60.0).max(0.0); }
            // Attack attempt heuristic costs
            // Offensive: carnivores boosting near herbivore target
            if c.diet == Diet::Carnivore && wants_boost {
                if let Some((_tx,_ty)) = nearest_herbivore(c.x, c.y, left, rest) {
                    c.energy = (c.energy - self.config.attack_cost_per_hit_energy * dt * 60.0).max(0.0);
                    c.actions_mask |= 1 << 3; // ATTACKING (attempt)
                }
            }
            // Drinking when near plant: recover thirst, pay drink cost
            if plants_near(&self.plants, c.x, c.y, c.radius + 5.0) {
                let thirst_thresh = self.config.thirst_threshold;
                if c.thirst < thirst_thresh {
                    c.thirst = (c.thirst + self.config.thirst_recovery_per_sec * dt * 60.0).min(100.0);
                    c.energy = (c.energy - self.config.drink_cost_per_second * dt * 60.0).max(0.0);
                    c.actions_mask |= 1 << 4; // DRINKING
                }
            }
            // Baseline movement energy (locomotion cost proportional to speed)
            let locomotion = self.config.move_cost_coeff_per_speed_per_sec * speed_mag;
            c.energy = (c.energy - locomotion * dt * 60.0).max(0.0);
            // Environmental energy costs (simple samplers for parity scaffolding)
            // NOTE: Keep these formulas 1:1 with the JS validator in useSimulationStore.ts.
            // Units: all costs are per-second rates; we multiply by t_sec = dt*60 to apply.
            // Components:
            //  - Swim: flat penalty when inside heuristic water bands.
            //  - Wind: proportional to wind speed and creature ground speed.
            //  - Cold/Heat: linear penalties outside comfort range (degC scaled by 1/10 factor).
            //  - Humidity: dehydration above threshold.
            //  - Oxygen: thin air penalty above elevation cutoff.
            //  - Noise: proportional to ambient noise.
            //  - Disease: flat drain.
            let t_sec = dt * 60.0;
            let temp_c = sample_temperature_c(c.x, c.y, self.tick);
            let humid01 = sample_humidity01(c.x, c.y, self.tick);
            let rain01 = sample_rain01(c.x, c.y, self.tick);
            let wet01 = sample_wetness01(c.x, c.y, self.tick);
            let wind = sample_wind_speed(c.x, c.y, self.tick);
            let elev01 = sample_elevation01(c.x, c.y);
            let noise01 = sample_noise01(c.x, c.y, self.tick);
            // Swim heuristic: treat top/bottom bands as water
            let in_water = c.y < self.height * 0.12 || c.y > self.height * 0.88;
            let env_swim = if in_water { self.config.swim_energy_cost_per_sec } else { 0.0 };
            let env_wind = self.config.wind_drag_coeff * wind * speed_mag;
            let env_cold = if temp_c < self.config.comfort_low_c {
                let d = (self.config.comfort_low_c - temp_c).max(0.0);
                self.config.temp_cold_penalty_per_sec * d / 10.0
            } else { 0.0 };
            let env_heat = if temp_c > self.config.comfort_high_c {
                let d = (temp_c - self.config.comfort_high_c).max(0.0);
                self.config.temp_heat_penalty_per_sec * d / 10.0
            } else { 0.0 };
            let env_humid = if humid01 > self.config.humidity_threshold {
                let ex = (humid01 - self.config.humidity_threshold).max(0.0);
                self.config.humidity_dehydration_coeff_per_sec * ex
            } else { 0.0 };
            let env_oxy = if elev01 > self.config.thin_air_elevation_cutoff01 {
                let ex = (elev01 - self.config.thin_air_elevation_cutoff01).max(0.0);
                self.config.oxygen_thin_air_penalty_per_sec * ex
            } else { 0.0 };
            let env_noise = self.config.noise_stress_penalty_per_sec * noise01;
            let env_disease = self.config.disease_energy_drain_per_sec;
            let env_total = env_swim + env_wind + env_cold + env_heat + env_humid + env_oxy + env_noise + env_disease;
            // Record telemetry
            c.last_locomotion = locomotion;
            c.last_env_total = env_total;
            c.last_env_swim = env_swim;
            c.last_env_wind = env_wind;
            c.last_env_cold = env_cold;
            c.last_env_heat = env_heat;
            c.last_env_humid = env_humid;
            c.last_env_oxy = env_oxy;
            c.last_env_noise = env_noise;
            c.last_env_disease = env_disease;
            if env_total != 0.0 { c.energy = (c.energy - env_total * t_sec).max(0.0); }
            // Ambient health decay with aging
            let max_life = 60.0 * 60.0 * 60.0; // ~60 minutes at 60fps equivalent
            let age_norm = (c.lifespan as f32 / max_life).clamp(0.0, 1.0);
            let ambient = self.config.ambient_health_decay_per_sec * (1.0 + self.config.aging_health_decay_coeff * age_norm);
            if !wants_rest { c.health = (c.health - ambient * dt * 60.0).max(0.0); }
            // Gestation per-second cost and birth handling
            if c.is_pregnant {
                let oc = c.offspring_count.max(1) as f32;
                let gest_e = self.config.gestation_base_cost_per_sec + self.config.gestation_cost_per_offspring_per_sec * oc;
                c.energy = (c.energy - gest_e * dt * 60.0).max(-50.0);
                c.gestation_timer += dt * 60.0;
                if c.gestation_timer >= self.config.gestation_period {
                    // Birth energy cost
                    c.energy = (c.energy - self.config.birth_event_cost_energy).max(-50.0);
                    // Mutation energy cost approximation (no genes here): base + per-offspring scaled by small random factor
                    let mut mut_cost = self.config.mutation_cost_energy_base;
                    let rand_factor = 0.5 + self.rng.next_f32_01(); // 0.5..1.5
                    mut_cost += self.config.mutation_cost_per_std_change * oc * rand_factor;
                    c.energy = (c.energy - mut_cost).max(-50.0);
                    // Spawn offspring near parent with small jitter
                    for k in 0..c.offspring_count.max(1) {
                        let angle = (k as f32) * 0.7 + self.rng.next_f32_01() * 6.2831;
                        let r = 4.0 + self.rng.next_f32_01() * 6.0;
                        let nx = (c.x + angle.cos() * r).clamp(0.0, self.width);
                        let ny = (c.y + angle.sin() * r).clamp(0.0, self.height);
                        let id = format!("c{}", self.tick + k as u64);
                        let diet = c.diet; // inherit diet
                        let layer_sizes = match self.brain_mode { BrainMode::OG => vec![14, 8, 8], BrainMode::Zegion => vec![24, 16, 6] };
                        let brain = init_brain_avoiding_bad(layer_sizes, &mut self.rng, &self.bad_brain_hashes);
                        newborns.push(Creature{
                            id,
                            x: nx, y: ny,
                            vx: self.rng.uniform(-0.5, 0.5), vy: self.rng.uniform(-0.5, 0.5),
                            radius: 4.0,
                            health: 100.0,
                            energy: 80.0,
                            stamina: 100.0,
                            max_stamina: 100.0,
                            thirst: 100.0,
                            lifespan: 0,
                            diet,
                            brain,
                            is_pregnant: false,
                            gestation_timer: 0.0,
                            offspring_count: 1,
                            actions_mask: 0,
                            feelings_mask: 0,
                            stagnant_ticks: 0,
                            last_env_total: 0.0,
                            last_env_swim: 0.0,
                            last_env_wind: 0.0,
                            last_env_cold: 0.0,
                            last_env_heat: 0.0,
                            last_env_humid: 0.0,
                            last_env_oxy: 0.0,
                            last_env_noise: 0.0,
                            last_env_disease: 0.0,
                            last_locomotion: 0.0,
                        });
                    }
                    // Reset pregnancy
                    c.is_pregnant = false;
                    c.gestation_timer = 0.0;
                    c.offspring_count = 1;
                }
            }
            wrap(&mut c.x, self.width);
            wrap(&mut c.y, self.height);
            // Clamp vital ranges
            c.energy = c.energy.clamp(-50.0, 100.0);
            c.health = c.health.clamp(0.0, 100.0);
            // Age increment (ticks)
            c.lifespan = c.lifespan.saturating_add(1);
            // Store activations for visualization
            c.brain.activations = Some(acts);
            // Feelings telemetry based on thresholds
            if c.thirst < self.config.thirst_threshold { c.feelings_mask |= 1 << 0; } // THIRSTY
            if c.energy < self.config.hunger_energy_threshold { c.feelings_mask |= 1 << 1; } // HUNGRY
            if c.stamina < self.config.fatigue_stamina_threshold { c.feelings_mask |= 1 << 2; } // FATIGUED
            // Restless: track stagnant ticks based on speed
            let speed = (c.vx * c.vx + c.vy * c.vy).sqrt();
            if speed < self.config.movement_threshold { c.stagnant_ticks = c.stagnant_ticks.saturating_add(1); } else { c.stagnant_ticks = 0; }
            if c.stagnant_ticks >= self.config.stagnant_ticks_limit { c.feelings_mask |= 1 << 3; } // RESTLESS
        }
        // Append any newborn creatures after processing all current ones
        if !newborns.is_empty() {
            self.creatures.extend(newborns);
        }
        // Remove dead into corpses
        let mut alive = Vec::with_capacity(self.creatures.len());
        for c in self.creatures.drain(..) {
            if c.health <= 0.0 || c.energy <= 0.0 {
                self.corpses.push(Corpse{
                    x: c.x, y: c.y, radius: c.radius,
                    energy_remaining: c.energy.max(0.0),
                    initial_decay_time: 100.0,
                    decay_timer: 100.0,
                    last_decay_total: 0.0,
                    last_decay_base: 0.0,
                    last_decay_temp: 0.0,
                    last_decay_humid: 0.0,
                    last_decay_rain: 0.0,
                    last_decay_wet: 0.0,
                });
            } else {
                alive.push(c);
            }
        }
        self.creatures = alive;
        // Decay corpses
        // NOTE: Rate = base + sum(component contributions). Each component is a fraction of base
        // controlled by its coefficient and an environmental scalar.
        for co in &mut self.corpses {
            let temp_c = sample_temperature_c(co.x, co.y, self.tick);
            let humid01 = sample_humidity01(co.x, co.y, self.tick);
            let rain01 = sample_rain01(co.x, co.y, self.tick);
            let wet01 = sample_wetness01(co.x, co.y, self.tick);
            // Componentized decay rate contributions (per second)
            let base = self.config.corpse_base_decay_per_sec.max(0.0);
            let temp_term = (temp_c - 20.0) / 15.0; // >0 when warmer than ~room temp
            // Warmer-than-room temperature accelerates decay; clamp 0..2 for stability
            let contrib_temp = base * self.config.corpse_temp_decay_coeff * temp_term.clamp(0.0, 2.0);
            let contrib_humid = base * self.config.corpse_humidity_decay_coeff * humid01.max(0.0);
            let contrib_rain = base * self.config.corpse_rain_decay_coeff * rain01.max(0.0);
            let contrib_wet = base * self.config.corpse_wetness_decay_coeff * wet01.max(0.0);
            let rate = (base + contrib_temp + contrib_humid + contrib_rain + contrib_wet).max(0.0);
            // Telemetry record
            co.last_decay_base = base;
            co.last_decay_temp = contrib_temp.max(0.0);
            co.last_decay_humid = contrib_humid.max(0.0);
            co.last_decay_rain = contrib_rain.max(0.0);
            co.last_decay_wet = contrib_wet.max(0.0);
            co.last_decay_total = rate;
            co.decay_timer -= dt * 60.0 * rate;
            if co.decay_timer < 0.0 { co.decay_timer = 0.0; }
        }
        self.corpses.retain(|c| c.decay_timer > 0.0);
    }

    pub fn creatures_json(&self) -> JsValue {
        serde_wasm_bindgen::to_value(&self.creatures).unwrap()
    }

    pub fn plants_json(&self) -> JsValue {
        serde_wasm_bindgen::to_value(&self.plants).unwrap()
    }

    pub fn corpses_json(&self) -> JsValue {
        serde_wasm_bindgen::to_value(&self.corpses).unwrap()
    }

    // Minimal environmental cost telemetry for validation/parity checks
    #[wasm_bindgen(js_name = env_costs_json)]
    pub fn env_costs_json(&self) -> JsValue {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct EnvCost<'a> {
            id: &'a str,
            env_total: f32,
            env_swim: f32,
            env_wind: f32,
            env_cold: f32,
            env_heat: f32,
            env_humid: f32,
            env_oxy: f32,
            env_noise: f32,
            env_disease: f32,
            locomotion: f32,
        }
        let v: Vec<EnvCost> = self.creatures.iter().map(|c| EnvCost{
            id: &c.id,
            env_total: c.last_env_total,
            env_swim: c.last_env_swim,
            env_wind: c.last_env_wind,
            env_cold: c.last_env_cold,
            env_heat: c.last_env_heat,
            env_humid: c.last_env_humid,
            env_oxy: c.last_env_oxy,
            env_noise: c.last_env_noise,
            env_disease: c.last_env_disease,
            locomotion: c.last_locomotion,
        }).collect();
        serde_wasm_bindgen::to_value(&v).unwrap()
    }

    // Minimal corpse decay telemetry for validation/parity checks
    #[wasm_bindgen(js_name = corpse_costs_json)]
    pub fn corpse_costs_json(&self) -> JsValue {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct CorpseCost {
            total: f32,
            base: f32,
            temp: f32,
            humid: f32,
            rain: f32,
            wet: f32,
        }
        let v: Vec<CorpseCost> = self.corpses.iter().map(|co| CorpseCost{
            total: co.last_decay_total,
            base: co.last_decay_base,
            temp: co.last_decay_temp,
            humid: co.last_decay_humid,
            rain: co.last_decay_rain,
            wet: co.last_decay_wet,
        }).collect();
        serde_wasm_bindgen::to_value(&v).unwrap()
    }

    // Spawn a single creature at a specific location (diet randomized)
    #[wasm_bindgen(js_name = spawn_creature)]
    pub fn spawn_creature(&mut self, x: f32, y: f32) {
        let id = format!("c{}", self.tick); // coarse unique-ish id based on tick
        let diet = if self.rng.next_f32_01() > 0.8 { Diet::Carnivore } else { Diet::Herbivore };
        let layer_sizes = match self.brain_mode {
            BrainMode::OG => vec![14, 8, 8],
            BrainMode::Zegion => vec![24, 16, 6],
        };
        let brain = init_brain_avoiding_bad(layer_sizes, &mut self.rng, &self.bad_brain_hashes);
        self.creatures.push(Creature{
            id,
            x,
            y,
            vx: self.rng.uniform(-1.0, 1.0) * 2.0,
            vy: self.rng.uniform(-1.0, 1.0) * 2.0,
            radius: 5.0,
            health: 100.0,
            energy: 100.0,
            stamina: 100.0,
            max_stamina: 100.0,
            thirst: 100.0,
            lifespan: 0,
            diet,
            brain,
            is_pregnant: false,
            gestation_timer: 0.0,
            offspring_count: 1,
            actions_mask: 0,
            feelings_mask: 0,
            stagnant_ticks: 0,
            last_env_total: 0.0,
            last_env_swim: 0.0,
            last_env_wind: 0.0,
            last_env_cold: 0.0,
            last_env_heat: 0.0,
            last_env_humid: 0.0,
            last_env_oxy: 0.0,
            last_env_noise: 0.0,
            last_env_disease: 0.0,
            last_locomotion: 0.0,
        });
    }

    // Spawn a plant at a location with optional radius (defaults to 3.0)
    #[wasm_bindgen(js_name = spawn_plant)]
    pub fn spawn_plant(&mut self, x: f32, y: f32, radius: Option<f32>) {
        let r = radius.unwrap_or(3.0).max(0.5);
        self.plants.push(Plant{ x, y, radius: r });
    }

    // Reset the world entities using current dimensions, RNG, and brain mode
    #[wasm_bindgen(js_name = reset_world)]
    pub fn reset_world(&mut self) {
        self.tick = 0;
        self.creatures.clear();
        self.plants.clear();
        self.corpses.clear();
        // Recreate a default population similar to constructor
        let n_cre = 50usize;
        for i in 0..n_cre {
            let diet = if self.rng.next_f32_01() > 0.8 { Diet::Carnivore } else { Diet::Herbivore };
            let layer_sizes = match self.brain_mode {
                BrainMode::OG => vec![14, 8, 8],
                BrainMode::Zegion => vec![24, 16, 6],
            };
            let brain = init_brain_avoiding_bad(layer_sizes, &mut self.rng, &self.bad_brain_hashes);
            self.creatures.push(Creature{
                id: format!("c{}", i),
                x: self.rng.uniform(0.0, self.width),
                y: self.rng.uniform(0.0, self.height),
                vx: self.rng.uniform(-1.0, 1.0) * 2.0,
                vy: self.rng.uniform(-1.0, 1.0) * 2.0,
                radius: 5.0,
                health: 100.0,
                energy: 100.0,
                stamina: 100.0,
                max_stamina: 100.0,
                thirst: 100.0,
                lifespan: 0,
                diet,
                brain,
                is_pregnant: false,
                gestation_timer: 0.0,
                offspring_count: 1,
                actions_mask: 0,
                feelings_mask: 0,
                stagnant_ticks: 0,
                last_env_total: 0.0,
                last_env_swim: 0.0,
                last_env_wind: 0.0,
                last_env_cold: 0.0,
                last_env_heat: 0.0,
                last_env_humid: 0.0,
                last_env_oxy: 0.0,
                last_env_noise: 0.0,
                last_env_disease: 0.0,
                last_locomotion: 0.0,
            });
        }
        for _ in 0..150 {
            self.plants.push(Plant{ x: self.rng.uniform(0.0, self.width), y: self.rng.uniform(0.0, self.height), radius: 3.0 });
        }
    }

    #[wasm_bindgen(js_name = set_brain_mode)]
    pub fn set_brain_mode(&mut self, mode: &str) {
        let new_mode = if mode.eq_ignore_ascii_case("Zegion") { BrainMode::Zegion } else { BrainMode::OG };
        if new_mode == self.brain_mode { return; }
        self.brain_mode = new_mode;
        match self.brain_mode {
            BrainMode::OG => {
                for c in &mut self.creatures { c.brain = init_brain_avoiding_bad(vec![14, 8, 8], &mut self.rng, &self.bad_brain_hashes); }
            }
            BrainMode::Zegion => {
                for c in &mut self.creatures { c.brain = init_brain_avoiding_bad(vec![24, 16, 6], &mut self.rng, &self.bad_brain_hashes); }
            }
        }
    }

    #[wasm_bindgen(js_name = set_seed)]
    pub fn set_seed(&mut self, seed: u32) {
        self.rng = RngLCG::new(seed);
    }

    // Alias for TS compatibility: store calls wasmWorld.set_brain_seed(...)
    #[wasm_bindgen(js_name = set_brain_seed)]
    pub fn set_brain_seed(&mut self, seed: u32) {
        self.set_seed(seed);
    }

    #[wasm_bindgen(js_name = set_bad_brain_hashes)]
    pub fn set_bad_brain_hashes(&mut self, hashes: JsValue) {
        // Expect an array of strings from JS
        if let Ok(vec) = serde_wasm_bindgen::from_value::<Vec<String>>(hashes) {
            let mut new_set: HashSet<String> = HashSet::with_capacity(vec.len());
            for h in vec { new_set.insert(h); }
            self.bad_brain_hashes = new_set;
        }
    }

    // Receive config from JS (simulationParams parity subset)
    #[wasm_bindgen(js_name = set_config)]
    pub fn set_config(&mut self, cfg: JsValue) {
        if let Ok(parsed) = serde_wasm_bindgen::from_value::<Config>(cfg) {
            self.config = parsed;
        }
    }
}

fn wrap(v: &mut f32, max: f32) {
    if *v > max { *v = 0.0; } else if *v < 0.0 { *v = max; }
}

fn rand_unit(seed: u64) -> f32 {
    // simple xorshift to pseudo-random [0,1)
    let mut s = seed;
    s ^= s << 13;
    s ^= s >> 7;
    s ^= s << 17;
    ((s % 10_000) as f32) / 10_000.0
}

fn nearest_herbivore(x: f32, y: f32, a: &[Creature], b: &[Creature]) -> Option<(f32,f32)> {
    let mut best_d2 = f32::INFINITY;
    let mut best = None;
    for c in a.iter().chain(b.iter()) {
        if let Diet::Herbivore = c.diet {
            let dx = c.x - x; let dy = c.y - y;
            let d2 = dx*dx + dy*dy;
            if d2 < best_d2 { best_d2 = d2; best = Some((c.x, c.y)); }
        }
    }
    best
}

// Very lightweight pseudo-noise for terrain speed multiplier [0.6, 1.0]
fn terrain_speed_at(x: f32, y: f32, t: u64) -> f32 {
    let tt = (t % 10_000) as f32 * 0.001;
    let v = (f32::sin(x * 0.003 + tt) * f32::cos(y * 0.002 - tt) * 0.5 + 0.5);
    0.6 + v * 0.4
}

// --- Simple environment samplers (placeholders; JS provides richer ones) ---
fn sample_temperature_c(x: f32, y: f32, t: u64) -> f32 {
    let tt = (t as f32) * 0.01;
    // 10..30C varying smoothly
    20.0 + (f32::sin(x * 0.001 + tt) + f32::cos(y * 0.001 - tt * 0.7)) * 5.0
}

fn sample_humidity01(x: f32, y: f32, t: u64) -> f32 {
    let tt = (t as f32) * 0.008;
    ((f32::sin(x * 0.0007 + y * 0.0005 + tt) * 0.5 + 0.5) * 0.9).clamp(0.0, 1.0)
}

fn sample_rain01(x: f32, y: f32, t: u64) -> f32 {
    let tt = (t as f32) * 0.02;
    let band = (f32::sin(tt) * 0.5 + 0.5); // periodic rain bands
    (band * (f32::sin(y * 0.002 + tt * 0.3) * 0.5 + 0.5)).clamp(0.0, 1.0)
}

fn sample_wetness01(x: f32, y: f32, t: u64) -> f32 {
    // Wetness lags rain a bit
    let r = sample_rain01(x, y, t.saturating_sub(50));
    (r * 0.7 + sample_humidity01(x, y, t) * 0.3).clamp(0.0, 1.0)
}

fn sample_wind_speed(x: f32, y: f32, t: u64) -> f32 {
    let tt = (t as f32) * 0.015;
    // 0..1 scale
    (f32::sin(x * 0.0009 + tt) * f32::cos(y * 0.0006 - tt) * 0.5 + 0.5).clamp(0.0, 1.0)
}

fn sample_elevation01(x: f32, y: f32) -> f32 {
    // Normalize position to 0..1; higher y slightly higher elevation
    let nx = (x * 0.001).sin() * 0.5 + 0.5;
    let ny = (y * 0.001).cos() * 0.5 + 0.5;
    ((nx * 0.6 + ny * 0.4) * 0.9).clamp(0.0, 1.0)
}

fn sample_noise01(x: f32, y: f32, t: u64) -> f32 {
    let tt = (t as f32) * 0.05;
    (f32::sin(x * 0.004 + tt) * f32::sin(y * 0.003 - tt) * 0.5 + 0.5).clamp(0.0, 1.0)
}

// Brain helpers
fn init_brain(layer_sizes: Vec<u32>, rng: &mut RngLCG) -> Brain {
    let mut weights: Vec<Vec<f32>> = Vec::new();
    let mut biases: Vec<Vec<f32>> = Vec::new();
    // For L layers where layer_sizes = [n0, n1, ..., n_{L-1}]
    for li in 1..layer_sizes.len() {
        let n_in = layer_sizes[li-1] as usize;
        let n_out = layer_sizes[li] as usize;
        // He-like init
        let scale = (2.0f32 / (n_in as f32).max(1.0)).sqrt();
        let mut w: Vec<f32> = Vec::with_capacity(n_in * n_out);
        for oi in 0..n_out { let _ = oi; for _ in 0..n_in { w.push((rng.uniform(-1.0, 1.0)) * scale); } }
        let b: Vec<f32> = vec![0.0; n_out];
        weights.push(w);
        biases.push(b);
    }
    Brain { layer_sizes, weights: Some(weights), biases: Some(biases), activations: None }
}

// Initialize a brain, retrying a limited number of times if the hash is in the bad set
fn init_brain_avoiding_bad(layer_sizes: Vec<u32>, rng: &mut RngLCG, bad: &HashSet<String>) -> Brain {
    const MAX_TRIES: usize = 16;
    let mut last = init_brain(layer_sizes.clone(), rng);
    if bad.is_empty() { return last; }
    for _ in 0..MAX_TRIES {
        let h = brain_hash(&last);
        if !bad.contains(&h) { return last; }
        last = init_brain(layer_sizes.clone(), rng);
    }
    last
}

// JS-simpleHash parity: 32-bit rolling hash over JSON text, then to radix36 string
fn simple_hash_str(s: &str) -> String {
    let mut hash: i32 = 0;
    for &b in s.as_bytes() {
        hash = (hash << 5).wrapping_sub(hash).wrapping_add(b as i32);
    }
    let mut n: u32 = hash as u32; // two's complement cast like JS |0 then >>>0
    // convert to radix36
    if n == 0 { return "0".to_string(); }
    let mut digits = Vec::new();
    while n > 0 {
        let rem = (n % 36) as u8;
        n /= 36;
        let ch = if rem < 10 { (b'0' + rem) as char } else { (b'a' + (rem - 10)) as char };
        digits.push(ch);
    }
    digits.iter().rev().collect()
}

fn brain_hash(brain: &Brain) -> String {
    // Serialize the same canonical fields as JS does
    #[derive(Serialize)]
    struct Canon<'a> { layer_sizes: &'a Vec<u32>, weights: &'a Vec<Vec<f32>>, biases: &'a Vec<Vec<f32>> }
    let weights = brain.weights.as_ref().unwrap();
    let biases = brain.biases.as_ref().unwrap();
    let canon = Canon { layer_sizes: &brain.layer_sizes, weights, biases };
    let json = serde_json::to_string(&canon).unwrap_or_else(|_| String::new());
    simple_hash_str(&json)
}

// Deterministic LCG RNG (32-bit state)
struct RngLCG { state: u32 }
impl RngLCG {
    fn new(seed: u32) -> Self { let s = if seed == 0 { 0xDEADBEEF } else { seed }; Self { state: s } }
    fn next_u32(&mut self) -> u32 { self.state = self.state.wrapping_mul(1664525).wrapping_add(1013904223); self.state }
    fn next_f32_01(&mut self) -> f32 { (self.next_u32() as f32) / 4294967296.0 }
    fn uniform(&mut self, min: f32, max: f32) -> f32 { min + (max - min) * self.next_f32_01() }
}

fn plants_near(plants: &Vec<Plant>, x: f32, y: f32, radius: f32) -> bool {
    let r2 = radius * radius;
    for p in plants.iter() {
        let dx = p.x - x; let dy = p.y - y; if dx*dx + dy*dy <= r2 { return true; }
    }
    false
}

fn build_inputs(width: f32, height: f32, tick: u64, c: &Creature, a: &[Creature], b: &[Creature], mode: BrainMode) -> Vec<f32> {
    // Common features
    let nx = c.x / width;
    let ny = c.y / height;
    let spx = c.vx.tanh();
    let spy = c.vy.tanh();
    let e = (c.energy / 100.0).clamp(0.0, 1.0);
    let h = (c.health / 100.0).clamp(0.0, 1.0);
    let t = (tick as f32) * 0.01;
    let ts = f32::sin(t);
    let tc = f32::cos(t);
    // Nearest herbivore vector
    let target = nearest_herbivore(c.x, c.y, a, b);
    let (dxn, dyy, dd) = if let Some((tx, ty)) = target {
        let dx = tx - c.x; let dy = ty - c.y; let d = (dx*dx + dy*dy).sqrt().max(0.0001);
        (dx / d, dy / d, (d / width.max(height)).clamp(0.0, 1.0))
    } else { (0.0, 0.0, 1.0) };
    let mut v = vec![nx, ny, spx, spy, e, h, ts, tc, dxn, dyy, dd];
    match mode {
        BrainMode::OG => {
            // Add bias + pad to 14
            v.push(1.0);
            let need = 14usize;
            if v.len() < need { v.extend(std::iter::repeat(0.0).take(need - v.len())); }
            v.truncate(need);
            v
        }
        BrainMode::Zegion => {
            // Nearest carnivore
            let pred = nearest_carnivore(c.x, c.y, a, b);
            let (dxn2, dyn2, dd2) = if let Some((px, py)) = pred {
                let dx = px - c.x; let dy = py - c.y; let d = (dx*dx + dy*dy).sqrt().max(0.0001);
                (dx / d, dy / d, (d / width.max(height)).clamp(0.0, 1.0))
            } else { (0.0, 0.0, 1.0) };
            let rough = terrain_speed_at(c.x, c.y, tick);
            let rough_n = (rough - 0.6) / 0.4; // 0..1 -> normalize
            let speed_mag = (c.vx * c.vx + c.vy * c.vy).sqrt().tanh();
            let dot_herb = spx * dxn + spy * dyy;
            let dot_carn = spx * dxn2 + spy * dyn2;
            let ts2 = f32::sin(t * 0.37 + c.x * 0.0007 + c.y * 0.0009);
            let tc2 = f32::cos(t * 0.41 - c.x * 0.0006 + c.y * 0.0011);
            let diet_carn = if c.diet == Diet::Carnivore { 1.0 } else { 0.0 };
            let inv_e = (1.0 - e).clamp(0.0, 1.0);
            v.extend([dxn2, dyn2, dd2, rough, rough_n, speed_mag, dot_herb, dot_carn, ts2, tc2, diet_carn, inv_e, 1.0]);
            // Now ensure length is 24
            let need = 24usize;
            if v.len() < need { v.extend(std::iter::repeat(0.0).take(need - v.len())); }
            v.truncate(need);
            v
        }
    }
}

fn brain_forward(brain: &mut Brain, inputs: &Vec<f32>, mode: BrainMode) -> (Vec<f32>, Vec<Vec<f32>>) {
    let ls = &brain.layer_sizes;
    let weights = brain.weights.as_ref().unwrap();
    let biases = brain.biases.as_ref().unwrap();
    let mut acts: Vec<Vec<f32>> = Vec::new();
    let mut cur = inputs.clone();
    acts.push(cur.clone());
    for li in 1..ls.len() {
        let n_in = ls[li-1] as usize;
        let n_out = ls[li] as usize;
        let w = &weights[li-1];
        let b = &biases[li-1];
        let mut next = vec![0.0f32; n_out];
        for o in 0..n_out {
            let mut sum = b[o];
            let base = o * n_in;
            for ii in 0..n_in { sum += w[base + ii] * cur[ii]; }
            next[o] = match (mode, li == ls.len()-1) {
                // Hidden layers: ReLU
                (_, false) => if sum > 0.0 { sum } else { 0.0 },
                // Output layer: tanh
                (_, true) => sum.tanh(),
            };
        }
        acts.push(next.clone());
        cur = next;
    }
    (cur.clone(), acts)
}
