import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { shallowMount, mount } from '@vue/test-utils'
import { nextTick, reactive } from 'vue'

// Shared spies for setLastExport
const setLastExportSpy = vi.fn((key: string, fmt: 'png' | 'csv') => {})
const getLastExportSpy = vi.fn((key: string): 'png' | 'csv' | undefined => undefined)

// Mock user prefs composable
vi.mock('../composables/useUserPrefs', () => {
  const preferred = reactive<Record<string, 'png' | 'csv' | undefined>>({})
  return {
    useUserPrefs: () => ({
      setLastExport: setLastExportSpy,
      getLastExport: getLastExportSpy,
      getPreferredExport: (k: string) => preferred[k],
      setPreferredExport: (k: string, v: 'png' | 'csv') => {
        preferred[k] = v
      },
    }),
  }
})

// Mock simulation store to provide minimal telemetry/creatures
vi.mock('../composables/useSimulationStore', () => {
  return {
    useSimulationStore: () => ({
      simulationParams: { plantSpawnRate: 0.5, waterLevel: 0.3 },
      telemetry: {
        series: {
          environment: {
            temperatureC: [20, 21], humidity01: [0.5, 0.6], precipitation01: [0.1, 0.2],
            uv01: [0.2, 0.3], visibility01: [0.7, 0.8], windSpeed: [1.0, 1.1],
          },
          events: { births: [0], deaths: [0] },
          avgSpeed: [0.1, 0.2, 0.15],
          population: { creatures: [1,2], plants: [3,2], corpses: [0,1] },
        },
      },
      creatures: [
        { phenotype: { eyesCount: 2, sightRange: 90, fieldOfViewDeg: 180 } },
        { phenotype: { eyesCount: 3, sightRange: 110, fieldOfViewDeg: 160 } },
      ],
      getHallOfFameTop: () => [],
      getVisionSpec: () => ({ eyesCount: 2, sightRange: 90, fieldOfViewDeg: 180 }),
    }),
  }
})

// Silence URL/Blob/anchor used by CSV/PNG triggers
beforeAll(() => {
  vi.stubGlobal('Blob', class { constructor(_parts: any[], _opts?: any) {} } as any)
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:url'), revokeObjectURL: vi.fn() } as any)
  const origCreate = (document.createElement as any).bind(document) as typeof document.createElement
  ;(document as any).createElement = vi.fn((tag: string, options?: any) => {
    if (tag.toLowerCase() === 'a') {
      const a = origCreate('a') as HTMLAnchorElement
      a.click = vi.fn() as any
      return a as any
    }
    return origCreate(tag as any, options)
  })
})

beforeEach(() => {
  setLastExportSpy.mockClear()
})

import BehaviorEvents from '../components/summary/BehaviorEvents.vue'
import PopulationDynamics from '../components/summary/PopulationDynamics.vue'
import EnvironmentSummary from '../components/summary/EnvironmentSummary.vue'
import GeneticsBrains from '../components/summary/GeneticsBrains.vue'
import MovementActivity from '../components/summary/MovementActivity.vue'

// Helper to change a <select> by id and click the matching Export button by aria-describedby
async function selectAndExport(wrapper: any, selectId: string, fmt: 'png' | 'csv', descId: string) {
  const sel = wrapper.find(`#${selectId}`)
  await sel.setValue(fmt)
  await sel.trigger('change')
  await nextTick()
  await nextTick()
  const btn = wrapper.findAll('button').find((b: any) => b.attributes('aria-describedby') === descId)
  await btn?.trigger('click')
}

describe('Export preference persistence', () => {
  it('BehaviorEvents records last format for PNG and CSV', async () => {
    const w = mount(BehaviorEvents, { global: { stubs: { EChart: true } } })
    // Mock chart ref for PNG path
    ;(w.vm as any).chartRef = { getDataURL: () => 'data:image/png;base64,' }
    await selectAndExport(w, 'events-pref', 'png', 'events-chart-desc')
    await selectAndExport(w, 'events-pref', 'csv', 'events-chart-desc')
    expect(setLastExportSpy).toHaveBeenCalledWith('summary:behavior-events', 'png')
    expect(setLastExportSpy).toHaveBeenCalledWith('summary:behavior-events', 'csv')
  })

  it('PopulationDynamics records last format for PNG and CSV', async () => {
    const w = mount(PopulationDynamics, { global: { stubs: { UPlotStackedArea: true } } })
    // Mock area chart root for PNG path
    ;(w.vm as any).areaRef = { querySelector: () => ({ toDataURL: () => 'data:image/png;base64,' }) }
    await selectAndExport(w, 'pop-pref', 'png', 'pop-chart-desc')
    await selectAndExport(w, 'pop-pref', 'csv', 'pop-chart-desc')
    expect(setLastExportSpy).toHaveBeenCalledWith('summary:population-dynamics', 'png')
    expect(setLastExportSpy).toHaveBeenCalledWith('summary:population-dynamics', 'csv')
  })

  it('EnvironmentSummary records temp and uv preferences', async () => {
    const w = mount(EnvironmentSummary, { global: { stubs: { EChart: true } } })
    // Mock chart refs for PNG path
    ;(w.vm as any).chartTempRef = { getDataURL: () => 'data:image/png;base64,' }
    ;(w.vm as any).chartUvRef = { getDataURL: () => 'data:image/png;base64,' }
    await selectAndExport(w, 'env-temp-pref', 'png', 'env-temp-desc')
    await selectAndExport(w, 'env-temp-pref', 'csv', 'env-temp-desc')
    await selectAndExport(w, 'env-uv-pref', 'png', 'env-uv-desc')
    await selectAndExport(w, 'env-uv-pref', 'csv', 'env-uv-desc')
    expect(setLastExportSpy).toHaveBeenCalledWith('summary:env-temp', 'png')
    expect(setLastExportSpy).toHaveBeenCalledWith('summary:env-temp', 'csv')
    expect(setLastExportSpy).toHaveBeenCalledWith('summary:env-uv', 'png')
    expect(setLastExportSpy).toHaveBeenCalledWith('summary:env-uv', 'csv')
  })

  it('GeneticsBrains records eyes PNG/CSV', async () => {
    const w = mount(GeneticsBrains, { global: { stubs: { EChart: true } } })
    ;(w.vm as any).chartEyesRef = { getDataURL: () => 'data:image/png;base64,' }
    await selectAndExport(w, 'gen-eyes-pref', 'png', 'gen-eyes-desc')
    await selectAndExport(w, 'gen-eyes-pref', 'csv', 'gen-eyes-desc')
    expect(setLastExportSpy).toHaveBeenCalledWith('summary:gen-eyes', 'png')
    expect(setLastExportSpy).toHaveBeenCalledWith('summary:gen-eyes', 'csv')
  })

  it('MovementActivity records histogram and line preferences', async () => {
    const w = mount(MovementActivity, { global: { stubs: { UPlotLine: true } } })
    // Stub PNG paths to avoid DOM access while still recording last export
    ;(w.vm as any).downloadHistPng = () => { setLastExportSpy('summary:move-hist', 'png') }
    ;(w.vm as any).downloadLinePng = () => { setLastExportSpy('summary:move-line', 'png') }
    await selectAndExport(w, 'move-hist-pref', 'png', 'move-hist-desc')
    await selectAndExport(w, 'move-hist-pref', 'csv', 'move-hist-desc')
    await selectAndExport(w, 'move-line-pref', 'png', 'move-line-desc')
    await selectAndExport(w, 'move-line-pref', 'csv', 'move-line-desc')
    expect(setLastExportSpy).toHaveBeenCalledWith('summary:move-hist', 'png')
    expect(setLastExportSpy).toHaveBeenCalledWith('summary:move-hist', 'csv')
    expect(setLastExportSpy).toHaveBeenCalledWith('summary:move-line', 'png')
    expect(setLastExportSpy).toHaveBeenCalledWith('summary:move-line', 'csv')
  })
})
