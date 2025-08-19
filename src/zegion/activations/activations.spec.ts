import { describe, it, expect } from 'vitest'
import ActivationRegistry from '@/zegion/activations'

function approx(a: number, b: number, eps = 1e-5) {
  return Math.abs(a - b) <= eps
}

describe('Zegion Activations', () => {
  it('registers core activations', () => {
    const names = ActivationRegistry.list()
    expect(names).toContain('relu')
    expect(names).toContain('gelu')
    expect(names).toContain('gelu_erf')
    expect(names).toContain('celu')
    expect(names).toContain('tanhshrink')
    expect(names).toContain('softshrink')
    expect(names).toContain('hardshrink')
    expect(names).toContain('bent_identity')
  })

  it('gelu approx ~ gelu_erf (close values)', () => {
    const gelu = ActivationRegistry.get('gelu').fn
    const geluErf = ActivationRegistry.get('gelu_erf').fn
    const xs = [-3, -1, -0.5, 0, 0.5, 1, 3]
    for (const x of xs) {
      const a = gelu(x)
      const b = geluErf(x)
      // Should be reasonably close; allow small deviation
      expect(approx(a, b, 3e-3)).toBe(true)
    }
  })

  it('celu tends to 0 from both sides and equals 0 at 0', () => {
    const celu = ActivationRegistry.get('celu').fn
    const left = celu(-1e-6, { alpha: 1.0 })
    const right = celu(1e-6, { alpha: 1.0 })
    expect(approx(left, 0, 1e-6)).toBe(true)
    expect(approx(right, 0, 1e-6)).toBe(true)
    expect(approx(celu(0), 0, 1e-12)).toBe(true)
  })

  it('tanhshrink behaves as x - tanh(x)', () => {
    const tanhshrink = ActivationRegistry.get('tanhshrink').fn
    const x = 0.7
    expect(approx(tanhshrink(x), x - Math.tanh(x))).toBe(true)
  })

  it('softshrink applies lambda threshold', () => {
    const softshrink = ActivationRegistry.get('softshrink').fn
    const l = 0.5
    expect(softshrink(0.4, { lambda: l })).toBe(0)
    expect(softshrink(-0.4, { lambda: l })).toBe(0)
    expect(softshrink(1.0, { lambda: l })).toBeCloseTo(0.5, 6)
    expect(softshrink(-1.0, { lambda: l })).toBeCloseTo(-0.5, 6)
  })

  it('hardshrink zeros inside |x|<=lambda', () => {
    const hardshrink = ActivationRegistry.get('hardshrink').fn
    const l = 0.25
    expect(hardshrink(0.2, { lambda: l })).toBe(0)
    expect(hardshrink(-0.2, { lambda: l })).toBe(0)
    expect(hardshrink(1.0, { lambda: l })).toBeCloseTo(1.0, 12)
  })

  it('bent_identity ~ identity with smooth bend near 0', () => {
    const bent = ActivationRegistry.get('bent_identity').fn
    expect(approx(bent(0), 0, 1e-12)).toBe(true)
    expect(bent(2)).toBeGreaterThan(2) // slightly above identity for positive
    expect(bent(-2)).toBeGreaterThan(-2) // slightly above identity (less negative) for negative
  })
})
