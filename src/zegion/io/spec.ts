// Zegion Spec Loader
// Loads src/zegion.spec.json with validation and sensible fallbacks.

export type ZegionSpec = {
  name?: string
  architecture: number[]
  activations?: { hidden?: string; output?: string }
  inputs?: Array<{ key: string; desc?: string }>
  outputs?: Array<{ key: string; desc?: string }>
  initialization?: { type?: string; details?: string }
  scaling?: Record<string, unknown>
  notes?: string
}

const DEFAULT_SPEC: ZegionSpec = {
  name: 'Zegion v1 (default)',
  architecture: [24, 16, 6],
  activations: { hidden: 'relu', output: 'tanh' },
}

function isValidSpec(x: any): x is ZegionSpec {
  return (
    x &&
    Array.isArray(x.architecture) &&
    x.architecture.every((n: any) => Number.isFinite(n) && n > 0)
  )
}

// Try ESM import first (Vite supports JSON import). Fallback to fetch.
export async function getZegionSpec(): Promise<ZegionSpec> {
  try {
    // @ts-ignore - Allow assert json if available
    const mod = await import('../../zegion.spec.json', { assert: { type: 'json' } } as any)
    const raw = (mod?.default ?? mod) as unknown
    if (isValidSpec(raw)) return raw
  } catch {}
  try {
    const resp = await fetch('/src/zegion.spec.json')
    if (resp.ok) {
      const raw = await resp.json()
      if (isValidSpec(raw)) return raw
    }
  } catch {}
  return DEFAULT_SPEC
}

export default getZegionSpec
