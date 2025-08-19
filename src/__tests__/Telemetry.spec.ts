import { describe, it, expect } from 'vitest'
import { useSimulationStore } from '../composables/useSimulationStore'

function isNonDecreasing(a: number[]) {
  for (let i = 1; i < a.length; i++) if ((a[i] ?? 0) < (a[i - 1] ?? 0)) return false
  return true
}

describe('Telemetry series', () => {
  it('caps series length and keeps event counters monotonic', () => {
    const store = useSimulationStore()
    // Run enough updates to exceed cap of 3600
    for (let i = 0; i < 4200; i++) store.update()

    const series: any = (store.telemetry as any).series

    // Length caps
    expect(series.avgSpeed.length).toBeLessThanOrEqual(3600)
    expect(series.population.creatures.length).toBeLessThanOrEqual(3600)
    expect(series.population.plants.length).toBeLessThanOrEqual(3600)
    expect(series.population.corpses.length).toBeLessThanOrEqual(3600)
    expect(series.events.births.length).toBeLessThanOrEqual(3600)
    expect(series.events.deaths.length).toBeLessThanOrEqual(3600)
    expect(series.environment.temperatureC.length).toBeLessThanOrEqual(3600)
    expect(series.environment.humidity01.length).toBeLessThanOrEqual(3600)
    expect(series.environment.precipitation01.length).toBeLessThanOrEqual(3600)

    // Monotonic cumulative events
    expect(isNonDecreasing(series.events.births)).toBe(true)
    expect(isNonDecreasing(series.events.deaths)).toBe(true)
    expect(isNonDecreasing(series.events.eats_plant)).toBe(true)
    expect(isNonDecreasing(series.events.eats_corpse)).toBe(true)
    expect(isNonDecreasing(series.events.drinks)).toBe(true)
    expect(isNonDecreasing(series.events.attacks)).toBe(true)
    expect(isNonDecreasing(series.events.gets_hit)).toBe(true)
  })
})
