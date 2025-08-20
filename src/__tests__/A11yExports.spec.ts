import { describe, it, expect, vi, beforeAll } from 'vitest'
import { shallowMount } from '@vue/test-utils'

// Mock simulation store composable used by components
vi.mock('../composables/useSimulationStore', () => {
  return {
    useSimulationStore: () => ({
      simulationParams: { plantSpawnRate: 0.5, waterLevel: 0.3 },
      telemetry: {
        totals: {},
        series: {
          events: {
            births: [0, 1, 3],
            deaths: [0, 1, 2],
            eats_plant: [0, 0, 1],
            eats_corpse: [0, 0, 0],
            drinks: [0, 0, 1],
            attacks: [0, 1, 1],
            gets_hit: [0, 0, 1],
          },
          population: { creatures: [1, 2, 3], plants: [5, 4, 3], corpses: [0, 1, 1] },
          environment: {
            temperatureC: [20, 21],
            humidity01: [0.5, 0.6],
            precipitation01: [0.1, 0.2],
            uv01: [0.2, 0.3],
            visibility01: [0.7, 0.8],
            windSpeed: [1.0, 1.1],
          },
          avgSpeed: [0.1, 0.2, 0.15],
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

// Mock user prefs (no-op persistence)
vi.mock('../composables/useUserPrefs', () => {
  return {
    useUserPrefs: () => ({
      getLastExport: () => undefined,
      setLastExport: (_k: string, _v: 'png' | 'csv') => {},
      getPreferredExport: () => undefined,
      setPreferredExport: (_k: string, _v: 'png' | 'csv') => {},
    }),
  }
})

// Silence URL/Blob/anchor in CSV export
beforeAll(() => {
  vi.stubGlobal(
    'Blob',
    class {
      constructor(_parts: any[], _opts?: any) {}
    } as any,
  )
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => 'blob:url'),
    revokeObjectURL: vi.fn(),
  } as any)
  // Only mock anchor creation, delegate others to original
  const origCreate = (document.createElement as any).bind(document) as typeof document.createElement
  ;(document as any).createElement = vi.fn((tag: string, options?: any) => {
    if (tag.toLowerCase() === 'a') return { href: '', download: '', click: vi.fn() } as any
    return origCreate(tag as any, options)
  })
})

import BehaviorEvents from '../components/summary/BehaviorEvents.vue'
import PopulationDynamics from '../components/summary/PopulationDynamics.vue'
import EnvironmentSummary from '../components/summary/EnvironmentSummary.vue'
import GeneticsBrains from '../components/summary/GeneticsBrains.vue'
import MovementActivity from '../components/summary/MovementActivity.vue'

function expectA11yExport(wrapper: any) {
  // Ensure there is at least one Export button with aria-describedby and label
  const exportBtns = wrapper.findAll('button').filter((b: any) => /export/i.test(b.text()))
  expect(exportBtns.length).toBeGreaterThan(0)
  exportBtns.forEach((btn: any) => {
    expect(btn.attributes('aria-describedby')).toBeTruthy()
    expect((btn.attributes('aria-label') || '').toLowerCase()).toContain('export')
  })
}

describe('Export controls a11y', () => {
  it('BehaviorEvents Export button has aria-describedby', () => {
    const w = shallowMount(BehaviorEvents)
    expectA11yExport(w)
  })
  it('PopulationDynamics Export button has aria-describedby', () => {
    const w = shallowMount(PopulationDynamics)
    expectA11yExport(w)
  })
  it('EnvironmentSummary Export button has aria-describedby', () => {
    const w = shallowMount(EnvironmentSummary)
    expectA11yExport(w)
  })
  it('GeneticsBrains Export button has aria-describedby', () => {
    const w = shallowMount(GeneticsBrains)
    expectA11yExport(w)
  })
  it('GeneticsBrains has preferred export selectors and Export buttons labeled', () => {
    const w = shallowMount(GeneticsBrains)
    // at least one preferred select exists and is labeled
    const selects = w.findAll('select[aria-label="Preferred export format"]')
    expect(selects.length).toBeGreaterThan(0)
    // each group should have an Export button with proper labeling
    const exportBtns = w.findAll('button').filter((b) => /export/i.test(b.text()))
    expect(exportBtns.length).toBeGreaterThan(0)
    exportBtns.forEach((btn) => {
      expect(btn.attributes('aria-describedby')).toBeTruthy()
      expect((btn.attributes('aria-label') || '').toLowerCase()).toContain('export')
    })
  })
  it('MovementActivity Export button has aria-describedby', () => {
    const w = shallowMount(MovementActivity)
    expectA11yExport(w)
  })
  it('MovementActivity has preferred export selectors and Export buttons labeled', () => {
    const w = shallowMount(MovementActivity)
    const selects = w.findAll('select[aria-label="Preferred export format"]')
    expect(selects.length).toBeGreaterThan(0)
    const exportBtns = w.findAll('button').filter((b) => /export/i.test(b.text()))
    expect(exportBtns.length).toBeGreaterThan(0)
    exportBtns.forEach((btn) => {
      expect(btn.attributes('aria-describedby')).toBeTruthy()
      expect((btn.attributes('aria-label') || '').toLowerCase()).toContain('export')
    })
  })
})
