import { reactive } from 'vue'

// Simple localStorage-backed user preferences for summary exports
// Keys are arbitrary strings per-chart, values are 'png' | 'csv'
export type ExportFormat = 'png' | 'csv'

interface State {
  lastExport: Record<string, ExportFormat>
  preferredExport?: Record<string, ExportFormat>
}

const STORAGE_KEY = 'evo:user-prefs'

function loadState(): State {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { lastExport: {}, preferredExport: {} }
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') {
      return {
        lastExport: { ...(parsed.lastExport || {}) },
        preferredExport: { ...(parsed.preferredExport || {}) },
      }
    }
  } catch {}
  return { lastExport: {}, preferredExport: {} }
}

function saveState(state: State) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {}
}

const state = reactive<State>(loadState())

export function useUserPrefs() {
  function getLastExport(key: string): ExportFormat | undefined {
    return state.lastExport[key]
  }
  function setLastExport(key: string, fmt: ExportFormat) {
    state.lastExport[key] = fmt
    saveState(state)
  }
  function getPreferredExport(key: string): ExportFormat | undefined {
    return state.preferredExport?.[key]
  }
  function setPreferredExport(key: string, fmt: ExportFormat) {
    if (!state.preferredExport) state.preferredExport = {}
    state.preferredExport[key] = fmt
    saveState(state)
  }
  return { getLastExport, setLastExport, getPreferredExport, setPreferredExport }
}
