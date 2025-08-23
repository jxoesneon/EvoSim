import { reactive } from 'vue'

interface UiPrefsState {
  fpsOn: boolean
  notificationDurationMs: number
  brainSeed: number
  activations: { hidden?: string; output?: string }
  jsonBinId: string
  telemetryOverlayOn?: boolean
  actionNoticing?: {
    enabled: boolean
    byAction: Record<string, boolean>
    holdMs: number
    zoom: number
  }
  statsPanel?: {
    activeTab: 'stats' | 'brain' | 'events'
    showInputs: boolean
    showOutputs: boolean
    showConnections: boolean
    sortBy: 'time_desc' | 'time_asc' | 'type'
    typeFilters: Record<string, boolean>
    keyFilters: Record<string, boolean>
  }
  movementActivity?: {
    showThreshold: boolean
    histBins: number
  }
  populationDynamics?: {
    hidden: { c: boolean; p: boolean; co: boolean }
    smoothing: boolean
    smoothWin: 5 | 9 | 13
    windowSel: 'full' | '1k' | '200'
  }
  vision?: {
    show: boolean
    fovDeg: number
    range: number
  }
  actionRangeOverlay?: {
    enabled: boolean
    byType: Record<string, boolean>
    alpha: number
    thin: boolean
  }
  logging?: {
    enabled: boolean
    types: Record<string, boolean>
  }
}

const STORAGE_KEY = 'evo:ui-prefs'
// Debounce handle for vision settings persistence
let visionSaveHandle: any = null
// Explicit gate: block saves until app signals hydration is complete
let suppressSaves = true

function load(): UiPrefsState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw)
      return {
        fpsOn: false,
        notificationDurationMs: 3000,
        brainSeed: 3735928559,
        activations: {},
        jsonBinId: '',
        telemetryOverlayOn: false,
        logging: {
          enabled: true,
          types: {
            action_notice: true,
            camera: true,
            renderer: true,
            input: true,
            world_to_screen: true,
            vision: false,
            ui_prefs: false,
            creature_event: false,
          },
        },
        actionNoticing: {
          enabled: true,
          byAction: {
            eats_plant: true,
            drinks_water: true,
            attacks: true,
            mates: true,
            born: true,
            dies: true,
          },
          holdMs: 5000,
          zoom: 2,
        },
        statsPanel: {
          activeTab: 'stats',
          showInputs: true,
          showOutputs: true,
          showConnections: true,
          sortBy: 'time_desc',
          typeFilters: {},
          keyFilters: {},
        },
        movementActivity: {
          showThreshold: true,
          histBins: 20,
        },
        populationDynamics: {
          hidden: { c: false, p: false, co: false },
          smoothing: false,
          smoothWin: 5,
          windowSel: 'full',
        },
        vision: {
          show: true,
          fovDeg: 90,
          range: 80,
        },
        actionRangeOverlay: {
          enabled: false,
          byType: { eat: true, drink: true, attack: true, mate: true },
          alpha: 0.2,
          thin: true,
        },
      }
    const obj = JSON.parse(raw)
    try {
      console.log('[UiPrefs] load from localStorage', obj)
    } catch {}
    return {
      fpsOn: !!obj.fpsOn,
      notificationDurationMs: Number.isFinite(obj.notificationDurationMs) ? obj.notificationDurationMs : 3000,
      brainSeed: Number.isFinite(obj.brainSeed) ? obj.brainSeed : 3735928559,
      activations: typeof obj.activations === 'object' && obj.activations ? { ...obj.activations } : {},
      jsonBinId: typeof obj.jsonBinId === 'string' ? obj.jsonBinId : '',
      telemetryOverlayOn: typeof obj.telemetryOverlayOn === 'boolean' ? obj.telemetryOverlayOn : false,
      logging: {
        enabled: typeof obj?.logging?.enabled === 'boolean' ? obj.logging.enabled : true,
        types:
          typeof obj?.logging?.types === 'object' && obj.logging.types
            ? {
                action_notice: true,
                camera: true,
                renderer: true,
                input: true,
                world_to_screen: true,
                vision: false,
                ui_prefs: false,
                creature_event: false,
                ...obj.logging.types,
              }
            : {
                action_notice: true,
                camera: true,
                renderer: true,
                input: true,
                world_to_screen: true,
                vision: false,
                ui_prefs: false,
                creature_event: false,
              },
      },
      actionNoticing: {
        enabled: typeof obj?.actionNoticing?.enabled === 'boolean' ? obj.actionNoticing.enabled : true,
        byAction:
          typeof obj?.actionNoticing?.byAction === 'object' && obj.actionNoticing.byAction
            ? {
                eats_plant: true,
                drinks_water: true,
                attacks: true,
                mates: true,
                born: true,
                dies: true,
                ...obj.actionNoticing.byAction,
              }
            : {
                eats_plant: true,
                drinks_water: true,
                attacks: true,
                mates: true,
                born: true,
                dies: true,
              },
        holdMs: Number.isFinite(obj?.actionNoticing?.holdMs) ? Number(obj.actionNoticing.holdMs) : 5000,
        zoom: Number.isFinite(obj?.actionNoticing?.zoom) ? Number(obj.actionNoticing.zoom) : 2,
      },
      statsPanel: {
        activeTab: ['stats', 'brain', 'events'].includes(obj?.statsPanel?.activeTab)
          ? obj.statsPanel.activeTab
          : 'stats',
        showInputs:
          typeof obj?.statsPanel?.showInputs === 'boolean' ? obj.statsPanel.showInputs : true,
        showOutputs:
          typeof obj?.statsPanel?.showOutputs === 'boolean' ? obj.statsPanel.showOutputs : true,
        showConnections:
          typeof obj?.statsPanel?.showConnections === 'boolean'
            ? obj.statsPanel.showConnections
            : true,
        sortBy: ['time_desc', 'time_asc', 'type'].includes(obj?.statsPanel?.sortBy)
          ? obj.statsPanel.sortBy
          : 'time_desc',
        typeFilters:
          typeof obj?.statsPanel?.typeFilters === 'object' && obj.statsPanel.typeFilters
            ? { ...obj.statsPanel.typeFilters }
            : {},
        keyFilters:
          typeof obj?.statsPanel?.keyFilters === 'object' && obj.statsPanel.keyFilters
            ? { ...obj.statsPanel.keyFilters }
            : {},
      },
      movementActivity: {
        showThreshold:
          typeof obj?.movementActivity?.showThreshold === 'boolean'
            ? obj.movementActivity.showThreshold
            : true,
        histBins: Number.isFinite(obj?.movementActivity?.histBins)
          ? Number(obj.movementActivity.histBins)
          : 20,
      },
      populationDynamics: {
        hidden:
          typeof obj?.populationDynamics?.hidden === 'object' && obj.populationDynamics.hidden
            ? { c: !!obj.populationDynamics.hidden.c, p: !!obj.populationDynamics.hidden.p, co: !!obj.populationDynamics.hidden.co }
            : { c: false, p: false, co: false },
        smoothing:
          typeof obj?.populationDynamics?.smoothing === 'boolean'
            ? obj.populationDynamics.smoothing
            : false,
        smoothWin: [5, 9, 13].includes(obj?.populationDynamics?.smoothWin)
          ? obj.populationDynamics.smoothWin
          : 5,
        windowSel: ['full', '1k', '200'].includes(obj?.populationDynamics?.windowSel)
          ? obj.populationDynamics.windowSel
          : 'full',
      },
      vision: {
        show: typeof obj?.vision?.show === 'boolean' ? obj.vision.show : true,
        fovDeg: Number.isFinite(obj?.vision?.fovDeg) ? Number(obj.vision.fovDeg) : 90,
        range: Number.isFinite(obj?.vision?.range) ? Number(obj.vision.range) : 80,
      },
      actionRangeOverlay: {
        enabled:
          typeof obj?.actionRangeOverlay?.enabled === 'boolean'
            ? obj.actionRangeOverlay.enabled
            : false,
        byType:
          typeof obj?.actionRangeOverlay?.byType === 'object' && obj.actionRangeOverlay.byType
            ? { eat: true, drink: true, attack: true, mate: true, ...obj.actionRangeOverlay.byType }
            : { eat: true, drink: true, attack: true, mate: true },
        alpha: Number.isFinite(obj?.actionRangeOverlay?.alpha)
          ? Number(obj.actionRangeOverlay.alpha)
          : 0.2,
        thin: typeof obj?.actionRangeOverlay?.thin === 'boolean'
          ? obj.actionRangeOverlay.thin
          : true,
      },
    }
  } catch (err) {
    console.warn('[UiPrefs] load failed, using defaults', err)
    return {
      fpsOn: false,
      notificationDurationMs: 3000,
      brainSeed: 3735928559,
      activations: {},
      jsonBinId: '',
      telemetryOverlayOn: false,
      logging: { enabled: true, types: { action_notice: true, camera: true, renderer: true, input: true, world_to_screen: true, vision: false, ui_prefs: false, creature_event: false } },
      actionNoticing: { enabled: true, byAction: { eats_plant: true }, holdMs: 5000, zoom: 2 },
      statsPanel: {
        activeTab: 'stats',
        showInputs: true,
        showOutputs: true,
        showConnections: true,
        sortBy: 'time_desc',
        typeFilters: {},
        keyFilters: {},
      },
      movementActivity: { showThreshold: true, histBins: 20 },
      populationDynamics: { hidden: { c: false, p: false, co: false }, smoothing: false, smoothWin: 5, windowSel: 'full' },
      vision: { show: true, fovDeg: 90, range: 80 },
      actionRangeOverlay: { enabled: false, byType: { eat: true, drink: true, attack: true, mate: true }, alpha: 0.2, thin: true },
    }
  }
}

function save(state: UiPrefsState) {
  try {
    if (suppressSaves) return
    try {
      console.log('[UiPrefs] save', state)
    } catch {}
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {}
}

const state = reactive<UiPrefsState>(load())

export function useUiPrefs() {
  function getFpsOn() {
    return state.fpsOn
  }
  function setFpsOn(v: boolean) {
    state.fpsOn = !!v
    save(state)
  }
  function getNotificationDurationMs() {
    return state.notificationDurationMs
  }
  function setNotificationDurationMs(ms: number) {
    state.notificationDurationMs = Number(ms) || 3000
    save(state)
  }
  function getBrainSeed() {
    return state.brainSeed
  }
  function setBrainSeed(v: number) {
    state.brainSeed = Number(v) >>> 0
    save(state)
  }
  function getActivations() {
    return { ...state.activations }
  }
  function setActivations(hidden?: string, output?: string) {
    state.activations.hidden = hidden
    state.activations.output = output
    save(state)
  }
  function getJsonBinId() {
    return state.jsonBinId || ''
  }
  function setJsonBinId(v: string) {
    state.jsonBinId = v || ''
    save(state)
  }
  // Telemetry overlay (Cost & Action) preference
  function getTelemetryOverlayOn() {
    return !!state.telemetryOverlayOn
  }
  function setTelemetryOverlayOn(v: boolean) {
    state.telemetryOverlayOn = !!v
    save(state)
  }
  // StatsPanel
  function getStatsPanel() {
    return { ...(state.statsPanel as NonNullable<UiPrefsState['statsPanel']>) }
  }
  function setStatsPanel(patch: Partial<NonNullable<UiPrefsState['statsPanel']>>) {
    state.statsPanel = { ...(state.statsPanel || ({} as any)), ...(patch as any) }
    save(state)
  }
  // MovementActivity
  function getMovementActivity() {
    return { ...(state.movementActivity as NonNullable<UiPrefsState['movementActivity']>) }
  }
  function setMovementActivity(patch: Partial<NonNullable<UiPrefsState['movementActivity']>>) {
    state.movementActivity = { ...(state.movementActivity || ({} as any)), ...(patch as any) }
    save(state)
  }
  // PopulationDynamics
  function getPopulationDynamics() {
    return { ...(state.populationDynamics as NonNullable<UiPrefsState['populationDynamics']>) }
  }
  function setPopulationDynamics(patch: Partial<NonNullable<UiPrefsState['populationDynamics']>>) {
    state.populationDynamics = { ...(state.populationDynamics || ({} as any)), ...(patch as any) }
    save(state)
  }
  // Vision settings
  function getVisionSettings() {
    return { ...(state.vision as NonNullable<UiPrefsState['vision']>) }
  }
  function setVisionSettings(patch: Partial<NonNullable<UiPrefsState['vision']>>) {
    try {
      console.log('[UiPrefs] setVisionSettings patch', patch)
    } catch {}
    const current = state.vision || ({} as any)
    const next = { ...current, ...(patch as any) }
    // Guard: if no actual change, skip scheduling save
    const same =
      current.show === next.show &&
      Number(current.fovDeg) === Number(next.fovDeg) &&
      Number(current.range) === Number(next.range)
    if (same) return
    state.vision = next as any
    // Debounce saves to reduce spam from rapid updates
    if (visionSaveHandle) clearTimeout(visionSaveHandle)
    visionSaveHandle = setTimeout(() => {
      save(state)
      visionSaveHandle = null
    }, 200)
  }
  // Action Range Overlay
  function getActionRangeOverlay() {
    return { ...(state.actionRangeOverlay as NonNullable<UiPrefsState['actionRangeOverlay']>) }
  }
  function setActionRangeOverlay(patch: Partial<NonNullable<UiPrefsState['actionRangeOverlay']>>) {
    state.actionRangeOverlay = { ...(state.actionRangeOverlay || ({} as any)), ...(patch as any) }
    save(state)
  }
  // Action Noticing
  function getActionNoticing() {
    return { ...(state.actionNoticing as NonNullable<UiPrefsState['actionNoticing']>) }
  }
  function setActionNoticing(patch: Partial<NonNullable<UiPrefsState['actionNoticing']>>) {
    state.actionNoticing = { ...(state.actionNoticing || ({} as any)), ...(patch as any) }
    save(state)
  }
  // Logging preferences
  function getLogging() {
    return { ...(state.logging as NonNullable<UiPrefsState['logging']>) }
  }
  function setLogging(patch: Partial<NonNullable<UiPrefsState['logging']>>) {
    const next = { ...(state.logging || ({} as any)), ...(patch as any) }
    if (patch?.types) next.types = { ...(state.logging?.types || {}), ...patch.types }
    state.logging = next as any
    save(state)
  }
  function isLogOn(type: string) {
    const g = state.logging?.enabled !== false
    const t = state.logging?.types?.[type]
    return !!g && t !== false
  }
  return {
    getFpsOn,
    setFpsOn,
    getNotificationDurationMs,
    setNotificationDurationMs,
    getBrainSeed,
    setBrainSeed,
    getActivations,
    setActivations,
    getJsonBinId,
    setJsonBinId,
    getTelemetryOverlayOn,
    setTelemetryOverlayOn,
    getStatsPanel,
    setStatsPanel,
    getMovementActivity,
    setMovementActivity,
    getPopulationDynamics,
    setPopulationDynamics,
    getVisionSettings,
    setVisionSettings,
    getActionRangeOverlay,
    setActionRangeOverlay,
    getActionNoticing,
    setActionNoticing,
    getLogging,
    setLogging,
    isLogOn,
  }
}

// Allow app to enable saves deterministically after initial hydration
export function allowUiPrefsSaves() {
  suppressSaves = false
}
