// Zegion Plasticity Types
export type Float = number

export interface Synapse {
  pre: number // index of pre neuron
  post: number // index of post neuron
  w: Float
}

export interface EligibilityTrace {
  value: Float
}

export interface PlasticityParams {
  eta: Float // learning rate
  decay?: Float // trace decay
  clip?: Float // optional weight clip
}

export interface UpdateContext {
  preAct: Float[] // activations of pre layer
  postAct: Float[] // activations of post layer
  modulators?: Record<string, Float> // e.g., reward in [-1,1]
  dt?: Float
}

export interface PlasticityRule {
  name: string
  initTraces: (synCount: number) => EligibilityTrace[]
  update: (
    synapses: Synapse[],
    traces: EligibilityTrace[],
    ctx: UpdateContext,
    params: PlasticityParams,
  ) => void
}
