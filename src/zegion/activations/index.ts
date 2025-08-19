// Zegion Activation System (TS)
// Interface + registry + common activations

export type ActivationName =
  | 'relu'
  | 'leaky_relu'
  | 'prelu'
  | 'tanh'
  | 'sigmoid'
  | 'elu'
  | 'gelu'
  | 'gelu_erf'
  | 'swish'
  | 'selu'
  | 'softplus'
  | 'softsign'
  | 'mish'
  | 'hard_sigmoid'
  | 'hard_tanh'
  | 'relu6'
  | 'hswish'
  | 'silu'
  | 'sine'
  | 'gaussian'
  | 'arctan'
  | 'tanhexp'
  | 'snake'
  | 'celu'
  | 'tanhshrink'
  | 'softshrink'
  | 'hardshrink'
  | 'bent_identity'

export interface Activation {
  name: ActivationName
  // params: optional per-neuron params (e.g., alpha for ELU/PReLU)
  fn: (x: number, params?: Record<string, number>) => number
  dfn?: (x: number, params?: Record<string, number>) => number // optional derivative
}

export class ActivationRegistry {
  private static map = new Map<ActivationName, Activation>()
  static register(a: Activation) {
    this.map.set(a.name, a)
  }
  static get(name: ActivationName): Activation {
    const a = this.map.get(name)
    if (!a) throw new Error(`Activation not found: ${name}`)
    return a
  }
  static has(name: ActivationName) {
    return this.map.has(name)
  }
  static list(): ActivationName[] {
    return Array.from(this.map.keys())
  }
}

// Implementations
const relu: Activation = {
  name: 'relu',
  fn: (x) => (x > 0 ? x : 0),
  dfn: (x) => (x > 0 ? 1 : 0),
}

const leaky_relu: Activation = {
  name: 'leaky_relu',
  fn: (x, p) => (x > 0 ? x : (p?.alpha ?? 0.01) * x),
  dfn: (x, p) => (x > 0 ? 1 : (p?.alpha ?? 0.01)),
}

const prelu: Activation = {
  name: 'prelu',
  fn: (x, p) => (x > 0 ? x : (p?.alpha ?? 0.25) * x),
}

const tanhA: Activation = {
  name: 'tanh',
  fn: (x) => Math.tanh(x),
}

const sigmoid: Activation = {
  name: 'sigmoid',
  fn: (x) => 1 / (1 + Math.exp(-x)),
}

const elu: Activation = {
  name: 'elu',
  fn: (x, p) => (x >= 0 ? x : (p?.alpha ?? 1.0) * (Math.exp(x) - 1)),
}

// Approximate GELU (tanh-based)
const gelu: Activation = {
  name: 'gelu',
  fn: (x) => 0.5 * x * (1 + Math.tanh(Math.sqrt(2 / Math.PI) * (x + 0.044715 * Math.pow(x, 3)))),
}

// Exact GELU via erf
const gelu_erf: Activation = {
  name: 'gelu_erf',
  fn: (x) => 0.5 * x * (1 + erf(x / Math.SQRT2)),
}

const swish: Activation = {
  name: 'swish',
  fn: (x) => x / (1 + Math.exp(-x)),
}

// SELU constants (from paper)
const SELU_LAMBDA = 1.0507009873554805
const SELU_ALPHA = 1.6732632423543772
const selu: Activation = {
  name: 'selu',
  fn: (x) => (x > 0 ? SELU_LAMBDA * x : SELU_LAMBDA * (SELU_ALPHA * (Math.exp(x) - 1))),
}

// CELU: Continuously differentiable ELU
const celu: Activation = {
  name: 'celu',
  fn: (x, p) => {
    const a = p?.alpha ?? 1.0
    return Math.max(0, x) + Math.min(0, a * (Math.exp(x / a) - 1))
  },
}

const softplus: Activation = {
  name: 'softplus',
  fn: (x) => Math.log1p(Math.exp(-Math.abs(x))) + Math.max(x, 0),
}

const softsign: Activation = {
  name: 'softsign',
  fn: (x) => x / (1 + Math.abs(x)),
}

const mish: Activation = {
  name: 'mish',
  fn: (x) => x * Math.tanh(Math.log1p(Math.exp(x))),
}

// Tanhshrink: x - tanh(x)
const tanhshrink: Activation = {
  name: 'tanhshrink',
  fn: (x) => x - Math.tanh(x),
}

// Softshrink: piecewise shrinkage
const softshrink: Activation = {
  name: 'softshrink',
  fn: (x, p) => {
    const l = p?.lambda ?? 0.5
    if (x > l) return x - l
    if (x < -l) return x + l
    return 0
  },
}

// Hardshrink: x if |x| > lambda else 0
const hardshrink: Activation = {
  name: 'hardshrink',
  fn: (x, p) => {
    const l = p?.lambda ?? 0.5
    return Math.abs(x) > l ? x : 0
  },
}

// Bent identity: smooth identity-like
const bent_identity: Activation = {
  name: 'bent_identity',
  fn: (x) => (Math.sqrt(x * x + 1) - 1) / 2 + x,
}

// Additional activations
const hard_sigmoid: Activation = {
  name: 'hard_sigmoid',
  fn: (x) => {
    const y = 0.2 * x + 0.5
    return y < 0 ? 0 : y > 1 ? 1 : y
  },
}

const hard_tanh: Activation = {
  name: 'hard_tanh',
  fn: (x) => (x < -1 ? -1 : x > 1 ? 1 : x),
}

const relu6: Activation = {
  name: 'relu6',
  fn: (x) => (x < 0 ? 0 : x > 6 ? 6 : x),
}

const hswish: Activation = {
  name: 'hswish',
  fn: (x) => (x * Math.max(0, Math.min(6, x + 3))) / 6,
}

const silu: Activation = {
  name: 'silu',
  fn: (x) => x / (1 + Math.exp(-x)), // alias of swish
}

const sine: Activation = {
  name: 'sine',
  fn: (x) => Math.sin(x),
}

const gaussian: Activation = {
  name: 'gaussian',
  fn: (x) => Math.exp(-x * x),
}

const arctan: Activation = {
  name: 'arctan',
  fn: (x) => Math.atan(x),
}

const tanhexp: Activation = {
  name: 'tanhexp',
  fn: (x) => x * Math.tanh(Math.exp(Math.max(-50, Math.min(50, x)))),
}

const snake: Activation = {
  name: 'snake',
  fn: (x, p) => {
    const a = p?.alpha ?? 1.0
    return x + (1 - Math.cos(2 * a * x)) / (2 * a)
  },
}

// Helper: erf approximation (Abramowitz-Stegun based)
function erf(x: number): number {
  // constants
  const a1 = 0.254829592
  const a2 = -0.284496736
  const a3 = 1.421413741
  const a4 = -1.453152027
  const a5 = 1.061405429
  const p = 0.3275911
  const sign = x < 0 ? -1 : 1
  const ax = Math.abs(x)
  const t = 1 / (1 + p * ax)
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax)
  return sign * y
}

// Register defaults
const DEFAULT_ACTIVATIONS: Activation[] = [
  relu,
  leaky_relu,
  prelu,
  tanhA,
  sigmoid,
  elu,
  gelu,
  gelu_erf,
  swish,
  selu,
  celu,
  softplus,
  softsign,
  mish,
  tanhshrink,
  softshrink,
  hardshrink,
  bent_identity,
  hard_sigmoid,
  hard_tanh,
  relu6,
  hswish,
  silu,
  sine,
  gaussian,
  arctan,
  tanhexp,
  snake,
]
DEFAULT_ACTIVATIONS.forEach((a) => ActivationRegistry.register(a))

export default ActivationRegistry
