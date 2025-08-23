<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, computed, watch, nextTick } from 'vue'
import { Bars3Icon, XMarkIcon, PlayIcon, StopIcon, ArrowPathIcon } from '@heroicons/vue/24/outline'
// @ts-ignore - SFC default export provided by Vue compiler
import EcosystemRenderer from './components/EcosystemRenderer.vue'
// @ts-ignore - SFC default export provided by Vue compiler
// @ts-ignore - SFC default export provided by Vue compiler
import StatsPanel from './components/StatsPanel.vue'
// @ts-ignore - SFC default export provided by Vue compiler
import ModalContainer from './components/ModalContainer.vue'
// @ts-ignore - SFC default export provided by Vue compiler
import SummaryDashboard from './components/summary/SummaryDashboard.vue'
import { useSimulationStore } from './composables/useSimulationStore'
import { enableFPSMeter, disableFPSMeter } from './webgl/renderer'
// @ts-ignore - SFC default export provided by Vue compiler
import GeneralStats from './components/GeneralStats.vue'
// @ts-ignore - SFC default export provided by Vue compiler
import HallOfFame from './components/HallOfFame.vue'
// @ts-ignore - SFC default export provided by Vue compiler
import EventNotifications from './components/EventNotifications.vue'
import { Switch, Disclosure, DisclosureButton, DisclosurePanel } from '@headlessui/vue'
import { useUiPrefs, allowUiPrefsSaves } from './composables/useUiPrefs'
const simulationStore = useSimulationStore()
// Persisted UI preferences
const uiPrefs = useUiPrefs()
// Live selection: keep only the selected id and derive the creature from the store list each render
const selectedId = ref<string | undefined>(undefined)
const selectedCreatureLive = computed<Record<string, any> | undefined>(() => {
  const id = selectedId.value
  if (!id) return undefined
  return (simulationStore.creatures.value as any[]).find((c: any) => c.id === id)
})
const showWasmDiag = ref(false)
const retryingWasm = ref(false)

async function onRetryWasm() {
  retryingWasm.value = true
  try {
    await simulationStore.retryWasmInit()
  } finally {
    retryingWasm.value = false
  }
}

// Expose a way for components to communicate with each other
const showStatsPanel = ref(false)
const showModal = ref(false)
const modalTitle = ref('')
const modalContent = ref('')
const modalKind = ref<'html' | 'gen'>('html')

// Creatures list binding
const creatures = computed(() => simulationStore.creatures.value)

function focusAndFollow(creature: any) {
  try {
    simulationStore.setSelectedCreature?.(creature.id)
    simulationStore.setFollowSelected?.(true)
    // Immediately center to provide instant feedback
    simulationStore.centerCameraOn?.(creature.x, creature.y)
  } catch (e) {
    console.warn('Failed to focus/follow creature', e)
  }
}

function onCreatureSelected(creature: any) {
  // When clicking on the map: focus/follow then open stats
  focusAndFollow(creature)
  displayCreatureStats(creature)
}

function displayCreatureStats(creature: Record<string, any>) {
  console.debug('[App] displayCreatureStats', { id: creature?.id })
  selectedId.value = creature?.id
  showStatsPanel.value = true
}

function onStatsClose() {
  showStatsPanel.value = false
}

function showModalDialog(title: string, content: string) {
  modalTitle.value = title
  modalContent.value = content
  modalKind.value = 'html'
  showModal.value = true
}

// Settings bindings
const showWeather = computed<boolean>({
  get: () => (simulationStore.simulationParams as any).showWeather as boolean,
  set: (v: boolean) => simulationStore.setShowWeather(v),
})

// Debug overlay setting (mouse position / picking diagnostics)
const showDebugOverlay = computed<boolean>({
  get: () => (simulationStore.simulationParams as any).showDebugOverlay as boolean,
  set: (v: boolean) => simulationStore.setShowDebugOverlay?.(!!v),
})

// Console debug logging (persisted in UiPrefs)
const debugLogging = computed<boolean>({
  get: () => !!uiPrefs.getLogging().enabled,
  set: (v: boolean) => uiPrefs.setLogging({ enabled: !!v }),
})

// Logging type controls (persisted)
const logTypeOptions = [
  { key: 'action_notice', label: 'Action Notice' },
  { key: 'camera', label: 'Camera' },
  { key: 'renderer', label: 'Renderer' },
  { key: 'input', label: 'Input' },
  { key: 'world_to_screen', label: 'Coords' },
  { key: 'vision', label: 'Vision' },
  { key: 'ui_prefs', label: 'UI Prefs' },
  { key: 'creature_event', label: 'Creature Events' },
] as const
const loggingTypes = ref<Record<string, boolean>>({
  action_notice: true,
  camera: true,
  renderer: true,
  input: true,
  world_to_screen: true,
  vision: false,
  ui_prefs: false,
  creature_event: false,
  ...uiPrefs.getLogging().types,
})
function toggleLogType(k: string) {
  loggingTypes.value[k] = !loggingTypes.value[k]
  uiPrefs.setLogging({ types: { [k]: loggingTypes.value[k] } as any })
}

// Debug-only logger for temporary VisionPrefs diagnostics
function visionLog(...args: any[]) {
  if (debugLogging.value) console.log(...args)
}
function visionWarn(...args: any[]) {
  if (debugLogging.value) console.warn(...args)
}

// Notifications duration (ms) - persisted
const notificationDurationMs = ref<number>(uiPrefs.getNotificationDurationMs())
watch(
  notificationDurationMs,
  (v) => {
    uiPrefs.setNotificationDurationMs(Number(v) || 3000)
  },
  { immediate: false },
)

// Action Noticing controls (persisted)
const anEnabled = ref<boolean>(uiPrefs.getActionNoticing().enabled)
const anHoldMs = ref<number>(uiPrefs.getActionNoticing().holdMs)
const anZoom = ref<number>(uiPrefs.getActionNoticing().zoom)
// Available action types and labels
const actionOptions = [
  { key: 'eats_plant', label: 'Eat' },
  { key: 'drinks_water', label: 'Drink' },
  { key: 'attacks', label: 'Attack' },
  { key: 'mates', label: 'Mate' },
  { key: 'born', label: 'Birth' },
  { key: 'dies', label: 'Death' },
] as const
// Local reactive map of action toggles
const anByAction = ref<Record<string, boolean>>({
  eats_plant: true,
  drinks_water: true,
  attacks: true,
  mates: true,
  born: true,
  dies: true,
  ...(uiPrefs.getActionNoticing().byAction || {}),
})
function toggleAction(key: string) {
  anByAction.value[key] = !anByAction.value[key]
  applyActionNoticing()
}
function applyActionNoticing() {
  try {
    uiPrefs.setActionNoticing({
      enabled: !!anEnabled.value,
      byAction: { ...anByAction.value },
      holdMs: Number(anHoldMs.value) || 5000,
      zoom: Number(anZoom.value) || 2,
    })
  } catch (e) {
    console.warn('[App] applyActionNoticing failed', e)
  }
}

// Action Range Overlay controls (persisted)
const aroSaved = uiPrefs.getActionRangeOverlay()
const aroEnabled = ref<boolean>(!!aroSaved.enabled)
const aroAlpha = ref<number>(Number.isFinite(aroSaved.alpha) ? Number(aroSaved.alpha) : 0.2)
const aroThin = ref<boolean>(aroSaved.thin !== false)
const aroByType = ref<Record<string, boolean>>({
  eat: true,
  drink: true,
  attack: true,
  mate: true,
  ...(aroSaved.byType || {}),
})
const aroTypeOptions = [
  { key: 'eat', label: 'Eat' },
  { key: 'drink', label: 'Drink' },
  { key: 'attack', label: 'Attack' },
  { key: 'mate', label: 'Mate' },
] as const
function toggleAroType(k: string) {
  aroByType.value[k] = !aroByType.value[k]
  applyActionRangeOverlay()
}
function applyActionRangeOverlay() {
  try {
    uiPrefs.setActionRangeOverlay({
      enabled: !!aroEnabled.value,
      byType: { ...aroByType.value },
      alpha: Math.max(0, Math.min(1, Number(aroAlpha.value) || 0)),
      thin: !!aroThin.value,
    })
  } catch (e) {
    console.warn('[App] applyActionRangeOverlay failed', e)
  }
}

// (moved) Vision toggle persistence watcher is placed after vision control declarations

// JSONBin bindings (also persisted to prefs)
const jsonBinId = computed<string>({
  get: () => simulationStore.jsonBin.binId,
  set: (v: string) => (simulationStore.jsonBin.binId = v || ''),
})
watch(
  jsonBinId,
  (v) => {
    uiPrefs.setJsonBinId(v || '')
  },
  { immediate: false },
)
const hasApiKey = computed<boolean>(() => !!simulationStore.jsonBin.apiKeyPresent)

// FPS toggle (persisted)
const fpsOn = ref(uiPrefs.getFpsOn())
function onToggleFPS() {
  // Apply immediately
  if (fpsOn.value) enableFPSMeter()
  else disableFPSMeter()
  // Persist
  uiPrefs.setFpsOn(fpsOn.value)
}

// Compact indicator bindings
const generation = computed(() => simulationStore.generation)
const avgSpeed = computed(() => simulationStore.movementStats.avgSpeed)
const stagnant = computed(() => simulationStore.stagnantTicks)
const isRunning = computed(() => simulationStore.isRunning)

// Auto-continue binding for quick toggle in compact stats
const autoCont = computed<boolean>({
  get: () => (simulationStore.simulationParams as any).autoContinueGenerations as boolean,
  set: (v: boolean) => simulationStore.setAutoContinueGenerations?.(!!v),
})

// Vision controls (now persisted via useUiPrefs here)
const savedVision = uiPrefs.getVisionSettings()
const showVisionCones = computed<boolean>({
  get: () => (simulationStore.simulationParams as any).showVisionCones as boolean,
  set: (v: boolean) => {
    // Use store setter (simulationParams is exposed as readonly)
    simulationStore.setShowVisionCones?.(!!v)
  },
})
const visionFovDeg = ref<number>(
  (savedVision.fovDeg ?? (simulationStore.simulationParams as any).visionFovDeg) ?? 90,
)
const visionRange = ref<number>(
  (savedVision.range ?? (simulationStore.simulationParams as any).visionRange) ?? 80,
)
function applyVisionParams() {
  const f = Number(visionFovDeg.value)
  const r = Number(visionRange.value)
  simulationStore.setVisionFovDeg?.(f)
  simulationStore.setVisionRange?.(r)
  try {
    uiPrefs.setVisionSettings({ fovDeg: f, range: r })
    visionLog('[VisionPrefs][App] applyVisionParams saved', uiPrefs.getVisionSettings())
  } catch (e) {
    visionWarn('[VisionPrefs][App] applyVisionParams persist failed', e)
  }
}

// Persist Vision toggle changes (must be after showVisionCones is declared)
watch(
  () => showVisionCones.value,
  (v) => {
    try {
      uiPrefs.setVisionSettings({ show: !!v })
      visionLog('[VisionPrefs][App] showVisionCones changed', {
        show: !!v,
        after: uiPrefs.getVisionSettings(),
        ls: localStorage.getItem('evo:ui-prefs'),
      })
    } catch (e) {
      visionWarn('[VisionPrefs][App] showVisionCones persist failed', e)
    }
  },
  { immediate: false },
)

// Brain seed control (moved from ControlPanel) - persisted
const brainSeed = ref<number>(uiPrefs.getBrainSeed())
function applySeed() {
  simulationStore.setBrainSeed?.(Number(brainSeed.value) >>> 0)
  uiPrefs.setBrainSeed(Number(brainSeed.value) >>> 0)
}

// Zegion activations (hidden/output) - persisted
const activationNames = computed(() => simulationStore.activationNames as string[])
const selHidden = ref<string>((simulationStore.zegionActivations as any).hidden)
const selOutput = ref<string>((simulationStore.zegionActivations as any).output)
// Override with saved prefs if present
try {
  const act = uiPrefs.getActivations()
  if (act.hidden) selHidden.value = act.hidden
  if (act.output) selOutput.value = act.output
} catch {}
function applyActivations() {
  simulationStore.setZegionActivations(selHidden.value as any, selOutput.value as any)
  uiPrefs.setActivations(selHidden.value, selOutput.value)
}

// Local persistence (download/upload)
const fileInput = ref<HTMLInputElement | null>(null)
function openFilePicker() {
  fileInput.value?.click()
}
async function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files && input.files[0]
  if (!file) return
  try {
    const text = await file.text()
    const json = JSON.parse(text)
    simulationStore.loadSnapshot?.(json)
  } catch (err) {
    console.warn('Failed to load save JSON', err)
  } finally {
    if (input) input.value = ''
  }
}

// Instance update throttle binding
const instanceUpdateEvery = computed<number>({
  get: () => (simulationStore.simulationParams as any).instanceUpdateEvery as number,
  set: (v: number) => simulationStore.setInstanceUpdateEvery(v),
})

const instanceUpdateChunk = computed<number>({
  get: () => (simulationStore.simulationParams as any).instanceUpdateChunk as number,
  set: (v: number) => simulationStore.setInstanceUpdateChunk(v),
})

// Adaptive performance bindings
const adaptivePerfEnabled = computed<boolean>({
  get: () => (simulationStore.simulationParams as any).adaptivePerfEnabled as boolean,
  set: (v: boolean) => simulationStore.setAdaptivePerfEnabled(v),
})
const targetFps = computed<number>({
  get: () => (simulationStore.simulationParams as any).targetFps as number,
  set: (v: number) => simulationStore.setTargetFps(v),
})

// Weather opacity binding
const weatherOpacity = computed<number>({
  get: () => (simulationStore.simulationParams as any).weatherOpacity as number,
  set: (v: number) => simulationStore.setWeatherOpacity(v),
})

// Brain mode binding
const brainMode = computed<'OG' | 'Zegion'>({
  get: () => (simulationStore.simulationParams as any).brainMode as 'OG' | 'Zegion',
  set: (v: 'OG' | 'Zegion') => simulationStore.setBrainMode(v),
})

// Biology/Evolution related bindings
const lifespanMultiplier = computed<number>({
  get: () => (simulationStore.simulationParams as any).lifespanMultiplier as number,
  set: (v: number) => simulationStore.setLifespanMultiplier(v),
})
const gestationPeriod = computed<number>({
  get: () => (simulationStore.simulationParams as any).gestationPeriod as number,
  set: (v: number) => simulationStore.setGestationPeriod(v),
})
const reproductionEnergy = computed<number>({
  get: () => (simulationStore.simulationParams as any).reproductionEnergy as number,
  set: (v: number) => simulationStore.setReproductionEnergy(v),
})

// Follow selected and key simulation settings
const followSelected = computed<boolean>({
  get: () => (simulationStore.simulationParams as any).followSelected as boolean,
  set: (v: boolean) => simulationStore.setFollowSelected(v),
})
const mutationRate = computed<number>({
  get: () => (simulationStore.simulationParams as any).mutationRate as number,
  set: (v: number) => simulationStore.setMutationRate(v),
})
const mutationAmount = computed<number>({
  get: () => (simulationStore.simulationParams as any).mutationAmount as number,
  set: (v: number) => simulationStore.setMutationAmount(v),
})
const plantSpawnRate = computed<number>({
  get: () => (simulationStore.simulationParams as any).plantSpawnRate as number,
  set: (v: number) => simulationStore.setPlantSpawnRate(v),
})
const waterLevel = computed<number>({
  get: () => (simulationStore.simulationParams as any).waterLevel as number,
  set: (v: number) => simulationStore.setWaterLevel(v),
})

// Generation control bindings
const movementThreshold = computed<number>({
  get: () => (simulationStore.simulationParams as any).movementThreshold as number,
  set: (v: number) => simulationStore.setMovementThreshold(v),
})
const stagnantTicksLimit = computed<number>({
  get: () => (simulationStore.simulationParams as any).stagnantTicksLimit as number,
  set: (v: number) => simulationStore.setStagnantTicksLimit(v),
})

// JSONBin UX state
const jsonBinLoading = ref(false)
const jsonBinMsg = ref<{ kind: 'ok' | 'err'; text: string } | null>(null)

async function onSaveJSONBin() {
  jsonBinMsg.value = null
  jsonBinLoading.value = true
  try {
    const res = await simulationStore.saveToJSONBin()
    if (res.ok) {
      jsonBinMsg.value = { kind: 'ok', text: `Saved${res.binId ? ` (bin ${res.binId})` : ''}` }
    } else {
      jsonBinMsg.value = {
        kind: 'err',
        text: `Save failed: ${String(res.error ?? 'unknown error')}`,
      }
    }
  } catch (e: any) {
    jsonBinMsg.value = { kind: 'err', text: `Save failed: ${e?.message || String(e)}` }
  } finally {
    jsonBinLoading.value = false
  }
}

async function onLoadJSONBin() {
  jsonBinMsg.value = null
  jsonBinLoading.value = true
  try {
    const res = await simulationStore.loadFromJSONBin()
    if (res.ok) {
      jsonBinMsg.value = { kind: 'ok', text: 'Loaded' }
    } else {
      jsonBinMsg.value = {
        kind: 'err',
        text: `Load failed: ${String(res.error ?? 'unknown error')}`,
      }
    }
  } catch (e: any) {
    jsonBinMsg.value = { kind: 'err', text: `Load failed: ${e?.message || String(e)}` }
  } finally {
    jsonBinLoading.value = false
  }
}

onMounted(() => {
  simulationStore.initialize()
  // Expose a test-only toggle to unmount/mount the renderer (automation only)
  try {
    if (typeof navigator !== 'undefined' && (navigator as any).webdriver) {
      ;(window as any).__toggleRenderer = () => {
        showRenderer.value = !showRenderer.value
      }
    }
  } catch {}
  // Hydrate Vision from persisted prefs FIRST, so early saves (e.g., FPS) don't overwrite it
  try {
    const v = uiPrefs.getVisionSettings()
    // Apply via store setters (avoid mutating readonly proxies)
    const show = !!(v.show ?? (simulationStore.simulationParams as any).showVisionCones ?? true)
    const fov = Number(v.fovDeg ?? (simulationStore.simulationParams as any).visionFovDeg ?? 90)
    const rng = Number(v.range ?? (simulationStore.simulationParams as any).visionRange ?? 80)
    simulationStore.setShowVisionCones?.(show)
    simulationStore.setVisionFovDeg?.(fov)
    simulationStore.setVisionRange?.(rng)
    // Sync UI inputs
    visionFovDeg.value = (simulationStore.simulationParams as any).visionFovDeg
    visionRange.value = (simulationStore.simulationParams as any).visionRange
    visionLog('[VisionPrefs][App] onMounted hydration', {
      v,
      show: (simulationStore.simulationParams as any).showVisionCones,
      fov: visionFovDeg.value,
      range: visionRange.value,
      ls: localStorage.getItem('evo:ui-prefs'),
    })
  } catch (e) {
    visionWarn('[VisionPrefs][App] onMounted hydration failed', e)
  }
  // Apply persisted FPS toggle state
  onToggleFPS()
  // Apply persisted JSONBin id
  try {
    const savedBin = uiPrefs.getJsonBinId()
    if (savedBin) simulationStore.jsonBin.binId = savedBin
  } catch {}
  // Apply persisted seed and activations into store
  try {
    simulationStore.setBrainSeed?.(Number(brainSeed.value) >>> 0)
    simulationStore.setZegionActivations(selHidden.value as any, selOutput.value as any)
  } catch {}
  // Hydration complete: now allow UiPrefs to save deterministically
  try {
    allowUiPrefsSaves()
  } catch {}
  // Auto-open Summary modal when visiting with ?uplot=1 (for layout/e2e testing)
  try {
    const usp = new URLSearchParams(window.location.search)
    if (usp.get('uplot') === '1') {
      modalTitle.value = 'Summary'
      modalContent.value = ''
      modalKind.value = 'gen'
      showModal.value = true
    }
  } catch {}
})

onBeforeUnmount(() => {
  simulationStore.cleanup()
})

// Watch generation end signal to open the summary popup when auto-continue is OFF
watch(
  () => simulationStore.genEndToken.value,
  () => {
    const auto = (simulationStore.simulationParams as any).autoContinueGenerations as boolean
    if (!auto) {
      // Ensure simulation is fully stopped before showing the summary modal
      try {
        simulationStore.stopSimulation()
      } catch (e) {
        console.warn('Failed to stop simulation on gen end', e)
      }
      const ended = simulationStore.lastGenEnd.value
      const genNum = ended?.gen ?? (simulationStore.generation as any)
      modalTitle.value = `Generation ${genNum} Summary`
      modalContent.value = ''
      modalKind.value = 'gen'
      showModal.value = true
    }
  },
  { immediate: false },
)

// Left (Stats) drawer state
const showStatsDrawer = ref(false)

// Telemetry overlay toggle (navbar) - persisted in UiPrefs
const showTelemetryOverlay = computed<boolean>({
  get: () => uiPrefs.getTelemetryOverlayOn(),
  set: (v: boolean) => uiPrefs.setTelemetryOverlayOn(!!v),
})
// Test hook: allow mounting/unmounting renderer to validate RAF/WebGL lifecycle
const showRenderer = ref(true)
</script>

<template>
  <div id="app" class="drawer drawer-end">
    <input id="main-drawer" type="checkbox" class="drawer-toggle" />
    <div class="drawer-content flex flex-col h-screen w-screen overflow-hidden">
      <!-- Navbar -->
      <div class="navbar bg-transparent shadow-none z-20">
        <div class="navbar-start">
          <button class="btn btn-ghost btn-sm" @click="showStatsDrawer = true" title="Open Stats">
            Stats
          </button>
          <button
            class="btn btn-ghost btn-sm ml-1"
            @click="showTelemetryOverlay = !showTelemetryOverlay"
            title="Toggle Cost & Action Telemetry"
          >
            Cost & Action Telemetry
          </button>
        </div>
        <div class="navbar-center">
          <div class="btn-group">
            <button
              @click="simulationStore.startSimulation()"
              class="btn btn-xs md:btn-sm btn-ghost"
              title="Start"
            >
              <PlayIcon class="w-4 h-4" />
              <span class="hidden md:inline ml-1">Start</span>
            </button>
            <button
              @click="simulationStore.stopSimulation()"
              class="btn btn-xs md:btn-sm btn-ghost"
              title="Stop"
            >
              <StopIcon class="w-4 h-4" />
              <span class="hidden md:inline ml-1">Stop</span>
            </button>
            <button
              @click="simulationStore.resetSimulation(false)"
              class="btn btn-xs md:btn-sm btn-ghost"
              title="Reset"
            >
              <ArrowPathIcon class="w-4 h-4" />
              <span class="hidden md:inline ml-1">Reset</span>
            </button>
            <button
              @click="simulationStore.addCreature()"
              class="btn btn-xs md:btn-sm btn-ghost"
              title="Add Creature"
            >
              + Creature
            </button>
            <button
              @click="simulationStore.addPlant()"
              class="btn btn-xs md:btn-sm btn-ghost"
              title="Add Plant"
            >
              + Plant
            </button>
          </div>
          <div class="ml-2 hidden md:flex items-center gap-1">
            <span class="text-xs opacity-80">Vision</span>
            <input
              type="checkbox"
              class="toggle toggle-xs"
              v-model="showVisionCones"
              data-testid="navbar-vision-toggle"
            />
          </div>
        </div>
        <div class="navbar-end">
          <label for="main-drawer" class="btn btn-primary btn-sm drawer-button">
            <Bars3Icon class="w-5 h-5" />
            Menu
          </label>
        </div>
      </div>

      <!-- Main Content -->
      <main class="flex-grow relative">
        <EcosystemRenderer v-if="showRenderer"
          :show-telemetry="showTelemetryOverlay"
          @creature-selected="onCreatureSelected"
        />

        <!-- Event Notifications overlay (top-right) -->
        <EventNotifications v-if="debugLogging" :duration-ms="notificationDurationMs" />

        <!-- Compact Stats: bottom-left overlay -->
        <div
          class="absolute bottom-3 left-3 z-50 join whitespace-nowrap bg-white/85 backdrop-blur px-3 pr-4 py-2 rounded-2xl shadow-xl border border-base-300 text-[11px] md:text-xs font-medium flex items-center"
          title="Generation / Avg Speed / Stagnant Ticks / Status"
        >
          <span class="badge badge-sm badge-outline join-item">Gen {{ generation }}</span>
          <span
            class="badge badge-sm badge-info text-white join-item px-3 min-w-[80px] justify-center [font-variant-numeric:tabular-nums]"
            >Avg {{ avgSpeed.toFixed(2) }}</span
          >
          <span
            class="badge badge-sm join-item px-3 min-w-[90px] justify-center [font-variant-numeric:tabular-nums]"
            >Stag {{ stagnant }}</span
          >
          <span
            :class="['badge badge-sm join-item', isRunning ? 'badge-success' : 'badge-neutral']"
          >
            {{ isRunning ? 'Running' : 'Stopped' }}
          </span>
          <!-- Auto-continue quick toggle -->
          <span class="ml-2 text-[10px] opacity-70">Auto</span>
          <input type="checkbox" class="toggle toggle-xs ml-1" v-model="autoCont" />
        </div>

        <!-- WASM status banner -->
        <div
          v-if="!simulationStore.wasmStatus.available"
          class="absolute top-0 left-0 right-0 z-50 px-3 py-2 text-xs bg-amber-100 text-amber-900 border-b border-amber-300"
          role="status"
        >
          <strong>WASM not initialized.</strong>
          Running JS fallback for creature logic. Check console for detailed logs.
          <span v-if="simulationStore.wasmStatus.lastError" class="ml-2 opacity-80">
            (last error: {{ simulationStore.wasmStatus.lastError }})
          </span>
        </div>

        <!-- WASM status dot + diagnostics panel -->
        <div class="absolute bottom-3 right-3 z-50">
          <button
            class="w-4 h-4 rounded-full shadow outline-none border"
            :class="
              simulationStore.wasmStatus.available
                ? 'bg-green-500 border-green-600'
                : 'bg-red-500 border-red-600'
            "
            title="WASM status"
            @click="showWasmDiag = !showWasmDiag"
          ></button>
          <div
            v-if="showWasmDiag"
            class="absolute bottom-full right-0 mb-2 w-[320px] max-w-[90vw] text-xs bg-white/95 backdrop-blur rounded shadow-lg border p-3 text-gray-800"
          >
            <div class="flex items-center justify-between mb-2">
              <div class="font-semibold">WASM Diagnostics</div>
              <button class="text-gray-500 hover:text-gray-800" @click="showWasmDiag = false">
                <XMarkIcon class="w-4 h-4" />
              </button>
            </div>
            <div class="space-y-1">
              <div>
                <span class="font-medium">Available:</span>
                {{ simulationStore.wasmStatus.available }}
              </div>
              <div v-if="simulationStore.wasmStatus.lastError">
                <span class="font-medium">Last Error:</span>
                <span class="break-all">{{ simulationStore.wasmStatus.lastError }}</span>
              </div>
              <div class="pt-2">
                <button
                  class="btn btn-xs btn-outline"
                  :disabled="retryingWasm"
                  @click="onRetryWasm"
                >
                  {{ retryingWasm ? 'Retrying…' : 'Retry WASM init' }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>

    <!-- Drawer/Sidebar -->
    <div class="drawer-side z-30">
      <label for="main-drawer" class="drawer-overlay"></label>
      <div class="menu p-4 w-96 min-h-full bg-base-200 text-base-content">
        <!-- Sidebar content here -->
        <div class="flex justify-between items-center mb-4">
          <h2 class="text-xl font-bold">EvoSim Menu</h2>
          <label for="main-drawer" class="btn btn-ghost btn-sm drawer-button">
            <XMarkIcon class="w-5 h-5" />
          </label>
        </div>

        <!-- Quick Actions -->
        <div class="collapse collapse-arrow bg-base-100 mb-3">
          <input type="checkbox" />
          <div class="collapse-title text-lg font-semibold px-4 py-3">Quick Actions</div>
          <div class="collapse-content px-4 pb-4 pt-0">
            <div class="flex flex-wrap gap-2">
              <button class="btn btn-sm" @click="simulationStore.addCreature()">
                Add Creature
              </button>
              <button class="btn btn-sm" @click="simulationStore.addPlant()">Add Plant</button>
              <button
                class="btn btn-sm btn-outline"
                @click="simulationStore.resetSimulation(false)"
              >
                Reset Generation
              </button>
            </div>
          </div>
        </div>

        <!-- (Removed) Ecosystem Stats from right drawer -->

        <!-- Settings Section -->
        <div class="collapse collapse-arrow bg-base-100 mb-3">
          <input type="checkbox" />
          <div class="collapse-title text-lg font-semibold px-4 py-3">Settings</div>
          <div class="collapse-content px-4 pb-4 pt-0">
            <div class="form-control space-y-3">
              <label class="label cursor-pointer">
                <span class="label-text">Show Weather Effects</span>
                <input type="checkbox" class="toggle toggle-primary" v-model="showWeather" />
              </label>
              <label class="label cursor-pointer">
                <span class="label-text">Follow Selected Creature</span>
                <input type="checkbox" class="toggle toggle-primary" v-model="followSelected" />
              </label>
              <label class="label">
                <span class="label-text">Weather Opacity</span>
              </label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                v-model.number="weatherOpacity"
                class="range range-primary range-sm"
              />

              <label class="label cursor-pointer">
                <span class="label-text">Show FPS Meter</span>
                <input
                  type="checkbox"
                  class="toggle toggle-primary"
                  v-model="fpsOn"
                  @change="onToggleFPS"
                />
              </label>

              <div class="divider my-3">Vision</div>
              <label class="label cursor-pointer">
                <span class="label-text">Show Vision Cones</span>
                <input
                  type="checkbox"
                  class="toggle"
                  v-model="showVisionCones"
                  data-testid="settings-vision-toggle"
                />
              </label>
              <div class="grid grid-cols-2 gap-2">
                <label class="label">
                  <span class="label-text">FOV (deg)</span>
                </label>
                <input
                  type="number"
                  class="input input-sm input-bordered"
                  v-model.number="visionFovDeg"
                  data-testid="settings-vision-fov"
                />
                <label class="label">
                  <span class="label-text">Range</span>
                </label>
                <input
                  type="number"
                  class="input input-sm input-bordered"
                  v-model.number="visionRange"
                  data-testid="settings-vision-range"
                />
              </div>
              <button class="btn btn-sm" @click="applyVisionParams">Apply Vision</button>
            </div>
          </div>
        </div>

        <!-- Action Range Overlay Section -->
        <div class="collapse collapse-arrow bg-base-100 mb-3">
          <input type="checkbox" />
          <div class="collapse-title text-lg font-semibold px-4 py-3">Action Range Overlay</div>
          <div class="collapse-content px-4 pb-4 pt-0">
            <div class="form-control space-y-3">
              <label class="label cursor-pointer" title="Enable/disable action range overlay">
                <span class="label-text">Enabled</span>
                <input type="checkbox" class="toggle toggle-primary" v-model="aroEnabled" @change="applyActionRangeOverlay" />
              </label>
              <div>
                <div class="label pb-1"><span class="label-text">Action Types</span></div>
                <div class="flex flex-wrap gap-2">
                  <button
                    v-for="opt in aroTypeOptions"
                    :key="opt.key"
                    type="button"
                    :class="['btn btn-xs', aroByType[opt.key] ? 'btn-primary' : 'btn-outline']"
                    @click="toggleAroType(opt.key)"
                  >
                    {{ opt.label }}
                  </button>
                </div>
              </div>
              <div class="grid grid-cols-[1fr_auto] items-center gap-2">
                <label class="label"><span class="label-text">Alpha</span></label>
                <input type="range" min="0" max="1" step="0.05" class="range range-sm w-[160px] justify-self-end" v-model.number="aroAlpha" @change="applyActionRangeOverlay" />
              </div>
              <label class="label cursor-pointer" title="Use thinner stroke for rings">
                <span class="label-text">Thin Stroke</span>
                <input type="checkbox" class="toggle toggle-secondary" v-model="aroThin" @change="applyActionRangeOverlay" />
              </label>
            </div>
          </div>
        </div>

        <!-- Action Noticing Section -->
        <div class="collapse collapse-arrow bg-base-100 mb-3">
          <input type="checkbox" />
          <div class="collapse-title text-lg font-semibold px-4 py-3">Action Noticing</div>
          <div class="collapse-content px-4 pb-4 pt-0">
            <div class="form-control space-y-3">
              <label class="label cursor-pointer" title="Enable/disable action noticing">
                <span class="label-text">Enabled</span>
                <input type="checkbox" class="toggle toggle-primary" v-model="anEnabled" @change="applyActionNoticing" />
              </label>
              <div>
                <div class="label pb-1"><span class="label-text">Actions</span></div>
                <div class="flex flex-wrap gap-2">
                  <button
                    v-for="opt in actionOptions"
                    :key="opt.key"
                    type="button"
                    :class="['btn btn-xs', anByAction[opt.key] ? 'btn-primary' : 'btn-outline']"
                    @click="toggleAction(opt.key)"
                  >
                    {{ opt.label }}
                  </button>
                </div>
              </div>
              <div class="grid grid-cols-[1fr_auto] items-center gap-2">
                <label class="label"><span class="label-text">Hold (ms)</span></label>
                <input type="number" min="250" step="250" class="input input-sm input-bordered w-[120px] justify-self-end" v-model.number="anHoldMs" @change="applyActionNoticing" />
              </div>
              <div class="grid grid-cols-[1fr_auto] items-center gap-2">
                <label class="label"><span class="label-text">Zoom</span></label>
                <input type="number" min="0.2" max="10" step="0.1" class="input input-sm input-bordered w-[120px] justify-self-end" v-model.number="anZoom" @change="applyActionNoticing" />
              </div>
            </div>
          </div>
        </div>

        <!-- Debugging Tools Section -->
        <div class="collapse collapse-arrow bg-base-100 mb-3">
          <input type="checkbox" />
          <div class="collapse-title text-lg font-semibold px-4 py-3">Debugging Tools</div>
          <div class="collapse-content px-4 pb-4 pt-0">
            <div class="form-control space-y-3">
              <label
                class="label cursor-pointer"
                title="Show mouse position and picking diagnostics overlay"
              >
                <span class="label-text">Mouse Position Overlay</span>
                <input type="checkbox" class="toggle toggle-primary" v-model="showDebugOverlay" />
              </label>
              <label class="label cursor-pointer" title="Enable verbose console debug logs">
                <span class="label-text">Enable Console Debug Logs</span>
                <input type="checkbox" class="toggle toggle-secondary" v-model="debugLogging" />
              </label>
              <div>
                <div class="label pb-1"><span class="label-text">Categories</span></div>
                <div class="flex flex-wrap gap-2">
                  <button
                    v-for="opt in logTypeOptions"
                    :key="opt.key"
                    type="button"
                    :class="['btn btn-xs', loggingTypes[opt.key] ? 'btn-secondary' : 'btn-outline']"
                    @click="toggleLogType(opt.key)"
                  >
                    {{ opt.label }}
                  </button>
                </div>
              </div>
              <div>
                <button
                  class="btn btn-sm btn-outline"
                  title="Spawn a temporary creature near camera and trigger events"
                  @click="simulationStore.debugSpawnAndTrigger?.()"
                >
                  Spawn Debug Creature
                </button>
              </div>
              <div class="grid grid-cols-[1fr_auto] items-center gap-2">
                <label class="label cursor-pointer">
                  <span class="label-text">Notification Duration (ms)</span>
                </label>
                <input
                  type="number"
                  class="input input-sm input-bordered w-[120px] justify-self-end"
                  v-model.number="notificationDurationMs"
                  min="500"
                  step="100"
                />
              </div>
            </div>
          </div>
        </div>

        <!-- Evolution Section -->
        <div class="collapse collapse-arrow bg-base-100 mb-3">
          <input type="checkbox" />
          <div class="collapse-title text-lg font-semibold px-4 py-3">Evolution</div>
          <div class="collapse-content px-4 pb-4 pt-0">
            <div class="form-control space-y-3">
              <label class="label">
                <span class="label-text">Brain Mode</span>
              </label>
              <select class="select select-bordered select-sm" v-model="brainMode">
                <option value="OG">OG</option>
                <option value="Zegion">Zegion</option>
              </select>

              <div class="mt-2" v-if="brainMode === 'Zegion'">
                <div class="grid grid-cols-2 gap-2">
                  <label class="label"><span class="label-text">Hidden Act</span></label>
                  <select class="select select-bordered select-sm" v-model="selHidden">
                    <option v-for="n in activationNames" :key="n" :value="n">{{ n }}</option>
                  </select>
                  <label class="label"><span class="label-text">Output Act</span></label>
                  <select class="select select-bordered select-sm" v-model="selOutput">
                    <option v-for="n in activationNames" :key="n + '-o'" :value="n">{{ n }}</option>
                  </select>
                </div>
                <button class="btn btn-sm mt-2" @click="applyActivations">Apply Activations</button>
              </div>

              <label class="label">
                <span class="label-text">Mutation Rate: {{ mutationRate.toFixed(2) }}</span>
              </label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                v-model.number="mutationRate"
                class="range range-sm"
              />

              <label class="label">
                <span class="label-text">Mutation Amount: {{ mutationAmount.toFixed(2) }}</span>
              </label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                v-model.number="mutationAmount"
                class="range range-sm"
              />

              <div class="divider my-3">Seed</div>
              <label class="label">
                <span class="label-text">Brain Seed</span>
              </label>
              <div class="join">
                <input
                  type="number"
                  class="input input-sm input-bordered join-item"
                  v-model.number="brainSeed"
                />
                <button class="btn btn-sm join-item" @click="applySeed">Apply</button>
              </div>

              <div class="divider my-3">Biology</div>
              <label class="label">
                <span class="label-text"
                  >Lifespan Multiplier: {{ lifespanMultiplier.toFixed(2) }}</span
                >
              </label>
              <input
                type="range"
                min="0.5"
                max="3"
                step="0.1"
                v-model.number="lifespanMultiplier"
                class="range range-sm"
              />

              <label class="label">
                <span class="label-text">Gestation Period (ticks): {{ gestationPeriod }}</span>
              </label>
              <input
                type="range"
                min="50"
                max="1000"
                step="10"
                v-model.number="gestationPeriod"
                class="range range-sm"
              />

              <label class="label">
                <span class="label-text">Reproduction Energy: {{ reproductionEnergy }}</span>
              </label>
              <input
                type="range"
                min="10"
                max="200"
                step="5"
                v-model.number="reproductionEnergy"
                class="range range-sm"
              />
            </div>
          </div>
        </div>

        <!-- Generation Section -->
        <div class="collapse collapse-arrow bg-base-100 mb-3">
          <input type="checkbox" />
          <div class="collapse-title text-lg font-semibold px-4 py-3">Generation</div>
          <div class="collapse-content px-4 pb-4 pt-0">
            <div class="form-control space-y-3">
              <label class="label cursor-pointer">
                <span class="label-text">Auto-continue Generations</span>
                <input type="checkbox" class="toggle toggle-primary" v-model="autoCont" />
              </label>

              <label class="label">
                <span class="label-text"
                  >Movement Threshold: {{ movementThreshold.toFixed(3) }}</span
                >
              </label>
              <input
                type="range"
                min="0"
                max="0.2"
                step="0.005"
                v-model.number="movementThreshold"
                class="range range-sm"
              />

              <label class="label">
                <span class="label-text">Stagnant Ticks Limit: {{ stagnantTicksLimit }}</span>
              </label>
              <input
                type="range"
                min="100"
                max="5000"
                step="50"
                v-model.number="stagnantTicksLimit"
                class="range range-sm"
              />
            </div>
          </div>
        </div>

        <!-- Environment Section -->
        <div class="collapse collapse-arrow bg-base-100 mb-3">
          <input type="checkbox" />
          <div class="collapse-title text-lg font-semibold px-4 py-3">Environment</div>
          <div class="collapse-content px-4 pb-4 pt-0">
            <div class="form-control space-y-3">
              <label class="label">
                <span class="label-text">Plant Spawn Rate: {{ plantSpawnRate.toFixed(2) }}</span>
              </label>
              <input
                type="range"
                min="0"
                max="5"
                step="0.1"
                v-model.number="plantSpawnRate"
                class="range range-sm"
              />

              <label class="label">
                <span class="label-text">Water Level: {{ waterLevel.toFixed(2) }}</span>
              </label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                v-model.number="waterLevel"
                class="range range-sm"
              />
            </div>
          </div>
        </div>

        <!-- Performance Section -->
        <div class="collapse collapse-arrow bg-base-100 mb-3">
          <input type="checkbox" />
          <div class="collapse-title text-lg font-semibold px-4 py-3">Performance</div>
          <div class="collapse-content px-4 pb-4 pt-0">
            <div class="form-control space-y-3">
              <label class="label">
                <span class="label-text">Update instances every</span>
              </label>
              <select class="select select-bordered select-sm" v-model.number="instanceUpdateEvery">
                <option :value="1">1 frame</option>
                <option :value="2">2 frames</option>
                <option :value="3">3 frames</option>
                <option :value="4">4 frames</option>
                <option :value="5">5 frames</option>
              </select>

              <label class="label">
                <span class="label-text">Chunk size</span>
              </label>
              <select class="select select-bordered select-sm" v-model.number="instanceUpdateChunk">
                <option :value="200">200</option>
                <option :value="500">500</option>
                <option :value="1000">1000</option>
                <option :value="2000">2000</option>
                <option :value="3000">3000</option>
              </select>

              <label class="label cursor-pointer">
                <span class="label-text">Adaptive performance</span>
                <input
                  type="checkbox"
                  class="toggle toggle-secondary"
                  v-model="adaptivePerfEnabled"
                />
              </label>
              <div class="form-control mt-2" v-if="adaptivePerfEnabled">
                <label class="label">
                  <span class="label-text">Target FPS</span>
                </label>
                <select class="select select-bordered select-sm" v-model.number="targetFps">
                  <option :value="30">30</option>
                  <option :value="45">45</option>
                  <option :value="60">60</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        <!-- Cloud Persistence Section -->
        <div class="collapse collapse-arrow bg-base-100 mb-3">
          <input type="checkbox" />
          <div class="collapse-title text-lg font-semibold px-4 py-3">Cloud Persistence</div>
          <div class="collapse-content px-4 pb-4 pt-0">
            <div class="form-control space-y-3">
              <div class="text-xs p-1" :class="hasApiKey ? 'text-success' : 'text-error'">
                API key: {{ hasApiKey ? 'Detected' : 'Missing (set VITE_JSONBIN_KEY)' }}
              </div>
              <input
                class="input input-sm input-bordered w-full"
                type="text"
                placeholder="Bin ID (optional on first save)"
                v-model="jsonBinId"
              />
              <div class="flex gap-2">
                <button
                  class="btn btn-sm btn-primary"
                  :disabled="!hasApiKey || jsonBinLoading"
                  @click="onSaveJSONBin"
                >
                  Save
                </button>
                <button
                  class="btn btn-sm btn-secondary"
                  :disabled="(!hasApiKey && !jsonBinId) || jsonBinLoading"
                  @click="onLoadJSONBin"
                >
                  Load
                </button>
                <span v-if="jsonBinLoading" class="loading loading-spinner loading-xs"></span>
              </div>
              <div
                v-if="jsonBinMsg"
                class="text-xs mt-1 p-1"
                :class="jsonBinMsg.kind === 'ok' ? 'text-success' : 'text-error'"
              >
                {{ jsonBinMsg.text }}
              </div>
            </div>
          </div>
        </div>

        <!-- Local Persistence Section -->
        <div class="collapse collapse-arrow bg-base-100 mb-3">
          <input type="checkbox" />
          <div class="collapse-title text-lg font-semibold px-4 py-3">Local Persistence</div>
          <div class="collapse-content px-4 pb-4 pt-0">
            <div class="form-control">
              <div class="flex gap-2">
                <button class="btn btn-sm btn-outline" @click="simulationStore.saveSimulation()">
                  Save to File
                </button>
                <button class="btn btn-sm btn-outline" @click="openFilePicker">
                  Load from File
                </button>
                <input
                  ref="fileInput"
                  type="file"
                  accept="application/json"
                  class="hidden"
                  @change="onFileChange"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Stats Panel for selected creature (live binding) -->
    <StatsPanel v-if="showStatsPanel" :creature="selectedCreatureLive" @close="onStatsClose" />

    <!-- Left Stats Drawer (responsive) -->
    <div class="fixed inset-0 z-30" v-show="showStatsDrawer">
      <div class="absolute inset-0 bg-black/30" @click="showStatsDrawer = false"></div>
      <aside
        class="absolute left-0 top-0 bottom-0 w-80 md:w-96 bg-base-100 shadow-xl border-r overflow-y-auto"
      >
        <div class="p-4 flex items-center justify-between border-b">
          <h2 class="text-lg font-semibold">Ecosystem Stats</h2>
          <button class="btn btn-ghost btn-sm" @click="showStatsDrawer = false">
            <XMarkIcon class="w-5 h-5" />
          </button>
        </div>
        <div class="p-4">
          <div class="collapse collapse-arrow bg-base-100 mb-3">
            <input type="checkbox" />
            <div class="collapse-title text-md font-semibold px-2 py-2">
              Creatures ({{ creatures.length }})
            </div>
            <div class="collapse-content px-2 pb-2 pt-0">
              <div class="max-h-64 overflow-auto divide-y">
                <div
                  v-for="c in creatures"
                  :key="c.id"
                  class="py-2 flex items-center justify-between gap-2"
                >
                  <button class="btn btn-ghost btn-xs" @click="focusAndFollow(c)">
                    <span
                      class="inline-block w-2 h-2 rounded-full mr-2"
                      :style="{
                        backgroundColor: `rgb(${c.communicationColor.r}, ${c.communicationColor.g}, ${c.communicationColor.b})`,
                      }"
                    ></span>
                    <span class="truncate max-w-[150px]">{{ c.name }}</span>
                  </button>
                  <button class="btn btn-outline btn-xs" @click="displayCreatureStats(c)">
                    Stats
                  </button>
                </div>
              </div>
            </div>
          </div>
          <GeneralStats />
          <div class="hof-container mt-4">
            <h3 class="text-md font-bold mb-2 border-b pb-1">Hall of Fame</h3>
            <HallOfFame />
          </div>
        </div>
      </aside>
    </div>

    <!-- Modal Container -->
    <ModalContainer
      v-if="showModal"
      :title="modalTitle"
      :content="modalContent"
      @close="showModal = false"
    >
      <SummaryDashboard v-if="modalKind === 'gen'" />
    </ModalContainer>
  </div>
</template>

<style>
html,
body {
  margin: 0;
  padding: 0;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  font-family: 'Inter', sans-serif;
}
#app {
  width: 100%;
  height: 100%;
}
</style>
