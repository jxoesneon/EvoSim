// Simple seedable RNG (LCG) - deterministic across JS runtimes
export class RNG {
  private state: number
  constructor(seed: number) {
    // Force to 32-bit
    this.state = seed >>> 0 || 0xdeadbeef
  }
  next(): number {
    // LCG constants Numerical Recipes
    this.state = (1664525 * this.state + 1013904223) >>> 0
    return this.state / 0x1_0000_0000
  }
  uniform(min = 0, max = 1): number {
    return min + (max - min) * this.next()
  }
  normal(mean = 0, std = 1): number {
    // Box–Muller
    const u = Math.max(1e-9, this.next())
    const v = Math.max(1e-9, this.next())
    const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
    return mean + std * z
  }
}

export default RNG
