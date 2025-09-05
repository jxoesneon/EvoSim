import { ref, reactive, readonly, watch } from 'vue'
import getZegionSpec from '@/zegion/io/spec'
import { RNG } from '@/zegion/utils/seeding'
import ActivationRegistry, { type ActivationName } from '@/zegion/activations'
import { useNameService } from '@/composables/useNameService'
import { useUiPrefs } from '@/composables/useUiPrefs'

// Interfaces for our simulation entities
export interface Camera {
  x: number
  y: number
  zoom: number
}

type LastCostTelemetry = {
  totalEnergyPerSec: number
  locomotion: number
  sprintOverflowE: number
  drinkE: number
  harvestE: number
  scavengeE: number
  matingE: number
  gestationE: number
  attackE: number
  postureE: number
  ambientHealthDelta: number
  envTotal?: number
  envSwim?: number
  envWind?: number
  envCold?: number
  envHeat?: number
  envHumid?: number
  envOxy?: number
  envNoise?: number
  envDisease?: number
}
type CreatureWithDiag = Creature & CreatureEventFlags & { _lastCost?: LastCostTelemetry }

// Typed augmentation for transient event flags we attach during UI/event processing
type CreatureEventFlags = {
  _ev_prev_thirsty?: boolean
  _ev_prev_hungry?: boolean
  _ev_prev_fatigued?: boolean
  _ev_prev_fearful?: boolean
  _ev_prev_mating?: boolean
  _ev_prev_health?: number
  _ev_prev_energy?: number
  _ev_prev_stamina?: number
  _ev_prev_nearPlant?: boolean
  _ev_prev_nearFoodPlant?: boolean
  _ev_prev_nearCorpse?: boolean
  _ev_prev_restless?: boolean
  _ev_prev_nearMate?: boolean
  _ev_prev_sprinting?: boolean
  _ev_prev_resting?: boolean
  _ev_prev_drinking?: boolean
  _prevVx?: number
  _prevVy?: number
  _prevHeading?: number
  _ev_ticks_since_rest?: number
}

export interface Phenotype {
  diet?: 'Herbivore' | 'Carnivore'
  eyesCount?: number
  fieldOfViewDeg?: number
  sightRange?: number
  size?: number
  speed?: number
  eyeAnglesDeg?: number[]
}

export interface BrainData {
  layerSizes: number[]
  weights: number[][]
  biases: number[][]
  // optional runtime exposed data for UI/diagnostics
  inputs?: number[]
  activations?: number[][]
  output?: number[]
}

export interface Creature {
  id: string
  name: string
  x: number
  y: number
  vx: number
  vy: number
  energy: number
  thirst: number
  stamina: number
  health: number
  sDrive: number
  fear: number
  lifespan: number
  isPregnant: boolean
  gestationTimer: number
  childGenes: Record<string, [string, string]> | Array<Record<string, [string, string]>> | null
  genes: Record<string, [string, string]>
  phenotype: Phenotype
  brain: BrainData | null
  radius: number
  maxStamina: number
  communicationColor: { r: number; g: number; b: number }
  isResting: boolean
  isSprinting: boolean
  // Telemetry masks from WASM (bitfields) and movement stagnation counter
  actionsMask?: number
  feelingsMask?: number
  stagnantTicks?: number
}

export interface Plant {
  x: number
  y: number
  radius: number
}

export interface Corpse {
  x: number
  y: number
  radius: number
  energyRemaining: number
  initialDecayTime: number
  decayTimer: number
  // Derived UI metric: fraction decayed in [0,1]
  decayFrac01?: number
}

// Singleton store pattern
let store: ReturnType<typeof createStore> | null = null

// Genetic gene bag for vision-related traits
type VisionGeneBag = Partial<{
  V: string[]
  E: string[]
  eyesCount: number
  sightRange: number
  fieldOfViewDeg: number
}>


export function useSimulationStore() {
  if (!store) {
    store = createStore()
  }

  // (Types for event flags and cost telemetry are defined at top-level and used where needed)
  // Genetic helpers (for future reproduction wiring)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function inheritVisionGenes(parentA: VisionGeneBag = {}, parentB: VisionGeneBag = {}): VisionGeneBag {
    // Inherit alleles by sampling one allele from each parent; default to heterozygous if missing
    const pickAllele = (alleles: unknown, fallbackDom: string, fallbackRec: string): string => {
      if (Array.isArray(alleles) && alleles.length >= 1) {
        const i = Math.random() < 0.5 ? 0 : Math.min(1, alleles.length - 1)
        return String(alleles[i])
      }
      return Math.random() < 0.5 ? fallbackDom : fallbackRec
    }
    const child: VisionGeneBag = {}
    // Sight range allele V/v
    const aV: string[] = Array.isArray(parentA?.V) ? parentA.V! : ['V', 'v']
    const bV: string[] = Array.isArray(parentB?.V) ? parentB.V! : ['V', 'v']
    child.V = [pickAllele(aV, 'V', 'v'), pickAllele(bV, 'V', 'v')]
    // Field of view allele E/e
    const aE: string[] = Array.isArray(parentA?.E) ? parentA.E! : ['E', 'e']
    const bE: string[] = Array.isArray(parentB?.E) ? parentB.E! : ['E', 'e']
    child.E = [pickAllele(aE, 'E', 'e'), pickAllele(bE, 'E', 'e')]
    // Eyes count: integer average of parents (if present) rounded, else 2
    const ecA = Number.isFinite(parentA?.eyesCount) ? Number(parentA.eyesCount) : NaN
    const ecB = Number.isFinite(parentB?.eyesCount) ? Number(parentB.eyesCount) : NaN
    let ec = 2
    if (Number.isFinite(ecA) && Number.isFinite(ecB)) ec = Math.round((ecA + ecB) / 2)
    else if (Number.isFinite(ecA)) ec = Math.round(ecA)
    else if (Number.isFinite(ecB)) ec = Math.round(ecB)
    child.eyesCount = Math.max(1, Math.min(6, ec || 2))
    return child
  }

  return store
}

function createStore() {
  // Math helper: wrap angle difference to [-PI, PI]
  function wrapAngle(a: number): number {
    // Normalize to [-PI, PI] robustly
    const twoPi = Math.PI * 2
    let x = a % twoPi
    if (x > Math.PI) x -= twoPi
    else if (x < -Math.PI) x += twoPi
    return x
  }

  // State
  const isRunning = ref(false)
  // Bumps when we want any RAF loop to force-cancel immediately (guards races)
  const rafHaltToken = ref(0)
  const creatures = ref<Creature[]>([])
  const plants = ref<Plant[]>([])
  const corpses = ref<Corpse[]>([])
  const camera = reactive<Camera>({ x: 1000, y: 1000, zoom: 1 })
  const selectedCreatureId = ref<string | null>(null)
  const generation = ref(1)
  const stagnantTicks = ref(0)
  const movementStats = reactive({ avgSpeed: 0 })
  // UI preferences (for logging gates, etc.)
  const uiPrefs = useUiPrefs()
  // Track current generation start (real timestamp, ms since epoch)
  const currentGenStartTs = ref<number>(Date.now())
  // Lightweight telemetry (no deps): ring buffers and counters
  const MAX_SERIES = 3600
  function pushSeries(arr: number[], v: number) {
    arr.push(Number.isFinite(v) ? v : 0)
    if (arr.length > MAX_SERIES) arr.splice(0, arr.length - MAX_SERIES)
  }
  const telemetry = reactive({
    series: {
      avgSpeed: [] as number[],
      population: {
        creatures: [] as number[],
        plants: [] as number[],
        corpses: [] as number[],
      },
      events: {
        births: [] as number[],
        deaths: [] as number[],
        eats_plant: [] as number[],
        eats_corpse: [] as number[],
        drinks: [] as number[],
        attacks: [] as number[],
        gets_hit: [] as number[],
      },
      environment: {
        temperatureC: [] as number[],
        humidity01: [] as number[],
        precipitation01: [] as number[],
        uv01: [] as number[],
        visibility01: [] as number[],
        windSpeed: [] as number[],
      },
    },
    totals: {
      births: 0,
      deaths: 0,
      eats_plant: 0,
      eats_corpse: 0,
      drinks: 0,
      attacks: 0,
      gets_hit: 0,
    },
  })
  // Parity summary stats for overlay (reset and updated each update() call)
  const parityStats = reactive({
    env: {
      mismatches: 0,
      maxRelDiff: 0,
      compMaxRel: {
        envSwim: 0,
        envWind: 0,
        envCold: 0,
        envHeat: 0,
        envHumid: 0,
        envOxy: 0,
        envNoise: 0,
        envDisease: 0,
        locomotion: 0,
      } as Record<string, number>,
    },
    corpse: {
      mismatches: 0,
      maxRelDiff: 0,
      compMaxRel: {
        base: 0,
        temp: 0,
        humid: 0,
        rain: 0,
        wet: 0,
        total: 0,
      } as Record<string, number>,
    },
  })
  // Per-generation Hall of Fame (top by lifespan)
  // id: stable brain-hash identifier; liveId: last known runtime creature id (for focus/lookups)
  const hallOfFameGen = ref<
    Array<{ id: string; name: string; lifespan: number; liveId?: string; gen: number }>
  >([])
  // Cumulative Hall of Fame across all generations (persists; keeps max lifespan per id)
  const hallOfFameAll = ref<
    Array<{ id: string; name: string; lifespan: number; liveId?: string; gen: number }>
  >([])
  // Generation end signal and summary
  const lastGenEnd = ref<null | { gen: number; reason: string; timestamp: number }>(null)
  const genEndToken = ref(0)
  // Snapshot of simulation params from the generation that just ended
  const lastGenParams = ref<null | Record<string, unknown>>(null)
  // Brain RNG seed handled by deterministic RNG below
  // Brain memoization cache: hash -> { score, brain, genes }
  const brainCache = reactive<Record<string, { score: number; brain: BrainData | null; genes: Record<string, [string, string]> }>>({})
  // Debug throttle counter for sparse logs
  let debugSkipCounter = 0
  // Frame counters for throttling parity diagnostics
  let parityFrame = 0
  // Bad brain hash library (collapse filters) maintained by simulation
  const badBrainHashes = reactive<Record<string, true>>({})

  // --- World Time state ---
  // Accumulated real seconds elapsed since simulation start (not scaled by simulationSpeed)
  const worldTimeSec = ref(0)
  // Continuous world day counter (0 at start), derived from worldTimeSec, realSecondsPerDay, and worldTimeScale
  const worldDayFloat = ref(0)
  // Normalized day-of-year in [0,1), includes configurable start offset
  const dayOfYear01 = ref(0)
  // Convenience seasonal scalar in [0,1), where 0~winter, 0.25~spring, 0.5~summer, 0.75~autumn.
  const season01 = ref(0)

  // --- Environment samplers (JS scaffolds; replace with WASM-backed fields later) ---
  // Deterministic pseudo-noise helpers without external deps
  function hhash(x: number, y: number, t: number): number {
    const s = Math.sin(x * 12.9898 + y * 78.233 + t * 0.12345) * 43758.5453
    return s - Math.floor(s)
  }
  function smooth01(v: number) {
    const x = v - Math.floor(v)
    return x * x * (3 - 2 * x)
  }
  function sampleWeather(x: number, y: number) {
    const dayFrac = ((worldDayFloat.value % 1) + 1) % 1
    const localTime01 = dayFrac
    const baseTemp = 10 + 15 * Math.sin((dayOfYear01.value + 0.05) * Math.PI * 2)
    const diurnal = 5 * Math.sin((localTime01 - 0.25) * Math.PI * 2)
    const temperatureC = baseTemp + diurnal
    const cloud01 = smooth01(hhash(x * 0.003, y * 0.003, worldDayFloat.value * 0.2))
    const precipitation01 = Math.max(0, cloud01 - 0.6) * 2
    const humidity01 = Math.min(1, 0.3 + 0.7 * (cloud01 * 0.6 + precipitation01 * 0.4))
    const windDirRad = (hhash(0, 0, worldDayFloat.value * 0.05) * Math.PI * 2) % (Math.PI * 2)
    const windSpeed = 1 + 4 * smooth01(hhash(10, 20, worldDayFloat.value * 0.03))
    const uv01 = Math.max(0, Math.sin(localTime01 * Math.PI)) * (1 - cloud01 * 0.6)
    const visibility01 = Math.max(0, 1 - precipitation01 * 0.7 - cloud01 * 0.3)
    const noise01 = smooth01(hhash(x * 0.01 + 7, y * 0.01 - 3, worldDayFloat.value * 0.5))
    return {
      temperatureC,
      humidity01,
      precipitation01,
      cloud01,
      windSpeed,
      windDirRad,
      uv01,
      visibility01,
      noise01,
    }
  }
  function sampleTerrain(x: number, y: number) {
    const elev = smooth01(hhash(x * 0.001, y * 0.001, 0))
    const elevation01 = elev
    const roughness01 = smooth01(hhash(x * 0.02 + 11, y * 0.02 - 5, 0))
    const slope01 = Math.abs(smooth01(hhash(x * 0.005 + 2, y * 0.005 + 4, 0)) - 0.5) * 2
    const fertility01 = smooth01(hhash(x * 0.004 - 9, y * 0.004 + 6, worldDayFloat.value * 0.02))
    const wetness01 = Math.min(1, 0.2 + 0.6 * elevation01 + 0.4 * fertility01)
    const waterDepth = Math.max(0, 0.35 - elevation01) * 2
    const flowTheta = hhash(x * 0.001 + 3, y * 0.001 + 7, 0) * Math.PI * 2
    const flow = { x: Math.cos(flowTheta) * waterDepth, y: Math.sin(flowTheta) * waterDepth }
    return {
      elevation01,
      slope01,
      roughness01,
      fertility01,
      wetness01,
      waterDepth,
      flow,
    }
  }

  // Will hold loaded Zegion spec for JS fallback sizing
  interface ZegionSpec {
    activations?: { hidden?: string; output?: string }
    architecture?: number[]
  }
  let zegionSpec: ZegionSpec | null = null

  // Deterministic brain RNG used for JS fallback brain init
  let rngBrain = new RNG(0xdeadbeef)
  // Human-friendly naming service
  const nameSvc = useNameService()
  nameSvc.prime(60)

  // Lightweight JS brain helpers to mirror WASM path enough to compile and run
  function initBrain(layerSizes: number[], rng: RNG = rngBrain): BrainData {
    const weights: number[][] = []
    const biases: number[][] = []
    for (let li = 1; li < layerSizes.length; li++) {
      const nIn = layerSizes[li - 1]
      const nOut = layerSizes[li]
      const scale = Math.sqrt(2 / Math.max(1, nIn))
      const w: number[] = []
      for (let o = 0; o < nOut; o++) {
        for (let i = 0; i < nIn; i++) w.push((rng.uniform(-1, 1) as number) * scale)
      }
      const b: number[] = new Array(nOut).fill(0)
      weights.push(w)
      biases.push(b)
    }
    return { layerSizes: layerSizes.slice(), weights, biases }
  }

  function createGoodBrain(layerSizes: number[], rng: RNG = rngBrain) {
    return initBrain(layerSizes, rng)
  }

  function computeLayerSizesForCreature(): number[] {
    // Use selected brain mode to choose base architecture
    return simulationParams.brainMode === 'Zegion' ? [24, 16, 6] : [14, 8, 8]
  }

  function resolveActivationFns() {
    const hidden = (x: number) => (x > 0 ? x : 0)
    const output = (x: number) => Math.tanh(x)
    return { hidden, output }
  }

  function brainForward(
    brain: { layerSizes: number[]; weights: number[][]; biases: number[][] },
    inputs: number[],
    _mode: 'OG' | 'Zegion',
    actFns: { hidden: (x: number) => number; output: (x: number) => number },
  ) {
    const ls = brain.layerSizes
    let cur = inputs.slice()
    const activations: number[][] = [cur.slice()]
    for (let li = 1; li < ls.length; li++) {
      const nIn = ls[li - 1]
      const nOut = ls[li]
      const w = brain.weights[li - 1]
      const b = brain.biases[li - 1]
      const next = new Array(nOut).fill(0)
      for (let o = 0; o < nOut; o++) {
        let sum = b[o]
        const base = o * nIn
        for (let ii = 0; ii < nIn; ii++) sum += w[base + ii] * cur[ii]
        next[o] = li === ls.length - 1 ? actFns.output(sum) : actFns.hidden(sum)
      }
      cur = next
      activations.push(cur.slice())
    }
    return { output: cur.slice(), activations }
  }

  function terrainSpeedAt(x: number, y: number, tick: number): number {
    const tt = (tick % 10000) * 0.001
    const v = Math.sin(x * 0.003 + tt) * Math.cos(y * 0.002 - tt) * 0.5 + 0.5
    return 0.6 + v * 0.4
  }

  function buildInputs(
    width: number,
    height: number,
    tick: number,
    c: Creature,
    all: Creature[],
    mode: 'OG' | 'Zegion',
  ): number[] {
    const nx = c.x / width
    const ny = c.y / height
    const spx = Math.tanh(c.vx)
    const spy = Math.tanh(c.vy)
    const e = Math.max(0, Math.min(1, c.energy / 100))
    const h = Math.max(0, Math.min(1, c.health / 100))
    // Nearest other creature simplistic vector
    const other = all.find((o) => o.id !== c.id)
    let dxn = 0,
      dyn = 0,
      dd = 1
    if (other) {
      const dx = other.x - c.x
      const dy = other.y - c.y
      const d = Math.max(0.0001, Math.hypot(dx, dy))
      dxn = dx / d
      dyn = dy / d
      dd = Math.max(0, Math.min(1, d / Math.max(width, height)))
    }

    // Inputs V1 (legacy): synthetic time sin/cos
    const t = tick * 0.01
    const ts = Math.sin(t)
    const tc = Math.cos(t)
    const baseV1 = [nx, ny, spx, spy, e, h, ts, tc, dxn, dyn, dd]

    // Inputs V2: environment/time aware
    const weather = sampleWeather(c.x, c.y)
    const terrain = sampleTerrain(c.x, c.y)
    // Normalize select env fields to [-1,1] or [0,1] as appropriate
    const tempN = Math.tanh((weather.temperatureC - 15) / 10)
    const humid = weather.humidity01
    const rain = weather.precipitation01
    const windX = Math.cos(weather.windDirRad) * (weather.windSpeed / 5)
    const windY = Math.sin(weather.windDirRad) * (weather.windSpeed / 5)
    const uv = weather.uv01
    const vis = weather.visibility01
    const elev = terrain.elevation01
    const slope = terrain.slope01
    const wet = terrain.wetness01
    const water = Math.min(1, terrain.waterDepth)
    const flowX = terrain.flow.x
    const flowY = terrain.flow.y
    const baseV2 = [nx, ny, spx, spy, e, h, dxn, dyn, dd, tempN, humid, rain]

    if (mode === 'OG') {
      if (simulationParams.inputsVersion === 'v2') {
        // Map to 14: position(2), vel(2), energy, health, nearest dir(2), dist(1), temp, humidity, rain, bias
        const v = baseV2.slice(0, 12)
        v.push(1.0) // bias
        while (v.length < 14) v.push(0)
        return v.slice(0, 14)
      } else {
        const v = baseV1.slice()
        v.push(1.0)
        while (v.length < 14) v.push(0)
        return v.slice(0, 14)
      }
    } else {
      const speedMag = Math.tanh(Math.hypot(c.vx, c.vy))
      if (simulationParams.inputsVersion === 'v2') {
        // Map to 24 richer vector including weather/terrain and diurnal/season
        const v = [
          nx,
          ny,
          spx,
          spy,
          speedMag,
          e,
          h,
          dxn,
          dyn,
          dd,
          tempN,
          humid,
          rain,
          uv,
          vis,
          windX,
          windY,
          elev,
          slope,
          wet,
          water,
          flowX,
          flowY,
        ]
        while (v.length < 24) v.push(0)
        return v.slice(0, 24)
      } else {
        const ts2 = Math.sin(t * 0.37 + c.x * 0.0007 + c.y * 0.0009)
        const tc2 = Math.cos(t * 0.41 - c.x * 0.0006 + c.y * 0.0011)
        const inv_e = 1 - e
        const v = baseV1.concat([speedMag, ts2, tc2, inv_e, 1.0])
        while (v.length < 24) v.push(0)
        return v.slice(0, 24)
      }
    }
  }

  // Stable labels map for current input orderings (kept in sync with buildInputs above)
  const InputIndexMap = {
    OG: {
      v1: [
        'x',
        'y',
        'vx',
        'vy',
        'energy',
        'health',
        'sin t',
        'cos t',
        'near dx',
        'near dy',
        'near dist',
        'bias',
        'unused 12',
        'unused 13',
      ],
      v2: [
        'x',
        'y',
        'vx',
        'vy',
        'energy_norm',
        'health_norm',
        'near_dx',
        'near_dy',
        'near_dist_norm',
        'temp_norm',
        'humidity_norm',
        'rain_norm',
        'bias',
        'pad',
      ],
    },
    Zegion: {
      v1: [
        'x',
        'y',
        'vx',
        'vy',
        'energy',
        'health',
        'sin t',
        'cos t',
        'near dx',
        'near dy',
        'near dist',
        'speed_norm',
        'sin2',
        'cos2',
        'inv energy',
        'bias',
        'pad16',
        'pad17',
        'pad18',
        'pad19',
        'pad20',
        'pad21',
        'pad22',
        'pad23',
      ],
      v2: [
        'x',
        'y',
        'vx',
        'vy',
        'speed_norm',
        'energy_norm',
        'health_norm',
        'near_dx',
        'near_dy',
        'near_dist_norm',
        'temp_norm',
        'humidity_norm',
        'rain_norm',
        'uv_norm',
        'visibility_norm',
        'wind_x_norm',
        'wind_y_norm',
        'altitude_norm',
        'slope_norm',
        'wetness_norm',
        'water_depth_norm',
        'flow_x_norm',
        'flow_y_norm',
      ],
    },
  } as const

  function getInputLabelsFor(
    total: number,
    mode: 'OG' | 'Zegion',
    version: 'v1' | 'v2',
  ): ReadonlyArray<string> {
    const arr = InputIndexMap[mode]?.[version] as ReadonlyArray<string> | undefined
    if (Array.isArray(arr) && arr.length >= total) return arr.slice(0, total)
    if (Array.isArray(arr))
      return [
        ...arr,
        ...Array.from({ length: total - arr.length }, (_, i) => `In ${arr.length + i}`),
      ]
    return Array.from({ length: total }, (_, i) => `In ${i}`)
  }

  function getInputCategoriesFor(total: number, mode: 'OG' | 'Zegion', version: 'v1' | 'v2') {
    const internalIdx = new Set<number>()
    if (mode === 'OG') {
      // indices: energy(4), health(5)
      internalIdx.add(4)
      internalIdx.add(5)
    } else {
      if (version === 'v2') {
        // indices: speed(4), energy(5), health(6)
        internalIdx.add(4)
        internalIdx.add(5)
        internalIdx.add(6)
      } else {
        // v1 legacy (Zegion): energy(4), health(5), speed(11), inv energy(14)
        internalIdx.add(4)
        internalIdx.add(5)
        internalIdx.add(11)
        internalIdx.add(14)
      }
    }
    return Array.from({ length: total }, (_, i) => (internalIdx.has(i) ? 'Internal' : 'External'))
  }

  function getInputMeta(total: number) {
    const mode = simulationParams.brainMode
    const version = simulationParams.inputsVersion
    const labels = getInputLabelsFor(total, mode, version)
    const cats = getInputCategoriesFor(total, mode, version)
    return labels.map((label, idx) => ({ idx, label, category: cats[idx] }))
  }

  // Public setter to reseed brain RNG and refresh JS fallback brains
  function setBrainSeed(seed: number) {
    const s = seed >>> 0 || 0xdeadbeef
    rngBrain = new RNG(s)
    if (!wasmWorld) {
      for (const c of creatures.value) {
        const sizes = computeLayerSizesForCreature()
        c.brain = initBrain(sizes, rngBrain)
      }
    }
  }

  // Per-creature live events log
  type CreatureEventType = 'feeling' | 'event' | 'action'
  type CreatureEventKey =
    | 'thirst'
    | 'hunger'
    | 'fatigue'
    | 'fear'
    | 'pain'
    | 'mating_urge'
    | 'restless'
    | 'finds_water'
    | 'loses_water'
    | 'finds_mate'
    | 'loses_mate'
    | 'finds_food_plant'
    | 'loses_food_plant'
    | 'finds_prey'
    | 'loses_prey'
    | 'finds_predator'
    | 'loses_predator'
    | 'finds_corpse'
    | 'loses_corpse'
    | 'drinks'
    | 'sprints'
    | 'stops_sprinting'
    | 'rests'
    | 'eats_plant'
    | 'eats_corpse'
    | 'gets_hit'
    | 'attacks'
    | 'energy_gain'
    | 'energy_loss'
    | 'stamina_gain'
    | 'stamina_loss'
    | 'health_gain'
    | 'health_loss'
    | 'birth'
    | 'death'
  interface CreatureEvent {
    ts: number
    type: CreatureEventType
    key: CreatureEventKey
    label: string
  }
  const creatureEvents = reactive<Record<string, CreatureEvent[]>>({})
  // WASM prev-flags for proximity events across frames
  const wasmPrevFlagsById = new Map<
    string,
    {
      nearPlant?: boolean
      nearFoodPlant?: boolean
      nearCorpse?: boolean
      nearPrey?: boolean
      nearPredator?: boolean
      nearMate?: boolean
    }
  >()
  const wasmPrevResources = new Map<
    string,
    { energy?: number; stamina?: number; health?: number }
  >()
  const MAX_EVENTS_PER_CREATURE = 200
  function pushCreatureEvent(id: string, ev: CreatureEvent) {
    if (!id) return
    const arr = creatureEvents[id] || (creatureEvents[id] = [])
    arr.push(ev)
    if (arr.length > MAX_EVENTS_PER_CREATURE) arr.splice(0, arr.length - MAX_EVENTS_PER_CREATURE)
    // Dev visibility: log and emit a browser event for overlays/listeners
    try {
      if (import.meta.env.DEV && uiPrefs.isLogOn?.('creature_event')) {

        console.debug('[CreatureEvent]', id, ev.type, ev.key, ev.label || '', new Date(ev.ts).toISOString())
      }
    } catch {}
  }

  // Debug-only dispatcher: keep debug emissions separate from real events
  // Does not mutate telemetry totals or persistent history arrays
  function pushCreatureEventDebug(id: string, ev: CreatureEvent) {
    // ... (rest of the code remains the same)
    if (!id) return
    try {
      if (import.meta.env.DEV && uiPrefs.isLogOn?.('creature_event')) {

        console.debug('[CreatureEvent][debug]', id, ev.type, ev.key, ev.label || '', new Date(ev.ts).toISOString())
      }
    } catch {}
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('creature-event-debug', { detail: { id, ev } }))
    }
  }

  function shouldEmitEvent(id: string, key: CreatureEventKey, minIntervalMs = 1500): boolean {
    // ... (rest of the code remains the same)
    const arr = creatureEvents[id]
    if (!arr || arr.length === 0) return true
    for (let i = arr.length - 1; i >= 0; i--) {
      const e = arr[i]
      if (e.key === key) {
        return Date.now() - e.ts >= minIntervalMs
      }
    }
    return true
  }
  function getCreatureEvents(id: string): readonly CreatureEvent[] {
    return creatureEvents[id] || []
  }
  function clearCreatureEvents(id: string) {
    if (creatureEvents[id]) creatureEvents[id] = []
  }

  // Notify WASM (if available) of the current bad brain hash list so it can avoid them
  function syncBadBrainsToWasm() {
    try {
      if (wasmWorld && typeof wasmWorld.set_bad_brain_hashes === 'function') {
        const arr = Object.keys(badBrainHashes)
        wasmWorld.set_bad_brain_hashes(arr)
      }
    } catch (e) {
      console.warn('[WASM] set_bad_brain_hashes failed', e)
    }
  }

  // --- Brain memoization helpers (mirroring OG) ---
  function simpleHash(str: string): string {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = (hash << 5) - hash + char
      hash |= 0 // Convert to 32-bit int
    }
    // Convert to unsigned and radix36
    return new Uint32Array([hash >>> 0])[0].toString(36)
  }

  function trimCache(
    cache: Record<string, { score: number; brain: BrainData | null; genes: Record<string, [string, string]> }>,
    maxEntries: number,
    trimPercent: number,
  ) {
    const keys = Object.keys(cache)
    if (keys.length <= maxEntries) return cache
    const scored = keys.map((k) => ({ k, s: cache[k].score }))
    scored.sort((a, b) => a.s - b.s)
    const trimCount = Math.floor(keys.length * trimPercent)
    for (let i = 0; i < trimCount; i++) delete cache[scored[i].k]
    return cache
  }

  // Classify bad brains: any with score (lifespan) below top 25% threshold
  function classifyBadBrainsFromCache() {
    const entries = Object.entries(brainCache)
    if (entries.length < 4) return // too few to classify meaningfully
    const scores = entries.map(([, v]) => v.score).sort((a, b) => a - b)
    const idx = Math.floor(0.75 * (scores.length - 1))
    const threshold = scores[idx]
    for (const [hash, v] of entries) {
      if (v.score < threshold) badBrainHashes[hash] = true
    }
  }

  // WebAssembly world reference (created from wasm-bindgen when available)
  interface WasmWorld {
    // JSON snapshots
    creatures_json: () => Array<Record<string, unknown>>
    plants_json: () => Array<Record<string, unknown>>
    corpses_json: () => Array<Record<string, unknown>>
    env_costs_json?: () => Array<Record<string, unknown>>
    // Controls
    set_brain_mode?: (mode: unknown) => void
    set_config?: (...args: unknown[]) => void
    // Spawners
    spawn_creature?: (x: number, y: number) => void
    spawn_plant?: (x: number, y: number, radius: number) => void
    // Misc
    set_bad_brain_hashes?: (hashes: string[]) => void
    step?: (dt?: number) => void
  }
  let wasmWorld: WasmWorld | null = null
  // (WASM decay cost shape can be inferred where used; no separate type needed here)
  // One-time emission guard for WASM-ready event/log
  let wasmReadyEmitted = false
  const wasmStatus = reactive<{ available: boolean; lastError: string | null }>({
    available: false,
    lastError: null,
  })

  // Helper: compute mutation energy cost between two gene maps
  type GenesLike = Record<string, unknown>
  function computeMutationEnergyCost(before: GenesLike, after: GenesLike): number {
    if (!before || !after) return simulationParams.mutationCostEnergyBase
    let delta = 0
    const keys = new Set([...Object.keys(before), ...Object.keys(after)])
    for (const k of keys) {
      const b = before[k]
      const a = after[k]
      if (Array.isArray(b) && Array.isArray(a)) {
        // allele difference count
        const len = Math.max(b.length, a.length)
        for (let i = 0; i < len; i++) delta += b[i] === a[i] ? 0 : 1
      } else if (typeof b === 'number' && typeof a === 'number') {
        delta += Math.abs(a - b)
      } else if (b !== undefined || a !== undefined) {
        delta += 1
      }
    }
    return (
      simulationParams.mutationCostEnergyBase + simulationParams.mutationCostPerStdChange * delta
    )
  }

  // Public API to charge mutation cost for a creature (for future reproduction wiring)
  function chargeMutationCost(creature: Creature, genesBefore: GenesLike, genesAfter: GenesLike) {
    const cost = computeMutationEnergyCost(genesBefore, genesAfter)
    creature.energy = Math.max(-50, creature.energy - cost)
  }

  // Centralized gated logger
  function log(...args: unknown[]) {
    try {
      if (simulationParams.debugLogging) console.debug(...(args as unknown[]))
    } catch {}
  }

  function setDebugLogging(v: boolean) {
    simulationParams.debugLogging = !!v
  }

  // Brain mode setter (syncs WASM if present and re-inits JS brains)
  function setBrainMode(mode: 'OG' | 'Zegion') {
    simulationParams.brainMode = mode
    try {
      if (wasmWorld && typeof wasmWorld.set_brain_mode === 'function') {
        wasmWorld.set_brain_mode(mode)
      }
    } catch (e) {
      console.warn('[WASM] set_brain_mode failed in setter', e)
    }
    // Re-init brains in JS fallback to match the new architecture
    if (!wasmWorld) {
      // Use safe defaults; full spec application happens on entity init paths
      const sizes = (mode === 'OG' ? [14, 8, 8] : [24, 16, 6]) as number[]
      for (const c of creatures.value) c.brain = initBrain(sizes)
    }
  }
  const wasmDiag = reactive({
    ua: '',
    isTestEnv: false,
    initTried: false,
    initUrlTried: false,
    initUrlOk: false,
    initNoArgTried: false,
    initNoArgOk: false,
    createdWorld: false,
    url: '' as string | null,
    attempts: 0,
    lastAttemptAt: 0,
    tStart: 0,
    tInitUrlMs: 0,
    tInitNoArgMs: 0,
    tWorldMs: 0,
    tTotalMs: 0,
  })

  // Build the WASM config object from current simulationParams (subset parity)
  function buildWasmConfig() {
    return {
      // Time parity
      realSecondsPerDay: Number(simulationParams.realSecondsPerDay),
      worldTimeScale: Number(simulationParams.worldTimeScale),
      startDayOfYear01: Number(simulationParams.startDayOfYear01),
      restStaminaRegenPerSec: Number(simulationParams.restStaminaRegenPerSec),
      restHealthRegenPerSec: Number(simulationParams.restHealthRegenPerSec),
      harvestPlantActionCostPerSecond: Number(simulationParams.harvestPlantActionCostPerSecond),
      attackCostPerHitStamina: Number(simulationParams.attackCostPerHitStamina),
      sprintOverflowCostPerSec: Number(simulationParams.sprintEnergyOverflowCoeff) * 0.06,
      postureCostPerSec: Number(simulationParams.postureCostPerSec),
      attackCostPerHitEnergy: Number(simulationParams.attackCostPerHitEnergy),
      thirstThreshold: Number(simulationParams.thirstThreshold),
      thirstRecoveryPerSec: Number(simulationParams.thirstRecoveryPerSec),
      drinkCostPerSecond: Number(simulationParams.drinkCostPerSecond),
      moveCostCoeffPerSpeedPerSec: Number(simulationParams.moveCostCoeffPerSpeedPerSec),
      ambientHealthDecayPerSec: Number(simulationParams.ambientHealthDecayPerSec),
      agingHealthDecayCoeff: Number(simulationParams.agingHealthDecayCoeff),
      gestationBaseCostPerSec: Number(simulationParams.gestationBaseCostPerSec),
      gestationCostPerOffspringPerSec: Number(simulationParams.gestationCostPerOffspringPerSec),
      gestationPeriod: Number(simulationParams.gestationPeriod),
      birthEventCostEnergy: Number(simulationParams.birthEventCostEnergy),
      mutationCostEnergyBase: Number(simulationParams.mutationCostEnergyBase),
      mutationCostPerStdChange: Number(simulationParams.mutationCostPerStdChange),
      // Telemetry thresholds (WASM deep parity)
      hungerEnergyThreshold: Number(simulationParams.hungerEnergyThreshold),
      fatigueStaminaThreshold: Number(simulationParams.fatigueStaminaThreshold),
      movementThreshold: Number(simulationParams.movementThreshold),
      stagnantTicksLimit: Number(simulationParams.stagnantTicksLimit),
      // Environmental cost tunables (parity hooks)
      swimEnergyCostPerSec: Number(simulationParams.swimEnergyCostPerSec),
      windDragCoeff: Number(simulationParams.windDragCoeff),
      tempColdPenaltyPerSec: Number(simulationParams.tempColdPenaltyPerSec),
      tempHeatPenaltyPerSec: Number(simulationParams.tempHeatPenaltyPerSec),
      comfortLowC: Number(simulationParams.comfortLowC),
      comfortHighC: Number(simulationParams.comfortHighC),
      humidityDehydrationCoeffPerSec: Number(simulationParams.humidityDehydrationCoeffPerSec),
      humidityThreshold: Number(simulationParams.humidityThreshold),
      oxygenThinAirPenaltyPerSec: Number(simulationParams.oxygenThinAirPenaltyPerSec),
      thinAirElevationCutoff01: Number(simulationParams.thinAirElevationCutoff01),
      noiseStressPenaltyPerSec: Number(simulationParams.noiseStressPenaltyPerSec),
      diseaseEnergyDrainPerSec: Number(simulationParams.diseaseEnergyDrainPerSec),
      // Corpse decay tunables
      corpseBaseDecayPerSec: Number(simulationParams.corpseBaseDecayPerSec),
      corpseTempDecayCoeff: Number(simulationParams.corpseTempDecayCoeff),
      corpseHumidityDecayCoeff: Number(simulationParams.corpseHumidityDecayCoeff),
      corpseRainDecayCoeff: Number(simulationParams.corpseRainDecayCoeff),
      corpseWetnessDecayCoeff: Number(simulationParams.corpseWetnessDecayCoeff),
    }
  }

  // Configurable simulation parameters
  const simulationParams = reactive({
    initialCreatures: 50,
    initialPlants: 300,
    plantSpawnRate: 0.2,
    waterLevel: 0.35,
    lifespanMultiplier: 1.0,
    mutationRate: 0.2,
    mutationAmount: 0.1,
    mutationRateAddLayer: 0.01,
    gestationPeriod: 200,
    reproductionEnergy: 80,
    showWeather: false,
    weatherOpacity: 0.4,
    instanceUpdateEvery: 1,
    instanceUpdateChunk: 500,
    // Additional throttles for renderer overlays and parity checks
    overlayUpdateEvery: 2,
    parityCheckEvery: 10,
    adaptivePerfEnabled: false,
    targetFps: 60,
    // Simulation speed multiplier (e.g., 0.25x, 0.5x, 1x, 2x, 4x)
    simulationSpeed: 1,
    // Brain input vector versioning (see inputs.md). 'v1' keeps legacy mapping; 'v2' uses env/time.
    inputsVersion: 'v2' as 'v1' | 'v2',
    // --- World Time controls (do NOT conflate with simulationSpeed) ---
    // Real seconds per world day (default 600s = 10 min/day)
    realSecondsPerDay: 600,
    // Independent multiplier for how fast world time flows relative to real time
    worldTimeScale: 1,
    // Starting day-of-year in [0, 1), e.g., 0 = day 0, 0.25 = spring
    startDayOfYear01: 0,
    followSelected: false,
    brainMode: 'Zegion' as 'OG' | 'Zegion',
    // Auto-continue control (UI toggle)
    autoContinueGenerations: true,
    // Debugging tools
    showVisionCones: true,
    visionFovDeg: 90,
    visionRange: 80,
    // Console logging gate
    debugLogging: true,
    // Feelings thresholds
    thirstThreshold: 30,
    hungerEnergyThreshold: 30,
    fatigueStaminaThreshold: 30,
    fearThreshold: 60,
    matingUrgeThreshold: 60,
    restlessTicks: 600,
    // Event sensitivity
    resourceDeltaEventThreshold: 0.1,
    painHealthDropThreshold: 0.05,
    // Action heuristics
    energyGainEatThreshold: 1.0,
    healthDropHitThreshold: 2.0,
    // Debugging tools
    showDebugOverlay: false,
    // Movement-based generation control
    movementThreshold: 0.02, // average |v| threshold
    stagnantTicksLimit: 600, // frames below threshold before culling (e.g., ~10s at 60 FPS)
    // Initial genetic variance (applied on spawn/reset for Gen 1)
    initialVarianceEnabled: true,
    initialVarianceAmount: 0.12, // +/- percentage for sightRange & FOV
    initialVarianceEyesDeltaProb: 0.25, // probability to +/- 1 eye
    initialVarianceEyeAnglesJitterDeg: 8, // per-eye central angle jitter
    // Diet-specific default vision baselines (used when genes don't specify)
    herbivoreFovDegDefault: 240,
    herbivoreSightRangeDefault: 90,
    carnivoreFovDegDefault: 150,
    carnivoreSightRangeDefault: 130,

    // --- Cost System Tunables (per-second unless noted) ---
    enableCostTelemetry: true,
    // Basal metabolism
    baseMetabolicCostPerSec: 0.08,
    sizeMetabolicCostPerSec: 0.04,
    brainMetabolicCostPerNeuronPerSec: 0.0008,
    visionMetabolicCostBasePerSec: 0.01,
    visionMetabolicCostPerEyePerSec: 0.005,
    visionMetabolicCostPer100RangePerSec: 0.008,
    visionMetabolicCostPer90FovPerSec: 0.006,
    // Locomotion/environment modifiers (hooks for WASM parity)
    swimEnergyCostPerSec: 0.0, // extra cost when waterDepth > 0
    windDragCoeff: 0.0, // scales with headwind * speed
    tempColdPenaltyPerSec: 0.0, // when tempC below comfortLowC
    tempHeatPenaltyPerSec: 0.0, // when tempC above comfortHighC
    comfortLowC: 5,
    comfortHighC: 30,
    humidityDehydrationCoeffPerSec: 0.0, // penalty when humidity below threshold
    humidityThreshold: 0.3,
    oxygenThinAirPenaltyPerSec: 0.0, // scales with elevation01 above cutoff
    thinAirElevationCutoff01: 0.7,
    noiseStressPenaltyPerSec: 0.0, // scales with weather.noise01
    diseaseEnergyDrainPerSec: 0.0, // placeholder constant drain

    // Locomotion core coefficients (referenced in energy model and WASM parity checks)
    moveCostCoeffPerSpeedPerSec: 0.05, // energy per unit speed per second
    turnCostCoeffPerRadPerSec: 0.01, // energy per radian turn per second
    accelerationCostCoeffPerAccelPerSec: 0.02, // energy per accel magnitude per second

    // --- Corpse decay tunables ---
    // Formula parity with WASM (see README Telemetry section):
    // base = max(0, corpseBaseDecayPerSec)
    // tempTerm = clamp((temperatureC - 20) / 15, 0, 2)
    // temp  = base * corpseTempDecayCoeff     * tempTerm
    // humid = base * corpseHumidityDecayCoeff * humidity01
    // rain  = base * corpseRainDecayCoeff     * precipitation01
    // wet   = base * corpseWetnessDecayCoeff  * wetness01
    // total = max(0, base + temp + humid + rain + wet)
    corpseBaseDecayPerSec: 0.02, // base fraction per second
    corpseTempDecayCoeff: 0.5, // scales with warm delta above 10C
    corpseHumidityDecayCoeff: 0.2, // scales with humidity01
    corpseRainDecayCoeff: 0.3, // scales with precipitation01
    corpseWetnessDecayCoeff: 0.2,
    sprintStaminaDrainPerSpeedPerSec: 0.12,
    sprintEnergyOverflowCoeff: 0.5,
    panicLocomotionCostMultiplier: 1.3,
    terrainCostMultiplierK: 1.0,
    minTerrainSpeedMult: 0.2,
    // Inaction posture maintenance (per-sec when idle and not resting)
    postureCostPerSec: 0.005,

    // Actions
    communicationCostPerBytePerSec: 0.001,
    glowCostPerUnitPerSec: 0.004,
    attackCostPerHitEnergy: 2.5,
    attackCostPerHitStamina: 10,
    mateActionCostPerAttemptEnergy: 1.2,
    mateActionCostPerAttemptStamina: 5,
    drinkCostPerSecond: 0.01,
    harvestPlantActionCostPerSecond: 0.015,
    scavengeCorpseActionCostPerSecond: 0.02,
    thirstRecoveryPerSec: 0.5,

    // Reproduction / Lifecycle
    gestationBaseCostPerSec: 0.02,
    gestationCostPerOffspringPerSec: 0.015,
    birthEventCostEnergy: 4.0,
    mutationCostEnergyBase: 0.5,
    mutationCostPerStdChange: 0.8,

    // Recovery
    restStaminaRegenPerSec: 0.15,
    restEnergyRegenCoeff: 0.2,
    restHealthRegenPerSec: 0.01,

    // Penalties and conversions
    starvationHealthLossPerNegEnergyPerSec: 0.02,
    collisionDamageHealthPerUnitImpulse: 0.1,
    dehydrationEnergyLossPerSec: 0.03,
    ambientHealthDecayPerSec: 0.002,
    agingHealthDecayCoeff: 0.5,

    // Diet-specific modifiers (optional)
    herbivoreSprintDrainMult: 0.9,
    herbivorePostureMult: 1.1,
    carnivoreSprintDrainMult: 1.1,
    carnivorePostureMult: 0.9,
  })

  // Apply small, configurable variance to initial vision phenotype (Gen 1 spawn)
  function applyInitialVisionVariance(base: {
    sightRange: number
    fieldOfViewDeg: number
    eyesCount: number
    eyeAnglesDeg: number[]
  }) {
    // Interpret initialVarianceAmount as standard deviation (fractional), use Gaussian N(0,1)
    const sigma = Math.max(0, Number(simulationParams.initialVarianceAmount) || 0)
    const eyesProb = Math.max(
      0,
      Math.min(1, Number(simulationParams.initialVarianceEyesDeltaProb) || 0),
    )
    const jitterSigmaDeg = Math.max(
      0,
      Number(simulationParams.initialVarianceEyeAnglesJitterDeg) || 0,
    )
    const gaussian = () => {
      // Box–Muller transform
      let u = 0,
        v = 0
      while (u === 0) u = Math.random()
      while (v === 0) v = Math.random()
      return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v)
    }
    // Symmetric multiplicative noise around baseline
    const sight = Math.max(5, base.sightRange * (1 + gaussian() * sigma))
    const fov = Math.max(10, Math.min(330, base.fieldOfViewDeg * (1 + gaussian() * sigma)))
    let eyes = Math.max(1, Math.min(6, Math.floor(base.eyesCount)))
    if (Math.random() < eyesProb)
      eyes = Math.max(1, Math.min(6, eyes + (Math.random() < 0.5 ? -1 : 1)))
    const half = fov / 2
    // Start from provided base angles if they match eyes; else evenly distribute
    const step = eyes > 1 ? fov / (eyes - 1) : 0
    let angles =
      Array.isArray(base.eyeAnglesDeg) && base.eyeAnglesDeg.length === eyes
        ? base.eyeAnglesDeg.slice()
        : eyes === 1
          ? [0]
          : Array.from({ length: eyes }, (_, i) => -half + i * step)
    if (jitterSigmaDeg > 0) {
      angles = angles.map((a) => {
        const j = gaussian() * jitterSigmaDeg
        return Math.max(-half, Math.min(half, a + j))
      })
    }
    // Normalize to mean 0 and clamp/sort for sanity
    const mean = angles.reduce((s, a) => s + a, 0) / Math.max(1, angles.length)
    angles = angles.map((a) => Math.max(-half, Math.min(half, a - mean)))
    angles.sort((a, b) => a - b)
    return { sightRange: sight, fieldOfViewDeg: fov, eyesCount: eyes, eyeAnglesDeg: angles }
  }

  // Zegion activation selection (UI overrides spec)
  const zegionActivations = reactive<{ hidden: ActivationName; output: ActivationName }>({
    hidden: 'relu',
    output: 'tanh',
  })
  const activationNames: ActivationName[] = ActivationRegistry.list()

  // Cloud persistence (JSONBin) config
  const jsonBin = reactive({
    binId: '',
    apiKeyPresent: typeof import.meta !== 'undefined' && !!import.meta.env?.VITE_JSONBIN_KEY,
  })

  // Internal: attempt to init WASM with timing diagnostics
  async function tryInitWasm(): Promise<boolean> {
    // Path matches temporary d.ts at src/types/wasm-ecosim.d.ts
    const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || ''
    const isTestEnv = /jsdom|node/i.test(ua)
    wasmDiag.ua = ua
    wasmDiag.isTestEnv = isTestEnv
    wasmDiag.attempts += 1
    wasmDiag.lastAttemptAt = Date.now()
    wasmDiag.tStart = (
      typeof performance !== 'undefined' ? performance.now() : Date.now()
    ) as number

    if (isTestEnv) return false
    try {
      wasmDiag.initTried = true
      const [mod, wasmUrlMod] = await Promise.all([
        import('@/wasm/ecosim/pkg/ecosim'),
        import('@/wasm/ecosim/pkg/ecosim_bg.wasm?url'),
      ])
      const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now()) as number
      // Ensure wasm module is initialized before using exports
      const modDefault = (mod as { default?: unknown }).default
      if (typeof modDefault === 'function') {
        try {
          const wasmUrl = (wasmUrlMod as { default?: string | undefined })?.default
          console.debug('[WASM] init with URL:', wasmUrl)
          wasmDiag.url = wasmUrl ?? null
          wasmDiag.initUrlTried = true
          // Prefer new object-form init first
          try {
            await (modDefault as (arg?: unknown) => Promise<unknown>)({ module_or_path: wasmUrl })
            wasmDiag.initUrlOk = true
          } catch {
            // Fallback to deprecated positional url
            await (modDefault as (arg?: unknown) => Promise<unknown>)(wasmUrl)
            wasmDiag.initUrlOk = true
          }
          wasmDiag.tInitUrlMs =
            ((typeof performance !== 'undefined' ? performance.now() : Date.now()) as number) - t0
        } catch (initErr) {
          console.warn('[WASM] init(url) failed; trying no-arg init()', initErr)
          const t1 = (typeof performance !== 'undefined' ? performance.now() : Date.now()) as number
          try {
            wasmDiag.initNoArgTried = true
            // Prefer object-form no-arg as well
            try {
              await (modDefault as (arg?: unknown) => Promise<unknown>)({})
              wasmDiag.initNoArgOk = true
            } catch {
              await (modDefault as (arg?: unknown) => Promise<unknown>)()
              wasmDiag.initNoArgOk = true
            }
          } catch (initErr2) {
            console.warn('[WASM] no-arg init() also failed', initErr2)
          } finally {
            wasmDiag.tInitNoArgMs =
              ((typeof performance !== 'undefined' ? performance.now() : Date.now()) as number) - t1
          }
        }
      }
      const t2 = (typeof performance !== 'undefined' ? performance.now() : Date.now()) as number
      const WorldCtorUnknown = (mod as { World?: unknown }).World
      if (typeof WorldCtorUnknown === 'function') {
        // Constructor signature (w, h, seed)
        type WorldCtor = new (w: number, h: number, seed: number) => WasmWorld
        wasmWorld = new (WorldCtorUnknown as WorldCtor)(2000, 2000, Date.now() % 0xffff_ffff)
      } else {
        throw new Error('WASM World constructor not available')
      }
      wasmStatus.available = true
      // One-time emission for diagnostics/UI hooks
      if (!wasmReadyEmitted) {
        wasmReadyEmitted = true
        try {
          console.info('[WASM] Ready')
        } catch {}
        if (typeof window !== 'undefined') {
          try {
            window.dispatchEvent(
              new CustomEvent('wasm-ready', { detail: { ts: Date.now() } }),
            )
          } catch {}
        }
      }
      wasmDiag.createdWorld = true
      wasmDiag.tWorldMs =
        ((typeof performance !== 'undefined' ? performance.now() : Date.now()) as number) - t2
      wasmDiag.tTotalMs =
        ((typeof performance !== 'undefined' ? performance.now() : Date.now()) as number) -
        wasmDiag.tStart
      // Ensure WASM world's brain mode matches UI/store selection
      try {
        if (wasmWorld && typeof wasmWorld.set_brain_mode === 'function') {
          wasmWorld.set_brain_mode(simulationParams.brainMode)
        }
      } catch (e) {
        console.warn('[WASM] set_brain_mode call failed during init', e)
      }
      if (wasmWorld && typeof wasmWorld.set_config === 'function') {
        wasmWorld.set_config(buildWasmConfig())
      }
      return true
    } catch (error) {
      console.error('[WASM] Failed to initialize (import/init):', error)
      wasmStatus.available = false
      wasmStatus.lastError = String(error)
      wasmDiag.tTotalMs =
        ((typeof performance !== 'undefined' ? performance.now() : Date.now()) as number) -
        wasmDiag.tStart
      return false
    }
  }

  async function initialize() {
    await tryInitWasm()
    // Load Zegion spec for JS fallback sizing
    try {
      zegionSpec = await getZegionSpec()
      // initialize UI activation overrides from spec
      if (zegionSpec?.activations) {
        const h = zegionSpec.activations.hidden
        const o = zegionSpec.activations.output
        if (h && (activationNames as readonly string[]).includes(h)) {
          zegionActivations.hidden = h as ActivationName
        }
        if (o && (activationNames as readonly string[]).includes(o)) {
          zegionActivations.output = o as ActivationName
        }
      }
    } catch {
      zegionSpec = { architecture: [24, 16, 6] }
    }
    // Watch relevant cost params and keep WASM config in sync
    try {
      const keys: (keyof typeof simulationParams)[] = [
        'restStaminaRegenPerSec',
        'restHealthRegenPerSec',
        'harvestPlantActionCostPerSecond',
        'attackCostPerHitStamina',
        'sprintEnergyOverflowCoeff',
        'postureCostPerSec',
        'attackCostPerHitEnergy',
        'thirstThreshold',
        'thirstRecoveryPerSec',
        'drinkCostPerSecond',
        'moveCostCoeffPerSpeedPerSec',
        'ambientHealthDecayPerSec',
        'agingHealthDecayCoeff',
        'gestationBaseCostPerSec',
        'gestationCostPerOffspringPerSec',
        'gestationPeriod',
        'birthEventCostEnergy',
        'mutationCostEnergyBase',
        'mutationCostPerStdChange',
        // Telemetry thresholds
        'hungerEnergyThreshold',
        'fatigueStaminaThreshold',
        'movementThreshold',
        'stagnantTicksLimit',
        // Environmental cost tunables
        'swimEnergyCostPerSec',
        'windDragCoeff',
        'tempColdPenaltyPerSec',
        'tempHeatPenaltyPerSec',
        'comfortLowC',
        'comfortHighC',
        'humidityDehydrationCoeffPerSec',
        'humidityThreshold',
        'oxygenThinAirPenaltyPerSec',
        'thinAirElevationCutoff01',
        'noiseStressPenaltyPerSec',
        'diseaseEnergyDrainPerSec',
        // Corpse decay tunables
        'corpseBaseDecayPerSec',
        'corpseTempDecayCoeff',
        'corpseHumidityDecayCoeff',
        'corpseRainDecayCoeff',
        'corpseWetnessDecayCoeff',
      ] as Array<keyof typeof simulationParams>
      watch(
        () => keys.map((k) => simulationParams[k]),
        () => {
          try {
            if (wasmWorld && typeof wasmWorld.set_config === 'function') {
              wasmWorld.set_config(buildWasmConfig())
            }
          } catch (e) {
            console.warn('[WASM] set_config failed in watcher', e)
          }
        },
        { deep: false },
      )
    } catch {}

    // Load default bad brain hashes preferring dev API; fallback to public asset
    try {
      let arr: string[] | null = null
      try {
        const apiRes = await fetch('/api/bad-brains', { cache: 'no-store' })
        if (apiRes.ok) arr = (await apiRes.json()) as string[]
      } catch {}
      if (!Array.isArray(arr)) {
        try {
          const res = await fetch('/bad-brains.json', { cache: 'no-store' })
          if (res.ok) arr = (await res.json()) as string[]
        } catch {}
      }
      if (Array.isArray(arr)) {
        for (const h of arr) badBrainHashes[h] = true
        // Inform WASM of initial list
        syncBadBrainsToWasm()
      }
    } catch {}
    // Seed the world and autostart the simulation on first load
    // Ensures creatures/plants are visible and RAF begins without user interaction
    try {
      resetSimulation(true)
    } catch (e) {
      console.warn('[Sim] initialize() resetSimulation failed', e)
    }
  }

  // Public: retry WASM initialization at runtime
  async function retryWasmInit() {
    // Reset flags for a cleaner subsequent attempt
    wasmDiag.initTried = false
    wasmDiag.initUrlTried = false
    wasmDiag.initUrlOk = false
    wasmDiag.initNoArgTried = false
    wasmDiag.initNoArgOk = false
    wasmDiag.createdWorld = false
    wasmDiag.tInitUrlMs = 0
    wasmDiag.tInitNoArgMs = 0
    wasmDiag.tWorldMs = 0
    wasmDiag.tTotalMs = 0
    const ok = await tryInitWasm()
    if (ok) {
      // Preserve current running state on re-init
      const wasRunning = isRunning.value
      resetSimulation(wasRunning)
    }
    return ok
  }

  // Simulation control functions
  function startSimulation() {
    isRunning.value = true
  }

  function stopSimulation() {
    isRunning.value = false
    // Signal renderers to stop RAF immediately
    rafHaltToken.value++
  }

  function computeVisionPhenotypeGlobal(
    genes: VisionGeneBag,
    diet?: 'Herbivore' | 'Carnivore',
  ) {
    // Choose diet-aware defaults if provided; else fall back to global sliders
    const isCarn = diet === 'Carnivore'
    const vrDefault = isCarn
      ? Number(simulationParams.carnivoreSightRangeDefault) ||
        Number(simulationParams.visionRange) ||
        80
      : Number(simulationParams.herbivoreSightRangeDefault) ||
        Number(simulationParams.visionRange) ||
        80
    const fovDefault = isCarn
      ? Number(simulationParams.carnivoreFovDegDefault) ||
        Number(simulationParams.visionFovDeg) ||
        90
      : Number(simulationParams.herbivoreFovDegDefault) ||
        Number(simulationParams.visionFovDeg) ||
        90
    // Decode allele-style genes if provided (OG-like):
    // - Sight range allele: genes.V is array like ['V','v']; 'V' dominant => 150, else 75
    // - FOV allele: genes.E is array like ['E','e']; 'E' dominant => 270, else 180
    let alleleSight: number | undefined
    try {
      const V = Array.isArray(genes?.V) ? genes.V : undefined
      if (V && V.some((a: string) => String(a).toUpperCase() === 'V')) alleleSight = 150
      else if (V && V.every((a: string) => String(a).toLowerCase() === 'v')) alleleSight = 75
    } catch {}
    let alleleFov: number | undefined
    try {
      const E = Array.isArray(genes?.E) ? genes.E : undefined
      if (E && E.some((a: string) => String(a).toUpperCase() === 'E')) alleleFov = 270
      else if (E && E.every((a: string) => String(a).toLowerCase() === 'e')) alleleFov = 180
    } catch {}

    const sightRange =
      typeof genes?.sightRange === 'number'
        ? genes.sightRange
        : typeof alleleSight === 'number'
          ? alleleSight
          : vrDefault

    const fieldOfViewDeg =
      typeof genes?.fieldOfViewDeg === 'number'
        ? genes.fieldOfViewDeg
        : typeof alleleFov === 'number'
          ? alleleFov
          : fovDefault

    const eyes = Math.max(1, Math.min(6, Math.floor(genes?.eyesCount ?? 2))) || 2
    // Compute per-eye central angles with diet-aware defaults
    const half = fieldOfViewDeg / 2
    let eyeAnglesDeg: number[] = []
    if (eyes === 1) {
      eyeAnglesDeg = [0]
    } else {
      const isCarn = diet === 'Carnivore'
      // Default evenly distributed across FOV
      const step = eyes > 1 ? fieldOfViewDeg / (eyes - 1) : 0
      eyeAnglesDeg = Array.from({ length: eyes }, (_, i) => -half + i * step)
      // Diet-specific tweaks for common cases
      if (eyes === 2) {
        if (isCarn) {
          const a = Math.min(half, 15)
          eyeAnglesDeg = [-a, a]
        } else {
          const a = Math.min(half, 90)
          eyeAnglesDeg = [-a, a]
        }
      } else if (eyes === 3) {
        if (isCarn) {
          const a = Math.min(half, 20)
          eyeAnglesDeg = [-a, 0, a]
        } // herbivores keep wide spread defaults
      }
    }
    return { sightRange, fieldOfViewDeg, eyesCount: eyes, eyeAnglesDeg }
  }

  function resetSimulation(autoStart: boolean = true) {
    // Halt updates during reset to avoid mid-frame mutations
    isRunning.value = false
    // Ensure any RAF loop cancels synchronously
    rafHaltToken.value++
    // Preserve previous names to keep stability across resets
    const prevNames = new Map<string, string>()
    try {
      for (const c of creatures.value) prevNames.set(c.id, c.name)
    } catch {}
    creatures.value = []
    plants.value = []
    corpses.value = []
    hallOfFameGen.value = []
    // Start timestamp for the new generation
    currentGenStartTs.value = Date.now()
    // Clear per-creature events
    for (const k of Object.keys(creatureEvents)) delete creatureEvents[k]
    // If WASM is available, rebuild state from it; else fall back to JS
    if (wasmWorld) {
      try {
        const wc: Array<Record<string, unknown>> = wasmWorld.creatures_json?.() ?? []
        const wp: Array<Record<string, unknown>> = wasmWorld.plants_json?.() ?? []
        const wco: Array<Record<string, unknown>> = wasmWorld.corpses_json?.() ?? []
        // If WASM did not seed a new population, seed it here and resync
        let newWc = wc
        let newWp = wp
        try {
          if ((!Array.isArray(newWc) || newWc.length === 0) && typeof wasmWorld.spawn_creature === 'function') {
            for (let i = 0; i < (simulationParams.initialCreatures || 0); i++) {
              const x = Math.random() * 2000
              const y = Math.random() * 2000
              wasmWorld.spawn_creature(x, y)
            }
            newWc = wasmWorld.creatures_json?.() ?? []
          }
          if ((!Array.isArray(newWp) || newWp.length === 0) && typeof wasmWorld.spawn_plant === 'function') {
            for (let i = 0; i < (simulationParams.initialPlants || 0); i++) {
              const x = Math.random() * 2000
              const y = Math.random() * 2000
              wasmWorld.spawn_plant(x, y, 3)
            }
            newWp = wasmWorld.plants_json?.() ?? []
          }
        } catch {}
        creatures.value = newWc.map((c: Record<string, unknown>) => {
          const r = c || {}
          const diet = r.diet === 'Carnivore' ? 'Carnivore' : 'Herbivore'
          const visionBase = computeVisionPhenotypeGlobal((r.genes as Record<string, unknown>) || {}, diet)
          const varied =
            generation.value === 1 && simulationParams.initialVarianceEnabled
              ? applyInitialVisionVariance(visionBase)
              : visionBase
          return {
            id: String(r.id ?? crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)),
            name: nameSvc.assignName(String(r.id ?? ''), prevNames.get(String(r.id ?? '')) || undefined),
            x: Number(r.x ?? 0),
            y: Number(r.y ?? 0),
            vx: Number(r.vx ?? 0),
            vy: Number(r.vy ?? 0),
            energy: Number((r as Record<string, unknown>).energy ?? 100),
            thirst: 100,
            stamina: 100,
            health: Number((r as Record<string, unknown>).health ?? 100),
            sDrive: 0,
            fear: 0,
            lifespan: Number((r as Record<string, unknown>).lifespan ?? 0),
            isPregnant: false,
            gestationTimer: 0,
            childGenes: null,
            genes: (r.genes as Record<string, unknown>) || {},
            phenotype: {
              size: 1.0,
              speed: 2.0,
              diet,
              sightRange: varied.sightRange,
              fieldOfViewDeg: varied.fieldOfViewDeg,
              eyesCount: varied.eyesCount,
              eyeAnglesDeg: varied.eyeAnglesDeg,
            },
            brain: (r as Record<string, unknown>).brain
              ? (() => {
                  const b = (r as Record<string, unknown>).brain as
                    | (Record<string, unknown> & {
                        layer_sizes?: number[]
                        layerSizes?: number[]
                        weights?: number[][]
                        biases?: number[][]
                        activations?: number[][]
                      })
                    | undefined
                  const ls = (b?.layer_sizes ?? b?.layerSizes ?? [14, 8, 8]) as number[]
                  const acts = (b?.activations ?? undefined) as number[][] | undefined
                  const weights = (b?.weights ?? undefined) as number[][] | undefined
                  const biases = (b?.biases ?? undefined) as number[][] | undefined
                  const output =
                    Array.isArray(acts) && acts.length > 0 ? acts[acts.length - 1] : undefined
                  return { layerSizes: ls, weights, biases, activations: acts, output }
                })()
              : {
                  layerSizes: computeLayerSizesForCreature(),
                },
            radius: Number((r as Record<string, unknown>).radius ?? 5),
            maxStamina: 100,
            communicationColor: { r: 255, g: 180, b: 255 },
            isResting: false,
            isSprinting: false,
          } as Creature
        })
        plants.value = newWp.map((p: Record<string, unknown>) => {
          const pr = p || {}
          return {
            x: Number(pr.x ?? 0),
            y: Number(pr.y ?? 0),
            radius: Number((pr as Record<string, unknown>).radius ?? 3),
          }
        })
        corpses.value = (wco ?? []).map((co: Record<string, unknown>) => {
          const cr = co || {}
          return {
            x: Number(cr.x ?? 0),
            y: Number(cr.y ?? 0),
            radius: Number((cr as Record<string, unknown>).radius ?? 3),
            energyRemaining: Number(
              (cr as Record<string, unknown>).energy_remaining ??
                (cr as Record<string, unknown>).energy ??
                0,
            ),
            initialDecayTime: Number((cr as Record<string, unknown>).initial_decay_time ?? 100),
            decayTimer: Number((cr as Record<string, unknown>).decay_timer ?? 100),
          }
        })
      } catch {
        console.warn('Failed to initialize from WASM, using JS fallback')
        initJsFallback()
      }
    } else {
      initJsFallback()
    }

    // Start the simulation if requested
    if (autoStart) startSimulation()
  }

  async function endGeneration(reason: string = 'stagnation') {
    stopSimulation()
    try {
      // Classify bad brains (below top 25% lifespan) for this run
      classifyBadBrainsFromCache()
      // Inform WASM of updated list
      syncBadBrainsToWasm()
      // Best-effort: push updated hashes to dev API so they persist to public/bad-brains.json
      try {
        const hashes = Object.keys(badBrainHashes)
        await fetch('/api/bad-brains', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(hashes),
        })
      } catch {}
      // Trim brain cache before snapshot to keep it bounded similar to OG
      trimCache(brainCache, 5000, 0.2)
      await saveGenerationSnapshot(reason)
    } catch (e) {
      console.warn('Failed to save generation snapshot', e)
    }
    // Record info about the generation that just ended before incrementing
    // Snapshot params used during this generation for delta displays
    try {
      lastGenParams.value = { ...simulationParams }
    } catch {}
    lastGenEnd.value = { gen: generation.value, reason, timestamp: Date.now() }
    generation.value += 1
    stagnantTicks.value = 0
    movementStats.avgSpeed = 0
    // Respect auto-continue setting
    resetSimulation(!!simulationParams.autoContinueGenerations)
    // Bump token to notify UI listeners
    genEndToken.value++
  }

  function initJsFallback() {
    creatures.value = []
    plants.value = []
    corpses.value = []

    for (let i = 0; i < simulationParams.initialCreatures; i++) {
      const x = Math.random() * 2000
      const y = Math.random() * 2000
      const genes: Record<string, [string, string]> = {}
      // Choose diet first so vision defaults can be diet-aware
      const diet = Math.random() > 0.8 ? 'Carnivore' : 'Herbivore'
      // Base phenotype from defaults/genes, then apply configurable initial variance
      const baseVision = computeVisionPhenotypeGlobal(genes, diet)
      const vision =
        generation.value === 1 && simulationParams.initialVarianceEnabled
          ? applyInitialVisionVariance(baseVision)
          : baseVision
      const id = Math.random().toString(36).substring(2, 9)
      const name = nameSvc.assignName(id)
      creatures.value.push({
        id,
        name,
        x,
        y,
        vx: Math.random() * 2 - 1,
        vy: Math.random() * 2 - 1,
        energy: 100,
        thirst: 100,
        stamina: 100,
        health: 100,
        sDrive: 0,
        fear: 0,
        lifespan: 0,
        isPregnant: false,
        gestationTimer: 0,
        childGenes: null,
        genes,
        phenotype: {
          size: 1.0,
          speed: 2.0,
          diet,
          sightRange: vision.sightRange,
          fieldOfViewDeg: vision.fieldOfViewDeg,
          eyesCount: vision.eyesCount,
          eyeAnglesDeg: vision.eyeAnglesDeg,
        },
        brain: createGoodBrain(computeLayerSizesForCreature(), rngBrain),
        radius: 5,
        maxStamina: 100,
        communicationColor: { r: 255, g: 180, b: 255 },
        isResting: false,
        isSprinting: false,
      })
    }
    for (let i = 0; i < simulationParams.initialPlants; i++) {
      plants.value.push({ x: Math.random() * 2000, y: Math.random() * 2000, radius: 3 })
    }
  }

  // Advance a simple JS simulation step (placeholder until WASM is integrated)
  function update(dt: number = 1 / 60) {
    if (!isRunning.value) {
      if (debugSkipCounter++ % 120 === 0) console.debug('[Sim] Skipped: not running')
      return
    }
    // Apply speed multiplier with substeps for stability when >1x
    const speed = Math.max(0, Number(simulationParams.simulationSpeed) || 0)
    if (speed === 0) {
      if (debugSkipCounter++ % 120 === 0) console.debug('[Sim] Skipped: speed=0')
      return
    }
    const estSteps = Math.max(1, Math.floor(speed))
    const steps = Math.min(16, estSteps)
    const effDt = (dt * speed) / steps
    if (debugSkipCounter++ % 240 === 0 && steps > 1) {
      console.debug('[Sim] Substeps', { steps, effDt: Number(effDt.toFixed(4)) })
    }

    // Parity diagnostics throttle
    const checkEvery = Math.max(1, Number(simulationParams.parityCheckEvery) || 1)
    const doParity = (parityFrame++ % checkEvery) === 0

    // Reset parity stats only on throttled frames
    if (doParity) {
      try {
        parityStats.env.mismatches = 0
        parityStats.env.maxRelDiff = 0
        for (const k of Object.keys(parityStats.env.compMaxRel)) parityStats.env.compMaxRel[k] = 0
        parityStats.corpse.mismatches = 0
        parityStats.corpse.maxRelDiff = 0
        for (const k of Object.keys(parityStats.corpse.compMaxRel)) parityStats.corpse.compMaxRel[k] = 0
      } catch (e) {
        console.warn('Failed to reset parity stats', e)
      }
    }

    for (let stepIdx = 0; stepIdx < steps; stepIdx++) {
      if (wasmWorld) {
        // Advance the WASM world and merge positional data into our creatures
        try {
          if (wasmWorld?.step) wasmWorld.step(effDt)
          // Local structural types for WASM JSON payloads (creature type removed if unused)
          type WasmEnvCost = {
            id: string
            envTotal?: number
            envSwim?: number
            envWind?: number
            envCold?: number
            envHeat?: number
            envHumid?: number
            envOxy?: number
            envNoise?: number
            envDisease?: number
            locomotion?: number
          }
          type WasmCorpseCost = {
            id: string
            total?: number
            base?: number
            temp?: number
            humid?: number
            rain?: number
            wet?: number
          }

          if (!wasmWorld) return
          const ww = wasmWorld as WasmWorld
          const wasmCreaturesRaw: Array<Record<string, unknown>> = ww.creatures_json()
          // Pull minimal environmental cost telemetry from WASM (optional method)
          const wasmEnvCosts: WasmEnvCost[] =
            typeof wasmWorld.env_costs_json === 'function' ? (wasmWorld.env_costs_json() as WasmEnvCost[]) : []
          const envById = new Map<string, WasmEnvCost>(
            Array.isArray(wasmEnvCosts) ? wasmEnvCosts.map((e: WasmEnvCost) => [e.id, e]) : [],
          )
          // Detect deaths by diffing previous vs new IDs
          const prevById = new Map<string, Creature>()
          for (const c of creatures.value) prevById.set(c.id, c)
          // Build nextCreatures from unknown-safe WASM JSON
          const nextCreatures: Creature[] = wasmCreaturesRaw.map((wc: Record<string, unknown>): Creature => {
            const wr = wc || {}
            const id = String(wr.id ?? crypto.randomUUID?.() ?? Math.random().toString(36).slice(2))
            const diet: 'Herbivore' | 'Carnivore' = wr.diet === 'Carnivore' ? 'Carnivore' : 'Herbivore'
            const genes = (wr.genes ?? {}) as VisionGeneBag
            const vp = computeVisionPhenotypeGlobal(genes, diet)
            return {
              id,
              name: nameSvc.assignName(id),
              x: Number(wr.x ?? 0),
              y: Number(wr.y ?? 0),
              vx: Number(wr.vx ?? 0),
              vy: Number(wr.vy ?? 0),
              energy: Number((wr as Record<string, unknown>).energy ?? 100),
              thirst: Number((wr as Record<string, unknown>).thirst ?? 100),
              stamina: Number((wr as Record<string, unknown>).stamina ?? 100),
              health: Number((wr as Record<string, unknown>).health ?? 100),
              sDrive: 0,
              fear: 0,
              lifespan: Number((wr as Record<string, unknown>).lifespan ?? 0),
              isPregnant: false,
              gestationTimer: 0,
              childGenes: null,
              genes,
              phenotype: {
                size: 1.0,
                speed: 2.0,
                diet,
                sightRange: vp.sightRange,
                fieldOfViewDeg: vp.fieldOfViewDeg,
                eyesCount: vp.eyesCount,
                eyeAnglesDeg: vp.eyeAnglesDeg,
              },
            } as Creature
          })
          // Plants and corpses
          const wasmPlantsRaw: Array<Record<string, unknown>> = ww.plants_json()
          const wasmCorpsesRaw: Array<Record<string, unknown>> =
            typeof wasmWorld.corpses_json === 'function' ? wasmWorld.corpses_json() : []
          // Update HoF and brain cache for those that disappeared
          try {
            const aliveIds = new Set(nextCreatures.map((c) => c.id))
            for (const [pid, prev] of prevById.entries()) {
              if (!aliveIds.has(pid)) {
                // Prepare brain JSON for hashing and caching
                type BrainJSON = { layerSizes: number[]; weights: number[][]; biases: number[][] }
                const b = prev.brain
                const brainJSON: BrainJSON | null =
                  b &&
                  Array.isArray(b.layerSizes) &&
                  Array.isArray(b.weights) &&
                  Array.isArray(b.biases)
                    ? {
                        layerSizes: b.layerSizes as number[],
                        weights: b.weights as number[][],
                        biases: b.biases as number[][],
                      }
                    : null
                const hofId = brainJSON ? simpleHash(JSON.stringify(brainJSON)) : String(prev.id)
                // Record to per-generation HoF with stable brain-hash id and last liveId for UI focus
                const entry = {
                  id: hofId,
                  liveId: String(prev.id),
                  name: prev.name,
                  lifespan: prev.lifespan,
                  gen: generation.value,
                }
                hallOfFameGen.value.push(entry)
                // Update cumulative HoF: keep max lifespan per brain id
                const idx = hallOfFameAll.value.findIndex((e) => e.id === entry.id)
                if (idx === -1) {
                  hallOfFameAll.value.push({ ...entry })
                } else if ((hallOfFameAll.value[idx].lifespan || 0) < entry.lifespan) {
                  hallOfFameAll.value[idx] = { ...entry }
                }
                // Telemetry: deaths counter
                telemetry.totals.deaths++
                // Also memoize brain in cache using lifespan as score
                if (brainJSON) {
                  const h = hofId
                  const existing = brainCache[h]
                  if (!existing || existing.score < prev.lifespan) {
                    brainCache[h] = {
                      score: prev.lifespan,
                      brain: brainJSON,
                      genes: prev.genes || {},
                    }
                  }
                }
              }
            }
          } catch {}
          // In-place reconcile creatures to avoid replacing the reactive array each frame
          {
            const cur = creatures.value
            const curById = new Map<string, Creature>()
            for (const c of cur) curById.set(c.id, c)
            const seen = new Set<string>()
            for (const nc of nextCreatures) {
              const ex = curById.get(nc.id)
              if (ex) {
                // Shallow merge to update fields while preserving refs used by Vue/renderer
                Object.assign(ex, nc)
              } else {
                cur.push(nc)
              }
              seen.add(nc.id)
            }
            // Remove creatures that disappeared
            for (let i = cur.length - 1; i >= 0; i--) {
              if (!seen.has(cur[i].id)) cur.splice(i, 1)
            }
          }
          // Debug parity check: ensure envTotal ~= sum of components from WASM telemetry
          if (
            simulationParams.enableCostTelemetry &&
            simulationParams.debugLogging &&
            envById.size &&
            doParity
          ) {
            const sample = nextCreatures.slice(0, 5)
            // Local accumulators for this frame (written back to parityStats after checks)
            let envMismatchCount = 0
            let envMaxRel = 0
            const envCompMax: Record<string, number> = {
              envSwim: 0,
              envWind: 0,
              envCold: 0,
              envHeat: 0,
              envHumid: 0,
              envOxy: 0,
              envNoise: 0,
              envDisease: 0,
              locomotion: 0,
            }
            const tolAbs = 1e-4
            const tolRel = 0.01
            for (const c of sample) {
              const w = envById.get(c.id)
              if (!w) continue
              const parts = [
                Number(w.envSwim ?? 0),
                Number(w.envWind ?? 0),
                Number(w.envCold ?? 0),
                Number(w.envHeat ?? 0),
                Number(w.envHumid ?? 0),
                Number(w.envOxy ?? 0),
                Number(w.envNoise ?? 0),
                Number(w.envDisease ?? 0),
              ]
              const sum = parts.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0)
              const total = Number(w.envTotal ?? 0)
              const absDiff = Math.abs(sum - total)
              const relDiff = total !== 0 ? absDiff / Math.abs(total) : absDiff
              const bad =
                !Number.isFinite(total) ||
                parts.some((p) => !Number.isFinite(p)) ||
                (absDiff > tolAbs && relDiff > tolRel)
              if (bad) {
                console.debug('[WASM EnvCost Validator]', {
                  id: c.id,
                  total,
                  sum,
                  absDiff: Number(absDiff.toFixed(6)),
                  relDiff: Number(relDiff.toFixed(6)),
                  parts: {
                    swim: parts[0],
                    wind: parts[1],
                    cold: parts[2],
                    heat: parts[3],
                    humid: parts[4],
                    oxy: parts[5],
                    noise: parts[6],
                    disease: parts[7],
                  },
                })
                envMismatchCount++
                envMaxRel = Math.max(envMaxRel, Number.isFinite(relDiff) ? relDiff : 0)
              }
            }
            // JS recomputation mirror of Rust formulas (now including a swim heuristic)
            for (const c of sample) {
              const wasm = envById.get(c.id)
              if (!wasm) continue
              const wthr = sampleWeather(c.x, c.y)
              const terr = sampleTerrain(c.x, c.y)
              const speedMag = Math.hypot(c.vx ?? 0, c.vy ?? 0)
              const jsWind =
                Number(simulationParams.windDragCoeff) * (wthr.windSpeed ?? 0) * speedMag
              const coldDelta = Math.max(
                0,
                Number(simulationParams.comfortLowC) - (wthr.temperatureC ?? 0),
              )
              const jsCold = (Number(simulationParams.tempColdPenaltyPerSec) * coldDelta) / 10
              const heatDelta = Math.max(
                0,
                (wthr.temperatureC ?? 0) - Number(simulationParams.comfortHighC),
              )
              const jsHeat = (Number(simulationParams.tempHeatPenaltyPerSec) * heatDelta) / 10
              const humidEx = Math.max(
                0,
                (wthr.humidity01 ?? 0) - Number(simulationParams.humidityThreshold),
              )
              const jsHumid = Number(simulationParams.humidityDehydrationCoeffPerSec) * humidEx
              const oxyEx = Math.max(
                0,
                (terr.elevation01 ?? 0) - Number(simulationParams.thinAirElevationCutoff01),
              )
              const jsOxy = Number(simulationParams.oxygenThinAirPenaltyPerSec) * oxyEx
              const jsNoise =
                Number(simulationParams.noiseStressPenaltyPerSec) * (wthr.noise01 ?? 0)
              const jsDisease = Number(simulationParams.diseaseEnergyDrainPerSec)
              // Swim heuristic parity with WASM: treat top/bottom world bands as water
              // World height is 2000 in both JS fallback and WASM world creation
              const worldHeight = 2000
              const inWater = (c.y ?? 0) < worldHeight * 0.12 || (c.y ?? 0) > worldHeight * 0.88
              const jsSwim = inWater ? Number(simulationParams.swimEnergyCostPerSec) : 0
              const comps: Array<[string, number, number]> = [
                ['envSwim', Number(wasm.envSwim ?? 0), jsSwim],
                ['envWind', Number(wasm.envWind ?? 0), jsWind],
                ['envCold', Number(wasm.envCold ?? 0), jsCold],
                ['envHeat', Number(wasm.envHeat ?? 0), jsHeat],
                ['envHumid', Number(wasm.envHumid ?? 0), jsHumid],
                ['envOxy', Number(wasm.envOxy ?? 0), jsOxy],
                ['envNoise', Number(wasm.envNoise ?? 0), jsNoise],
                ['envDisease', Number(wasm.envDisease ?? 0), jsDisease],
              ]
              for (const [name, wv, jv] of comps) {
                const diff = Math.abs(wv - jv)
                const rel =
                  Math.max(Math.abs(wv), 1e-6) > 0 ? diff / Math.max(Math.abs(wv), 1e-6) : diff
                const badComp = diff > tolAbs && rel > tolRel
                if (badComp) {
                  console.debug('[WASM EnvCost JS-Recompute]', {
                    id: c.id,
                    comp: name,
                    wasm: Number(wv.toFixed(6)),
                    js: Number(jv.toFixed(6)),
                    absDiff: Number(diff.toFixed(6)),
                    relDiff: Number(rel.toFixed(6)),
                  })
                  envMismatchCount++
                }
                envMaxRel = Math.max(envMaxRel, Number.isFinite(rel) ? rel : 0)
                if (envCompMax[name] !== undefined)
                  envCompMax[name] = Math.max(envCompMax[name], Number.isFinite(rel) ? rel : 0)
              }
              // Locomotion parity check
              const jsLoc = Number(simulationParams.moveCostCoeffPerSpeedPerSec) * speedMag
              const wLoc = Number(wasm.locomotion ?? 0)
              const dLoc = Math.abs(jsLoc - wLoc)
              const rLoc = wLoc !== 0 ? dLoc / Math.abs(wLoc) : dLoc
              if (dLoc > tolAbs && rLoc > tolRel) {
                console.debug('[WASM Locomotion JS-Recompute]', {
                  id: c.id,
                  wasm: Number(wLoc.toFixed(6)),
                  js: Number(jsLoc.toFixed(6)),
                  absDiff: Number(dLoc.toFixed(6)),
                  relDiff: Number(rLoc.toFixed(6)),
                })
                envMismatchCount++
              }
              envMaxRel = Math.max(envMaxRel, Number.isFinite(rLoc) ? rLoc : 0)
              envCompMax.locomotion = Math.max(
                envCompMax.locomotion,
                Number.isFinite(rLoc) ? rLoc : 0,
              )
            }
            // Write back env parity accumulators
            parityStats.env.mismatches = envMismatchCount
            parityStats.env.maxRelDiff = envMaxRel
            for (const k of Object.keys(envCompMax)) parityStats.env.compMaxRel[k] = envCompMax[k]
          }
          // sync plants (index-based in-place updates)
          {
            const pv = plants.value
            const n = wasmPlantsRaw.length
            const m = Math.min(pv.length, n)
            for (let i = 0; i < m; i++) {
              const p = wasmPlantsRaw[i]
              const tgt = pv[i]
              tgt.x = Number(p.x ?? 0)
              tgt.y = Number(p.y ?? 0)
              tgt.radius = Number((p as Record<string, unknown>).radius ?? 3)
            }
            if (n > pv.length) {
              for (let i = pv.length; i < n; i++) {
                const p = wasmPlantsRaw[i]
                pv.push({
                  x: Number(p.x ?? 0),
                  y: Number(p.y ?? 0),
                  radius: Number((p as Record<string, unknown>).radius ?? 3),
                })
              }
            } else if (n < pv.length) {
              pv.splice(n)
            }
          }
          // sync corpses and attach telemetry when available
          const corpseCostsRaw: unknown[] =
            typeof (wasmWorld as unknown as { corpse_costs_json?: () => unknown[] }).corpse_costs_json === 'function'
              ? ((wasmWorld as unknown as { corpse_costs_json: () => unknown[] }).corpse_costs_json() as unknown[])
              : []
          const corpseCosts = Array.isArray(corpseCostsRaw)
            ? (corpseCostsRaw as unknown as WasmCorpseCost[])
            : []
          const ccByIndex = new Map<number, WasmCorpseCost>(
            corpseCosts.map((v: WasmCorpseCost, i: number) => [i, v]),
          )
          // sync corpses (index-based in-place updates)
          {
            const cv = corpses.value
            const n = wasmCorpsesRaw.length
            const m = Math.min(cv.length, n)
            for (let i = 0; i < m; i++) {
              const c = wasmCorpsesRaw[i] || {}
              const tgt = cv[i] as unknown as Record<string, unknown>
              ;(tgt as { x: number }).x = Number(c.x ?? 0)
              ;(tgt as { y: number }).y = Number(c.y ?? 0)
              ;(tgt as { radius: number }).radius = Number(c.radius ?? 3)
              ;(tgt as { energyRemaining: number }).energyRemaining = Number(
                (c as Record<string, unknown>).energy_remaining ??
                  (c as Record<string, unknown>).energy ??
                  0,
              )
              ;(tgt as { initialDecayTime: number }).initialDecayTime = Number(
                (c as Record<string, unknown>).initial_decay_time ?? 100,
              )
              ;(tgt as { decayTimer: number }).decayTimer = Number(
                (c as Record<string, unknown>).decay_timer ?? 100,
              )
              if (ccByIndex.has(i)) {
                ;(tgt as { _lastDecay?: Record<string, number> })._lastDecay = {
                  total: ccByIndex.get(i)!.total ?? 0,
                  base: ccByIndex.get(i)!.base ?? 0,
                  temp: ccByIndex.get(i)!.temp ?? 0,
                  humid: ccByIndex.get(i)!.humid ?? 0,
                  rain: ccByIndex.get(i)!.rain ?? 0,
                  wet: ccByIndex.get(i)!.wet ?? 0,
                }
              }
            }
            if (n > cv.length) {
              for (let i = cv.length; i < n; i++) {
                const c = wasmCorpsesRaw[i] || {}
                cv.push({
                  x: Number(c.x ?? 0),
                  y: Number(c.y ?? 0),
                  radius: Number(c.radius ?? 3),
                  energyRemaining: Number(
                    (c as Record<string, unknown>).energy_remaining ??
                      (c as Record<string, unknown>).energy ??
                      0,
                  ),
                  initialDecayTime: Number((c as Record<string, unknown>).initial_decay_time ?? 100),
                  decayTimer: Number((c as Record<string, unknown>).decay_timer ?? 100),
                  ...(ccByIndex.has(i)
                    ? {
                        _lastDecay: {
                          total: ccByIndex.get(i)!.total ?? 0,
                          base: ccByIndex.get(i)!.base ?? 0,
                          temp: ccByIndex.get(i)!.temp ?? 0,
                          humid: ccByIndex.get(i)!.humid ?? 0,
                          rain: ccByIndex.get(i)!.rain ?? 0,
                          wet: ccByIndex.get(i)!.wet ?? 0,
                        },
                      }
                    : {}),
                })
              }
            } else if (n < cv.length) {
              cv.splice(n)
            }
          }
          // Corpse parity diagnostics (throttled)
          if (
            doParity &&
            simulationParams.enableCostTelemetry &&
            simulationParams.debugLogging &&
            corpseCosts.length
          ) {
            let corpseMismatchCount = 0
            let corpseMaxRel = 0
            const corpseCompMax: Record<string, number> = {
              base: 0,
              temp: 0,
              humid: 0,
              rain: 0,
              wet: 0,
              total: 0,
            }
            // Validate WASM parts sum against total
            for (let i = 0; i < Math.min(5, corpseCosts.length); i++) {
              const w = corpseCosts[i]
              if (!w) continue
              const parts = [
                Number(w.base ?? 0),
                Number(w.temp ?? 0),
                Number(w.humid ?? 0),
                Number(w.rain ?? 0),
                Number(w.wet ?? 0),
              ]
              const sum = parts.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0)
              const total = Number(w.total ?? 0)
              const absDiff = Math.abs(sum - total)
              const relDiff = total !== 0 ? absDiff / Math.abs(total) : absDiff
              const tolAbs = 1e-4
              const tolRel = 0.01
              if (
                !Number.isFinite(total) ||
                parts.some((p) => !Number.isFinite(p)) ||
                (absDiff > tolAbs && relDiff > tolRel)
              ) {
                console.debug('[WASM CorpseDecay Validator]', {
                  index: i,
                  total,
                  sum,
                  absDiff: Number(absDiff.toFixed(6)),
                  relDiff: Number(relDiff.toFixed(6)),
                })
                corpseMismatchCount++
                corpseMaxRel = Math.max(corpseMaxRel, Number.isFinite(relDiff) ? relDiff : 0)
              }
            }
            // JS recomputation mirror of Rust formulas
            for (let i = 0; i < Math.min(5, corpseCosts.length); i++) {
              const w = corpseCosts[i]
              const co = (wasmCorpsesRaw ?? [])[i]
              if (!w || !co) continue
              const wx = Number(co.x) || 0
              const wy = Number(co.y) || 0
              const wthr = sampleWeather(wx, wy)
              const terr = sampleTerrain(wx, wy)
              const base = Math.max(0, Number(simulationParams.corpseBaseDecayPerSec) || 0)
              const tempTerm = Math.max(0, Math.min(2, ((wthr.temperatureC ?? 0) - 20) / 15))
              const jTemp = base * (Number(simulationParams.corpseTempDecayCoeff) || 0) * tempTerm
              const jHumid =
                base * (Number(simulationParams.corpseHumidityDecayCoeff) || 0) * Math.max(0, wthr.humidity01 ?? 0)
              const wthrCast = wthr as { rain01?: number; precipitation01?: number }
              const terrCast = terr as { wet01?: number; wetness01?: number }
              const rain01 = wthrCast.rain01 ?? wthrCast.precipitation01 ?? 0
              const wet01 = terrCast.wet01 ?? terrCast.wetness01 ?? 0
              const jRain = base * (Number(simulationParams.corpseRainDecayCoeff) || 0) * Math.max(0, rain01)
              const jWet = base * (Number(simulationParams.corpseWetnessDecayCoeff) || 0) * Math.max(0, wet01)
              const jTotal = Math.max(0, base + jTemp + jHumid + jRain + jWet)
              const comps: Array<[string, number, number]> = [
                ['base', Number(w.base ?? 0), base],
                ['temp', Number(w.temp ?? 0), jTemp],
                ['humid', Number(w.humid ?? 0), jHumid],
                ['rain', Number(w.rain ?? 0), jRain],
                ['wet', Number(w.wet ?? 0), jWet],
              ]
              const ctAbs = 1e-4
              const ctRel = 0.01
              for (const [name, wv, jv] of comps) {
                const diff = Math.abs(wv - jv)
                const rel = Math.max(Math.abs(wv), 1e-6) > 0 ? diff / Math.max(Math.abs(wv), 1e-6) : diff
                if (diff > ctAbs && rel > ctRel) {
                  console.debug('[WASM CorpseDecay JS-Recompute]', {
                    index: i,
                    comp: name,
                    wasm: Number(wv.toFixed(6)),
                    js: Number(jv.toFixed(6)),
                    absDiff: Number(diff.toFixed(6)),
                    relDiff: Number(rel.toFixed(6)),
                  })
                  corpseMismatchCount++
                }
                corpseMaxRel = Math.max(corpseMaxRel, Number.isFinite(rel) ? rel : 0)
                if (corpseCompMax[name] !== undefined) {
                  corpseCompMax[name] = Math.max(corpseCompMax[name], Number.isFinite(rel) ? rel : 0)
                }
              }
              const tw = Number(w.total ?? 0)
              const td = Math.abs(tw - jTotal)
              const tr = tw !== 0 ? td / Math.abs(tw) : td
              if (td > ctAbs && tr > ctRel) {
                console.debug('[WASM CorpseDecay JS-Recompute Total]', {
                  index: i,
                  wasm: Number(tw.toFixed(6)),
                  js: Number(jTotal.toFixed(6)),
                  absDiff: Number(td.toFixed(6)),
                  relDiff: Number(tr.toFixed(6)),
                })
                corpseMismatchCount++
              }
              corpseMaxRel = Math.max(corpseMaxRel, Number.isFinite(tr) ? tr : 0)
              corpseCompMax.total = Math.max(corpseCompMax.total, Number.isFinite(tr) ? tr : 0)
            }
            // Write back accumulators
            parityStats.corpse.mismatches = corpseMismatchCount
            parityStats.corpse.maxRelDiff = corpseMaxRel
            for (const k of Object.keys(corpseCompMax)) parityStats.corpse.compMaxRel[k] = corpseCompMax[k]
          }
          // Lightweight proximity events (WASM path lacks intent signals)
          try {
            const plantArr = plants.value
            const corpseArr = corpses.value
            const allCreatures = creatures.value
            for (const c of creatures.value) {
              const prev = wasmPrevFlagsById.get(c.id) || {}
              const prevRes = wasmPrevResources.get(c.id) || {}
              // Finds water (near plant)
              const nearPlant = plantArr.some(
                (p) => Math.hypot(p.x - c.x, p.y - c.y) <= Math.max(4, c.radius + p.radius + 2),
              )
              if (nearPlant && !prev.nearPlant && shouldEmitEvent(c.id, 'finds_water')) {
                pushCreatureEvent(c.id, {
                  ts: Date.now(),
                  type: 'event',
                  key: 'finds_water',
                  label: 'Finds water (plant nearby)',
                })
              }
              if (!nearPlant && prev.nearPlant) {
                pushCreatureEvent(c.id, {
                  ts: Date.now(),
                  type: 'event',
                  key: 'loses_water',
                  label: 'Loses water source',
                })
              }
              // Food plant perception (same proximity as plants)
              const nearFoodPlant = nearPlant
              if (
                nearFoodPlant &&
                !prev.nearFoodPlant &&
                shouldEmitEvent(c.id, 'finds_food_plant')
              ) {
                pushCreatureEvent(c.id, {
                  ts: Date.now(),
                  type: 'event',
                  key: 'finds_food_plant',
                  label: 'Finds food plant',
                })
              }
              if (!nearFoodPlant && prev.nearFoodPlant) {
                pushCreatureEvent(c.id, {
                  ts: Date.now(),
                  type: 'event',
                  key: 'loses_food_plant',
                  label: 'Loses food plant',
                })
              }
              // Finds corpse
              const nearCorpse = corpseArr.some(
                (co) => Math.hypot(co.x - c.x, co.y - c.y) <= Math.max(4, c.radius + co.radius + 2),
              )
              if (nearCorpse && !prev.nearCorpse && shouldEmitEvent(c.id, 'finds_corpse')) {
                pushCreatureEvent(c.id, {
                  ts: Date.now(),
                  type: 'event',
                  key: 'finds_corpse',
                  label: 'Finds a corpse nearby',
                })
              }
              if (!nearCorpse && prev.nearCorpse) {
                pushCreatureEvent(c.id, {
                  ts: Date.now(),
                  type: 'event',
                  key: 'loses_corpse',
                  label: 'Loses corpse from proximity',
                })
              }
              // Resource deltas (WASM path)
              const e = c.energy ?? 0
              const s = c.stamina ?? 0
              const h = c.health ?? 0
              if (prevRes.energy !== undefined) {
                const de = e - (prevRes.energy ?? e)
                if (de > 0.1 && shouldEmitEvent(c.id, 'energy_gain'))
                  pushCreatureEvent(c.id, {
                    ts: Date.now(),
                    type: 'event',
                    key: 'energy_gain',
                    label: `Energy +${de.toFixed(1)}`,
                  })
                if (de < -0.1 && shouldEmitEvent(c.id, 'energy_loss'))
                  pushCreatureEvent(c.id, {
                    ts: Date.now(),
                    type: 'event',
                    key: 'energy_loss',
                    label: `Energy ${de.toFixed(1)}`,
                  })
                // Heuristic: significant energy gain near food source => eating
                if (de > simulationParams.energyGainEatThreshold) {
                  const diet = c.phenotype?.diet || 'Herbivore'
                  if (
                    nearFoodPlant &&
                    diet === 'Herbivore' &&
                    shouldEmitEvent(c.id, 'eats_plant', 2500)
                  ) {
                    pushCreatureEvent(c.id, {
                      ts: Date.now(),
                      type: 'action',
                      key: 'eats_plant',
                      label: 'Eats plant',
                    })
                    telemetry.totals.eats_plant++
                  }
                  if (
                    nearCorpse &&
                    diet === 'Carnivore' &&
                    shouldEmitEvent(c.id, 'eats_corpse', 2500)
                  ) {
                    pushCreatureEvent(c.id, {
                      ts: Date.now(),
                      type: 'action',
                      key: 'eats_corpse',
                      label: 'Eats from corpse',
                    })
                    telemetry.totals.eats_corpse++
                  }
                }
              }
              if (prevRes.stamina !== undefined) {
                const ds = s - (prevRes.stamina ?? s)
                if (ds > 0.1 && shouldEmitEvent(c.id, 'stamina_gain'))
                  pushCreatureEvent(c.id, {
                    ts: Date.now(),
                    type: 'event',
                    key: 'stamina_gain',
                    label: `Stamina +${ds.toFixed(1)}`,
                  })
                if (ds < -0.1 && shouldEmitEvent(c.id, 'stamina_loss'))
                  pushCreatureEvent(c.id, {
                    ts: Date.now(),
                    type: 'event',
                    key: 'stamina_loss',
                    label: `Stamina ${ds.toFixed(1)}`,
                  })
              }
              if (prevRes.health !== undefined) {
                const dh = h - (prevRes.health ?? h)
                if (dh > 0.1 && shouldEmitEvent(c.id, 'health_gain'))
                  pushCreatureEvent(c.id, {
                    ts: Date.now(),
                    type: 'event',
                    key: 'health_gain',
                    label: `Health +${dh.toFixed(1)}`,
                  })
                if (dh < -0.1 && shouldEmitEvent(c.id, 'health_loss'))
                  pushCreatureEvent(c.id, {
                    ts: Date.now(),
                    type: 'event',
                    key: 'health_loss',
                    label: `Health ${dh.toFixed(1)}`,
                  })
              }
              wasmPrevResources.set(c.id, { energy: e, stamina: s, health: h })
              // Finds predator/prey using diet
              const isCarn = (c.phenotype?.diet || 'Herbivore') === 'Carnivore'
              const visionR = Math.max(
                20,
                Number(c.phenotype?.sightRange) || Number(simulationParams.visionRange),
              )
              const nearPredator = allCreatures.some(
                (o) =>
                  o.id !== c.id &&
                  (o.phenotype?.diet || 'Herbivore') === 'Carnivore' &&
                  Math.hypot(o.x - c.x, o.y - c.y) <= visionR,
              )
              const nearPrey = allCreatures.some(
                (o) =>
                  o.id !== c.id &&
                  (o.phenotype?.diet || 'Herbivore') === 'Herbivore' &&
                  Math.hypot(o.x - c.x, o.y - c.y) <= visionR,
              )
              const nearMate = allCreatures.some(
                (o) => o.id !== c.id && Math.hypot(o.x - c.x, o.y - c.y) <= visionR,
              )
              if (!isCarn) {
                if (nearPredator && !prev.nearPredator) {
                  pushCreatureEvent(c.id, {
                    ts: Date.now(),
                    type: 'event',
                    key: 'finds_predator',
                    label: 'Detects predator nearby',
                  })
                }
                if (!nearPredator && prev.nearPredator) {
                  pushCreatureEvent(c.id, {
                    ts: Date.now(),
                    type: 'event',
                    key: 'loses_predator',
                    label: 'Predator gone',
                  })
                }
              } else {
                if (nearPrey && !prev.nearPrey) {
                  pushCreatureEvent(c.id, {
                    ts: Date.now(),
                    type: 'event',
                    key: 'finds_prey',
                    label: 'Detects prey nearby',
                  })
                }
                if (!nearPrey && prev.nearPrey) {
                  pushCreatureEvent(c.id, {
                    ts: Date.now(),
                    type: 'event',
                    key: 'loses_prey',
                    label: 'Loses track of prey',
                  })
                }
              }
              if (nearMate && !prev.nearMate) {
                pushCreatureEvent(c.id, {
                  ts: Date.now(),
                  type: 'event',
                  key: 'finds_mate',
                  label: 'Finds potential mate nearby',
                })
              }
              if (!nearMate && prev.nearMate) {
                pushCreatureEvent(c.id, {
                  ts: Date.now(),
                  type: 'event',
                  key: 'loses_mate',
                  label: 'Loses potential mate',
                })
              }
              wasmPrevFlagsById.set(c.id, {
                nearPlant,
                nearFoodPlant,
                nearCorpse,
                nearPrey,
                nearPredator,
                nearMate,
              })
            }
          } catch {}
        } catch (e) {
          console.warn('WASM update failed, falling back to JS step:', e)
          wasmWorld = null
        }
      }
    }

    // --- Advance world clock using unscaled real dt, not effDt, to avoid coupling with simulationSpeed ---
    const realDt = Math.max(0, Number(dt) || 0)
    if (realDt > 0) {
      worldTimeSec.value += realDt
      const rspd = Math.max(1e-6, Number(simulationParams.realSecondsPerDay) || 600)
      const wScale = Math.max(0, Number(simulationParams.worldTimeScale) || 0)
      // Continuous fractional days progressed this frame
      worldDayFloat.value += (realDt / rspd) * wScale
      // Normalize fractional year position [0,1)
      const doy = (simulationParams.startDayOfYear01 + (worldDayFloat.value % 1) + 1) % 1
      dayOfYear01.value = doy
      // Basic smooth season scalar (0 winter -> 0.5 summer -> 1 wraps to winter)
      season01.value = doy
    }
    if (!wasmWorld) {
      // JS fallback with simple MLP brain mirroring WASM behavior
      const drag = 0.99
      const width = 2000
      const height = 2000
      const tick = Date.now() // coarse; not critical for placeholder inputs
      // Build next-frame creature list with deaths handled
      const nextCreatures: Creature[] = []
      const maxLife = 5000 * Math.max(0.1, simulationParams.lifespanMultiplier)
      // Track previous per-creature flags for transition-based events
      type PrevFlags = {
        thirsty?: boolean
        hungry?: boolean
        fatigued?: boolean
        fearful?: boolean
        inMatingUrge?: boolean
        restless?: boolean
        nearPlant?: boolean
        nearFoodPlant?: boolean
        nearCorpse?: boolean
        nearMate?: boolean
        sprinting?: boolean
        resting?: boolean
        drinking?: boolean
        prevHealth?: number
        prevEnergy?: number
        prevStamina?: number
      }
      const prevFlagsById: Map<string, PrevFlags> = new Map()
      for (const c of creatures.value) {
        const cf = c as Creature & CreatureEventFlags
        prevFlagsById.set(c.id, {
          thirsty: cf._ev_prev_thirsty || false,
          hungry: cf._ev_prev_hungry || false,
          fatigued: cf._ev_prev_fatigued || false,
          fearful: cf._ev_prev_fearful || false,
          inMatingUrge: cf._ev_prev_mating || false,
          restless: cf._ev_prev_restless || false,
          nearPlant: cf._ev_prev_nearPlant || false,
          nearFoodPlant: cf._ev_prev_nearFoodPlant || false,
          nearCorpse: cf._ev_prev_nearCorpse || false,
          nearMate: cf._ev_prev_nearMate || false,
          sprinting: cf._ev_prev_sprinting || false,
          resting: cf._ev_prev_resting || false,
          drinking: cf._ev_prev_drinking || false,
          prevHealth: cf._ev_prev_health ?? c.health,
          prevEnergy: cf._ev_prev_energy ?? c.energy,
        })
      }
      for (const c of creatures.value) {
        if (!c.brain || !c.brain.layerSizes || !c.brain.weights) {
          const sizes = computeLayerSizesForCreature()
          c.brain = createGoodBrain((c.brain?.layerSizes as number[]) || sizes, rngBrain)
        } else {
          // Auto-resize if architecture changed due to mode/config
          const desired = computeLayerSizesForCreature()
          if (Array.isArray(c.brain.layerSizes) && c.brain.layerSizes[0] !== desired[0]) {
            c.brain = createGoodBrain(desired, rngBrain)
          }
        }
        const inputs = buildInputs(
          width,
          height,
          tick,
          c,
          creatures.value,
          simulationParams.brainMode,
        )
        // Expose current inputs for UI/diagnostics
        if (c.brain) c.brain.inputs = inputs.slice()
        const actFns = resolveActivationFns()
        const { output, activations } = brainForward(
          c.brain!,
          inputs,
          simulationParams.brainMode,
          actFns,
        )
        // Steering and acceleration
        const ax = Math.tanh(output[0] ?? 0)
        const ay = Math.tanh(output[1] ?? 0)
        const aScale = Math.abs(Math.tanh(output[2] ?? 0))
        const eatSig = Math.tanh(output[3] ?? 0)
        const restSig = Math.tanh(output[4] ?? 0)
        const boostSig = Math.tanh(output[5] ?? 0)
        const speedMult = terrainSpeedAt(c.x, c.y, tick)
        let accel = 0.35 * speedMult * (0.5 + aScale)
        // Sprint boost if requested
        const wantsBoost = boostSig > 0.5
        if (wantsBoost) accel *= 1.5
        c.vx += ax * accel
        c.vy += ay * accel
        c.x += c.vx * effDt * 60 * speedMult
        c.y += c.vy * effDt * 60 * speedMult
        c.vx *= drag
        c.vy *= drag
        // Rest behavior: damp velocities (regen handled in cost aggregation below)
        const wantsRest = restSig > 0.5
        c.isResting = wantsRest
        if (wantsRest) {
          c.vx *= 0.9
          c.vy *= 0.9
        }
        // Perception helpers
        const nearPlant = plants.value.some(
          (p) => Math.hypot(p.x - c.x, p.y - c.y) <= Math.max(4, c.radius + p.radius + 2),
        )
        const nearCorpse = corpses.value.some(
          (co) => Math.hypot(co.x - c.x, co.y - c.y) <= Math.max(4, c.radius + co.radius + 2),
        )
        // Nearby creatures info (for prey/predator/mate heuristics)
        const visionR = Math.max(
          20,
          Number(c.phenotype?.sightRange) || Number(simulationParams.visionRange),
        )
        const nearMateLocal = creatures.value.some(
          (o) => o.id !== c.id && Math.hypot(o.x - c.x, o.y - c.y) <= visionR,
        )
        const nearPreyLocal = creatures.value.some(
          (o) =>
            o.id !== c.id &&
            (o.phenotype?.diet || 'Herbivore') === 'Herbivore' &&
            Math.hypot(o.x - c.x, o.y - c.y) <= visionR,
        )
        const nearPredatorLocal = creatures.value.some(
          (o) =>
            o.id !== c.id &&
            (o.phenotype?.diet || 'Herbivore') === 'Carnivore' &&
            Math.hypot(o.x - c.x, o.y - c.y) <= visionR,
        )
        // Eat behavior: trickle energy when near a plant (herbivore) or corpse (carnivore)
        const wantsEat = eatSig > 0.5
        if (wantsEat) {
          const diet: 'Herbivore' | 'Carnivore' = c.phenotype?.diet || 'Herbivore'
          if (diet === 'Herbivore' && nearPlant) c.energy = Math.min(100, c.energy + 0.15)
          else if (diet === 'Carnivore' && nearCorpse) c.energy = Math.min(100, c.energy + 0.12)
        }
        // Sprint bookkeeping (drain handled in cost aggregation below)
        c.isSprinting = wantsBoost
        // no direct energy drain here; handled via sprint costs
        // Wrap
        if (c.x > width) c.x = 0
        else if (c.x < 0) c.x = width
        if (c.y > height) c.y = 0
        else if (c.y < 0) c.y = height
        // --- Per-tick Cost Aggregation ---
        // Track previous velocity to estimate turning and acceleration
        const ce = c as Creature & CreatureEventFlags
        const prevVx = ce._prevVx ?? c.vx
        const prevVy = ce._prevVy ?? c.vy
        const prevHeading = ce._prevHeading ?? Math.atan2(prevVy, prevVx)
        const speedNow = Math.hypot(c.vx, c.vy)
        const headingNow = speedNow > 1e-3 ? Math.atan2(c.vy, c.vx) : prevHeading
        const dHead = speedNow > 1e-3 ? Math.abs(wrapAngle(headingNow - prevHeading)) / effDt : 0
        const accelMag = Math.hypot((c.vx - prevVx) / effDt, (c.vy - prevVy) / effDt)
        ;(c as Creature & CreatureEventFlags)._prevVx = c.vx
        ;(c as Creature & CreatureEventFlags)._prevVy = c.vy
        ;(c as Creature & CreatureEventFlags)._prevHeading = headingNow

        let Eout = 0
        let Sout = 0
        // Basal metabolism
        Eout += simulationParams.baseMetabolicCostPerSec
        const ph = c.phenotype
        const brainNeurons = Array.isArray(c.brain?.layerSizes)
          ? (c.brain!.layerSizes as number[]).reduce((a, b) => a + b, 0)
          : 0
        Eout += simulationParams.sizeMetabolicCostPerSec * (Number(ph.size) || 1)
        Eout += simulationParams.brainMetabolicCostPerNeuronPerSec * brainNeurons
        Eout += simulationParams.visionMetabolicCostBasePerSec
        Eout += simulationParams.visionMetabolicCostPerEyePerSec * (Number(ph.eyesCount) || 0)
        Eout +=
          simulationParams.visionMetabolicCostPer100RangePerSec *
          ((Number(ph.sightRange) || 0) / 100)
        Eout +=
          simulationParams.visionMetabolicCostPer90FovPerSec *
          ((Number(ph.fieldOfViewDeg) || 0) / 90)

        // Locomotion costs
        let locomotion = 0
        locomotion += simulationParams.moveCostCoeffPerSpeedPerSec * speedNow
        locomotion += simulationParams.turnCostCoeffPerRadPerSec * dHead
        locomotion += simulationParams.accelerationCostCoeffPerAccelPerSec * accelMag
        // Terrain difficulty multiplier with clamp
        const tMult = Math.max(simulationParams.minTerrainSpeedMult, speedMult)
        locomotion *=
          Math.min(1 / tMult, 1 / simulationParams.minTerrainSpeedMult) *
          simulationParams.terrainCostMultiplierK
        // Panic multiplier
        if ((c.fear ?? 0) > simulationParams.fearThreshold) {
          locomotion *= simulationParams.panicLocomotionCostMultiplier
        }
        Eout += locomotion

        // --- Environmental Modifiers (hooks; kept 0 by default) ---
        // Track component breakdown for telemetry and WASM parity validation
        let envSwim = 0
        let envWind = 0
        let envCold = 0
        let envHeat = 0
        let envHumid = 0
        let envOxy = 0
        let envNoise = 0
        let envDisease = 0
        try {
          const w = sampleWeather(c.x, c.y)
          const tr = sampleTerrain(c.x, c.y)
          // Swimming penalty scales with water depth
          if (tr.waterDepth > 0) {
            envSwim += simulationParams.swimEnergyCostPerSec * Math.min(1, tr.waterDepth)
          }
          // Wind drag: cost increases with headwind component and speed
          if (simulationParams.windDragCoeff > 0 && (c.vx !== 0 || c.vy !== 0)) {
            const vmag = Math.hypot(c.vx, c.vy)
            if (vmag > 1e-4) {
              const vhatx = c.vx / vmag
              const vhaty = c.vy / vmag
              const wx = Math.cos(w.windDirRad)
              const wy = Math.sin(w.windDirRad)
              const head = Math.max(0, -(vhatx * wx + vhaty * wy)) // 0..1 when headwind
              envWind += simulationParams.windDragCoeff * head * (w.windSpeed || 0) * vmag
            }
          }
          // Thermal penalties
          const tC = w.temperatureC
          if (tC < simulationParams.comfortLowC) {
            const k = (simulationParams.comfortLowC - tC) / 10
            envCold += simulationParams.tempColdPenaltyPerSec * Math.max(0, k)
          } else if (tC > simulationParams.comfortHighC) {
            const k = (tC - simulationParams.comfortHighC) / 10
            envHeat += simulationParams.tempHeatPenaltyPerSec * Math.max(0, k)
          }
          // Low humidity dehydration assist
          if (w.humidity01 < simulationParams.humidityThreshold) {
            const k = simulationParams.humidityThreshold - w.humidity01
            envHumid += simulationParams.humidityDehydrationCoeffPerSec * Math.max(0, k)
          }
          // Thin air at elevation
          if (tr.elevation01 > simulationParams.thinAirElevationCutoff01) {
            const k =
              (tr.elevation01 - simulationParams.thinAirElevationCutoff01) /
              Math.max(1e-3, 1 - simulationParams.thinAirElevationCutoff01)
            envOxy += simulationParams.oxygenThinAirPenaltyPerSec * Math.max(0, k)
          }
          // Noise stress and disease drains
          envNoise += simulationParams.noiseStressPenaltyPerSec * (w.noise01 ?? 0)
          envDisease += simulationParams.diseaseEnergyDrainPerSec
        } catch {}
        const envTotal =
          envSwim + envWind + envCold + envHeat + envHumid + envOxy + envNoise + envDisease
        Eout += envTotal

        // Sprinting drains stamina first; overflow to energy
        let sprintOverflowE = 0
        if (c.isSprinting) {
          const sDrainPerSec = simulationParams.sprintStaminaDrainPerSpeedPerSec * speedNow
          const sDrainTick = sDrainPerSec * effDt
          const takeS = Math.min(c.stamina, sDrainTick)
          c.stamina -= takeS
          const excess = sDrainTick - takeS
          if (excess > 1e-6) {
            sprintOverflowE += (excess / effDt) * simulationParams.sprintEnergyOverflowCoeff
          }
        }
        Eout += sprintOverflowE

        // Inaction posture maintenance (when not resting and nearly idle)
        let postureE = 0
        if (!c.isResting && speedNow < 0.02) {
          postureE = 0.25 * simulationParams.moveCostCoeffPerSpeedPerSec
          Eout += postureE
        }

        // Action costs and effects
        let matingE = 0
        let gestationE = 0
        let attackE = 0
        let drinkE = 0
        let harvestE = 0
        let scavengeE = 0
        const diet: 'Herbivore' | 'Carnivore' =
          c.phenotype?.diet === 'Carnivore' ? 'Carnivore' : 'Herbivore'
        if (wantsEat) {
          if (diet === 'Herbivore' && nearPlant) {
            harvestE += simulationParams.harvestPlantActionCostPerSecond
          } else if (diet === 'Carnivore' && nearCorpse) {
            scavengeE += simulationParams.scavengeCorpseActionCostPerSecond
          }
        }
        // Drinking when thirsty near plant (acts as water source)
        const thirstyNowLocal = (c.thirst ?? 100) < simulationParams.thirstThreshold
        if (nearPlant && thirstyNowLocal) {
          c.thirst = Math.min(
            100,
            (c.thirst ?? 100) + simulationParams.thirstRecoveryPerSec * effDt,
          )
          drinkE += simulationParams.drinkCostPerSecond
        }

        // Mating attempt costs when in urge and near a mate
        const matingNowLocal = (c.sDrive ?? 0) > simulationParams.matingUrgeThreshold
        if (matingNowLocal && nearMateLocal) {
          matingE += simulationParams.mateActionCostPerAttemptEnergy
          Sout += simulationParams.mateActionCostPerAttemptStamina
        }

        // Gestation per-second costs while pregnant
        if (c.isPregnant) {
          const offspringCount = Array.isArray(c.childGenes) ? c.childGenes.length : 1
          gestationE +=
            simulationParams.gestationBaseCostPerSec +
            simulationParams.gestationCostPerOffspringPerSec * Math.max(1, offspringCount)
          // Advance gestation timer and handle birth
          c.gestationTimer = (c.gestationTimer || 0) + effDt
          if (c.gestationTimer >= (simulationParams.gestationPeriod || 0)) {
            // Birth event cost
            c.energy = Math.max(-50, c.energy - (simulationParams.birthEventCostEnergy || 0))
            // Apply mutation cost if childGenes differ from parent genes
            if (c.childGenes) {
              try {
                const afterGenes: Record<string, unknown> = Array.isArray(c.childGenes)
                  ? ((c.childGenes[0] as unknown) as Record<string, unknown>)
                  : ((c.childGenes as unknown) as Record<string, unknown>)
                chargeMutationCost(c, (c.genes as unknown) as Record<string, unknown>, afterGenes)
              } catch {}
            }
            // Emit event
            pushCreatureEvent(c.id, {
              ts: Date.now(),
              type: 'event',
              key: 'birth',
              label: 'Gives birth',
            })
            // Reset pregnancy state (offspring spawning handled elsewhere if needed)
            c.isPregnant = false
            c.gestationTimer = 0
            ;(c as { childGenes: unknown | null }).childGenes = null
          }
        }

        // Attack attempt costs heuristics (simple):
        // Offensive: carnivores sprinting near prey
        // Defensive: any creature fearful near predator
        const offensive = diet === 'Carnivore' && c.isSprinting && nearPreyLocal
        const defensive = (c.fear ?? 0) > simulationParams.fearThreshold && nearPredatorLocal
        if (offensive || defensive) {
          attackE += simulationParams.attackCostPerHitEnergy
          Sout += simulationParams.attackCostPerHitStamina
          // Emit attack attempt event (throttled) and increment telemetry
          if (shouldEmitEvent(c.id, 'attacks', 1200)) {
            pushCreatureEvent(c.id, {
              ts: Date.now(),
              type: 'action',
              key: 'attacks',
              label: 'Attacks',
            })
            telemetry.totals.attacks++
          }
        }

        // Accumulate action energy costs
        Eout += matingE + gestationE + attackE + drinkE + harvestE + scavengeE

        // Recovery and penalties
        let ambientApplied = 0
        if (c.isResting) {
          c.stamina = Math.min(
            c.maxStamina ?? 100,
            c.stamina + simulationParams.restStaminaRegenPerSec * effDt,
          )
          c.health = Math.min(100, c.health + simulationParams.restHealthRegenPerSec * effDt)
          ambientApplied = -simulationParams.restHealthRegenPerSec * effDt
        } else {
          // Ambient health decay scaled by age
          const ageNorm = Math.min(1, c.lifespan / maxLife)
          const ambient =
            simulationParams.ambientHealthDecayPerSec *
            (1 + simulationParams.agingHealthDecayCoeff * ageNorm)
          c.health = Math.max(0, c.health - ambient * effDt)
          ambientApplied = ambient * effDt
        }
        // Dehydration penalty when thirsty
        if ((c.thirst ?? 100) < simulationParams.thirstThreshold) {
          Eout += simulationParams.dehydrationEnergyLossPerSec
        }

        // Apply energy and stamina deltas
        c.energy -= Eout * effDt
        c.stamina = Math.max(0, Math.min(c.maxStamina ?? 100, c.stamina - Sout * effDt))

        // Starvation health loss when energy negative
        if (c.energy < 0) {
          c.health = Math.max(
            0,
            c.health -
              simulationParams.starvationHealthLossPerNegEnergyPerSec *
                Math.min(1, -c.energy / 20) *
                effDt,
          )
        }

        // Clamp energy/health to bounds
        c.energy = Math.max(-50, Math.min(100, c.energy))
        c.health = Math.max(0, Math.min(100, c.health))
        // Bookkeeping
        c.lifespan += 1

        // Optional cost telemetry
        if (simulationParams.enableCostTelemetry) {
          ;(c as CreatureWithDiag)._lastCost = {
            totalEnergyPerSec: Eout,
            locomotion,
            sprintOverflowE,
            drinkE,
            harvestE,
            scavengeE,
            matingE,
            gestationE,
            attackE,
            postureE,
            ambientHealthDelta: ambientApplied,
            envTotal,
            envSwim,
            envWind,
            envCold,
            envHeat,
            envHumid,
            envOxy,
            envNoise,
            envDisease,
          }
        }
        // Event logging (feelings / events / actions)
        try {
          const prev = prevFlagsById.get(c.id) || {}
          // Feeling: thirst (threshold 30)
          const thirstyNow = (c.thirst ?? 100) < simulationParams.thirstThreshold
          if (thirstyNow && !prev.thirsty) {
            pushCreatureEvent(c.id, {
              ts: Date.now(),
              type: 'feeling',
              key: 'thirst',
              label: 'Feels thirsty',
            })
          }
          ;(c as CreatureWithDiag)._ev_prev_thirsty = thirstyNow

          // Feeling: hunger (energy < 30)
          const hungryNow = (c.energy ?? 100) < simulationParams.hungerEnergyThreshold
          if (hungryNow && !prev.hungry) {
            pushCreatureEvent(c.id, {
              ts: Date.now(),
              type: 'feeling',
              key: 'hunger',
              label: 'Feels hungry',
            })
          }
          ;(c as CreatureWithDiag)._ev_prev_hungry = hungryNow

          // Feeling: fatigue (stamina < 30)
          const fatiguedNow = (c.stamina ?? 100) < simulationParams.fatigueStaminaThreshold
          if (fatiguedNow && !prev.fatigued) {
            pushCreatureEvent(c.id, {
              ts: Date.now(),
              type: 'feeling',
              key: 'fatigue',
              label: 'Feels fatigued',
            })
          }
          ;(c as CreatureWithDiag)._ev_prev_fatigued = fatiguedNow

          // Feeling: fear (fear > 60)
          const fearfulNow = (c.fear ?? 0) > simulationParams.fearThreshold
          if (fearfulNow && !prev.fearful) {
            pushCreatureEvent(c.id, {
              ts: Date.now(),
              type: 'feeling',
              key: 'fear',
              label: 'Feels afraid',
            })
          }
          ;(c as CreatureWithDiag)._ev_prev_fearful = fearfulNow

          // Feeling: mating_urge (sDrive > 60)
          const matingNow = (c.sDrive ?? 0) > simulationParams.matingUrgeThreshold
          if (matingNow && !prev.inMatingUrge) {
            pushCreatureEvent(c.id, {
              ts: Date.now(),
              type: 'feeling',
              key: 'mating_urge',
              label: 'Feels mating urge',
            })
          }
          ;(c as CreatureWithDiag)._ev_prev_mating = matingNow

          // Feeling: pain (health drop this frame)
          const prevHealth = prev.prevHealth ?? c.health
          if ((c.health ?? 100) < prevHealth - simulationParams.painHealthDropThreshold) {
            pushCreatureEvent(c.id, {
              ts: Date.now(),
              type: 'feeling',
              key: 'pain',
              label: 'Feels pain',
            })
          }
          ;(c as CreatureWithDiag)._ev_prev_health = c.health

          // Resource change events (JS path)
          const prevEnergy = prev.prevEnergy ?? c.energy ?? 0
          const prevStamina = prev.prevStamina ?? c.stamina ?? 0
          const de = (c.energy ?? 0) - prevEnergy
          const ds = (c.stamina ?? 0) - prevStamina
          if (
            de > simulationParams.resourceDeltaEventThreshold &&
            shouldEmitEvent(c.id, 'energy_gain')
          ) {
            pushCreatureEvent(c.id, {
              ts: Date.now(),
              type: 'event',
              key: 'energy_gain',
              label: `Energy +${de.toFixed(1)}`,
            })
          } else if (
            de < -simulationParams.resourceDeltaEventThreshold &&
            shouldEmitEvent(c.id, 'energy_loss')
          ) {
            pushCreatureEvent(c.id, {
              ts: Date.now(),
              type: 'event',
              key: 'energy_loss',
              label: `Energy ${de.toFixed(1)}`,
            })
          }
          if (
            ds > simulationParams.resourceDeltaEventThreshold &&
            shouldEmitEvent(c.id, 'stamina_gain')
          ) {
            pushCreatureEvent(c.id, {
              ts: Date.now(),
              type: 'event',
              key: 'stamina_gain',
              label: `Stamina +${ds.toFixed(1)}`,
            })
          } else if (
            ds < -simulationParams.resourceDeltaEventThreshold &&
            shouldEmitEvent(c.id, 'stamina_loss')
          ) {
            pushCreatureEvent(c.id, {
              ts: Date.now(),
              type: 'event',
              key: 'stamina_loss',
              label: `Stamina ${ds.toFixed(1)}`,
            })
          }
          // Health gain/loss (pain already covers loss as feeling; keep an event too)
          const dhJs = (c.health ?? 0) - prevHealth
          if (
            dhJs > simulationParams.resourceDeltaEventThreshold &&
            shouldEmitEvent(c.id, 'health_gain')
          ) {
            pushCreatureEvent(c.id, {
              ts: Date.now(),
              type: 'event',
              key: 'health_gain',
              label: `Health +${dhJs.toFixed(1)}`,
            })
          } else if (
            dhJs < -simulationParams.resourceDeltaEventThreshold &&
            shouldEmitEvent(c.id, 'health_loss')
          ) {
            pushCreatureEvent(c.id, {
              ts: Date.now(),
              type: 'event',
              key: 'health_loss',
              label: `Health ${dhJs.toFixed(1)}`,
            })
          }
          ;(c as CreatureWithDiag)._ev_prev_energy = c.energy
          ;(c as CreatureWithDiag)._ev_prev_stamina = c.stamina

          // Event: finds water (near plant)
          const nearPlant = plants.value.some(
            (p) => Math.hypot(p.x - c.x, p.y - c.y) <= Math.max(4, c.radius + p.radius + 2),
          )
          if (nearPlant && !prev.nearPlant) {
            pushCreatureEvent(c.id, {
              ts: Date.now(),
              type: 'event',
              key: 'finds_water',
              label: 'Finds water (plant nearby)',
            })
          }
          if (!nearPlant && prev.nearPlant) {
            pushCreatureEvent(c.id, {
              ts: Date.now(),
              type: 'event',
              key: 'loses_water',
              label: 'Loses water source',
            })
          }
          ;(c as CreatureWithDiag)._ev_prev_nearPlant = nearPlant

          // Event: finds/loses food plant (reuse plant proximity)
          const nearFoodPlant = nearPlant
          if (nearFoodPlant && !prev.nearFoodPlant) {
            pushCreatureEvent(c.id, {
              ts: Date.now(),
              type: 'event',
              key: 'finds_food_plant',
              label: 'Finds food plant',
            })
          }
          if (!nearFoodPlant && prev.nearFoodPlant) {
            pushCreatureEvent(c.id, {
              ts: Date.now(),
              type: 'event',
              key: 'loses_food_plant',
              label: 'Loses food plant',
            })
          }
          ;(c as CreatureWithDiag)._ev_prev_nearFoodPlant = nearFoodPlant

          // Event: finds corpse
          const nearCorpse = corpses.value.some(
            (co) => Math.hypot(co.x - c.x, co.y - c.y) <= Math.max(4, c.radius + co.radius + 2),
          )
          if (nearCorpse && !prev.nearCorpse) {
            pushCreatureEvent(c.id, {
              ts: Date.now(),
              type: 'event',
              key: 'finds_corpse',
              label: 'Finds a corpse nearby',
            })
          }
          if (!nearCorpse && prev.nearCorpse) {
            pushCreatureEvent(c.id, {
              ts: Date.now(),
              type: 'event',
              key: 'loses_corpse',
              label: 'Loses corpse from proximity',
            })
          }

          // Heuristic actions based on recent deltas and proximity
          if (de > simulationParams.energyGainEatThreshold) {
            const diet = c.phenotype?.diet || 'Herbivore'
            if (
              nearFoodPlant &&
              diet === 'Herbivore' &&
              shouldEmitEvent(c.id, 'eats_plant', 2500)
            ) {
              // Remove the nearest plant within interaction radius and emit global notice with location
              try {
                const plantArr = plants.value
                let bestIdx = -1
                let bestD = Infinity
                let bestP: Plant | null = null
                for (let i = 0; i < plantArr.length; i++) {
                  const p = plantArr[i]
                  const d = Math.hypot(p.x - c.x, p.y - c.y)
                  if (d < bestD) {
                    bestD = d
                    bestP = p
                    bestIdx = i
                  }
                }
                const eatTol = Math.max(4, c.radius + ((bestP?.radius ?? 3)) + 2)
                if (bestIdx >= 0 && bestD <= eatTol) {
                  // Confirmed consume within tolerance
                  pushCreatureEvent(c.id, {
                    ts: Date.now(),
                    type: 'action',
                    key: 'eats_plant',
                    label: 'Eats plant',
                  })
                  telemetry.totals.eats_plant++
                  const eaten = plantArr[bestIdx]
                  plants.value = [
                    ...plantArr.slice(0, bestIdx),
                    ...plantArr.slice(bestIdx + 1),
                  ]
                  if (typeof window !== 'undefined') {
                    // TEMP probe: confirm dispatch of action-notice
                    try {

                      console.log('[ActionNotice][probe][dispatch] about to dispatch', {
                        type: 'eats_plant', x: eaten.x, y: eaten.y, by: c.id,
                      })
                    } catch {}
                    window.dispatchEvent(
                      new CustomEvent('action-notice', {
                        detail: { type: 'eats_plant', x: eaten.x, y: eaten.y, by: c.id },
                      }),
                    )
                  }
                } else {
                  // Attempted but not within tolerance -> label attempt only, no totals or action-notice
                  pushCreatureEvent(c.id, {
                    ts: Date.now(),
                    type: 'action',
                    key: 'eats_plant',
                    label: 'Attempts to eat plant',
                  })
                }
              } catch {}
            }
          }

          // Event: finds/loses mate (simple proximity to any other creature)
          const visionR = Math.max(
            20,
            Number(c.phenotype?.sightRange) || Number(simulationParams.visionRange),
          )
          const nearMate = creatures.value.some(
            (o) => o.id !== c.id && Math.hypot(o.x - c.x, o.y - c.y) <= visionR,
          )
          const nearPredator = creatures.value.some(
            (o) =>
              o.id !== c.id &&
              (o.phenotype?.diet || 'Herbivore') === 'Carnivore' &&
              Math.hypot(o.x - c.x, o.y - c.y) <= visionR,
          )
          if (nearMate && !prev.nearMate) {
            pushCreatureEvent(c.id, {
              ts: Date.now(),
              type: 'event',
              key: 'finds_mate',
              label: 'Finds potential mate nearby',
            })
          }
          if (!nearMate && prev.nearMate) {
            pushCreatureEvent(c.id, {
              ts: Date.now(),
              type: 'event',
              key: 'loses_mate',
              label: 'Loses potential mate',
            })
          }
          ;(c as CreatureWithDiag)._ev_prev_nearMate = nearMate

          // Heuristic: notable health drop while predator near => gets_hit
          if (
            dhJs < -simulationParams.healthDropHitThreshold &&
            nearPredator &&
            shouldEmitEvent(c.id, 'gets_hit', 3000)
          ) {
            pushCreatureEvent(c.id, {
              ts: Date.now(),
              type: 'action',
              key: 'gets_hit',
              label: 'Gets hit',
            })
            telemetry.totals.gets_hit++
          }

          // Actions
          if (wantsBoost && !prev.sprinting) {
            pushCreatureEvent(c.id, {
              ts: Date.now(),
              type: 'action',
              key: 'sprints',
              label: 'Sprints',
            })
          }
          if (!wantsBoost && prev.sprinting) {
            pushCreatureEvent(c.id, {
              ts: Date.now(),
              type: 'action',
              key: 'stops_sprinting',
              label: 'Stops sprinting',
            })
          }
          ;(c as CreatureWithDiag)._ev_prev_sprinting = !!wantsBoost

          if (wantsRest && !prev.resting) {
            pushCreatureEvent(c.id, {
              ts: Date.now(),
              type: 'action',
              key: 'rests',
              label: 'Rests',
            })
          }
          ;(c as CreatureWithDiag)._ev_prev_resting = !!wantsRest

          // Feeling: restless (ticks since last rest > 600 and currently not resting)
          const sinceRest = ((c as CreatureWithDiag)._ev_ticks_since_rest || 0) + 1
          if (wantsRest) {
            ;(c as CreatureWithDiag)._ev_ticks_since_rest = 0
          } else {
            ;(c as CreatureWithDiag)._ev_ticks_since_rest = sinceRest
          }
          const restlessNow = !wantsRest && sinceRest > simulationParams.restlessTicks
          if (restlessNow && !prev.restless) {
            pushCreatureEvent(c.id, {
              ts: Date.now(),
              type: 'feeling',
              key: 'restless',
              label: 'Feels restless',
            })
          }
          // Use typed event flags intersection to record state
          const cf = c as CreatureWithDiag
          cf._ev_prev_restless = restlessNow

          const drinkingNow = wantsEat && nearPlant
          if (drinkingNow && !prev.drinking) {
            pushCreatureEvent(c.id, {
              ts: Date.now(),
              type: 'action',
              key: 'drinks',
              label: 'Drinks',
            })
          }
          ;(c as CreatureWithDiag)._ev_prev_drinking = drinkingNow
        } catch {}

        // Death check -> create corpse and skip adding to next list
        if (c.health <= 0) {
          // Emit death event and increment telemetry
          pushCreatureEvent(c.id, {
            ts: Date.now(),
            type: 'event',
            key: 'death',
            label: 'Dies',
          })
          telemetry.totals.deaths++
          // Record best-of brain into memoization cache using lifespan as score
          try {
            const brainJSON =
              c.brain && typeof c.brain === 'object'
                ? {
                    layerSizes: c.brain.layerSizes,
                    weights: c.brain.weights,
                    biases: c.brain.biases,
                  }
                : null
            if (brainJSON) {
              const h = simpleHash(JSON.stringify(brainJSON))
              const existing = brainCache[h]
              if (!existing || existing.score < c.lifespan) {
                brainCache[h] = { score: c.lifespan, brain: brainJSON, genes: c.genes || {} }
              }
            }
          } catch {
            // non-fatal
          }
          // Add to per-generation Hall of Fame using stable brain hash when available
          const hofBrainJSON =
            c.brain && typeof c.brain === 'object'
              ? {
                  layerSizes: (c.brain as BrainData).layerSizes,
                  weights: (c.brain as BrainData).weights,
                  biases: (c.brain as BrainData).biases,
                }
              : null
          const hofIdNow = hofBrainJSON ? simpleHash(JSON.stringify(hofBrainJSON)) : String(c.id)
          const entryNow = {
            id: hofIdNow,
            liveId: String(c.id),
            name: c.name,
            lifespan: c.lifespan,
            gen: generation.value,
          }
          hallOfFameGen.value.push(entryNow)
          const idxAll = hallOfFameAll.value.findIndex((e) => e.id === entryNow.id)
          if (idxAll === -1) {
            hallOfFameAll.value.push({ ...entryNow })
          } else if ((hallOfFameAll.value[idxAll].lifespan || 0) < entryNow.lifespan) {
            hallOfFameAll.value[idxAll] = { ...entryNow }
          }
          corpses.value.push({
            x: c.x,
            y: c.y,
            radius: c.radius,
            energyRemaining: Math.max(0, c.energy),
            initialDecayTime: 300,
            decayTimer: 300,
          })
          continue
        }
        // store activations and output for possible UI usage
        if (c.brain) {
          c.brain.activations = activations
          c.brain.output = output
        }
        nextCreatures.push(c)
      }
      creatures.value = nextCreatures
      // Decay corpses over time (weather/terrain-modulated)
      const nextCorpses: Corpse[] = []
      for (const co of corpses.value) {
        let init = Number(co.initialDecayTime) || 0
        let timer = Number(co.decayTimer) || 0
        const w = sampleWeather(co.x, co.y)
        const tr = sampleTerrain(co.x, co.y)
        // Build a multiplicative decay factor from environment
        const warmDelta = Math.max(0, (w.temperatureC ?? 10) - 10) / 20 // 0 at 10C, ~1 at 30C
        const tempK = 1 + simulationParams.corpseTempDecayCoeff * warmDelta
        const humK = 1 + simulationParams.corpseHumidityDecayCoeff * (w.humidity01 ?? 0)
        const rainK = 1 + simulationParams.corpseRainDecayCoeff * (w.precipitation01 ?? 0)
        const wetK = 1 + simulationParams.corpseWetnessDecayCoeff * (tr.wetness01 ?? 0)
        const envK = tempK * humK * rainK * wetK
        const base = Math.max(0, simulationParams.corpseBaseDecayPerSec)
        const decPerSec = base * envK
        // Use seconds-based timers: burn through initialDelay first, then timer
        if (init > 0) {
          init = Math.max(0, init - effDt)
        } else if (timer > 0) {
          const delta = decPerSec * effDt
          timer = Math.max(0, timer - delta)
        }
        // Energy remaining also slowly decays toward zero with same factor
        const energy = Math.max(0, co.energyRemaining * Math.exp(-decPerSec * effDt))
        const total = Math.max(1e-6, (co.initialDecayTime || 0) + (co.decayTimer || 0))
        const remaining = init + timer
        const frac = Math.min(1, Math.max(0, 1 - remaining / total))
        if (remaining > 0) {
          nextCorpses.push({
            x: co.x,
            y: co.y,
            radius: co.radius,
            energyRemaining: energy,
            initialDecayTime: init,
            decayTimer: timer,
            decayFrac01: frac,
          })
        }
      }
      corpses.value = nextCorpses
    }

    // Compute average movement speed across all creatures (WASM or JS paths)
    if (creatures.value.length > 0) {
      let sum = 0
      for (const c of creatures.value) sum += Math.hypot(c.vx, c.vy)
      movementStats.avgSpeed = sum / creatures.value.length
    } else {
      movementStats.avgSpeed = 0
    }

    // Telemetry series sampling (once per outer update call)
    try {
      pushSeries(telemetry.series.avgSpeed, movementStats.avgSpeed)
      pushSeries(telemetry.series.population.creatures, creatures.value.length)
      pushSeries(telemetry.series.population.plants, plants.value.length)
      pushSeries(telemetry.series.population.corpses, corpses.value.length)
      // Sample cumulative totals so UI can diff to get per-interval event rates
      pushSeries(telemetry.series.events.births, telemetry.totals.births)
      pushSeries(telemetry.series.events.deaths, telemetry.totals.deaths)
      pushSeries(telemetry.series.events.eats_plant, telemetry.totals.eats_plant)
      pushSeries(telemetry.series.events.eats_corpse, telemetry.totals.eats_corpse)
      pushSeries(telemetry.series.events.drinks, telemetry.totals.drinks)
      pushSeries(telemetry.series.events.attacks, telemetry.totals.attacks)
      pushSeries(telemetry.series.events.gets_hit, telemetry.totals.gets_hit)
      // Sample environment at camera center as a representative signal
      const wx = sampleWeather(camera.x, camera.y)
      pushSeries(telemetry.series.environment.temperatureC, wx.temperatureC)
      pushSeries(telemetry.series.environment.humidity01, wx.humidity01)
      pushSeries(telemetry.series.environment.precipitation01, wx.precipitation01)
      pushSeries(telemetry.series.environment.uv01, wx.uv01)
      pushSeries(telemetry.series.environment.visibility01, wx.visibility01)
      pushSeries(telemetry.series.environment.windSpeed, wx.windSpeed)
    } catch {}

    // If the entire population is extinct, end the generation immediately.
    if (creatures.value.length === 0) {
      endGeneration('extinction')
      return
    }

    // Stagnation detection -> end generation
    if (movementStats.avgSpeed < simulationParams.movementThreshold) stagnantTicks.value += 1
    else stagnantTicks.value = 0
    if (stagnantTicks.value >= simulationParams.stagnantTicksLimit) {
      // Kill them all and start a new generation
      endGeneration('stagnation')
      return
    }

    // Optional camera follow
    if (simulationParams.followSelected && selectedCreatureId.value) {
      const c = creatures.value.find((cc) => cc.id === selectedCreatureId.value)
      if (c) {
        centerCameraOn(c.x, c.y)
      }
    }
  }

  // Camera controls
  function clampCameraToWorld() {
    // Ensure camera center stays within world bounds, accounting for aspect and zoom
    const aspect =
      typeof window !== 'undefined' && window.innerHeight
        ? window.innerWidth / window.innerHeight
        : 16 / 9
    const worldHalf = 1000
    const visibleHalfWidth = worldHalf / camera.zoom
    const visibleHalfHeight = worldHalf / aspect / camera.zoom
    const before = { x: camera.x, y: camera.y, z: camera.zoom }

    // If the visible half-extents exceed the world half, pin the center to world center
    if (visibleHalfWidth >= worldHalf) {
      camera.x = worldHalf
    } else {
      const minX = visibleHalfWidth
      const maxX = 2000 - visibleHalfWidth
      camera.x = Math.min(Math.max(camera.x, minX), maxX)
    }

    if (visibleHalfHeight >= worldHalf) {
      camera.y = worldHalf
    } else {
      const minY = visibleHalfHeight
      const maxY = 2000 - visibleHalfHeight
      camera.y = Math.min(Math.max(camera.y, minY), maxY)
    }

    try {
      const uiPrefs = useUiPrefs()
      if (uiPrefs.isLogOn?.('camera'))
        console.debug('[Camera] clampCameraToWorld', {
          before,
          after: { x: camera.x, y: camera.y, z: camera.zoom },
          visibleHalfWidth,
          visibleHalfHeight,
          aspect,
        })
    } catch {}
  }

  function centerCameraOn(x: number, y: number) {
    const before = { x: camera.x, y: camera.y, z: camera.zoom }
    camera.x = x
    camera.y = y
    clampCameraToWorld()

    try {
      const uiPrefs = useUiPrefs()
      if (uiPrefs.isLogOn?.('camera'))
        console.debug('[Camera] centerCameraOn', { before, target: { x, y }, after: { x: camera.x, y: camera.y, z: camera.zoom } })
    } catch {}
  }

  function moveCamera(dx: number, dy: number) {
    // Convert screen-space delta to world-space using current zoom
    const before = { x: camera.x, y: camera.y, z: camera.zoom }
    camera.x -= dx / camera.zoom
    camera.y += dy / camera.zoom
    clampCameraToWorld()

    try {
      const uiPrefs = useUiPrefs()
      if (uiPrefs.isLogOn?.('camera'))
        console.debug('[Camera] moveCamera', {
          before,
          dx,
          dy,
          after: { x: camera.x, y: camera.y, z: camera.zoom },
        })
    } catch {}
  }

  function zoomCamera(delta: number) {
    // Compute dynamic min zoom so the viewport never exceeds world in either axis
    const aspect =
      typeof window !== 'undefined' && window.innerHeight
        ? window.innerWidth / window.innerHeight
        : 16 / 9
    const minZoomWidth = 1 // to keep width within world
    const minZoomHeight = 1 / Math.max(0.0001, aspect) // to keep height within world
    const minZoom = Math.max(minZoomWidth, minZoomHeight)
    const maxZoom = 5

    // Apply zoom limits
    const before = camera.zoom
    const requested = camera.zoom + delta
    const newZoom = Math.max(minZoom, Math.min(maxZoom, requested))
    try {
      const uiPrefs = useUiPrefs()
      if (uiPrefs.isLogOn?.('camera'))
        console.debug('[Camera] zoomCamera', {
          before,
          delta,
          requested,
          newZoom,
          minZoom,
          maxZoom,
          aspect,
        })
    } catch {}
    camera.zoom = newZoom

    // After zooming, clamp camera so the viewport remains inside bounds
    clampCameraToWorld()
  }

  // Entity manipulation
  function addCreature(x?: number, y?: number) {
    const posX = x ?? Math.random() * 2000
    const posY = y ?? Math.random() * 2000
    if (wasmWorld && typeof wasmWorld.spawn_creature === 'function') {
      try {
        wasmWorld.spawn_creature(posX, posY)
        telemetry.totals.births++
        // Resync from WASM for immediate consistency
        type WasmCreatureJson = {
          id: string
          x: number
          y: number
          vx: number
          vy: number
          energy?: number
          health?: number
          lifespan?: number
          diet?: 'Herbivore' | 'Carnivore' | string
          radius?: number
          brain?: {
            layer_sizes?: number[]
            layerSizes?: number[]
            weights?: number[][]
            biases?: number[][]
          } | null
        }
        if (!wasmWorld) return
        const ww2 = wasmWorld as WasmWorld
        const wcUnknown: unknown[] = ww2.creatures_json() as unknown[]
        const nameById = new Map<string, string>()
        for (const c of creatures.value) nameById.set(c.id, c.name)
        creatures.value = wcUnknown.map((raw: unknown) => {
          const c = (raw as WasmCreatureJson) || ({} as WasmCreatureJson)
          const id = String(c.id ?? crypto.randomUUID?.() ?? Math.random().toString(36).slice(2))
          return {
            id,
            name: nameSvc.assignName(id, nameById.get(id) || undefined),
            x: Number(c.x ?? 0),
            y: Number(c.y ?? 0),
            vx: Number(c.vx ?? 0),
            vy: Number(c.vy ?? 0),
            energy: Number(c.energy ?? 100),
            thirst: 100,
            stamina: 100,
            health: Number(c.health ?? 100),
            sDrive: 0,
            fear: 0,
            lifespan: Number(c.lifespan ?? 0),
            isPregnant: false,
            gestationTimer: 0,
            childGenes: null,
            genes: {},
            phenotype: {
              size: 1.0,
              speed: 2.0,
              diet: (c.diet === 'Carnivore' ? 'Carnivore' : 'Herbivore') as 'Carnivore' | 'Herbivore',
            },
            brain: c.brain
              ? (() => {
                  const ls = c.brain!.layer_sizes ?? c.brain!.layerSizes
                  const weights = c.brain!.weights
                  const biases = c.brain!.biases
                  return {
                    layerSizes: Array.isArray(ls) ? (ls as number[]) : [14, 8, 8],
                    weights: Array.isArray(weights) ? (weights as number[][]) : [],
                    biases: Array.isArray(biases) ? (biases as number[][]) : [],
                  }
                })()
              : null,
            radius: typeof c.radius === 'number' ? c.radius : 5,
            maxStamina: 100,
            communicationColor: { r: 255, g: 180, b: 255 },
            isResting: false,
            isSprinting: false,
          }
        })
        return
      } catch (e) {
        console.warn('[WASM] spawn_creature failed; falling back to JS add', e)
      }
    }
    // JS fallback creature creation
    const id = Math.random().toString(36).substring(2, 9)
    const name = nameSvc.assignName(id)
    creatures.value.push({
      id,
      name,
      x: posX,
      y: posY,
      vx: Math.random() * 2 - 1,
      vy: Math.random() * 2 - 1,
      energy: 100,
      thirst: 100,
      stamina: 100,
      health: 100,
      sDrive: 0,
      fear: 0,
      lifespan: 0,
      isPregnant: false,
      gestationTimer: 0,
      childGenes: null,
      genes: {},
      phenotype: {
        size: 1.0,
        speed: 2.0,
        diet: Math.random() > 0.8 ? 'Carnivore' : 'Herbivore',
      },
      brain: null,
      radius: 5,
      maxStamina: 100,
      communicationColor: { r: 255, g: 180, b: 255 },
      isResting: false,
      isSprinting: false,
    })
    telemetry.totals.births++
  }

  function addPlant(x?: number, y?: number) {
    const posX = x ?? Math.random() * 2000
    const posY = y ?? Math.random() * 2000
    if (wasmWorld && typeof wasmWorld.spawn_plant === 'function') {
      try {
        wasmWorld.spawn_plant(posX, posY, 3)
        // Resync plants from WASM
        const wp = (wasmWorld.plants_json() as unknown) as Array<{
          x: number
          y: number
          radius: number
        }>
        plants.value = wp.map((p) => ({ x: p.x, y: p.y, radius: p.radius }))
        return
      } catch (e) {
        console.warn('[WASM] spawn_plant failed; falling back to JS add', e)
      }
    }
    plants.value.push({ x: posX, y: posY, radius: 3 })
  }

  // Selection
  function getCreatureAtPosition(x: number, y: number): Creature | null {
    for (const creature of creatures.value) {
      const distance = Math.hypot(creature.x - x, creature.y - y)
      if (distance <= creature.radius) {
        return creature
      }
    }
    return null
  }

  // Selection helpers
  function setSelectedCreature(id: string | null) {
    selectedCreatureId.value = id
  }

  function getSelectedCreature(): Creature | null {
    if (!selectedCreatureId.value) return null
    const c = creatures.value.find((cc) => cc.id === selectedCreatureId.value)
    return c || null
  }

  // Debug helper: spawn a temporary creature and trigger a sequence of events
  function debugSpawnAndTrigger() {
    try {
      const cx = camera.x
      const cy = camera.y
      addCreature(cx, cy)
      // Newly added creature should be last in list
      const c = creatures.value[creatures.value.length - 1]
      if (!c) return
      const id = c.id
      // Make it easy to observe: select and follow the spawned creature and center camera
      try {
        setSelectedCreature?.(id)
        setFollowSelected?.(true)
        centerCameraOn?.(c.x, c.y)
      } catch {}
      const now = Date.now()
      // Emit a few debug events for visual verification (separate channel)
      pushCreatureEventDebug(id, { ts: now - 1, type: 'event', key: 'birth', label: 'Birth (debug)' })
      pushCreatureEventDebug(id, { ts: now, type: 'action', key: 'attacks', label: 'Attacks (debug)' })
      pushCreatureEventDebug(id, {
        ts: now + 50,
        type: 'action',
        key: 'gets_hit',
        label: 'Gets hit (debug)',
      })
      pushCreatureEventDebug(id, {
        ts: now + 100,
        type: 'action',
        key: 'eats_plant',
        label: 'Eats plant (debug)',
      })
      // Schedule death to verify cleanup and death event path
      setTimeout(() => {
        const cc = creatures.value.find((k: Creature) => k.id === id)
        if (cc) {
          // Push explicit death event for visibility, then apply health=0 to exercise cleanup path
          pushCreatureEventDebug(id, {
            ts: Date.now(),
            type: 'event',
            key: 'death',
            label: 'Death (debug)',
          })
          cc.health = 0
        }
      }, 400)
    } catch (e) {
      console.warn('debugSpawnAndTrigger failed', e)
    }
  }

  // Clean up resources
  function cleanup() {
    isRunning.value = false
    creatures.value = []
    plants.value = []
    corpses.value = []
  }

  // Persistence (localStorage)
  function saveSimulation(key: string = 'evosim-save') {
    try {
      const snapshot = {
        creatures: creatures.value,
        plants: plants.value,
        corpses: corpses.value,
        camera: camera,
        params: simulationParams,
      }
      localStorage.setItem(key, JSON.stringify(snapshot))
      return true
    } catch (e) {
      console.warn('Failed to save simulation', e)
      return false
    }
  }

  function loadSimulation(key: string = 'evosim-save') {
    try {
      const raw = localStorage.getItem(key)
      if (!raw) return false
      const snapshot = JSON.parse(raw)
      creatures.value = snapshot.creatures ?? []
      plants.value = snapshot.plants ?? []
      corpses.value = snapshot.corpses ?? []
      Object.assign(camera, snapshot.camera ?? {})
      Object.assign(simulationParams, snapshot.params ?? {})
      return true
    } catch (e) {
      console.warn('Failed to load simulation', e)
      return false
    }
  }

  // UI setters
  function setShowWeather(value: boolean) {
    simulationParams.showWeather = value
  }

  function setFollowSelected(value: boolean) {
    simulationParams.followSelected = value
  }

  function setAutoContinueGenerations(v: boolean) {
    simulationParams.autoContinueGenerations = !!v
  }

  function setShowVisionCones(v: boolean) {
    simulationParams.showVisionCones = !!v
  }

  function setShowDebugOverlay(v: boolean) {
    simulationParams.showDebugOverlay = !!v
  }

  // Throttle setters
  function setOverlayUpdateEvery(v: number) {
    // Minimum 1 frame; clamp to integer
    simulationParams.overlayUpdateEvery = Math.max(1, Math.round(Number(v)))
  }

  function setParityCheckEvery(v: number) {
    // Minimum 1 frame; clamp to integer
    simulationParams.parityCheckEvery = Math.max(1, Math.round(Number(v)))
  }

  function setVisionFovDeg(v: number) {
    const n = Math.max(10, Math.min(180, Math.round(v)))
    simulationParams.visionFovDeg = n
  }

  function setVisionRange(v: number) {
    const n = Math.max(5, Math.min(500, Math.round(v)))
    simulationParams.visionRange = n
  }

  // Threshold setters
  function setThirstThreshold(v: number) {
    simulationParams.thirstThreshold = Math.max(0, Math.min(100, Number(v)))
  }
  function setHungerEnergyThreshold(v: number) {
    simulationParams.hungerEnergyThreshold = Math.max(0, Math.min(100, Number(v)))
  }
  function setFatigueStaminaThreshold(v: number) {
    simulationParams.fatigueStaminaThreshold = Math.max(0, Math.min(100, Number(v)))
  }
  function setFearThreshold(v: number) {
    simulationParams.fearThreshold = Math.max(0, Math.min(100, Number(v)))
  }
  function setMatingUrgeThreshold(v: number) {
    simulationParams.matingUrgeThreshold = Math.max(0, Math.min(100, Number(v)))
  }
  function setRestlessTicks(v: number) {
    simulationParams.restlessTicks = Math.max(0, Math.round(Number(v)))
  }
  function setResourceDeltaEventThreshold(v: number) {
    simulationParams.resourceDeltaEventThreshold = Math.max(0, Number(v))
  }
  function setPainHealthDropThreshold(v: number) {
    simulationParams.painHealthDropThreshold = Math.max(0, Number(v))
  }
  function setEnergyGainEatThreshold(v: number) {
    simulationParams.energyGainEatThreshold = Math.max(0, Number(v))
  }
  function setHealthDropHitThreshold(v: number) {
    simulationParams.healthDropHitThreshold = Math.max(0, Number(v))
  }

  function setInstanceUpdateEvery(v: number) {
    const n = Math.max(1, Math.min(10, Math.round(v)))
    simulationParams.instanceUpdateEvery = n
  }

  function setInstanceUpdateChunk(v: number) {
    const n = Math.max(50, Math.min(5000, Math.round(v)))
    simulationParams.instanceUpdateChunk = n
  }

  function setAdaptivePerfEnabled(v: boolean) {
    simulationParams.adaptivePerfEnabled = v
  }

  function setTargetFps(v: number) {
    const n = Math.max(15, Math.min(120, Math.round(v)))
    simulationParams.targetFps = n
  }

  function setSimulationSpeed(v: number) {
    const allowed = [0, 0.25, 0.5, 1, 2, 4]
    const n = Number(v)
    simulationParams.simulationSpeed = allowed.includes(n) ? n : Math.max(0, n)
  }

  function setWeatherOpacity(v: number) {
    simulationParams.weatherOpacity = Math.max(0, Math.min(1, Number(v)))
  }

  // Biology parameter setters
  function setLifespanMultiplier(v: number) {
    simulationParams.lifespanMultiplier = Math.max(0.1, Math.min(10, Number(v)))
  }

  function setGestationPeriod(v: number) {
    simulationParams.gestationPeriod = Math.max(1, Math.round(Number(v)))
  }

  function setReproductionEnergy(v: number) {
    simulationParams.reproductionEnergy = Math.max(0, Number(v))
  }

  // Simulation parameter setters (expose to UI)
  function setMutationRate(v: number) {
    simulationParams.mutationRate = Math.max(0, Math.min(1, Number(v)))
  }

  function setMutationAmount(v: number) {
    simulationParams.mutationAmount = Math.max(0, Math.min(1, Number(v)))
  }

  function setPlantSpawnRate(v: number) {
    simulationParams.plantSpawnRate = Math.max(0, Math.min(5, Number(v)))
  }

  function setWaterLevel(v: number) {
    simulationParams.waterLevel = Math.max(0, Math.min(1, Number(v)))
    // Regenerate terrain if renderer loaded will read new value next time
  }

  // Cloud persistence: JSONBin
  async function saveToJSONBin(): Promise<{ ok: boolean; binId?: string; error?: unknown }> {
    try {
      // In dev, skip JSONBin entirely unless explicitly allowed
      if (import.meta.env.DEV && !import.meta.env.VITE_ALLOW_JSONBIN_DEV) {
        return { ok: false, error: 'JSONBin disabled in dev' }
      }
      const apiKey = import.meta.env.VITE_JSONBIN_KEY
      if (!apiKey) return { ok: false, error: 'Missing VITE_JSONBIN_KEY' }
      const snapshot = {
        creatures: creatures.value,
        plants: plants.value,
        corpses: corpses.value,
        camera: camera,
        params: simulationParams,
      }
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Master-Key': apiKey,
      }
      const endpoint = jsonBin.binId
        ? `https://api.jsonbin.io/v3/b/${jsonBin.binId}`
        : 'https://api.jsonbin.io/v3/b'
      const method = jsonBin.binId ? 'PUT' : 'POST'
      const res = await fetch(endpoint, { method, headers, body: JSON.stringify(snapshot) })
      if (!res.ok) {
        // Suppress noisy 401s in development when key is invalid
        if (res.status === 401 && import.meta.env?.DEV) {
          // Do not update binId or throw; just report as a soft failure
          return { ok: false, error: 'JSONBin unauthorized (dev suppressed)' }
        }
        throw new Error(`JSONBin ${method} failed: ${res.status}`)
      }
      const data = await res.json()
      const id = data?.record?.id || data?.metadata?.id || data?.id || jsonBin.binId
      if (!jsonBin.binId && id) jsonBin.binId = id
      return { ok: true, binId: jsonBin.binId }
    } catch (e) {
      // Downgrade 401 noise in dev to debug; keep warn otherwise
      const msg = e instanceof Error ? e.message : String(e)
      if (/401/.test(msg) && import.meta.env.DEV) {
        console.debug('saveToJSONBin skipped (401 dev)', e)
      } else {
        console.warn('saveToJSONBin failed', e)
      }
      return { ok: false, error: e }
    }
  }

  async function loadFromJSONBin(binId?: string): Promise<{ ok: boolean; error?: unknown }> {
    try {
      // In dev, skip JSONBin entirely unless explicitly allowed
      if (import.meta.env.DEV && !import.meta.env.VITE_ALLOW_JSONBIN_DEV) {
        return { ok: false, error: 'JSONBin disabled in dev' }
      }
      const id = binId || jsonBin.binId
      if (!id) return { ok: false, error: 'Missing binId' }
      const apiKey = import.meta.env.VITE_JSONBIN_KEY
      if (!apiKey) return { ok: false, error: 'Missing VITE_JSONBIN_KEY' }
      const headers: Record<string, string> = {
        'X-Master-Key': apiKey,
      }
      const res = await fetch(`https://api.jsonbin.io/v3/b/${id}/latest`, { headers })
      if (!res.ok) throw new Error(`JSONBin GET failed: ${res.status}`)
      const data = await res.json()
      const snapshot = data?.record || data
      loadSnapshot(snapshot)
      jsonBin.binId = id
      return { ok: true }
    } catch (e) {
      console.warn('loadFromJSONBin failed', e)
      return { ok: false, error: e }
    }
  }

  // Helpers for local file fallback and generation snapshots
  function saveJSONToLocalFile(obj: unknown, filename: string) {
    try {
      const dataStr = JSON.stringify(obj as Record<string, unknown> | unknown[], null, 2)
      const blob = new Blob([dataStr], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      return true
    } catch (e) {
      console.warn('Failed to save local file', e)
      return false
    }
  }

  async function saveGenerationSnapshot(reason: string) {
    const snapshot = {
      generation: generation.value,
      reason,
      timestamp: Date.now(),
      creatures: creatures.value,
      plants: plants.value,
      corpses: corpses.value,
      params: { ...simulationParams },
      movement: { avgSpeed: movementStats.avgSpeed, threshold: simulationParams.movementThreshold },
      badBrainHashes: Object.keys(badBrainHashes),
    }
    // Optional: try JSONBin if configured; otherwise skip cloud save silently
    try {
      const apiKey = import.meta.env.VITE_JSONBIN_KEY
      if (apiKey) {
        await saveToJSONBin()
      }
    } catch (e) {
      console.warn('Cloud save skipped/failed during generation snapshot', e)
    }
    // Also persist a localStorage backup (rolling)
    try {
      localStorage.setItem(`evosim-gen-${generation.value}`, JSON.stringify(snapshot))
    } catch (e) {
      console.warn('Failed to save localStorage generation snapshot', e)
    }
  }

  // Read-only accessors for brain cache (for UI/devtools)
  function getBrainCache(): Readonly<Record<string, { score: number; brain: unknown; genes: unknown }>> {
    return readonly(brainCache)
  }

  function getTopBrains(
    limit = 20,
  ): Array<{ hash: string; score: number; brain: unknown; genes: unknown }> {
    const entries = Object.entries(brainCache).map(([hash, v]) => ({ hash, ...v }))
    entries.sort((a, b) => b.score - a.score)
    return entries.slice(0, Math.max(0, limit))
  }

  // Manual download of current simulation state (user-triggered)
  function downloadSimulation(filename?: string) {
    const snapshot = {
      generation: generation.value,
      timestamp: Date.now(),
      creatures: creatures.value,
      plants: plants.value,
      corpses: corpses.value,
      params: { ...simulationParams },
      camera,
      badBrainHashes: Object.keys(badBrainHashes),
    }
    const fname = filename || `evosim-save-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
    saveJSONToLocalFile(snapshot, fname)
  }

  // Load a snapshot object into the current store state
  function loadSnapshot(snapshot: unknown): boolean {
    try {
      // Ensure we are not stepping while applying a snapshot
      isRunning.value = false
      const s = (snapshot as Record<string, unknown>) || {}
      creatures.value = (s.creatures as Creature[]) ?? []
      plants.value = (s.plants as Array<{ x: number; y: number; radius: number }>) ?? []
      const rawCorpses = (s.corpses as unknown[]) ?? []
      corpses.value = rawCorpses.map((rc: unknown) => {
        const r = (rc as Record<string, unknown>) || {}
        return {
          x: Number(r.x ?? 0),
          y: Number(r.y ?? 0),
          radius: Number(r.radius ?? 3),
          energyRemaining: Number((r as Record<string, unknown>).energyRemaining ?? 0),
          initialDecayTime: Number((r as Record<string, unknown>).initialDecayTime ?? 100),
          decayTimer: Number((r as Record<string, unknown>).decayTimer ?? 100),
        }
      })
      if (s.camera) Object.assign(camera, s.camera as object)
      if (s.params) Object.assign(simulationParams, s.params as object)
      if (Array.isArray(s.badBrainHashes)) {
        for (const h of s.badBrainHashes as unknown[]) if (typeof h === 'string') badBrainHashes[h] = true
      }
      // Sync merged hashes to WASM if supported
      syncBadBrainsToWasm()
      return true
    } catch (e) {
      console.warn('Failed to load snapshot', e)
      return false
    }
  }

  // Bad brain hash helpers
  function addBadBrainHash(hash: string) {
    if (typeof hash === 'string' && hash.length > 0) badBrainHashes[hash] = true
    syncBadBrainsToWasm()
  }
  function addBadBrainHashes(hashes: string[]) {
    for (const h of hashes) if (typeof h === 'string' && h.length > 0) badBrainHashes[h] = true
    syncBadBrainsToWasm()
  }
  function getBadBrainHashes(): readonly string[] {
    return Object.keys(badBrainHashes)
  }

  function exportBadBrainLibrary(filename = 'bad-brains-export.json') {
    const hashes = Object.keys(badBrainHashes)
    saveJSONToLocalFile(hashes, filename)
  }

  // Expose per-creature vision spec (safe defaults if missing)
  function getVisionSpec(target?: string | Creature) {
    let c: Creature | undefined
    if (!target) c = creatures.value.find((x) => x.id === selectedCreatureId.value)
    else if (typeof target === 'string') c = creatures.value.find((x) => x.id === target)
    else c = target
    const genes = (c?.genes as Record<string, unknown>) || {}
    const ph = (c?.phenotype as Creature['phenotype']) || ({} as Creature['phenotype'])
    const computed = computeVisionPhenotypeGlobal(genes, ph?.diet || 'Herbivore')
    return {
      sightRange: Number(ph.sightRange) || computed.sightRange,
      fieldOfViewDeg: Number(ph.fieldOfViewDeg) || computed.fieldOfViewDeg,
      eyesCount: Number.isFinite(ph.eyesCount) ? Number(ph.eyesCount) : computed.eyesCount,
      eyeAnglesDeg: Array.isArray(ph.eyeAnglesDeg) ? ph.eyeAnglesDeg : computed.eyeAnglesDeg,
    }
  }

  // Hall of Fame accessors (per-generation)
  function getHallOfFameTop(
    limit = 10,
  ): Array<{ id: string; name: string; lifespan: number; liveId?: string; gen: number }> {
    const list = hallOfFameGen.value.slice()
    list.sort((a, b) => (b.lifespan || 0) - (a.lifespan || 0))
    return list.slice(0, Math.max(0, limit))
  }

  // Cumulative Hall of Fame accessor (all-time)
  function getHallOfFameTopAll(
    limit = 10,
  ): Array<{ id: string; name: string; lifespan: number; liveId?: string; gen: number }> {
    const list = hallOfFameAll.value.slice()
    list.sort((a, b) => (b.lifespan || 0) - (a.lifespan || 0))
    return list.slice(0, Math.max(0, limit))
  }

  // Return public API
  return {
    // State
    isRunning: readonly(isRunning),
    rafHaltToken: readonly(rafHaltToken),
    creatures,
    plants,
    corpses,
    // Parity summary (for telemetry overlay)
    parityStats: readonly(parityStats),
    // World time readouts
    worldTimeSec: readonly(worldTimeSec),
    worldDayFloat: readonly(worldDayFloat),
    dayOfYear01: readonly(dayOfYear01),
    season01: readonly(season01),
    // Environment samplers
    sampleWeather,
    sampleTerrain,
    camera: readonly(camera),
    centerCameraOn,
    moveCamera,
    zoomCamera,
    generation: readonly(generation),
    movementStats: readonly(movementStats),
    currentGenStartTs: readonly(currentGenStartTs),
    telemetry: readonly(telemetry),
    stagnantTicks: readonly(stagnantTicks),
    simulationParams: readonly(simulationParams),
    // Generation end summary and signal
    lastGenEnd: readonly(lastGenEnd),
    lastGenParams: readonly(lastGenParams),
    genEndToken: readonly(genEndToken),
    wasmStatus,
    wasmDiag,
    jsonBin,

    selectedCreatureId,
    setFollowSelected,
    setInstanceUpdateEvery,
    setInstanceUpdateChunk,
    setOverlayUpdateEvery,
    setParityCheckEvery,
    setAdaptivePerfEnabled,
    setTargetFps,
    setSimulationSpeed,
    setShowWeather,
    setAutoContinueGenerations,
    setShowVisionCones,
    setShowDebugOverlay,
    setVisionFovDeg,
    setVisionRange,
    setThirstThreshold,
    setHungerEnergyThreshold,
    setFatigueStaminaThreshold,
    setFearThreshold,
    setMatingUrgeThreshold,
    setRestlessTicks,
    setResourceDeltaEventThreshold,
    setPainHealthDropThreshold,
    setEnergyGainEatThreshold,
    setHealthDropHitThreshold,
    setWeatherOpacity,
    setLifespanMultiplier,
    setGestationPeriod,
    setReproductionEnergy,
    setBrainMode,
    setBrainSeed,
    setMutationRate,
    setMutationAmount,
    setPlantSpawnRate,
    setWaterLevel,
    setMovementThreshold(v: number) {
      simulationParams.movementThreshold = Math.max(0, Number(v))
    },
    setStagnantTicksLimit(v: number) {
      simulationParams.stagnantTicksLimit = Math.max(1, Math.round(Number(v)))
    },

    // Zegion activation selection
    activationNames,
    zegionActivations,
    setZegionActivations(hidden: ActivationName, output: ActivationName) {
      if (activationNames.includes(hidden)) zegionActivations.hidden = hidden
      if (activationNames.includes(output)) zegionActivations.output = output
      // Re-init brains in JS fallback to apply immediately
      if (!wasmWorld) {
        for (const c of creatures.value) {
          const sizes = computeLayerSizesForCreature()
          c.brain = initBrain(sizes, rngBrain)
        }
      }
    },

    // Lifecycle and control
    initialize,
    retryWasmInit,
    cleanup,
    startSimulation,
    stopSimulation,
    resetSimulation,
    getVisionSpec,

    // Entity helpers
    addCreature,
    addPlant,
    getCreatureAtPosition,
    setSelectedCreature,
    getSelectedCreature,
    debugSpawnAndTrigger,

    // Persistence
    saveSimulation,
    loadSimulation,
    saveToJSONBin,
    loadFromJSONBin,
    downloadSimulation,
    loadSnapshot,

    // Step function (used by renderer loop)
    update,

    // Brain cache accessors
    getBrainCache,
    getTopBrains,
    getHallOfFameTop,
    getHallOfFameTopAll,

    // Bad brain hashes API
    addBadBrainHash,
    addBadBrainHashes,
    getBadBrainHashes,
    exportBadBrainLibrary,
    syncBadBrainsToWasm,

    // Creature events API
    getCreatureEvents,
    clearCreatureEvents,

    // Debug logging API
    setDebugLogging,
    log,
    // Input metadata API
    getInputMeta,
    getInputLabelsFor,
    getInputCategoriesFor,
  }
}
