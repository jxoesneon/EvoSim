<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, unref, computed, watch, defineAsyncComponent } from 'vue'
import { useSimulationStore } from '../composables/useSimulationStore'
const CostTelemetryOverlay = defineAsyncComponent(() => import('./CostTelemetryOverlay.vue'))
import { initWebGL, renderScene } from '../webgl/renderer'

// Viewport props (canvas size + whether to show overlays)
const props = defineProps({
  width: {
    type: Number,
    default: window.innerWidth,
  },
  height: {
    type: Number,
    default: window.innerHeight,
  },
  showTelemetry: {
    type: Boolean,
    default: true,
  },
})

// Emits when a creature is selected via click/tap
const emit = defineEmits(['creature-selected'])
const canvasRef = ref<HTMLCanvasElement | null>(null)
const simulationStore = useSimulationStore()

// Speed selector (bottom-left overlay)
const speedOptions = [0, 0.25, 0.5, 1, 2, 4]
const speedLabels: Record<number, string> = {
  0: '0x',
  0.25: '0.25x',
  0.5: '0.5x',
  1: '1x',
  2: '2x',
  4: '4x',
}
const currentSpeed = computed(() => simulationStore.simulationParams.simulationSpeed)
function setSpeed(v: number) {
  simulationStore.setSimulationSpeed(v)
}
function labelForSpeed(v: number) {
  return speedLabels[v] ?? `${v}x`
}
let animationFrameId: number | null = null
let rafActive = false
let isDragging = false
const DRAG_THRESHOLD = 8
let lastMousePos = { x: 0, y: 0 }

// Listener options to satisfy Chrome's passive listener guidance
const passiveOpts: AddEventListenerOptions = { passive: true }
const nonPassiveOpts: AddEventListenerOptions = { passive: false }

// Rendering loop utilities
// Safe RAF for test/SSR environments: use globalThis to avoid unguarded window access
const raf = (cb: FrameRequestCallback): number => {
  const g: any = typeof globalThis !== 'undefined' ? (globalThis as any) : undefined
  if (g && typeof g.requestAnimationFrame === 'function') {
    return g.requestAnimationFrame(cb)
  }
  return setTimeout(
    () => cb(typeof performance !== 'undefined' ? performance.now() : Date.now()),
    16,
  ) as unknown as number
}
const caf = (id: number) => {
  const g: any = typeof globalThis !== 'undefined' ? (globalThis as any) : undefined
  if (g && typeof g.cancelAnimationFrame === 'function') {
    return g.cancelAnimationFrame(id)
  }
  return clearTimeout(id as unknown as number)
}

// Keyboard shortcut handler (Cmd/Ctrl + Ctrl + C) to copy debug overlay
function handleKeyDown(e: KeyboardEvent) {
  // Requires Cmd (meta) + Ctrl + C to copy debug info
  if ((e.metaKey || e.ctrlKey) && e.ctrlKey && (e.key === 'c' || e.key === 'C')) {
    copyDebugToClipboard()
  }
}

async function copyDebugToClipboard() {
  try {
    await navigator.clipboard.writeText(debugText.value)
  } catch (err) {
    console.warn('Clipboard write failed', err)
  }
}

// Update debug overlay on any mouse move over canvas
function updateDebugOverlay(clientX: number, clientY: number) {
  const rect = canvasRef.value?.getBoundingClientRect()
  if (!rect) return
  const aspect = rect.width / rect.height
  const worldHalf = 1000
  const visibleHalfWidth = worldHalf / simulationStore.camera.zoom
  const visibleHalfHeight = worldHalf / aspect / simulationStore.camera.zoom
  const sx = (clientX - rect.left) / rect.width
  const sy = (clientY - rect.top) / rect.height
  const x = simulationStore.camera.x - visibleHalfWidth + sx * (visibleHalfWidth * 2)
  // Invert Y: top of canvas (sy=0) should map to world top (cam.y + visibleHalfHeight)
  const y = simulationStore.camera.y + visibleHalfHeight - sy * (visibleHalfHeight * 2)
  const worldPerPxX = (visibleHalfWidth * 2) / rect.width
  const worldPerPxY = (visibleHalfHeight * 2) / rect.height
  const tolPx = 32
  const tol = Math.max(worldPerPxX, worldPerPxY) * tolPx
  const nearest = pickCreatureAt(x, y, tol)
  // Compute actual nearest distance (no tol) for diagnostics
  const list = unref(simulationStore.creatures) as any[]
  let nearestDist = Infinity
  let nearestId: any = null
  for (const c of list) {
    const d = Math.hypot((c.x ?? 0) - x, (c.y ?? 0) - y)
    if (d < nearestDist) {
      nearestDist = d
      nearestId = c?.id
    }
  }
  const cam = simulationStore.camera
  debugText.value = JSON.stringify(
    {
      screen: { x: Math.round(clientX - rect.left), y: Math.round(clientY - rect.top) },
      world: { x: +x.toFixed(2), y: +y.toFixed(2) },
      tolWorld: +tol.toFixed(2),
      tolPx,
      zoom: cam.zoom,
      cam: { x: +cam.x.toFixed(1), y: +cam.y.toFixed(1) },
      hit: nearest ? { id: nearest.id, name: nearest.name, r: nearest.radius } : null,
      nearest: { id: nearestId, d: isFinite(nearestDist) ? +nearestDist.toFixed(2) : null },
    },
    null,
    0,
  )
  debugX.value = clientX + 12
  debugY.value = clientY + 12
}
let hasDragged = false
let clickTarget: any | null = null
let suppressPan = false

// Batch debug overlay updates to one per animation frame
let pendingDebug = false
let pendingCoords: { x: number; y: number } | null = null
function scheduleDebugOverlay(x: number, y: number) {
  pendingCoords = { x, y }
  if (pendingDebug) return
  pendingDebug = true
  raf(() => {
    pendingDebug = false
    if (!pendingCoords) return
    updateDebugOverlay(pendingCoords.x, pendingCoords.y)
    pendingCoords = null
  })
}

// Debug overlay state
const debugText = ref('')
const debugX = ref(0)
const debugY = ref(0)
// Controlled by store (default off)
const showDebug = computed(() => simulationStore.simulationParams.showDebugOverlay)
let clickDetail = 0

// Handle WebGL context setup and main render loop (RAF)
onMounted(() => {
  if (canvasRef.value) {
    // Initialize WebGL context with our canvas
    initWebGL(canvasRef.value)

    const loop = () => {
      if (!rafActive) return
      const tokenAtStart = unref(simulationStore.rafHaltToken)
      // Update only if running and token hasn't changed mid-frame
      if (
        unref(simulationStore.isRunning) &&
        tokenAtStart === unref(simulationStore.rafHaltToken)
      ) {
        simulationStore.update?.()
      } else if (tokenAtStart !== unref(simulationStore.rafHaltToken)) {
        simulationStore.log('[Renderer] Halt token changed mid-frame; skip update', {
          ts: Date.now(),
        })
      }
      if (canvasRef.value) {
        renderScene(
          unref(simulationStore.creatures) as any,
          unref(simulationStore.plants) as any,
          unref(simulationStore.corpses) as any,
        )
      }
      // Re-check rafActive and halt token to avoid rescheduling after a mid-frame stop/reset
      if (!rafActive) return
      if (tokenAtStart !== unref(simulationStore.rafHaltToken)) {
        simulationStore.log('[Renderer] Halt token changed before schedule; not rescheduling', {
          ts: Date.now(),
        })
        return
      }
      animationFrameId = raf(loop)
    }

    // Start/stop helpers for the RAF loop
    function startLoop() {
      if (rafActive) return
      rafActive = true
      animationFrameId = raf(loop)
      simulationStore.log('[Renderer] RAF start', {
        ts: Date.now(),
        id: animationFrameId,
        running: unref(simulationStore.isRunning),
      })
    }
    function stopLoop() {
      rafActive = false
      if (animationFrameId !== null) {
        caf(animationFrameId)
        simulationStore.log('[Renderer] RAF cancel', { ts: Date.now(), id: animationFrameId })
        animationFrameId = null
      }
      // Render one final frame to reflect latest state while paused
      if (canvasRef.value) {
        renderScene(
          unref(simulationStore.creatures) as any,
          unref(simulationStore.plants) as any,
          unref(simulationStore.corpses) as any,
        )
      }
      simulationStore.log('[Renderer] RAF stopped', { ts: Date.now() })
    }

    // React to running state
    watch(
      simulationStore.isRunning,
      (running) => {
        const val = unref(running)
        simulationStore.log('[Renderer] isRunning changed', { ts: Date.now(), running: val })
        if (val) startLoop()
        else stopLoop()
      },
      { immediate: true },
    )

    // Force-cancel RAF on explicit halt token (guards races around watchers)
    watch(
      () => unref(simulationStore.rafHaltToken),
      () => {
        stopLoop()
      },
    )

    // Set up event handlers for interactivity
    canvasRef.value.addEventListener('mousedown', handleMouseDown)
    canvasRef.value.addEventListener('mousemove', handleMouseMove)
    canvasRef.value.addEventListener('mouseup', handleMouseUp)
    canvasRef.value.addEventListener('click', handleClick)
    // Wheel needs non-passive to allow preventDefault for zoom
    canvasRef.value.addEventListener('wheel', handleWheel, nonPassiveOpts)
    // Touch events can be passive
    canvasRef.value.addEventListener('touchstart', handleTouchStart, passiveOpts)
    canvasRef.value.addEventListener('touchmove', handleTouchMove, passiveOpts)
    canvasRef.value.addEventListener('touchend', handleTouchEnd, passiveOpts)
  }

  // Keyboard shortcut: Cmd + Ctrl + C copies debug text
  window.addEventListener('keydown', handleKeyDown)
})

onBeforeUnmount(() => {
  if (animationFrameId !== null) {
    caf(animationFrameId)
    simulationStore.log('[Renderer] unmount cancel RAF', { ts: Date.now(), id: animationFrameId })
  }
  rafActive = false

  if (canvasRef.value) {
    canvasRef.value.removeEventListener('mousedown', handleMouseDown)
    canvasRef.value.removeEventListener('mousemove', handleMouseMove)
    canvasRef.value.removeEventListener('mouseup', handleMouseUp)
    canvasRef.value.removeEventListener('click', handleClick)
    canvasRef.value.removeEventListener('wheel', handleWheel, nonPassiveOpts)
    canvasRef.value.removeEventListener('touchstart', handleTouchStart, passiveOpts)
    canvasRef.value.removeEventListener('touchmove', handleTouchMove, passiveOpts)
    canvasRef.value.removeEventListener('touchend', handleTouchEnd, passiveOpts)
  }
  window.removeEventListener('keydown', handleKeyDown)
})

// Mouse event handlers (pan/select) and click selection logic
function handleMouseDown(event: MouseEvent) {
  isDragging = true
  lastMousePos = { x: event.clientX, y: event.clientY }
  hasDragged = false
  suppressPan = false
  clickTarget = null
  scheduleDebugOverlay(event.clientX, event.clientY)

  const rect = canvasRef.value?.getBoundingClientRect()
  if (rect) {
    const aspect = rect.width / rect.height
    const worldHalf = 1000
    const visibleHalfWidth = worldHalf / simulationStore.camera.zoom
    const visibleHalfHeight = worldHalf / aspect / simulationStore.camera.zoom
    const sx = (event.clientX - rect.left) / rect.width
    const sy = (event.clientY - rect.top) / rect.height
    const x = simulationStore.camera.x - visibleHalfWidth + sx * (visibleHalfWidth * 2)
    const y = simulationStore.camera.y + visibleHalfHeight - sy * (visibleHalfHeight * 2)

    const worldPerPxX = (visibleHalfWidth * 2) / rect.width
    const worldPerPxY = (visibleHalfHeight * 2) / rect.height
    const tol = Math.max(worldPerPxX, worldPerPxY) * 8
    const candidate = pickCreatureAt(x, y, tol)
    if (candidate) {
      clickTarget = candidate
      suppressPan = true
      // Do not preventDefault to keep other interactions, but avoid panning until mouseup
      // console.debug('[EcosystemRenderer] mousedown on creature', { id: candidate.id })
    }
  }
}

function handleMouseMove(event: MouseEvent) {
  // Always update the debug overlay (throttled to rAF)
  scheduleDebugOverlay(event.clientX, event.clientY)
  if (!isDragging) return

  const dx = event.clientX - lastMousePos.x
  const dy = event.clientY - lastMousePos.y

  // If press started on a creature, suppress panning altogether until mouseup
  if (suppressPan) {
    lastMousePos = { x: event.clientX, y: event.clientY }
    return
  }

  // Only start dragging after surpassing threshold
  if (!hasDragged) {
    if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
      hasDragged = true
      // reset lastMousePos to avoid large initial jump
      lastMousePos = { x: event.clientX, y: event.clientY }
      return
    }
  } else {
    simulationStore.moveCamera(dx, dy)
    lastMousePos = { x: event.clientX, y: event.clientY }
  }
}

function handleMouseUp(event: MouseEvent) {
  // If we pressed on a creature, treat as selection regardless of small movements
  if (clickTarget) {
    simulationStore.setSelectedCreature(clickTarget.id)
    emit('creature-selected', clickTarget)
  } else if (isDragging && !hasDragged) {
    const rect = canvasRef.value?.getBoundingClientRect()
    if (rect) {
      // Map screen -> world using camera center and current zoom/aspect
      const aspect = rect.width / rect.height
      const worldHalf = 1000
      const visibleHalfWidth = worldHalf / simulationStore.camera.zoom
      const visibleHalfHeight = worldHalf / aspect / simulationStore.camera.zoom
      const sx = (event.clientX - rect.left) / rect.width // 0..1 across canvas
      const sy = (event.clientY - rect.top) / rect.height // 0..1 down canvas
      const x = simulationStore.camera.x - visibleHalfWidth + sx * (visibleHalfWidth * 2)
      const y = simulationStore.camera.y + visibleHalfHeight - sy * (visibleHalfHeight * 2)

      // Pixel-to-world tolerance (~32px)
      const worldPerPxX = (visibleHalfWidth * 2) / rect.width
      const worldPerPxY = (visibleHalfHeight * 2) / rect.height
      const tol = Math.max(worldPerPxX, worldPerPxY) * 32

      let creature = pickCreatureAt(x, y, tol)
      if (!creature) {
        // Fallback: snap to nearest within tolerance even if outside radius
        creature = pickNearestWithinTol(x, y, tol)
      }
      if (creature) {
        simulationStore.setSelectedCreature(creature.id)
        emit('creature-selected', creature)
      }
    }
  }
  isDragging = false
  hasDragged = false
  suppressPan = false
  clickTarget = null
}

// Dedicated click handler to ensure small movements don't cancel selection
function handleClick(event: MouseEvent) {
  const rect = canvasRef.value?.getBoundingClientRect()
  if (!rect) return
  // Copy on triple-click
  // event.detail provides number of consecutive clicks
  if (event.detail >= 3) {
    copyDebugToClipboard()
    return
  }
  const aspect = rect.width / rect.height
  const worldHalf = 1000
  const visibleHalfWidth = worldHalf / simulationStore.camera.zoom
  const visibleHalfHeight = worldHalf / aspect / simulationStore.camera.zoom
  const sx = (event.clientX - rect.left) / rect.width
  const sy = (event.clientY - rect.top) / rect.height
  const x = simulationStore.camera.x - visibleHalfWidth + sx * (visibleHalfWidth * 2)
  const y = simulationStore.camera.y + visibleHalfHeight - sy * (visibleHalfHeight * 2)

  // Pixel-to-world tolerance (~32px)
  const worldPerPxX = (visibleHalfWidth * 2) / rect.width
  const worldPerPxY = (visibleHalfHeight * 2) / rect.height
  const tol = Math.max(worldPerPxX, worldPerPxY) * 32

  let creature = pickCreatureAt(x, y, tol)
  if (!creature) {
    creature = pickNearestWithinTol(x, y, tol)
  }
  console.debug('[EcosystemRenderer] click world', {
    x,
    y,
    found: !!creature,
    id: creature?.id,
    tol,
  })
  if (creature) {
    simulationStore.setSelectedCreature(creature.id)
    emit('creature-selected', creature)
  }
}

// Find nearest creature within tolerance (in world units)
function pickCreatureAt(x: number, y: number, tol: number) {
  const list = unref(simulationStore.creatures) as any[]
  let best: any = null
  let bestDist = Infinity
  for (const c of list) {
    const baseR = Math.max(c?.radius ?? 0, 10)
    const r = baseR + tol
    const d = Math.hypot((c.x ?? 0) - x, (c.y ?? 0) - y)
    if (d <= r && d < bestDist) {
      best = c
      bestDist = d
    }
  }
  return best
}

// Fallback: choose the nearest creature if it's within tolerance (ignoring radius)
function pickNearestWithinTol(x: number, y: number, tol: number) {
  const list = unref(simulationStore.creatures) as any[]
  let best: any = null
  let bestDist = Infinity
  for (const c of list) {
    const d = Math.hypot((c.x ?? 0) - x, (c.y ?? 0) - y)
    if (d <= tol && d < bestDist) {
      best = c
      bestDist = d
    }
  }
  return best
}

function handleWheel(event: WheelEvent) {
  event.preventDefault()
  const delta = Math.sign(event.deltaY) * -0.1
  simulationStore.zoomCamera(delta)
}

// Touch event handlers for mobile support
function handleTouchStart(event: TouchEvent) {
  if (event.touches.length === 1) {
    isDragging = true
    lastMousePos = { x: event.touches[0].clientX, y: event.touches[0].clientY }
    hasDragged = false
  }
}

function handleTouchMove(event: TouchEvent) {
  if (!isDragging || event.touches.length !== 1) return

  const dx = event.touches[0].clientX - lastMousePos.x
  const dy = event.touches[0].clientY - lastMousePos.y

  if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
    hasDragged = true
    simulationStore.moveCamera(dx, dy)
  }

  lastMousePos = { x: event.touches[0].clientX, y: event.touches[0].clientY }
}

function handleTouchEnd(event: TouchEvent) {
  if (isDragging && !hasDragged && event.changedTouches.length === 1) {
    const touch = event.changedTouches[0]
    const rect = canvasRef.value?.getBoundingClientRect()
    if (rect) {
      // Map touch -> world using camera center and current zoom/aspect
      const aspect = rect.width / rect.height
      const worldHalf = 1000
      const visibleHalfWidth = worldHalf / simulationStore.camera.zoom
      const visibleHalfHeight = worldHalf / aspect / simulationStore.camera.zoom
      const sx = (touch.clientX - rect.left) / rect.width
      const sy = (touch.clientY - rect.top) / rect.height
      const x = simulationStore.camera.x - visibleHalfWidth + sx * (visibleHalfWidth * 2)
      const y = simulationStore.camera.y + visibleHalfHeight - sy * (visibleHalfHeight * 2)

      const creature = simulationStore.getCreatureAtPosition(x, y)
      if (creature) {
        simulationStore.setSelectedCreature(creature.id)
        emit('creature-selected', creature)
      }
    }
  }
  isDragging = false
}
</script>

<template>
  <!-- Main WebGL canvas -->
  <canvas
    ref="canvasRef"
    id="ecosystemCanvas"
    class="absolute top-0 left-0 w-full h-full bg-black"
    :class="{ 'is-dragging': isDragging && hasDragged }"
    :width="width"
    :height="height"
  ></canvas>
  <!-- Bottom-left overlay: divider + speed selector -->
  <div class="absolute bottom-4 right-16 sm:right-24 z-50 text-white select-none">
    <div class="w-56 border-t border-white/40 mb-1"></div>
    <div class="text-[10px] uppercase tracking-wider text-white/80 mb-1">Speed</div>
    <div
      class="inline-flex overflow-hidden rounded-md bg-black/50 backdrop-blur-md shadow-lg border border-white/30"
    >
      <button
        v-for="opt in speedOptions"
        :key="opt"
        class="px-2 sm:px-3 py-1 text-xs sm:text-sm transition-colors"
        :class="currentSpeed === opt ? 'bg-emerald-400 text-black' : 'hover:bg-white/20 text-white'"
        @click="setSpeed(opt)"
      >
        {{ labelForSpeed(opt) }}
      </button>
    </div>
  </div>
  <!-- Debug hover overlay (follows cursor) -->
  <div
    v-if="showDebug"
    class="absolute z-50 text-xs bg-black/70 text-white px-2 py-1 rounded shadow pointer-events-none whitespace-pre"
    :style="{ left: debugX + 'px', top: debugY + 'px' }"
  >
    {{ debugText }}
  </div>
  <!-- Cost telemetry overlay (top-right) -->
  <CostTelemetryOverlay v-if="showTelemetry" />
  <!-- Optional tooltip element (currently unused) -->
  <div
    id="tooltip"
    class="absolute hidden bg-black bg-opacity-75 text-white p-2 rounded-lg text-sm pointer-events-none"
  ></div>
</template>

<style scoped>
canvas {
  background: #000;
  display: block;
  width: 100%;
  height: 100%;
  cursor: default;
}
canvas.is-dragging {
  cursor: grabbing;
}
</style>
