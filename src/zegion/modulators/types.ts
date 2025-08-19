// Zegion Modulators API (stubs)
export interface ModulatorSignal {
  reward: number // normalized [-1,1]
  fatigue?: number
  novelty?: number
}

export interface SimSnapshotMinimal {
  energy: number
  health: number
  events?: { reproduced?: boolean; ate?: boolean; damaged?: boolean }
}

export type ComputeModulators = (
  prev: SimSnapshotMinimal,
  curr: SimSnapshotMinimal,
) => ModulatorSignal
