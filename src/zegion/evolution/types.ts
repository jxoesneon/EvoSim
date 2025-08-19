// Zegion Evolution API (stubs)
export interface Genome {
  layerSizes: number[]
  weights: number[][]
  biases: number[][]
  activations?: string[]
}

export interface MutationParams {
  rate: number
  amount: number
}

export type Mutate = (g: Genome, p: MutationParams) => Genome
export type Crossover = (a: Genome, b: Genome) => Genome
