# Zegion

A modular neuroplastic and self-evolving brain for EvoSim.

Folders:

- activations/: activation functions and registry
- plasticity/: synaptic plasticity rules and eligibility traces
- structure/: structural plasticity (add/prune/swap)
- modulators/: reward-like modulators from sim state
- evolution/: reproduction-time genetics (mutation/crossover)
- io/: JSON spec and config loading
- utils/: shared helpers (rng, math)

This is scaffolding for Zegion v2; implementations roll out in phases.

## Activations

Defined in `src/zegion/activations/index.ts` with a registry for easy extension. Currently supported:

- ReLU family: `relu`, `leaky_relu`, `prelu`, `relu6`, `selu`, `celu`
- Sigmoids/tanh: `sigmoid`, `tanh`, `hard_sigmoid`, `hard_tanh`, `softsign`, `softplus`
- GELU/SiLU/Mish: `gelu` (tanh approx), `gelu_erf` (erf exact), `swish`/`silu`, `mish`
- Mobile/Efficient: `hswish`
- Shrinkage: `tanhshrink`, `softshrink`(λ=0.5 default), `hardshrink`(λ=0.5 default)
- Periodic/others: `sine`, `gaussian`, `arctan`, `tanhexp`, `snake`, `bent_identity`

Notes:

- `gelu`: Hendrycks & Gimpel, 2016. Tanh approximation used; `gelu_erf` provides the erf exact form.
- `selu`: Klambauer et al., 2017 (self-normalizing networks); constants per paper.
- `swish`/`silu`: Ramachandran et al., 2017 (swish) / SiLU equivalence.
- `mish`: Misra, 2019.
- `hswish`/`relu6`: Howard et al., MobileNetV3.
- `snake`: periodic learnable-ish function; exposes `alpha` parameter (default 1.0).

All activations can optionally accept per-neuron params via `params?: Record<string, number>` (e.g., `alpha`, `lambda`).
