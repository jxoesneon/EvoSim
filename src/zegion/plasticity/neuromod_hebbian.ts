// Neuromodulated Hebbian Plasticity (stub)
import type {
  EligibilityTrace,
  PlasticityParams,
  PlasticityRule,
  Synapse,
  UpdateContext,
} from './types'

export const NeuromodHebbian: PlasticityRule = {
  name: 'neuromod_hebbian',
  initTraces: (synCount) =>
    new Array(synCount).fill(0).map(() => ({ value: 0 }) as EligibilityTrace),
  update: (
    synapses: Synapse[],
    traces: EligibilityTrace[],
    ctx: UpdateContext,
    params: PlasticityParams,
  ) => {
    const eta = params.eta
    const decay = params.decay ?? 0.95
    const clip = params.clip ?? 5
    const mod = ctx.modulators?.reward ?? 0 // [-1,1]
    for (let i = 0; i < synapses.length; i++) {
      const s = synapses[i]
      const e = traces[i]
      const pre = ctx.preAct[s.pre] ?? 0
      const post = ctx.postAct[s.post] ?? 0
      // Simple eligibility trace update
      e.value = e.value * decay + pre * post
      // Neuromodulated weight change
      s.w += eta * mod * e.value
      // Optional clip
      if (s.w > clip) s.w = clip
      else if (s.w < -clip) s.w = -clip
    }
  },
}

export default NeuromodHebbian
