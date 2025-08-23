<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, unref, computed, watch, defineAsyncComponent } from 'vue'
import { useSimulationStore } from '../composables/useSimulationStore'
const CostTelemetryOverlay = defineAsyncComponent(() => import('./CostTelemetryOverlay.vue'))
import { initWebGL, renderScene, disposeWebGL } from '../webgl/renderer'
import { useUiPrefs } from '../composables/useUiPrefs'

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
const uiPrefs = useUiPrefs()

// Action-notice highlight state
const highlightActive = ref(false)
const highlightX = ref(0)
const highlightY = ref(0)
let highlightTimer: any = null

function worldToScreen(x: number, y: number) {
  const rect = canvasRef.value?.getBoundingClientRect()
  if (!rect) return { sx: 0, sy: 0, ok: false }
  const aspect = rect.width / rect.height
  const worldHalf = 1000
  const visibleHalfWidth = worldHalf / simulationStore.camera.zoom
  const visibleHalfHeight = worldHalf / aspect / simulationStore.camera.zoom
  const sx = ((x - (simulationStore.camera.x - visibleHalfWidth)) / (visibleHalfWidth * 2)) * rect.width
  const sy = ((simulationStore.camera.y + visibleHalfHeight - y) / (visibleHalfHeight * 2)) * rect.height
  const out = { sx: rect.left + sx, sy: rect.top + sy, ok: true }
  try {
    // eslint-disable-next-line no-console
    if (uiPrefs.isLogOn?.('world_to_screen'))
      console.debug('[Renderer] worldToScreen', {
        world: { x, y },
        cam: { x: simulationStore.camera.x, y: simulationStore.camera.y, z: simulationStore.camera.zoom },
        rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        aspect,
        visibleHalfWidth,
        visibleHalfHeight,
        out,
      })
  } catch {}
  return out
}

function handleActionNotice(e: CustomEvent) {
  const detail = e.detail || {}
  // TEMP probe: confirm handler fires and show current logging gates
  try {
    const lg: any = uiPrefs.getLogging?.()
    // eslint-disable-next-line no-console
    console.warn('[ActionNotice][probe] fired', {
      type: detail?.type,
      gates: { master: lg?.enabled, action_notice: lg?.types?.action_notice },
    })
  } catch {}
  const prefs = uiPrefs.getActionNoticing?.()
  if (!prefs || !prefs.enabled) return
  if (prefs.byAction && prefs.byAction[detail.type] === false) return
  const x = Number(detail.x)
  const y = Number(detail.y)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return
  // Save previous cam
  const prev = { x: simulationStore.camera.x, y: simulationStore.camera.y, z: simulationStore.camera.zoom }
  // Debug before
  try {
    // eslint-disable-next-line no-console
    if (uiPrefs.isLogOn?.('action_notice'))
      console.debug('[ActionNotice] start', {
        type: detail.type,
        world: { x, y },
        camBefore: { ...prev },
        prefs,
      })
  } catch {}
  // Center and zoom to target
  simulationStore.centerCameraOn?.(x, y)
  const targetZoom = Math.max(0.1, Number(prefs.zoom) || 2)
  const delta = targetZoom - simulationStore.camera.zoom
  if (Math.abs(delta) > 1e-6) simulationStore.zoomCamera?.(delta)
  try {
    // eslint-disable-next-line no-console
    if (uiPrefs.isLogOn?.('action_notice'))
      console.debug('[ActionNotice] after focus', {
        camAfter: {
          x: simulationStore.camera.x,
          y: simulationStore.camera.y,
          z: simulationStore.camera.zoom,
        },
      })
  } catch {}
  // Highlight overlay
  const screen = worldToScreen(x, y)
  if (screen.ok) {
    highlightX.value = screen.sx
    highlightY.value = screen.sy
    highlightActive.value = true
  }
  // Clear existing timer
  if (highlightTimer) clearTimeout(highlightTimer)
  const hold = Math.max(500, Number(prefs.holdMs) || 5000)
  highlightTimer = setTimeout(() => {
    // Zoom back and roughly center back
    simulationStore.centerCameraOn?.(prev.x, prev.y)
    const back = prev.z - simulationStore.camera.zoom
    if (Math.abs(back) > 1e-6) simulationStore.zoomCamera?.(back)
    highlightActive.value = false
    try {
      // eslint-disable-next-line no-console
      if (uiPrefs.isLogOn?.('action_notice'))
        console.debug('[ActionNotice] restored', {
          camRestored: {
            x: simulationStore.camera.x,
            y: simulationStore.camera.y,
            z: simulationStore.camera.zoom,
          },
        })
    } catch {}
  }, hold)
}

// Speed selector (bottom-left overlay) -> discrete slider
const speedOptions = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
const speedLabels: Record<number, string> = {
  0: '0x',
  0.1: '0.1x',
  0.2: '0.2x',
  0.3: '0.3x',
  0.4: '0.4x',
  0.5: '0.5x',
  0.6: '0.6x',
  0.7: '0.7x',
  0.8: '0.8x',
  0.9: '0.9x',
  1: '1x',
  2: '2x',
  3: '3x',
  4: '4x',
  5: '5x',
  6: '6x',
  7: '7x',
  8: '8x',
  9: '9x',
  10: '10x',
}
const currentSpeed = computed(() => simulationStore.simulationParams.simulationSpeed)
function setSpeed(v: number) {
  simulationStore.setSimulationSpeed(v)
}
function labelForSpeed(v: number) {
  return speedLabels[v] ?? `${v}x`
}
function findClosestIndex(v: number) {
  let best = 0
  let bestDiff = Infinity
  for (let i = 0; i < speedOptions.length; i++) {
    const d = Math.abs(speedOptions[i] - v)
    if (d < bestDiff) {
      bestDiff = d
      best = i
    }
  }
  return best
}
const sliderIndex = ref(findClosestIndex(currentSpeed.value))
watch(currentSpeed, (v) => {
  sliderIndex.value = findClosestIndex(v)
})
function onSpeedSliderInput(e: Event) {
  const val = Number((e.target as HTMLInputElement).value)
  sliderIndex.value = val
  const speed = speedOptions[val] ?? 1
  setSpeed(speed)
}
// percent string for track fill (0%..100%) based on slider index
const percentStr = computed(() => `${(sliderIndex.value / (speedOptions.length - 1)) * 100}%`)
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
    // Ensure simulation auto-starts on initial mount if not already running
    if (!unref(simulationStore.isRunning)) {
      simulationStore.log('[Renderer] Auto-start simulation on mount', { ts: Date.now() })
      simulationStore.startSimulation?.()
    }

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
  // Action-notice listener
  // eslint-disable-next-line no-console
  console.warn('[ActionNotice][probe] registering window listener')
  window.addEventListener('action-notice', handleActionNotice as any)
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
  // eslint-disable-next-line no-console
  console.warn('[ActionNotice][probe] unregistering window listener')
  window.removeEventListener('action-notice', handleActionNotice as any)
  // Fully dispose WebGL resources and context
  disposeWebGL()
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
  if (uiPrefs.isLogOn?.('input'))
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
  const before = simulationStore.camera.zoom
  simulationStore.zoomCamera(delta)
  try {
    // eslint-disable-next-line no-console
    if (uiPrefs.isLogOn?.('input'))
      console.debug('[Input] wheel', {
        deltaY: event.deltaY,
        delta,
        before,
        after: simulationStore.camera.zoom,
      })
  } catch {}
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
  <!-- Bottom-left overlay: divider + speed slider -->
  <div class="absolute bottom-4 right-16 sm:right-24 z-50 text-white select-none">
    <div class="w-56 border-t border-white/40 mb-1"></div>
    <div class="text-[10px] uppercase tracking-wider text-white/80 mb-1">Speed</div>
    <div
      class="w-48 px-2 py-1 rounded-md bg-black/50 backdrop-blur-md shadow-lg border border-white/30 text-center"
    >
      <div class="flex items-center justify-center gap-2">
        <input
          type="range"
          class="range range-xs speed-range w-36"
          min="0"
          :max="speedOptions.length - 1"
          step="1"
          v-model.number="sliderIndex"
          :style="{ '--pct': percentStr }"
          @input="onSpeedSliderInput"
        />
        <span class="text-xs tabular-nums w-10 text-right">
          {{ labelForSpeed(speedOptions[sliderIndex]) }}
        </span>
      </div>
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
  <!-- Action Notice highlight -->
  <div
    v-if="highlightActive"
    class="pointer-events-none absolute z-50"
    :style="{ left: highlightX + 'px', top: highlightY + 'px', transform: 'translate(-50%, -50%)' }"
  >
    <div class="w-12 h-12 rounded-full border-4 border-yellow-400 animate-ping opacity-80"></div>
  </div>
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

/* Slim, centered speed slider styling */
.speed-range {
  /* Ensure enough box height so the thumb is within hit area */
  height: 16px !important;
  padding: 6px 0 !important; /* prevents clipping and enables dragging on thumb */
  overflow: visible !important; /* ensure thumb can extend without clipping */
  cursor: pointer;
  /* WebKit-based: draw base (9px) + fill (7px) + small left cap (7px) */
  background:
    linear-gradient(#ffffff, #ffffff) no-repeat,
    linear-gradient(rgba(255, 255, 255, 0.2), rgba(255, 255, 255, 0.2)) no-repeat,
    linear-gradient(#ffffff, #ffffff) no-repeat !important;
  background-size:
    var(--pct, 0%) 7px,
    100% 9px,
    7px 7px !important;
  background-position:
    left center,
    left center,
    left center !important;
  border-radius: 9999px;
  -webkit-appearance: none;
  -moz-appearance: none;
  appearance: none;
}
.speed-range::-webkit-slider-runnable-track {
  height: 9px !important; /* 75% of 12px thumb */
  background: transparent !important; /* use element background layers */
  border-radius: 9999px !important;
}
.speed-range::-moz-range-track {
  height: 9px !important; /* 75% of 12px thumb */
  background: rgba(255, 255, 255, 0.2) !important; /* base grey */
  border-radius: 9999px !important;
}
.speed-range::-moz-range-progress {
  height: 7px !important; /* slightly slimmer white fill */
  background: #ffffff !important;
  border-radius: 9999px !important;
}
.speed-range::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 12px;
  height: 12px;
  pointer-events: auto; /* allow dragging the thumb */
  background: #ffffff !important;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.6) !important; /* subtle inner halo */
  border-radius: 9999px;
}
.speed-range::-moz-range-thumb {
  width: 12px;
  height: 12px;
  pointer-events: auto; /* allow dragging the thumb */
  background: #ffffff !important;
  border: 2px solid rgba(0, 0, 0, 0.3) !important;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.6) !important;
  border-radius: 9999px;
}
</style>
