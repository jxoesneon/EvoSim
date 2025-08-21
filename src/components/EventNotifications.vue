<script setup lang="ts">
import { onMounted, onBeforeUnmount, reactive } from 'vue'
import { useSimulationStore } from '../composables/useSimulationStore'

type CreatureEvent = {
  ts: number
  type: 'event' | 'action' | 'feeling' | string
  key: string
  label?: string
}

type Toast = {
  id: number
  text: string
  kind: 'action' | 'event' | 'feeling'
}

const state = reactive({
  items: [] as Toast[],
})

let nextId = 1
const MAX_ITEMS = 6

const props = defineProps<{ durationMs?: number }>()
const LIFETIME_MS = typeof props.durationMs === 'number' ? Math.max(500, props.durationMs) : 3000

const store = useSimulationStore()

function resolveCreatureName(id: string): string {
  try {
    const c = store.creatures.value.find((x: any) => x.id === id)
    return c?.name || `#${id}`
  } catch {
    return `#${id}`
  }
}

function pushToast(ev: CreatureEvent, creatureId: string) {
  const text = ev.label || `${ev.type}:${ev.key}`
  const kind =
    ev.type === 'action' || ev.type === 'event' || ev.type === 'feeling'
      ? (ev.type as 'action' | 'event' | 'feeling')
      : 'event'
  const id = nextId++
  const who = resolveCreatureName(creatureId)
  state.items.push({ id, text: `${who} · ${text}`, kind })
  // Trim
  if (state.items.length > MAX_ITEMS) state.items.splice(0, state.items.length - MAX_ITEMS)
  // Auto-remove
  setTimeout(() => {
    const idx = state.items.findIndex((t) => t.id === id)
    if (idx >= 0) state.items.splice(idx, 1)
  }, LIFETIME_MS)
}

function onCreatureEvent(e: Event) {
  const det = (e as CustomEvent).detail as { id: string; ev: CreatureEvent }
  if (!det?.id || !det?.ev) return
  // Filter: show common actions/lifecycle by default; expand as needed
  const k = det.ev.key
  const show = ['birth', 'death', 'attacks', 'gets_hit', 'eats_plant', 'eats_corpse']
  if (show.includes(k)) pushToast(det.ev, det.id)
}

onMounted(() => {
  window.addEventListener('creature-event', onCreatureEvent as EventListener)
})

onBeforeUnmount(() => {
  window.removeEventListener('creature-event', onCreatureEvent as EventListener)
})
</script>

<template>
  <!-- Center-top stacked toasts (below navbar) -->
  <TransitionGroup
    name="toast-anim"
    tag="div"
    class="pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2 w-[440px] max-w-[90vw] items-center"
  >
    <div
      v-for="t in state.items"
      :key="t.id"
      :class="[
        'pointer-events-auto shadow-lg border rounded-xl px-3 py-2 text-sm backdrop-blur bg-white/[.7125]',
        t.kind === 'action'
          ? 'border-blue-300'
          : t.kind === 'feeling'
            ? 'border-amber-300'
            : 'border-gray-300',
      ]"
      role="status"
    >
      <span class="font-medium mr-1" v-if="t.kind === 'action'">Action:</span>
      <span class="font-medium mr-1" v-else-if="t.kind === 'feeling'">Feeling:</span>
      <span class="font-medium mr-1" v-else>Event:</span>
      <span>{{ t.text }}</span>
    </div>
  </TransitionGroup>
</template>

<style scoped>
/* Fade in + slide down on enter; fade out + slide up on leave */
.toast-anim-enter-active,
.toast-anim-leave-active {
  transition:
    opacity 800ms ease,
    transform 800ms ease;
}
.toast-anim-enter-from {
  opacity: 0;
  transform: translateY(-6px);
}
.toast-anim-enter-to {
  opacity: 1;
  transform: translateY(0);
}
.toast-anim-leave-from {
  opacity: 1;
  transform: translateY(0);
}
.toast-anim-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
</style>
