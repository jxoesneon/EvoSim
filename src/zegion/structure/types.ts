// Zegion Structural Plasticity Types and API (stubs)
export interface AddSynapseOp {
  pre: number
  post: number
  w?: number
}
export interface PruneCriteria {
  threshold?: number
  keepTopK?: number
}
export interface AddNeuronOp {
  layerIndex: number
  activation?: string
}

export interface StructureAPI {
  addSynapses: (ops: AddSynapseOp[]) => void
  pruneSynapses: (criteria: PruneCriteria) => void
  addNeurons: (ops: AddNeuronOp[]) => void
  swapActivation: (layerIndex: number, neuronIndex: number, activation: string) => void
}
