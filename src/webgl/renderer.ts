let frameIndex = 0
let lastAppliedZoom = -1
import * as THREE from 'three'
import { useUiPrefs } from '@/composables/useUiPrefs'
import {
  useSimulationStore,
  type Creature,
  type Plant,
  type Corpse,
} from '../composables/useSimulationStore'

// Narrow renderer typing: real THREE renderer or a headless no-op shim
type RendererLike =
  | THREE.WebGLRenderer
  | {
      setPixelRatio(n: number): void
      setSize(w: number, h: number, updateStyle?: boolean): void
      render(scene: THREE.Scene, camera: THREE.Camera): void
      getContext?: () => WebGLRenderingContext | WebGL2RenderingContext | undefined
      dispose?: () => void
      domElement?: HTMLCanvasElement
    }

// WebGL renderer state
let renderer: RendererLike | null = null
let currentCanvas: HTMLCanvasElement | null = null
let scene: THREE.Scene
let camera: THREE.OrthographicCamera
let terrainTexture: THREE.Texture | null = null
let weatherTexture: THREE.Texture | null = null
let weatherMesh: THREE.Mesh | null = null
let creatureMesh: THREE.InstancedMesh | null = null
let plantMesh: THREE.InstancedMesh | null = null
let corpseMesh: THREE.InstancedMesh | null = null
let selectionRing: THREE.Mesh | null = null
let visionMesh: THREE.InstancedMesh | null = null
// Action range rings (separate meshes by diet color for simplicity)
let actionRangeHerbMesh: THREE.InstancedMesh | null = null
let actionRangeCarnMesh: THREE.InstancedMesh | null = null
// Previous-value caches for action range instance matrices
let prevActionRangeHerbMat: Float32Array | null = null
let prevActionRangeCarnMat: Float32Array | null = null
// Note: we track only capacity; mesh.count is set directly on meshes
// Capacity (over-allocation) to minimize buffer re-creation churn
let creatureCap = 0
let plantCap = 0
let corpseCap = 0
let visionCap = 0
let creatureStart = 0
let plantStart = 0
let corpseStart = 0
let headless = false
let weatherPhase = 0
// FPS meter (optional)
let fpsEnabled = false
let fpsDiv: HTMLDivElement | null = null
let lastFpsTime = 0
let frameCount = 0
let currentFps = 0
let lastAdaptTime = 0
// Vision update chunk cursor
let visionStart = 0
let actionRangeHerbStart = 0
let actionRangeCarnStart = 0
let actionRangeHerbCap = 0
let actionRangeCarnCap = 0
// Cache for vision cone base width per creature (to avoid per-frame trig)
const visionWidthCache = new Map<string, { fovDeg: number; range: number; baseWidth: number }>()
// Whether we've performed an initial full transform update for current vision mesh
let visionPrimed = false
// Z layer for vision cones so they render above creatures and weather
const VISION_Z = 1.5
// Flattened per-eye layout for vision cones built each frame
const visionFlat: { ci: number; angleDeg: number; widthDeg: number }[] = []
let visionTotal = 0
// Visual tuning to match OG look
const VISION_SPACING = 0.95 // multiply half-angle by this to create a small gap
const VISION_JITTER_DEG = 1.2 // tiny deterministic jitter to avoid uniform overlaps
const FEATHER_RADIAL = 0.06 // radial feather (0..1 of radius)
const FEATHER_ANGULAR_RAD = 0.08 // angular feather in radians

// Cache: last signature of inputs that affect vision layout, to avoid per-frame rebuild
let lastVisionSig = ''
// Cache computed, sorted eye angles per creature phenotype signature to avoid rework
const visionAnglesCache = new Map<string, number[]>()

// During Vite HMR, ensure previous GL resources are disposed to avoid context conflicts
// This prevents errors like "existing context of a different type" on the same canvas
// when the module is reloaded.
type ViteHot = { dispose(cb: () => void): void }
type ImportMetaHot = { hot?: ViteHot }
try {
  const im = import.meta as unknown as ImportMeta & ImportMetaHot
  if (im?.hot) {
    im.hot.dispose(() => {
      try {
        disposeWebGL()
      } catch {}
    })
  }
} catch {}

function hash01(s: string): number {
  // simple deterministic string hash to [0,1)
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  // final scramble
  h ^= h >>> 13
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

type VisionPhenotype = { eyeAnglesDeg?: number[]; eyesCount?: number; fieldOfViewDeg?: number }
type HasVision = { phenotype?: VisionPhenotype; id?: string }
function computeEyeAnglesDeg(c: HasVision, fallbackFovDeg: number): number[] {
  const ph = c?.phenotype || {}
  const fromPh = Array.isArray(ph.eyeAnglesDeg) ? ph.eyeAnglesDeg : null
  if (fromPh && fromPh.length > 0) return fromPh as number[]
  const eyes = Math.max(1, Math.min(6, Math.floor(Number(ph.eyesCount) || 1)))
  const fov =
    typeof ph.fieldOfViewDeg === 'number' && Number.isFinite(ph.fieldOfViewDeg) && ph.fieldOfViewDeg > 0
      ? ph.fieldOfViewDeg
      : fallbackFovDeg
  if (eyes === 1) return [0]
  const half = fov / 2
  const step = eyes > 1 ? fov / (eyes - 1) : 0
  const arr: number[] = []
  for (let i = 0; i < eyes; i++) arr.push(-half + i * step)
  return arr
}

function rebuildVisionLayout(
  creatures: readonly Creature[],
  simStore: ReturnType<typeof useSimulationStore>,
) {
  // Compute compact signature: depends on global FOV and per-creature vision phenotype
  // Using lengths and selected fields to keep it cheap.
  interface SimParamsPartial {
    visionFovDeg?: number
  }
  const simParams = simStore.simulationParams as unknown as SimParamsPartial
  const globalFov = Number(simParams.visionFovDeg ?? 90)
  let sig = `f:${globalFov}|n:${creatures.length}`
  for (let i = 0; i < creatures.length; i++) {
    const c = creatures[i]
    const ph = c.phenotype
    // include id for stability and relevant fields
    const eAngles = Array.isArray(ph.eyeAnglesDeg) ? ph.eyeAnglesDeg.join(',') : 'na'
    const eyes = Number.isFinite(ph.eyesCount) ? Number(ph.eyesCount) : -1
    const f = Number(ph.fieldOfViewDeg)
    const fov = Number.isFinite(f) && f > 0 ? f : -1
    sig += `|${c.id}:${eyes}:${fov}:${eAngles}`
  }
  if (sig === lastVisionSig) {
    // No change; skip rebuild
    return
  }
  lastVisionSig = sig
  visionFlat.length = 0
  let total = 0
  // use computed globalFov above
  for (let ci = 0; ci < creatures.length; ci++) {
    const c = creatures[ci]
    const ph = c.phenotype
    const fovDeg: number =
      Number.isFinite(ph.fieldOfViewDeg) && (ph.fieldOfViewDeg as number) > 0
        ? (ph.fieldOfViewDeg as number)
        : globalFov
    const key = `${c.id}:${Number(ph.eyesCount) || 1}:${fovDeg}:${Array.isArray(ph.eyeAnglesDeg) ? ph.eyeAnglesDeg.join(',') : 'na'}`
    let angles = visionAnglesCache.get(key)
    if (!angles) {
      angles = computeEyeAnglesDeg(c, globalFov).slice().sort((a, b) => a - b)
      visionAnglesCache.set(key, angles)
    }
    const n = angles.length
    if (n === 1) {
      // Single eye takes full FOV
      visionFlat.push({ ci, angleDeg: 0, widthDeg: fovDeg })
      total++
    } else {
      // Apply a small per-creature rotation offset of the whole eye set to reduce uniformity
      const step = n > 1 ? fovDeg / (n - 1) : fovDeg
      const offset = (hash01(String(c.id)) * 2 - 1) * step * 0.5
      const half = fovDeg / 2
      angles = angles.map((a) => Math.max(-half, Math.min(half, a + offset)))
      for (let i = 0; i < n; i++) {
        const a = angles[i]
        const prev = i === 0 ? -half : angles[i - 1]
        const next = i === n - 1 ? half : angles[i + 1]
        const leftHalf = (a - prev) / 2
        const rightHalf = (next - a) / 2
        const widthDeg = Math.max(1, leftHalf + rightHalf)
        visionFlat.push({ ci, angleDeg: a, widthDeg })
        total += 1
      }
    }
  }
  visionTotal = total
  // New layout built; ensure subsequent render primes instances once
  visionPrimed = false
}

// Public API: FPS meter overlay
export function enableFPSMeter(): void {
  if (fpsEnabled) return
  fpsEnabled = true
  if (typeof document !== 'undefined') {
    fpsDiv = document.createElement('div')
    fpsDiv.style.position = 'fixed'
    fpsDiv.style.top = '8px'
    fpsDiv.style.left = '8px'
    fpsDiv.style.padding = '4px 8px'
    fpsDiv.style.background = 'rgba(0,0,0,0.6)'
    fpsDiv.style.color = '#0f0'
    fpsDiv.style.fontFamily = 'monospace'
    fpsDiv.style.fontSize = '12px'
    fpsDiv.style.zIndex = '9999'
    fpsDiv.textContent = 'FPS'
    document.body.appendChild(fpsDiv)
  }
}

function updateVisionInstances(creatures: readonly Creature[]) {
  if (!visionMesh) return
  const simStore = useSimulationStore()
  const halfAttr = (visionMesh.geometry as THREE.BufferGeometry).getAttribute(
    'aHalfAngle',
  ) as THREE.InstancedBufferAttribute
  for (let i = 0; i < visionFlat.length; i++) {
    const { ci, angleDeg, widthDeg } = visionFlat[i]
    const c = creatures[ci]
    // Prefer per-creature phenotype; fallback to global sliders
    const globalRange = Number(
      (simStore.simulationParams as { visionRange?: number }).visionRange ?? 80,
    )
    const rangeRaw = Number(
      (c.phenotype as { sightRange?: number } | undefined)?.sightRange,
    )
    const range = Number.isFinite(rangeRaw) && rangeRaw > 0 ? rangeRaw : globalRange
    const clampedRange = Math.max(5, range)
    const halfAngleRad = (Math.max(1, Math.min(179, widthDeg)) * 0.5 * Math.PI) / 180
    // Per-creature slight spacing variance (e.g., 0.95..0.99)
    const spacingVar = 0.9 + 0.1 * hash01(String(c.id))
    halfAttr.setX(i, halfAngleRad * VISION_SPACING * spacingVar)
    const vx = c.vx
    const vy = c.vy
    const speed = Math.hypot(vx, vy)
    const baseTheta = speed > 1e-4 ? Math.atan2(vy, vx) : 0
    // small deterministic jitter per creature & eye index
    const jitter = ((hash01(c.id + ':' + i) * 2 - 1) * VISION_JITTER_DEG * Math.PI) / 180
    const theta = baseTheta + (angleDeg * Math.PI) / 180 + jitter
    // Compose: T(x,y) * R(theta) * S(range, baseWidth)
    tmpRotMatrix.makeRotationZ(theta)
    const sca = tmpScaleMatrix.makeScale(clampedRange, clampedRange, 1)
    const trs = tmpMatrix.multiplyMatrices(tmpRotMatrix, sca)
    tmpTransMatrix.makeTranslation(c.x, c.y, VISION_Z)
    const final = tmpMatrix.multiplyMatrices(tmpTransMatrix, trs)
    // Write matrix directly to buffer
    const base = i * 16
    const e = final.elements
    const matArr = (visionMesh.instanceMatrix as unknown as THREE.InstancedBufferAttribute)
      .array as Float32Array
    matArr[base + 0] = e[0]
    matArr[base + 1] = e[1]
    matArr[base + 2] = e[2]
    matArr[base + 3] = e[3]
    matArr[base + 4] = e[4]
    matArr[base + 5] = e[5]
    matArr[base + 6] = e[6]
    matArr[base + 7] = e[7]
    matArr[base + 8] = e[8]
    matArr[base + 9] = e[9]
    matArr[base + 10] = e[10]
    matArr[base + 11] = e[11]
    matArr[base + 12] = e[12]
    matArr[base + 13] = e[13]
    matArr[base + 14] = e[14]
    matArr[base + 15] = e[15]
  }
  visionMesh.instanceMatrix.needsUpdate = true
  if (halfAttr) halfAttr.needsUpdate = true
}

export function disableFPSMeter(): void {
  fpsEnabled = false
  if (fpsDiv && fpsDiv.parentElement) {
    fpsDiv.parentElement.removeChild(fpsDiv)
  }
  fpsDiv = null
  lastFpsTime = 0
  frameCount = 0
}

// --- Lightweight Perlin Noise (2D) ---
// Adapted simple implementation suitable for textures
const PERM = new Uint8Array(512)
const Gx = new Float32Array(512)
const Gy = new Float32Array(512)
let noiseSeeded = false
function seedNoise(seed = 1337) {
  noiseSeeded = true
  let s = seed >>> 0
  const rand = () => {
    // xorshift
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return (s >>> 0) / 0xffffffff
  }

  const p = new Uint8Array(256)
  for (let i = 0; i < 256; i++) p[i] = i
  // Fisher-Yates shuffle
  for (let i = 255; i > 0; i--) {
    const j = (rand() * (i + 1)) | 0
    const t = p[i]
    p[i] = p[j]
    p[j] = t
  }
  for (let i = 0; i < 512; i++) {
    const v = p[i & 255]
    PERM[i] = v
    // random unit gradients
    const a = rand() * Math.PI * 2
    Gx[i] = Math.cos(a)
    Gy[i] = Math.sin(a)
  }
}
function fade(t: number) {
  return t * t * t * (t * (t * 6 - 15) + 10)
}
function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}
function grad(i: number, x: number, y: number) {
  return Gx[i] * x + Gy[i] * y
}
function perlin2(x: number, y: number) {
  if (!noiseSeeded) seedNoise(12345)
  const X = Math.floor(x) & 255
  const Y = Math.floor(y) & 255
  const xf = x - Math.floor(x)
  const yf = y - Math.floor(y)
  const u = fade(xf)
  const v = fade(yf)
  const aa = PERM[X + PERM[Y]]
  const ab = PERM[X + PERM[Y + 1]]
  const ba = PERM[X + 1 + PERM[Y]]
  const bb = PERM[X + 1 + PERM[Y + 1]]
  const x1 = lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u)
  const x2 = lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u)
  return (lerp(x1, x2, v) + 1) * 0.5 // [0,1]
}

// Initialize WebGL context
export function initWebGL(canvas: HTMLCanvasElement): void {
  // Guard: if already initialized for this canvas, do nothing
  if (renderer && currentCanvas === canvas) {
    return
  }
  // If a different canvas is passed after initialization, dispose prior context first
  if (renderer && currentCanvas && currentCanvas !== canvas) {
    disposeWebGL()
  }
  // Create a new WebGL renderer
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || ''
  const isTestEnv = /jsdom|node/i.test(ua)

  // Helper to attempt GL acquisition with graceful fallback from WebGL2 to WebGL1
  const attemptAcquireGL = (): WebGL2RenderingContext | WebGLRenderingContext | null => {
    // Prefer WebGL2, fallback to WebGL1; both calls return the existing context if already created
    const gl2 = canvas.getContext('webgl2', { antialias: true, alpha: true })
    const gl = (gl2 || canvas.getContext('webgl', { antialias: true, alpha: true }))
    return gl || null
  }

  try {
    if (isTestEnv) {
      throw new Error('Headless test environment')
    }
    let gl: WebGL2RenderingContext | WebGLRenderingContext | null = null
    try {
      gl = attemptAcquireGL()
    } catch {
      // If the canvas has a conflicting context (e.g., after HMR), dispose and retry once
      try {
        disposeWebGL()
      } catch {}
      gl = attemptAcquireGL()
    }
    if (!gl) {
      throw new Error('Failed to acquire WebGL/WebGL2 context')
    }
    renderer = new THREE.WebGLRenderer({
      canvas,
      context: gl,
      antialias: true,
      alpha: true,
    })
    currentCanvas = canvas
    renderer.setPixelRatio(window.devicePixelRatio)
    // Use the actual canvas size, not the window size
    const cw = canvas.clientWidth || canvas.width
    const ch = canvas.clientHeight || canvas.height
    renderer.setSize(cw, ch, false)
  } catch {
    // Headless or failed to create GL context: provide a no-op renderer
    headless = true
    renderer = {
      setPixelRatio: (n: number) => {
        void n
      },
      setSize: (w: number, h: number) => {
        void w
        void h
      },
      render: (scene: THREE.Scene, camera: THREE.Camera) => {
        void scene
        void camera
      },
      getContext: () => undefined,
      dispose: () => {},
    }
    currentCanvas = canvas
    // Avoid throwing in tests
    // console.warn('Running in headless mode (no WebGL). Rendering is disabled.')
  }

  // Create a scene
  scene = new THREE.Scene()
  scene.background = new THREE.Color(0x000000)

  // Create an orthographic camera
  const cwidth = canvas.clientWidth || canvas.width
  const cheight = canvas.clientHeight || canvas.height
  const aspectRatio = (cwidth || 1) / (cheight || 1)
  // Fit width: world is 2000 wide, so half-width = 1000, half-height = 1000 / aspect
  const halfWidth = 1000
  const halfHeight = halfWidth / aspectRatio
  camera = new THREE.OrthographicCamera(-halfWidth, halfWidth, halfHeight, -halfHeight, 0.1, 2000)
  // Center camera over our 2000x2000 world so initial terrain/creatures are visible
  camera.position.set(1000, 1000, 1000)
  camera.lookAt(1000, 1000, 0)

  // Add event listener to handle window resize
  window.addEventListener('resize', onWindowResize)

  // Generate terrain texture
  generateTerrainTexture()

  // Generate weather texture
  generateWeatherTexture()

  // Create selection ring (hidden by default)
  const ringGeo = new THREE.RingGeometry(1.15, 1.5, 32)
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffff00, transparent: true, opacity: 0.8 })
  selectionRing = new THREE.Mesh(ringGeo, ringMat)
  selectionRing.visible = false
  selectionRing.renderOrder = 10
  scene.add(selectionRing)

  // Vision cones are created on-demand via ensureVisionMesh()
}

// Dispose all WebGL/THREE resources and detach listeners
export function disposeWebGL(): void {
  try {
    // Remove window resize listener
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', onWindowResize)
    }
    // Remove and dispose meshes
    if (scene) {
      if (creatureMesh) {
        scene.remove(creatureMesh)
        creatureMesh.geometry?.dispose?.()
        ;(creatureMesh.material as THREE.Material | undefined)?.dispose?.()
        creatureMesh = null
      }
      if (plantMesh) {
        scene.remove(plantMesh)
        plantMesh.geometry?.dispose?.()
        ;(plantMesh.material as THREE.Material | undefined)?.dispose?.()
        plantMesh = null
      }
      if (corpseMesh) {
        scene.remove(corpseMesh)
        corpseMesh.geometry?.dispose?.()
        ;(corpseMesh.material as THREE.Material | undefined)?.dispose?.()
        corpseMesh = null
      }
      if (visionMesh) {
        scene.remove(visionMesh)
        visionMesh.geometry?.dispose?.()
        ;(visionMesh.material as THREE.Material | undefined)?.dispose?.()
        visionMesh = null
      }
      if (actionRangeHerbMesh) {
        scene.remove(actionRangeHerbMesh)
        actionRangeHerbMesh.geometry.dispose()
        ;(actionRangeHerbMesh.material as THREE.Material).dispose()
        actionRangeHerbMesh = null
        prevActionRangeHerbMat = null
      }
      if (actionRangeCarnMesh) {
        scene.remove(actionRangeCarnMesh)
        actionRangeCarnMesh.geometry.dispose()
        ;(actionRangeCarnMesh.material as THREE.Material).dispose()
        actionRangeCarnMesh = null
        prevActionRangeCarnMat = null
      }
      if (selectionRing) {
        scene.remove(selectionRing)
        selectionRing.geometry?.dispose?.()
        ;(selectionRing.material as THREE.Material | undefined)?.dispose?.()
        selectionRing = null
      }
      if (weatherMesh) {
        scene.remove(weatherMesh)
        ;(weatherMesh.material as THREE.Material | undefined)?.dispose?.()
        weatherMesh = null
      }
    }
    // Dispose textures
    if (terrainTexture) {
      terrainTexture.dispose()
      terrainTexture = null
    }
    if (weatherTexture) {
      weatherTexture.dispose()
      weatherTexture = null
    }
    // Dispose renderer and force context loss when possible
    if (renderer) {
      try {
        // Try to lose the GL context to free resources in some browsers
        const gl = getRendererGL()
        type LoseExt = { loseContext?: () => void }
        if (gl) {
          // Structural cast to a generic signature to avoid DOM lib literal-union restrictions
          const ge = (gl as unknown as { getExtension(ext: string): unknown }).getExtension
          if (typeof ge === 'function') {
            const maybeExt = ge.call(gl as unknown as object, 'WEBGL_lose_context') as unknown
            const ext: LoseExt | null =
              typeof maybeExt === 'object' && maybeExt !== null ? (maybeExt as LoseExt) : null
            if (ext && typeof ext.loseContext === 'function') {
              try {
                ext.loseContext()
              } catch {}
            }
          }
        }
      } catch {}
      try {
        type HasDispose = { dispose: () => void }
        if (renderer && 'dispose' in renderer) (renderer as HasDispose).dispose()
      } catch {}
    }
  } finally {
    // Reset state
    renderer = null
    currentCanvas = null
    scene = undefined as unknown as THREE.Scene
    camera = undefined as unknown as THREE.OrthographicCamera
    // reset capacities handled below; counts are controlled on meshes directly
    visionStart = 0
    visionWidthCache.clear()
    visionPrimed = false
    weatherPhase = 0
    headless = false
    actionRangeHerbStart = 0
    actionRangeCarnStart = 0
    creatureCap = 0
    plantCap = 0
    corpseCap = 0
    visionCap = 0
    actionRangeHerbCap = 0
    actionRangeCarnCap = 0
  }
}

export function isHeadless(): boolean {
  return headless
}

function getRendererGL(): WebGLRenderingContext | WebGL2RenderingContext | null {
  if (!renderer) return null
  // Prefer renderer.getContext when available (THREE renderer)
  if ('getContext' in renderer && typeof renderer.getContext === 'function') {
    try {
      const ctx = renderer.getContext()
      if (ctx) return ctx
    } catch {}
  }
  // Fallback: try to reach the canvas and get a context
  const el =
    (renderer && 'domElement' in renderer
      ? ((renderer as THREE.WebGLRenderer).domElement as HTMLCanvasElement)
      : currentCanvas) || null
  if (!el) return null
  return (
    (el.getContext && (el.getContext('webgl2') as WebGL2RenderingContext | null)) ||
    (el.getContext && (el.getContext('webgl') as WebGLRenderingContext | null)) ||
    null
  )
}

function onWindowResize() {
  // When the window changes, recalc using the renderer's canvas size
  const el =
    (renderer && 'domElement' in renderer
      ? ((renderer as THREE.WebGLRenderer).domElement as HTMLCanvasElement)
      : null) || null
  const width = el?.clientWidth || el?.width || window.innerWidth
  const height = el?.clientHeight || el?.height || window.innerHeight
  const aspectRatio = (width || 1) / (height || 1)
  const halfWidth = 1000
  const halfHeight = halfWidth / aspectRatio

  camera.left = -halfWidth
  camera.right = halfWidth
  camera.top = halfHeight
  camera.bottom = -halfHeight
  camera.updateProjectionMatrix()

  if (renderer && typeof renderer.setSize === 'function') {
    renderer.setSize(width, height, false)
  }
}

// Generate a texture for terrain using Perlin noise
function generateTerrainTexture() {
  const width = 2000
  const height = 2000
  const size = width * height

  const data = new Uint8Array(4 * size)
  const simStore = useSimulationStore()
  const waterLevel = simStore.simulationParams.waterLevel ?? 0.35

  // Multi-octave Perlin for elevation
  const scale = 300 // base wavelength
  const octaves = 4
  const persistence = 0.5
  const lacunarity = 2.0
  for (let i = 0; i < size; i++) {
    const stride = i * 4
    const x = i % width
    const y = Math.floor(i / width)

    let amp = 1
    let freq = 1
    let sum = 0
    let norm = 0
    for (let o = 0; o < octaves; o++) {
      const nx = (x / scale) * freq
      const ny = (y / scale) * freq
      sum += perlin2(nx, ny) * amp
      norm += amp
      amp *= persistence
      freq *= lacunarity
    }
    const elevation = sum / norm // [0,1]

    let r: number, g: number, b: number
    if (elevation < waterLevel) {
      // Water shades
      const t = elevation / Math.max(0.0001, waterLevel)
      r = 40 + 20 * t
      g = 90 + 40 * t
      b = 160 + 60 * t
    } else if (elevation < waterLevel + 0.08) {
      // Sand near shore
      r = 210
      g = 190
      b = 140
    } else if (elevation < 0.7) {
      // Grasslands
      const t = (elevation - (waterLevel + 0.08)) / (0.7 - (waterLevel + 0.08))
      r = 40 + 30 * t
      g = 120 + 60 * t
      b = 40
    } else if (elevation < 0.85) {
      // Rocky
      const t = (elevation - 0.7) / 0.15
      r = 120 + 30 * t
      g = 100 - 30 * t
      b = 90
    } else {
      // Snow caps
      const t = (elevation - 0.85) / 0.15
      r = 200 + 30 * t
      g = 200 + 30 * t
      b = 210 + 30 * t
    }

    data[stride] = r
    data[stride + 1] = g
    data[stride + 2] = b
    data[stride + 3] = 255
  }

  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat)
  texture.needsUpdate = true

  // Create a plane with the terrain texture
  const geometry = new THREE.PlaneGeometry(width, height)
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    side: THREE.DoubleSide,
  })
  const terrain = new THREE.Mesh(geometry, material)
  terrain.position.set(width / 2, height / 2, -1) // Behind everything
  terrain.userData.type = 'terrain'

  scene.add(terrain)
  terrainTexture = texture

  return texture
}

// Generate a texture for weather effects using Perlin noise
function generateWeatherTexture() {
  const width = 2000
  const height = 2000
  const size = width * height

  const data = new Uint8Array(4 * size)
  const scale = 250
  for (let i = 0; i < size; i++) {
    const stride = i * 4
    const x = i % width
    const y = Math.floor(i / width)
    const n = perlin2(x / scale, y / scale)
    const cloud = Math.max(0, n * 1.2 - 0.5) // thresholded clouds
    const alpha = Math.min(255, Math.floor(cloud * 255))
    data[stride] = 255
    data[stride + 1] = 255
    data[stride + 2] = 255
    data[stride + 3] = alpha
  }

  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat)
  texture.needsUpdate = true
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping

  // Create a plane with the weather texture
  const geometry = new THREE.PlaneGeometry(width, height)
  const simStore = useSimulationStore()
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: Number(simStore.simulationParams.weatherOpacity ?? 0.4),
    depthWrite: false,
  })
  weatherMesh = new THREE.Mesh(geometry, material)
  weatherMesh.position.set(width / 2, height / 2, 1) // In front of everything
  weatherMesh.visible = false // Hidden by default
  weatherMesh.userData.type = 'weather'

  scene.add(weatherMesh)
  weatherTexture = texture

  return texture
}

// Render the scene with all entities
export function renderScene(
  creatures: readonly Creature[],
  plants: readonly Plant[],
  corpses: readonly Corpse[],
): void {
  // Ensure instanced meshes exist and have correct counts
  ensureCreatureMesh(creatures.length)
  ensurePlantMesh(plants.length)
  ensureCorpseMesh(corpses.length)

  // Vision cones
  const simStore = useSimulationStore()
  const showVC = !!(simStore.simulationParams as { showVisionCones?: boolean }).showVisionCones
  if (showVC) {
    rebuildVisionLayout(creatures, simStore)
    ensureVisionMesh(visionTotal)
    if (visionMesh) {
      type InstancedMeshWithCount = THREE.InstancedMesh & { count: number }
      ;(visionMesh as InstancedMeshWithCount).count = visionTotal
    }
    // One-time prime so cones are visible immediately after creation/resizing
    if (!visionPrimed && visionTotal > 0) {
      updateVisionInstances(creatures)
      visionPrimed = true
      try {
        const uiPrefs = useUiPrefs()
        if (uiPrefs.isLogOn?.('vision'))
          console.debug('[Vision] primed with eyes=', visionTotal)
      } catch {}
    }
  } else {
    ensureVisionMesh(0)
    visionPrimed = false
    lastVisionSig = ''
  }

  // Action range overlay
  const ui = useUiPrefs()
  const aro = ui.getActionRangeOverlay?.()
  const showActionRanges = !!(aro && aro.enabled)
  if (showActionRanges) {
    // Partition counts by diet for separate colored meshes
    let herbCount = 0
    let carnCount = 0
    for (let i = 0; i < creatures.length; i++) {
      const d = ((creatures[i].phenotype as { diet?: string } | undefined)?.diet ?? 'Herbivore') === 'Carnivore' ? 'Carnivore' : 'Herbivore'
      if (d === 'Carnivore') carnCount++
      else herbCount++
    }
    ensureActionRangeMeshes(herbCount, carnCount, aro)
    if (actionRangeHerbMesh) {
      type InstancedMeshWithCount = THREE.InstancedMesh & { count: number }
      ;(actionRangeHerbMesh as InstancedMeshWithCount).count = herbCount
    }
    if (actionRangeCarnMesh) {
      type InstancedMeshWithCount = THREE.InstancedMesh & { count: number }
      ;(actionRangeCarnMesh as InstancedMeshWithCount).count = carnCount
    }
    actionRangeHerbStart = 0
    actionRangeCarnStart = 0
  }

  // Clamp desired camera center based on current frustum and target zoom
  const desiredZoom = camera.zoom
  const aspect = (camera.right - camera.left) / (camera.top - camera.bottom)
  const worldHalf = 1000
  const minZoomWidth = 1
  const minZoomHeight = 1 / Math.max(0.0001, aspect)
  const minZoom = Math.max(minZoomWidth, minZoomHeight)
  const maxZoom = 5
  const z = Math.min(maxZoom, Math.max(minZoom, desiredZoom))
  let x = camera.position.x
  let y = camera.position.y
  const visibleHalfWidth = worldHalf / z
  const visibleHalfHeight = worldHalf / aspect / z
  if (visibleHalfWidth >= worldHalf) {
    x = worldHalf
  } else {
    const minX = visibleHalfWidth
    const maxX = 2000 - visibleHalfWidth
    x = Math.min(Math.max(x, minX), maxX)
  }
  if (visibleHalfHeight >= worldHalf) {
    y = worldHalf
  } else {
    const minY = visibleHalfHeight
    const maxY = 2000 - visibleHalfHeight
    y = Math.min(Math.max(y, minY), maxY)
  }

  // Apply clamped camera
  camera.position.x = x
  camera.position.y = y
  camera.zoom = z
  camera.updateProjectionMatrix()
  if (Math.abs(z - lastAppliedZoom) > 1e-6) {
    try {
      const uiPrefs = useUiPrefs()
      if (uiPrefs.isLogOn?.('renderer'))
        console.debug('[Renderer] apply zoom', {
          desired: desiredZoom,
          applied: z,
          prevApplied: lastAppliedZoom,
        })
    } catch {}
    lastAppliedZoom = z
  }

  // Update instances (throttled + chunked)
  frameIndex++
  type SimParamsThrottle = { instanceUpdateEvery?: number }
  const every = Math.max(1, (simStore.simulationParams as SimParamsThrottle).instanceUpdateEvery ?? 1)
  if (frameIndex % every === 0) {
    type SimParamsChunk = { instanceUpdateChunk?: number }
    const chunk = Math.max(1, (simStore.simulationParams as SimParamsChunk).instanceUpdateChunk ?? 500)
    // Overlays can be throttled further via overlayUpdateEvery (defaults to 'every')
    type SimParamsOverlay = { overlayUpdateEvery?: number }
    const overlayEvery = Math.max(
      1,
      (simStore.simulationParams as SimParamsOverlay).overlayUpdateEvery ?? every,
    )
    // Creatures
    if (creatures.length > 0) {
      creatureStart = updateCreatureInstancesChunk(creatures, creatureStart, chunk)
    }
    // Plants
    if (plants.length > 0) {
      plantStart = updatePlantInstancesChunk(plants, plantStart, chunk)
    }
    // Corpses
    if (corpses.length > 0) {
      corpseStart = updateCorpseInstancesChunk(corpses, corpseStart, chunk)
    }
    // Vision cones (optional)
    if (showVC && creatures.length > 0 && frameIndex % overlayEvery === 0) {
      visionStart = updateVisionInstancesChunk(creatures, visionStart, chunk)
    }
    // Action ranges (optional)
    if (showActionRanges && creatures.length > 0 && frameIndex % overlayEvery === 0) {
      actionRangeHerbStart = updateActionRangeInstancesChunk(
        creatures,
        actionRangeHerbStart,
        chunk,
        /*diet*/ 'Herbivore',
      )
      actionRangeCarnStart = updateActionRangeInstancesChunk(
        creatures,
        actionRangeCarnStart,
        chunk,
        /*diet*/ 'Carnivore',
      )
    }
  }

  // Render the scene
  if (weatherMesh) {
    // Toggle visibility from store
    weatherMesh.visible = !!simStore.simulationParams.showWeather
    // Keep opacity in sync with setting
    const mat = weatherMesh.material as THREE.MeshBasicMaterial
    if (mat) mat.opacity = Number(simStore.simulationParams.weatherOpacity ?? 0.4)
    // Animate weather by scrolling UVs
    if (weatherTexture) {
      weatherPhase += 0.0005
      const mat = weatherMesh.material as THREE.MeshBasicMaterial
      if (mat.map) {
        mat.map.offset.set(weatherPhase * 20, weatherPhase * 10)
      }
    }
  }

  // Selection highlight: follow selected creature from store
  const selectedId = simStore.selectedCreatureId?.value as string | null
  if (selectionRing) {
    if (selectedId) {
      const sel = creatures.find((c) => c.id === selectedId)
      if (sel) {
        selectionRing.visible = true
        selectionRing.position.set(sel.x, sel.y, 2)
        const s = Math.max(0.01, sel.radius)
        selectionRing.scale.set(s, s, 1)
      } else {
        selectionRing.visible = false
      }
    } else {
      selectionRing.visible = false
    }
  }

  if (renderer && typeof renderer.render === 'function') {
    renderer.render(scene, camera)
  }

  // FPS meter update
  if (fpsEnabled) {
    const now = performance.now()
    if (!lastFpsTime) lastFpsTime = now
    frameCount++
    const dt = now - lastFpsTime
    if (dt >= 500) {
      // update twice per second
      const fps = Math.round((frameCount * 1000) / dt)
      currentFps = fps
      if (fpsDiv) fpsDiv.textContent = `${fps} FPS`
      frameCount = 0
      lastFpsTime = now
    }
  }

  // Adaptive performance: adjust throttling/chunking toward target FPS
  interface SimParamsAdaptive {
    adaptivePerfEnabled?: boolean
    targetFps?: number
    instanceUpdateEvery?: number
    instanceUpdateChunk?: number
  }
  const simParams = simStore.simulationParams as SimParamsAdaptive
  if (simParams.adaptivePerfEnabled) {
    const now = performance.now()
    if (!lastAdaptTime) lastAdaptTime = now
    if (now - lastAdaptTime >= 1000) {
      // adapt at most once per second
      const target = Number(simParams.targetFps ?? 60)
      const fps = currentFps || 0
      const hysteresis = 4
      let every = Number(simParams.instanceUpdateEvery ?? 1)
      let chunk = Number(simParams.instanceUpdateChunk ?? 500)

      if (fps && fps < target - hysteresis) {
        // Too slow: reduce per-frame work
        if (chunk > 200) chunk = Math.max(200, Math.floor(chunk * 0.8))
        else if (every < 5) every = Math.min(5, every + 1)
      } else if (fps && fps > target + hysteresis) {
        // Faster than target: increase visual smoothness
        if (every > 1) every = Math.max(1, every - 1)
        else if (chunk < 5000) chunk = Math.min(5000, Math.floor(chunk * 1.25))
      }

      if (every !== simParams.instanceUpdateEvery) {
        simStore.setInstanceUpdateEvery(every)
      }
      if (chunk !== simParams.instanceUpdateChunk) {
        simStore.setInstanceUpdateChunk(chunk)
      }
      lastAdaptTime = now
    }
  }
}

// Ensure instanced meshes exist and match needed count (with capacity growth)
function ensureCreatureMesh(desired: number) {
  if (desired <= 0) {
    if (creatureMesh) {
      scene.remove(creatureMesh)
      creatureMesh.geometry.dispose()
      ;(creatureMesh.material as THREE.Material).dispose()
      creatureMesh = null
    }
    creatureCap = 0
    prevCreatureMat = null
    prevCreatureCol = null
    return
  }
  // If current mesh can accommodate, just update count and reset cursors/sentinels
  if (creatureMesh && desired <= creatureCap) {
    type InstancedMeshWithCount = THREE.InstancedMesh & { count: number }
    ;(creatureMesh as InstancedMeshWithCount).count = desired
    // Reset chunk cursor to ensure recent range gets uploaded soon
    creatureStart = 0
    return
  }
  // Need to (re)create with larger capacity (next power-of-two for amortization)
  if (creatureMesh) {
    scene.remove(creatureMesh)
    creatureMesh.geometry.dispose()
    ;(creatureMesh.material as THREE.Material).dispose()
    creatureMesh = null
  }
  const nextCap = Math.pow(2, Math.ceil(Math.log2(Math.max(1, desired))))
  const geometry = new THREE.CircleGeometry(1, 24)
  const material = new THREE.MeshBasicMaterial({ vertexColors: true })
  creatureMesh = new THREE.InstancedMesh(geometry, material, nextCap)
  creatureMesh.userData.type = 'creatures'
  creatureMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  scene.add(creatureMesh)
  creatureCap = nextCap
  type InstancedMeshWithCount = THREE.InstancedMesh & { count: number }
  ;(creatureMesh as InstancedMeshWithCount).count = desired
  creatureStart = 0
  // allocate previous caches (Infinity to force initial uploads) sized to capacity
  prevCreatureMat = new Float32Array(nextCap * 16)
  for (let i = 0; i < prevCreatureMat.length; i++) prevCreatureMat[i] = Infinity
  prevCreatureCol = new Float32Array(nextCap * 3)
  for (let i = 0; i < prevCreatureCol.length; i++) prevCreatureCol[i] = Infinity
}

function ensurePlantMesh(desired: number) {
  if (desired <= 0) {
    if (plantMesh) {
      scene.remove(plantMesh)
      plantMesh.geometry.dispose()
      ;(plantMesh.material as THREE.Material).dispose()
      plantMesh = null
    }
    plantCap = 0
    prevPlantMat = null
    return
  }
  if (plantMesh && desired <= plantCap) {
    type InstancedMeshWithCount = THREE.InstancedMesh & { count: number }
    ;(plantMesh as InstancedMeshWithCount).count = desired
    plantStart = 0
    return
  }
  if (plantMesh) {
    scene.remove(plantMesh)
    plantMesh.geometry.dispose()
    ;(plantMesh.material as THREE.Material).dispose()
    plantMesh = null
  }
  const nextCap = Math.pow(2, Math.ceil(Math.log2(Math.max(1, desired))))
  const geometry = new THREE.CircleGeometry(1, 16)
  const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 0.7, 0.3) })
  plantMesh = new THREE.InstancedMesh(geometry, material, nextCap)
  plantMesh.userData.type = 'plants'
  plantMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  scene.add(plantMesh)
  plantCap = nextCap
  type InstancedMeshWithCount = THREE.InstancedMesh & { count: number }
  ;(plantMesh as InstancedMeshWithCount).count = desired
  plantStart = 0
  prevPlantMat = new Float32Array(nextCap * 16)
  for (let i = 0; i < prevPlantMat.length; i++) prevPlantMat[i] = Infinity
}

function ensureCorpseMesh(desired: number) {
  if (desired <= 0) {
    if (corpseMesh) {
      scene.remove(corpseMesh)
      corpseMesh.geometry.dispose()
      ;(corpseMesh.material as THREE.Material).dispose()
      corpseMesh = null
    }
    corpseCap = 0
    prevCorpseMat = null
    prevCorpseCol = null
    return
  }
  if (corpseMesh && desired <= corpseCap) {
    type InstancedMeshWithCount = THREE.InstancedMesh & { count: number }
    ;(corpseMesh as InstancedMeshWithCount).count = desired
    corpseStart = 0
    return
  }
  if (corpseMesh) {
    scene.remove(corpseMesh)
    corpseMesh.geometry.dispose()
    ;(corpseMesh.material as THREE.Material).dispose()
    corpseMesh = null
  }
  const nextCap = Math.pow(2, Math.ceil(Math.log2(Math.max(1, desired))))
  const geometry = new THREE.CircleGeometry(1, 16)
  const material = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0.7,
    vertexColors: true,
  })
  corpseMesh = new THREE.InstancedMesh(geometry, material, nextCap)
  corpseMesh.userData.type = 'corpses'
  corpseMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  scene.add(corpseMesh)
  corpseCap = nextCap
  type InstancedMeshWithCount = THREE.InstancedMesh & { count: number }
  ;(corpseMesh as InstancedMeshWithCount).count = desired
  corpseStart = 0
  prevCorpseMat = new Float32Array(nextCap * 16)
  for (let i = 0; i < prevCorpseMat.length; i++) prevCorpseMat[i] = Infinity
  prevCorpseCol = new Float32Array(nextCap * 3)
  for (let i = 0; i < prevCorpseCol.length; i++) prevCorpseCol[i] = Infinity
}

// Vision cones instanced mesh (semi-transparent sectors approximated by a triangle scaled to FOV/Range)
function ensureVisionMesh(desired: number) {
  if (desired <= 0) {
    if (visionMesh) {
      scene.remove(visionMesh)
      visionMesh.geometry.dispose()
      ;(visionMesh.material as THREE.Material).dispose()
      visionMesh = null
    }
    visionCap = 0
    prevVisionMat = null
    visionStart = 0
    visionWidthCache.clear()
    visionPrimed = false
    return
  }
  if (visionMesh && desired <= visionCap) {
    type InstancedMeshWithCount = THREE.InstancedMesh & { count: number }
    ;(visionMesh as InstancedMeshWithCount).count = desired
    visionStart = 0
    return
  }
  if (visionMesh) {
    scene.remove(visionMesh)
    visionMesh.geometry.dispose()
    ;(visionMesh.material as THREE.Material).dispose()
    visionMesh = null
  }
  const nextCap = Math.pow(2, Math.ceil(Math.log2(Math.max(1, desired))))
  // Unit quad covering [-1,1] x [-1,1]; shader will mask a circular sector
  const geom = new THREE.BufferGeometry()
  const quad = new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0])
  const idx = new Uint16Array([0, 1, 2, 0, 2, 3])
  geom.setAttribute('position', new THREE.BufferAttribute(quad, 3))
  geom.setIndex(new THREE.BufferAttribute(idx, 1))
  // Per-instance half-angle (radians)
  const halfAngles = new Float32Array(nextCap)
  geom.setAttribute('aHalfAngle', new THREE.InstancedBufferAttribute(halfAngles, 1))
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(1, 1, 0) },
      uOpacity: { value: 0.2 },
      uFeatherRadial: { value: FEATHER_RADIAL },
      uFeatherAngular: { value: FEATHER_ANGULAR_RAD },
    },
    vertexShader: `
      attribute float aHalfAngle;
      varying vec2 vLocal;
      varying float vHalfAngle;
      void main(){
        vLocal = position.xy;
        vHalfAngle = aHalfAngle;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uFeatherRadial;
      uniform float uFeatherAngular;
      varying vec2 vLocal;
      varying float vHalfAngle;
      void main(){
        float r = length(vLocal);
        float ang = abs(atan(vLocal.y, vLocal.x));
        // radial feather: from (1 - feather) to 1.0
        float edgeR = 1.0 - smoothstep(1.0 - uFeatherRadial, 1.0, r);
        // angular feather: from (vHalfAngle - feather) to vHalfAngle
        float edgeA = 1.0 - smoothstep(vHalfAngle - uFeatherAngular, vHalfAngle, ang);
        float m = clamp(min(edgeR, edgeA), 0.0, 1.0);
        if (m <= 0.0) discard;
        gl_FragColor = vec4(uColor, uOpacity * m);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
  })
  visionMesh = new THREE.InstancedMesh(geom, mat, nextCap)
  visionMesh.userData.type = 'vision'
  visionMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  visionMesh.frustumCulled = false
  visionMesh.renderOrder = 6
  visionMesh.visible = true
  scene.add(visionMesh)
  visionCap = nextCap
  type InstancedMeshWithCount = THREE.InstancedMesh & { count: number }
  ;(visionMesh as InstancedMeshWithCount).count = desired
  visionStart = 0
  visionWidthCache.clear()
  visionPrimed = false
  prevVisionMat = new Float32Array(nextCap * 16)
  for (let i = 0; i < prevVisionMat.length; i++) prevVisionMat[i] = Infinity
  try {
    const uiPrefs = useUiPrefs()
    if (uiPrefs.isLogOn?.('vision')) console.debug('[Vision] ensureVisionMesh cap=', nextCap, 'desired=', desired)
  } catch {}
}

// Cached overlay appearance for action ranges
let actionRangeLastThin = true
let actionRangeLastAlpha = 0.2

// Ensure action range instanced meshes (separate by diet) exist and are configured
type ActionRangeOverlay = { alpha?: number; thin?: boolean; byType?: Record<string, boolean> }
function ensureActionRangeMeshes(
  herbCount: number,
  carnCount: number,
  aro: ActionRangeOverlay | undefined,
) {
  const alpha = Number(aro?.alpha ?? actionRangeLastAlpha)
  const thin = aro?.thin ?? actionRangeLastThin
  const anyTypeOn = (() => {
    const bt = aro?.byType
    if (!bt) return true
    const keys = Object.keys(bt)
    if (keys.length === 0) return true
    for (const k of keys) if (bt[k] !== false) return true
    return false
  })()

  // Helper to (re)create an instanced ring mesh with capacity
  const createRingMesh = (
    capacity: number,
    color: THREE.Color | number,
  ): THREE.InstancedMesh | null => {
    if (capacity <= 0) return null
    // Unit ring around radius=1, scaled per instance
    const outer = 1.0
    const inner = thin ? Math.max(0.0, outer - 0.06) : Math.max(0.0, outer - 0.25)
    const geo = new THREE.RingGeometry(inner, outer, 48)
    const mat = new THREE.MeshBasicMaterial({
      color: color as THREE.ColorRepresentation,
      transparent: true,
      opacity: Math.max(0, Math.min(1, alpha)),
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
    })
    const mesh = new THREE.InstancedMesh(geo, mat, capacity)
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    mesh.frustumCulled = false
    mesh.renderOrder = 7
    mesh.visible = true
    return mesh
  }

  // Recreate meshes if counts changed or appearance toggles changed
  const needRebuildHerb = !actionRangeHerbMesh || thin !== actionRangeLastThin || herbCount > actionRangeHerbCap
  const needRebuildCarn = !actionRangeCarnMesh || thin !== actionRangeLastThin || carnCount > actionRangeCarnCap

  if (needRebuildHerb) {
    if (actionRangeHerbMesh) {
      scene.remove(actionRangeHerbMesh)
      actionRangeHerbMesh.geometry?.dispose?.()
      ;(actionRangeHerbMesh.material as THREE.Material | undefined)?.dispose?.()
      actionRangeHerbMesh = null
    }
    if (herbCount > 0) {
      actionRangeHerbCap = Math.pow(2, Math.ceil(Math.log2(Math.max(1, herbCount))))
      actionRangeHerbMesh = createRingMesh(actionRangeHerbCap, new THREE.Color(0.2, 0.9, 0.4))
      if (actionRangeHerbMesh) {
        actionRangeHerbMesh.userData.type = 'action_range_herb'
        scene.add(actionRangeHerbMesh)
        actionRangeHerbStart = 0
      }
    } else {
      actionRangeHerbStart = 0
      actionRangeHerbCap = 0
    }
  }

  if (needRebuildCarn) {
    if (actionRangeCarnMesh) {
      scene.remove(actionRangeCarnMesh)
      actionRangeCarnMesh.geometry?.dispose?.()
      ;(actionRangeCarnMesh.material as THREE.Material | undefined)?.dispose?.()
      actionRangeCarnMesh = null
    }
    if (carnCount > 0) {
      actionRangeCarnCap = Math.pow(2, Math.ceil(Math.log2(Math.max(1, carnCount))))
      actionRangeCarnMesh = createRingMesh(actionRangeCarnCap, new THREE.Color(0.95, 0.25, 0.25))
      if (actionRangeCarnMesh) {
        actionRangeCarnMesh.userData.type = 'action_range_carn'
        scene.add(actionRangeCarnMesh)
        actionRangeCarnStart = 0
      }
    } else {
      actionRangeCarnStart = 0
      actionRangeCarnCap = 0
    }
  }

  // Update opacity live if meshes exist and alpha changed
  if (actionRangeHerbMesh && actionRangeLastAlpha !== alpha) {
    const m = actionRangeHerbMesh.material as THREE.MeshBasicMaterial
    if (m) m.opacity = Math.max(0, Math.min(1, alpha))
  }
  if (actionRangeCarnMesh && actionRangeLastAlpha !== alpha) {
    const m = actionRangeCarnMesh.material as THREE.MeshBasicMaterial
    if (m) m.opacity = Math.max(0, Math.min(1, alpha))
  }

  // Respect per-action type toggles by controlling visibility
  if (actionRangeHerbMesh) actionRangeHerbMesh.visible = anyTypeOn
  if (actionRangeCarnMesh) actionRangeCarnMesh.visible = anyTypeOn

  actionRangeLastThin = thin
  actionRangeLastAlpha = alpha
}

// Chunked updater for action range rings per diet
// Reusable scratch arrays to avoid per-frame allocations
const scratchIndicesHerb: number[] = []
const scratchIndicesCarn: number[] = []

function updateActionRangeInstancesChunk(
  creatures: readonly Creature[],
  start: number,
  chunk: number,
  diet: 'Herbivore' | 'Carnivore',
): number {
  const mesh = diet === 'Carnivore' ? actionRangeCarnMesh : actionRangeHerbMesh
  if (!mesh) return 0
  const len = creatures.length
  if (len === 0) return 0

  // Build filtered indices for selected diet
  const indices = diet === 'Carnivore' ? scratchIndicesCarn : scratchIndicesHerb
  indices.length = 0
  for (let i = 0; i < len; i++) {
    const d = ((creatures[i].phenotype as { diet?: string } | undefined)?.diet ?? 'Herbivore') === 'Carnivore' ? 'Carnivore' : 'Herbivore'
    if (d === diet) indices.push(i)
  }
  if (indices.length === 0) return 0

  const end = Math.min(indices.length, start + chunk)
  // Direct buffer writes for subset [start, end)
  const matArr = (mesh.instanceMatrix as unknown as THREE.InstancedBufferAttribute)
    .array as Float32Array
  const prevArr = diet === 'Carnivore' ? prevActionRangeCarnMat : prevActionRangeHerbMat
  let first = -1
  let last = -1
  for (let k = start; k < end; k++) {
    const ci = indices[k]
    const c = creatures[ci]
    const base = k * 16
    const sx = Math.max(2, c.radius * 3)
    const sy = sx
    const tx = c.x
    const ty = c.y
    if (
      !prevArr ||
      Math.abs((prevArr as Float32Array)[base + 0] - sx) > EPS ||
      Math.abs((prevArr as Float32Array)[base + 5] - sy) > EPS ||
      Math.abs((prevArr as Float32Array)[base + 12] - tx) > EPS ||
      Math.abs((prevArr as Float32Array)[base + 13] - ty) > EPS
    ) {
      // S(base) then T(x,y)
      matArr[base + 0] = sx
      matArr[base + 1] = 0
      matArr[base + 2] = 0
      matArr[base + 3] = 0
      matArr[base + 4] = 0
      matArr[base + 5] = sy
      matArr[base + 6] = 0
      matArr[base + 7] = 0
      matArr[base + 8] = 0
      matArr[base + 9] = 0
      matArr[base + 10] = 1
      matArr[base + 11] = 0
      matArr[base + 12] = tx
      matArr[base + 13] = ty
      matArr[base + 14] = 0
      matArr[base + 15] = 1
      if (prevArr) {
        prevArr[base + 0] = sx
        prevArr[base + 5] = sy
        prevArr[base + 12] = tx
        prevArr[base + 13] = ty
      }
      if (first === -1) first = k
      last = k
    }
  }
  if (first !== -1) {
    const matAttrAR = mesh.instanceMatrix as unknown as THREE.BufferAttribute
    setAttrRange(matAttrAR, first * 16, (last - first + 1) * 16)
  }
  const next = end >= indices.length ? 0 : end
  return next
}

// Update per-instance transforms/colors (temps reused across chunk functions)
const tmpMatrix = new THREE.Matrix4()
const tmpScaleMatrix = new THREE.Matrix4()
const tmpRotMatrix = new THREE.Matrix4()
const tmpTransMatrix = new THREE.Matrix4()

// Helper: set partial upload range without relying on TS typing for updateRange
function setAttrRange(
  attr: THREE.BufferAttribute | THREE.InstancedBufferAttribute,
  offset: number,
  count: number,
) {
  ;(attr as unknown as { updateRange: { offset: number; count: number } }).updateRange = {
    offset,
    count,
  }
  attr.needsUpdate = true
}

// Previous-value caches for dirty checking
const EPS = 1e-3
let prevCreatureMat: Float32Array | null = null
let prevCreatureCol: Float32Array | null = null
let prevPlantMat: Float32Array | null = null
let prevCorpseMat: Float32Array | null = null
let prevCorpseCol: Float32Array | null = null
let prevVisionMat: Float32Array | null = null

// Chunked updates (return next start index)
function updateCreatureInstancesChunk(
  creatures: readonly Creature[],
  start: number,
  chunk: number,
): number {
  if (!creatureMesh) return 0
  const len = creatures.length
  if (len === 0) return 0
  const end = Math.min(len, start + chunk)
  // Direct writes into buffers to avoid setMatrixAt/setColorAt overhead
  const matArrC = (creatureMesh.instanceMatrix as unknown as THREE.InstancedBufferAttribute)
    .array as Float32Array
  const colArrC = creatureMesh.instanceColor
    ? ((creatureMesh.instanceColor as THREE.InstancedBufferAttribute).array as Float32Array)
    : null
  let firstMat = -1
  let lastMat = -1
  let firstCol = -1
  let lastCol = -1
  for (let i = start; i < end; i++) {
    const c = creatures[i]
    const base = i * 16
    // Scale-only with translation (column-major expected by shader, matches Matrix4.elements layout)
    // Elements (row-major listing):
    // [ sx, 0,  0,  0,
    //   0,  sy, 0,  0,
    //   0,  0,  1,  0,
    //   tx, ty, 0,  1 ]
    const sx = c.radius
    const sy = c.radius
    // Only write when changed (dirty check against prev)
    if (prevCreatureMat) {
      const p = prevCreatureMat
      const tx = c.x
      const ty = c.y
      if (
        Math.abs(p[base + 0] - sx) > EPS ||
        Math.abs(p[base + 5] - sy) > EPS ||
        Math.abs(p[base + 12] - tx) > EPS ||
        Math.abs(p[base + 13] - ty) > EPS
      ) {
        matArrC[base + 0] = sx
        matArrC[base + 1] = 0
        matArrC[base + 2] = 0
        matArrC[base + 3] = 0
        matArrC[base + 4] = 0
        matArrC[base + 5] = sy
        matArrC[base + 6] = 0
        matArrC[base + 7] = 0
        matArrC[base + 8] = 0
        matArrC[base + 9] = 0
        matArrC[base + 10] = 1
        matArrC[base + 11] = 0
        matArrC[base + 12] = tx
        matArrC[base + 13] = ty
        matArrC[base + 14] = 0
        matArrC[base + 15] = 1
        p[base + 0] = sx
        p[base + 5] = sy
        p[base + 12] = tx
        p[base + 13] = ty
        if (firstMat === -1) firstMat = i
        lastMat = i
      }
    } else {
      // fallback when prev not allocated
      matArrC[base + 0] = sx
      matArrC[base + 1] = 0
      matArrC[base + 2] = 0
      matArrC[base + 3] = 0
      matArrC[base + 4] = 0
      matArrC[base + 5] = sy
      matArrC[base + 6] = 0
      matArrC[base + 7] = 0
      matArrC[base + 8] = 0
      matArrC[base + 9] = 0
      matArrC[base + 10] = 1
      matArrC[base + 11] = 0
      matArrC[base + 12] = c.x
      matArrC[base + 13] = c.y
      matArrC[base + 14] = 0
      matArrC[base + 15] = 1
      if (firstMat === -1) firstMat = i
      lastMat = i
    }
    if (colArrC) {
      const cb = i * 3
      const r = c.phenotype.diet === 'Carnivore' ? 0.8 : 0.9
      const g = c.phenotype.diet === 'Carnivore' ? 0.3 : 0.7
      const b = c.phenotype.diet === 'Carnivore' ? 0.3 : 0.7
      // darken by health
      const healthRatio = c.health / 100
      const nr = r * (0.2 + 0.8 * healthRatio)
      const ng = g * (0.2 + 0.8 * healthRatio)
      const nb = b * (0.2 + 0.8 * healthRatio)
      if (
        !prevCreatureCol ||
        Math.abs(prevCreatureCol[cb + 0] - nr) > EPS ||
        Math.abs(prevCreatureCol[cb + 1] - ng) > EPS ||
        Math.abs(prevCreatureCol[cb + 2] - nb) > EPS
      ) {
        colArrC[cb + 0] = nr
        colArrC[cb + 1] = ng
        colArrC[cb + 2] = nb
        if (prevCreatureCol) {
          prevCreatureCol[cb + 0] = nr
          prevCreatureCol[cb + 1] = ng
          prevCreatureCol[cb + 2] = nb
        }
        if (firstCol === -1) firstCol = i
        lastCol = i
      }
    }
  }
  if (creatureMesh.instanceColor && firstCol !== -1) {
    const colorAttr = creatureMesh.instanceColor as unknown as THREE.BufferAttribute
    setAttrRange(colorAttr, firstCol * 3, (lastCol - firstCol + 1) * 3)
  }
  if (firstMat !== -1) {
    const matAttrC = creatureMesh.instanceMatrix as unknown as THREE.BufferAttribute
    setAttrRange(matAttrC, firstMat * 16, (lastMat - firstMat + 1) * 16)
  }
  const next = end >= len ? 0 : end
  return next
}

function updatePlantInstancesChunk(plants: readonly Plant[], start: number, chunk: number): number {
  if (!plantMesh) return 0
  const len = plants.length
  if (len === 0) return 0
  const end = Math.min(len, start + chunk)
  const matArrP = (plantMesh.instanceMatrix as unknown as THREE.InstancedBufferAttribute)
    .array as Float32Array
  let firstP = -1
  let lastP = -1
  for (let i = start; i < end; i++) {
    const p = plants[i]
    const base = i * 16
    const sx = p.radius
    const sy = p.radius
    const tx = p.x
    const ty = p.y
    if (
      !prevPlantMat ||
      Math.abs(prevPlantMat[base + 0] - sx) > EPS ||
      Math.abs(prevPlantMat[base + 5] - sy) > EPS ||
      Math.abs(prevPlantMat[base + 12] - tx) > EPS ||
      Math.abs(prevPlantMat[base + 13] - ty) > EPS
    ) {
      matArrP[base + 0] = sx
      matArrP[base + 1] = 0
      matArrP[base + 2] = 0
      matArrP[base + 3] = 0
      matArrP[base + 4] = 0
      matArrP[base + 5] = sy
      matArrP[base + 6] = 0
      matArrP[base + 7] = 0
      matArrP[base + 8] = 0
      matArrP[base + 9] = 0
      matArrP[base + 10] = 1
      matArrP[base + 11] = 0
      matArrP[base + 12] = tx
      matArrP[base + 13] = ty
      matArrP[base + 14] = 0
      matArrP[base + 15] = 1
      if (prevPlantMat) {
        prevPlantMat[base + 0] = sx
        prevPlantMat[base + 5] = sy
        prevPlantMat[base + 12] = tx
        prevPlantMat[base + 13] = ty
      }
      if (firstP === -1) firstP = i
      lastP = i
    }
  }
  if (firstP !== -1) {
    const matAttrP = plantMesh.instanceMatrix as unknown as THREE.BufferAttribute
    setAttrRange(matAttrP, firstP * 16, (lastP - firstP + 1) * 16)
  }
  const next = end >= len ? 0 : end
  return next
}

function updateCorpseInstancesChunk(
  corpses: readonly Corpse[],
  start: number,
  chunk: number,
): number {
  if (!corpseMesh) return 0
  const len = corpses.length
  if (len === 0) return 0
  const end = Math.min(len, start + chunk)
  const matArrCoW = (corpseMesh.instanceMatrix as unknown as THREE.InstancedBufferAttribute)
    .array as Float32Array
  const colArrCo = corpseMesh.instanceColor
    ? ((corpseMesh.instanceColor as THREE.InstancedBufferAttribute).array as Float32Array)
    : null
  let firstM = -1
  let lastM = -1
  let firstC = -1
  let lastC = -1
  for (let i = start; i < end; i++) {
    const c = corpses[i]
    const energyFactor = Math.max(0.6, (c.energyRemaining ?? 0) / 100)
    const scale = Math.max(0.5, c.radius * energyFactor)
    const base = i * 16
    // Only write when changed (dirty check against prev)
    if (prevCorpseMat) {
      const p = prevCorpseMat
      const tx = c.x
      const ty = c.y
      if (
        Math.abs(p[base + 0] - scale) > EPS ||
        Math.abs(p[base + 5] - scale) > EPS ||
        Math.abs(p[base + 12] - tx) > EPS ||
        Math.abs(p[base + 13] - ty) > EPS
      ) {
        matArrCoW[base + 0] = scale
        matArrCoW[base + 1] = 0
        matArrCoW[base + 2] = 0
        matArrCoW[base + 3] = 0
        matArrCoW[base + 4] = 0
        matArrCoW[base + 5] = scale
        matArrCoW[base + 6] = 0
        matArrCoW[base + 7] = 0
        matArrCoW[base + 8] = 0
        matArrCoW[base + 9] = 0
        matArrCoW[base + 10] = 1
        matArrCoW[base + 11] = 0
        matArrCoW[base + 12] = tx
        matArrCoW[base + 13] = ty
        matArrCoW[base + 14] = 0
        matArrCoW[base + 15] = 1
        p[base + 0] = scale
        p[base + 5] = scale
        p[base + 12] = tx
        p[base + 13] = ty
        if (firstM === -1) firstM = i
        lastM = i
      }
    } else {
      // fallback when prev not allocated
      matArrCoW[base + 0] = scale
      matArrCoW[base + 1] = 0
      matArrCoW[base + 2] = 0
      matArrCoW[base + 3] = 0
      matArrCoW[base + 4] = 0
      matArrCoW[base + 5] = scale
      matArrCoW[base + 6] = 0
      matArrCoW[base + 7] = 0
      matArrCoW[base + 8] = 0
      matArrCoW[base + 9] = 0
      matArrCoW[base + 10] = 1
      matArrCoW[base + 11] = 0
      matArrCoW[base + 12] = c.x
      matArrCoW[base + 13] = c.y
      matArrCoW[base + 14] = 0
      matArrCoW[base + 15] = 1
      if (firstM === -1) firstM = i
      lastM = i
    }
    if (colArrCo) {
      const poisonThreshold = c.initialDecayTime * 0.25
      const cb = i * 3
      if (c.decayTimer < poisonThreshold) {
        const nr = 120 / 255
        const ng = 50 / 255
        const nb = 120 / 255
        if (
          !prevCorpseCol ||
          Math.abs((prevCorpseCol as Float32Array)[cb + 0] - nr) > EPS ||
          Math.abs((prevCorpseCol as Float32Array)[cb + 1] - ng) > EPS ||
          Math.abs((prevCorpseCol as Float32Array)[cb + 2] - nb) > EPS
        ) {
          colArrCo[cb + 0] = nr
          colArrCo[cb + 1] = ng
          colArrCo[cb + 2] = nb
          if (prevCorpseCol) {
            prevCorpseCol[cb + 0] = nr
            prevCorpseCol[cb + 1] = ng
            prevCorpseCol[cb + 2] = nb
          }
          if (firstC === -1) firstC = i
          lastC = i
        }
      } else if (((c as unknown) as { cause?: string }).cause === 'Eaten') {
        const nr = 60 / 255
        const ng = 50 / 255
        const nb = 120 / 255
        if (
          !prevCorpseCol ||
          Math.abs((prevCorpseCol as Float32Array)[cb + 0] - nr) > EPS ||
          Math.abs((prevCorpseCol as Float32Array)[cb + 1] - ng) > EPS ||
          Math.abs((prevCorpseCol as Float32Array)[cb + 2] - nb) > EPS
        ) {
          colArrCo[cb + 0] = nr
          colArrCo[cb + 1] = ng
          colArrCo[cb + 2] = nb
          if (prevCorpseCol) {
            prevCorpseCol[cb + 0] = nr
            prevCorpseCol[cb + 1] = ng
            prevCorpseCol[cb + 2] = nb
          }
          if (firstC === -1) firstC = i
          lastC = i
        }
      } else {
        const nr = 100 / 255
        const ng = 100 / 255
        const nb = 100 / 255
        if (
          !prevCorpseCol ||
          Math.abs((prevCorpseCol as Float32Array)[cb + 0] - nr) > EPS ||
          Math.abs((prevCorpseCol as Float32Array)[cb + 1] - ng) > EPS ||
          Math.abs((prevCorpseCol as Float32Array)[cb + 2] - nb) > EPS
        ) {
          colArrCo[cb + 0] = nr
          colArrCo[cb + 1] = ng
          colArrCo[cb + 2] = nb
          if (prevCorpseCol) {
            prevCorpseCol[cb + 0] = nr
            prevCorpseCol[cb + 1] = ng
            prevCorpseCol[cb + 2] = nb
          }
          if (firstC === -1) firstC = i
          lastC = i
        }
      }
    }
  }
  if (corpseMesh.instanceColor && firstC !== -1) {
    const colorAttr = corpseMesh.instanceColor as unknown as THREE.BufferAttribute
    setAttrRange(colorAttr, firstC * 3, (lastC - firstC + 1) * 3)
  }
  if (firstM !== -1) {
    const matAttrCo = corpseMesh.instanceMatrix as unknown as THREE.BufferAttribute
    setAttrRange(matAttrCo, firstM * 16, (lastM - firstM + 1) * 16)
  }
  const next = end >= len ? 0 : end
  return next
}

function updateVisionInstancesChunk(
  creatures: readonly Creature[],
  start: number,
  chunk: number,
): number {
  if (!visionMesh) return 0
  const len = visionFlat.length
  if (len === 0) return 0
  const simStore = useSimulationStore()
  const end = Math.min(len, start + chunk)
  const halfAttr = (visionMesh.geometry as THREE.BufferGeometry).getAttribute(
    'aHalfAngle',
  ) as THREE.InstancedBufferAttribute
  const globalRange = Number(
    (simStore.simulationParams as { visionRange?: number }).visionRange ?? 80,
  )
  const halfArr = halfAttr.array as Float32Array
  const vm = visionMesh!
  const matArrV = (vm.instanceMatrix as unknown as THREE.InstancedBufferAttribute)
    .array as Float32Array
  let firstM = -1
  let lastM = -1
  for (let i = start; i < end; i++) {
    const { ci, angleDeg, widthDeg } = visionFlat[i]
    const c = creatures[ci]
    // Prefer per-creature phenotype; fallback to global sliders
    const range = Number(
      (c.phenotype as { sightRange?: number } | undefined)?.sightRange ?? globalRange,
    )
    const halfAngleRad = (Math.max(1, Math.min(179, widthDeg)) * 0.5 * Math.PI) / 180
    halfArr[i] = halfAngleRad * VISION_SPACING
    const vx = c.vx
    const vy = c.vy
    const speed = Math.hypot(vx, vy)
    const baseTheta = speed > 1e-4 ? Math.atan2(vy, vx) : 0
    const jitter = ((hash01(c.id + ':' + i) * 2 - 1) * VISION_JITTER_DEG * Math.PI) / 180
    const theta = baseTheta + (angleDeg * Math.PI) / 180 + jitter
    tmpRotMatrix.makeRotationZ(theta)
    const sca = tmpScaleMatrix.makeScale(range, range, 1)
    const trs = tmpMatrix.multiplyMatrices(tmpRotMatrix, sca)
    tmpTransMatrix.makeTranslation(c.x, c.y, VISION_Z)
    const final = tmpMatrix.multiplyMatrices(tmpTransMatrix, trs)
    const base = i * 16
    const e = final.elements
    // Only write when changed (dirty check against prev)
    if (prevVisionMat) {
      const p = prevVisionMat
      if (
        Math.abs(p[base + 0] - e[0]) > EPS ||
        Math.abs(p[base + 1] - e[1]) > EPS ||
        Math.abs(p[base + 2] - e[2]) > EPS ||
        Math.abs(p[base + 3] - e[3]) > EPS ||
        Math.abs(p[base + 4] - e[4]) > EPS ||
        Math.abs(p[base + 5] - e[5]) > EPS ||
        Math.abs(p[base + 6] - e[6]) > EPS ||
        Math.abs(p[base + 7] - e[7]) > EPS ||
        Math.abs(p[base + 8] - e[8]) > EPS ||
        Math.abs(p[base + 9] - e[9]) > EPS ||
        Math.abs(p[base + 10] - e[10]) > EPS ||
        Math.abs(p[base + 11] - e[11]) > EPS ||
        Math.abs(p[base + 12] - e[12]) > EPS ||
        Math.abs(p[base + 13] - e[13]) > EPS ||
        Math.abs(p[base + 14] - e[14]) > EPS ||
        Math.abs(p[base + 15] - e[15]) > EPS
      ) {
        matArrV[base + 0] = e[0]
        matArrV[base + 1] = e[1]
        matArrV[base + 2] = e[2]
        matArrV[base + 3] = e[3]
        matArrV[base + 4] = e[4]
        matArrV[base + 5] = e[5]
        matArrV[base + 6] = e[6]
        matArrV[base + 7] = e[7]
        matArrV[base + 8] = e[8]
        matArrV[base + 9] = e[9]
        matArrV[base + 10] = e[10]
        matArrV[base + 11] = e[11]
        matArrV[base + 12] = e[12]
        matArrV[base + 13] = e[13]
        matArrV[base + 14] = e[14]
        matArrV[base + 15] = e[15]
        p[base + 0] = e[0]
        p[base + 1] = e[1]
        p[base + 2] = e[2]
        p[base + 3] = e[3]
        p[base + 4] = e[4]
        p[base + 5] = e[5]
        p[base + 6] = e[6]
        p[base + 7] = e[7]
        p[base + 8] = e[8]
        p[base + 9] = e[9]
        p[base + 10] = e[10]
        p[base + 11] = e[11]
        p[base + 12] = e[12]
        p[base + 13] = e[13]
        p[base + 14] = e[14]
        p[base + 15] = e[15]
        if (firstM === -1) firstM = i
        lastM = i
      }
    } else {
      // fallback when prev not allocated
      matArrV[base + 0] = e[0]
      matArrV[base + 1] = e[1]
      matArrV[base + 2] = e[2]
      matArrV[base + 3] = e[3]
      matArrV[base + 4] = e[4]
      matArrV[base + 5] = e[5]
      matArrV[base + 6] = e[6]
      matArrV[base + 7] = e[7]
      matArrV[base + 8] = e[8]
      matArrV[base + 9] = e[9]
      matArrV[base + 10] = e[10]
      matArrV[base + 11] = e[11]
      matArrV[base + 12] = e[12]
      matArrV[base + 13] = e[13]
      matArrV[base + 14] = e[14]
      matArrV[base + 15] = e[15]
      if (firstM === -1) firstM = i
      lastM = i
    }
  }
  if (firstM !== -1) {
    const matAttrV = vm.instanceMatrix as unknown as THREE.BufferAttribute
    setAttrRange(matAttrV, firstM * 16, (lastM - firstM + 1) * 16)
  }
  const halfAttrBA = halfAttr as unknown as THREE.BufferAttribute
  setAttrRange(halfAttrBA, start, end - start)
  const next = end >= len ? 0 : end
  return next
}
