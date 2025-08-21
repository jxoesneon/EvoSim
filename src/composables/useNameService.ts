import { reactive } from 'vue'

/**
 * Name service to provide human-friendly names for creatures.
 * - Maintains a queue of prefetched names from randomuser.me
 * - Falls back to generated short IDs when offline or API fails
 * - Keeps a stable id->name map so names persist across WASM resyncs
 */
export function useNameService() {
  if (singleton) return singleton
  singleton = createService()
  return singleton
}

let singleton: ReturnType<typeof createService> | null = null

function createService() {
  const state = reactive({
    queue: [] as string[],
    idToName: new Map<string, string>(),
    fetching: false,
    lastError: null as string | null,
  })

  async function fetchBatch(count = 20) {
    if (state.fetching) return
    state.fetching = true
    try {
      const url = `https://randomuser.me/api/?results=${count}&inc=name&nat=us,gb,ca,au,nz`
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as any
      const names: string[] = []
      for (const r of data?.results || []) {
        const f = r?.name?.first ? String(r.name.first) : ''
        const l = r?.name?.last ? String(r.name.last) : ''
        const name = `${capitalize(f)} ${capitalize(l)}`.trim()
        if (name.length > 0) names.push(name)
      }
      if (names.length > 0) state.queue.push(...names)
      state.lastError = null
    } catch (e: any) {
      state.lastError = e?.message || String(e)
    } finally {
      state.fetching = false
    }
  }

  function getNextName(): string {
    // Pre-emptively top-up when low
    if (state.queue.length < 5 && !state.fetching) void fetchBatch(25)
    const n = state.queue.shift()
    return n || fallbackName()
  }

  function getNameForId(id: string): string {
    const prev = state.idToName.get(id)
    if (prev) return prev
    const name = getNextName()
    state.idToName.set(id, name)
    return name
  }

  function assignName(id: string, preferred?: string): string {
    if (!id) return preferred || getNextName()
    const prev = state.idToName.get(id)
    if (prev) return prev
    const name = preferred && preferred.length > 0 ? preferred : getNextName()
    state.idToName.set(id, name)
    return name
  }

  function prime(count = 40) {
    void fetchBatch(count)
  }

  return {
    state,
    fetchBatch,
    getNextName,
    getNameForId,
    assignName,
    prime,
  }
}

function fallbackName() {
  const animals = ['Lynx', 'Otter', 'Wren', 'Pika', 'Yak', 'Civet', 'Ibex', 'Stoat', 'Tern', 'Quoll']
  const adj = ['Swift', 'Bold', 'Quiet', 'Feral', 'Merry', 'Sly', 'Calm', 'Nimble', 'Brave', 'Wary']
  const a = animals[Math.floor(Math.random() * animals.length)]
  const b = adj[Math.floor(Math.random() * adj.length)]
  const id = Math.random().toString(36).substring(2, 6)
  return `${b} ${a}-${id}`
}

function capitalize(s: string) {
  if (!s) return ''
  return s.charAt(0).toUpperCase() + s.slice(1)
}
