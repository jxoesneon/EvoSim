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

// WebGL renderer state
let renderer: any
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
let creatureCount = 0
let plantCount = 0
let corpseCount = 0
let visionCount = 0
let actionRangeHerbCount = 0
let actionRangeCarnCount = 0
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
// Cache for vision cone base width per creature (to avoid per-frame trig)
const visionWidthCache = new Map<string, { fovDeg: number; range: number; baseWidth: number }>()
// Whether we've performed an initial full transform update for current vision mesh
let visionPrimed = false
// Z layer for vision cones so they render above creatures and weather
const VISION_Z = 1.5
// Flattened per-eye layout for vision cones built each frame
let visionFlat: { ci: number; angleDeg: number; widthDeg: number }[] = []
let visionTotal = 0
// Visual tuning to match OG look
const VISION_SPACING = 0.95 // multiply half-angle by this to create a small gap
const VISION_JITTER_DEG = 1.2 // tiny deterministic jitter to avoid uniform overlaps
const FEATHER_RADIAL = 0.06 // radial feather (0..1 of radius)
const FEATHER_ANGULAR_RAD = 0.08 // angular feather in radians

// During Vite HMR, ensure previous GL resources are disposed to avoid context conflicts
// This prevents errors like "existing context of a different type" on the same canvas
// when the module is reloaded.
try {
  if ((import.meta as any)?.hot) {
    ;(import.meta as any).hot.dispose(() => {
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

function computeEyeAnglesDeg(c: any, fallbackFovDeg: number): number[] {
  const ph = c?.phenotype || {}
  const fromPh = Array.isArray(ph.eyeAnglesDeg) ? ph.eyeAnglesDeg : null
  if (fromPh && fromPh.length > 0) return fromPh as number[]
  const eyes = Math.max(1, Math.min(6, Math.floor(Number(ph.eyesCount) || 1)))
  const fov =
    Number.isFinite(ph.fieldOfViewDeg) && ph.fieldOfViewDeg > 0 ? ph.fieldOfViewDeg : fallbackFovDeg
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
  visionFlat.length = 0
  let total = 0
  const globalFov = Number((simStore.simulationParams as any).visionFovDeg ?? 90)
  for (let ci = 0; ci < creatures.length; ci++) {
    const c: any = creatures[ci]
    const ph = c?.phenotype || {}
    const fovDeg =
      Number.isFinite(ph.fieldOfViewDeg) && ph.fieldOfViewDeg > 0 ? ph.fieldOfViewDeg : globalFov
    const half = fovDeg / 2
    let angles = computeEyeAnglesDeg(c, globalFov)
      .slice()
      .sort((a, b) => a - b)
    const n = angles.length
    if (n === 1) {
      // Single eye takes full FOV
      visionFlat.push({ ci, angleDeg: angles[0], widthDeg: fovDeg })
      total += 1
    } else {
      // Apply a small per-creature rotation offset of the whole eye set to reduce uniformity
      const step = n > 1 ? fovDeg / (n - 1) : fovDeg
      const offset = (hash01(String(c.id)) * 2 - 1) * step * 0.5
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
    const globalFov = Number((simStore.simulationParams as any).visionFovDeg ?? 90)
    const globalRange = Number((simStore.simulationParams as any).visionRange ?? 80)
    const fovDegRaw = Number((c as any)?.phenotype?.fieldOfViewDeg)
    const rangeRaw = Number((c as any)?.phenotype?.sightRange)
    const fovDeg = Number.isFinite(fovDegRaw) && fovDegRaw > 0 ? fovDegRaw : globalFov
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
    visionMesh.setMatrixAt(i, final)
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
  const attemptAcquireGL = (): any => {
    // Prefer WebGL2, fallback to WebGL1; both calls return the existing context if already created
    const gl2 = canvas.getContext('webgl2', { antialias: true, alpha: true }) as any
    const gl = (gl2 || canvas.getContext('webgl', { antialias: true, alpha: true })) as any
    return gl || null
  }

  try {
    if (isTestEnv) {
      throw new Error('Headless test environment')
    }
    let gl: any = null
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
  } catch (e) {
    // Headless or failed to create GL context: provide a no-op renderer
    headless = true
    renderer = {
      setPixelRatio: (_: number) => {},
      setSize: (_w: number, _h: number) => {},
      render: (_scene: any, _camera: any) => {},
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
        actionRangeHerbMesh.geometry?.dispose?.()
        ;(actionRangeHerbMesh.material as THREE.Material | undefined)?.dispose?.()
        actionRangeHerbMesh = null
      }
      if (actionRangeCarnMesh) {
        scene.remove(actionRangeCarnMesh)
        actionRangeCarnMesh.geometry?.dispose?.()
        ;(actionRangeCarnMesh.material as THREE.Material | undefined)?.dispose?.()
        actionRangeCarnMesh = null
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
        const gl: WebGLRenderingContext | WebGL2RenderingContext | undefined =
          typeof renderer.getContext === 'function' ? (renderer.getContext() as any) : undefined
        if (gl && typeof (gl as any).getExtension === 'function') {
          const ext = (gl as any).getExtension('WEBGL_lose_context')
          if (ext && typeof ext.loseContext === 'function') {
            try {
              ext.loseContext()
            } catch {}
          }
        }
      } catch {}
      try {
        if (typeof renderer.dispose === 'function') renderer.dispose()
      } catch {}
    }
  } finally {
    // Reset state
    renderer = null
    currentCanvas = null
    scene = undefined as any
    camera = undefined as any
    creatureCount = 0
    plantCount = 0
    corpseCount = 0
    visionCount = 0
    visionStart = 0
    visionWidthCache.clear()
    visionPrimed = false
    weatherPhase = 0
    headless = false
    actionRangeHerbCount = 0
    actionRangeCarnCount = 0
    actionRangeHerbStart = 0
    actionRangeCarnStart = 0
  }
}

export function isHeadless(): boolean {
  return headless
}

function onWindowResize() {
  // When the window changes, recalc using the renderer's canvas size
  const el = (renderer && (renderer.domElement as HTMLCanvasElement)) || null
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
  const showVC = !!(simStore.simulationParams as any).showVisionCones
  if (showVC) {
    rebuildVisionLayout(creatures, simStore)
    ensureVisionMesh(visionTotal)
    if (visionMesh) {
      ;(visionMesh as any).count = visionTotal
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
      const diet = ((creatures[i] as any)?.phenotype?.diet || 'Herbivore') as string
      if (diet === 'Carnivore') carnCount++
      else herbCount++
    }
    ensureActionRangeMeshes(herbCount, carnCount, aro)
    if (actionRangeHerbMesh) (actionRangeHerbMesh as any).count = herbCount
    if (actionRangeCarnMesh) (actionRangeCarnMesh as any).count = carnCount
  } else {
    ensureActionRangeMeshes(0, 0, { alpha: 0.2, thin: true } as any)
  }

  const cameraState = simStore.camera

  // Clamp desired camera center based on current frustum and target zoom
  const desiredZoom = cameraState.zoom
  const aspect = (camera.right - camera.left) / (camera.top - camera.bottom)
  const worldHalf = 1000
  const minZoomWidth = 1
  const minZoomHeight = 1 / Math.max(0.0001, aspect)
  const minZoom = Math.max(minZoomWidth, minZoomHeight)
  const maxZoom = 5
  const z = Math.min(maxZoom, Math.max(minZoom, desiredZoom))
  let x = cameraState.x
  let y = cameraState.y
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
          desired: cameraState.zoom,
          applied: z,
          prevApplied: lastAppliedZoom,
        })
    } catch {}
    lastAppliedZoom = z
  }

  // Update instances (throttled + chunked)
  frameIndex++
  const every = Math.max(1, (simStore.simulationParams as any).instanceUpdateEvery ?? 1)
  if (frameIndex % every === 0) {
    const chunk = Math.max(1, (simStore.simulationParams as any).instanceUpdateChunk ?? 500)
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
    if (showVC && creatures.length > 0) {
      visionStart = updateVisionInstancesChunk(creatures, visionStart, chunk)
    }
    // Action ranges (optional)
    if (showActionRanges && creatures.length > 0) {
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
    ;(weatherMesh as any).visible = !!simStore.simulationParams.showWeather
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
  const simParams: any = simStore.simulationParams as any
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
        else if (chunk < 3000) chunk = Math.min(3000, Math.floor(chunk * 1.25))
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

// Ensure instanced meshes exist and match needed count
function ensureCreatureMesh(count: number) {
  if (count === creatureCount && creatureMesh) return
  if (creatureMesh) {
    scene.remove(creatureMesh)
    creatureMesh.geometry.dispose()
    ;(creatureMesh.material as THREE.Material).dispose()
    creatureMesh = null
  }
  if (count === 0) {
    creatureCount = 0
    return
  }
  // Use a unit circle, scale per-instance via matrix
  const geometry = new THREE.CircleGeometry(1, 24)
  const material = new THREE.MeshBasicMaterial({ vertexColors: true })
  creatureMesh = new THREE.InstancedMesh(geometry, material, count)
  creatureMesh.userData.type = 'creatures'
  creatureMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  scene.add(creatureMesh)
  creatureCount = count
  creatureStart = 0
}

function ensurePlantMesh(count: number) {
  if (count === plantCount && plantMesh) return
  if (plantMesh) {
    scene.remove(plantMesh)
    plantMesh.geometry.dispose()
    ;(plantMesh.material as THREE.Material).dispose()
    plantMesh = null
  }
  if (count === 0) {
    plantCount = 0
    return
  }
  const geometry = new THREE.CircleGeometry(1, 16)
  const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 0.7, 0.3) })
  plantMesh = new THREE.InstancedMesh(geometry, material, count)
  plantMesh.userData.type = 'plants'
  plantMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  scene.add(plantMesh)
  plantCount = count
  plantStart = 0
}

function ensureCorpseMesh(count: number) {
  if (count === corpseCount && corpseMesh) return
  if (corpseMesh) {
    scene.remove(corpseMesh)
    corpseMesh.geometry.dispose()
    ;(corpseMesh.material as THREE.Material).dispose()
    corpseMesh = null
  }
  if (count === 0) {
    corpseCount = 0
    return
  }
  const geometry = new THREE.CircleGeometry(1, 16)
  const material = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0.7,
    vertexColors: true,
  })
  corpseMesh = new THREE.InstancedMesh(geometry, material, count)
  corpseMesh.userData.type = 'corpses'
  corpseMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  scene.add(corpseMesh)
  corpseCount = count
  corpseStart = 0
}

// Vision cones instanced mesh (semi-transparent sectors approximated by a triangle scaled to FOV/Range)
function ensureVisionMesh(count: number) {
  if (visionMesh && count === visionCount) return
  if (visionMesh) {
    scene.remove(visionMesh)
    visionMesh.geometry.dispose()
    ;(visionMesh.material as THREE.Material).dispose()
    visionMesh = null
  }
  if (count === 0) {
    visionCount = 0
    visionStart = 0
    visionWidthCache.clear()
    visionPrimed = false
    return
  }
  // Unit quad covering [-1,1] x [-1,1]; shader will mask a circular sector
  const geom = new THREE.BufferGeometry()
  const quad = new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0])
  const idx = new Uint16Array([0, 1, 2, 0, 2, 3])
  geom.setAttribute('position', new THREE.BufferAttribute(quad, 3))
  geom.setIndex(new THREE.BufferAttribute(idx, 1))
  // Per-instance half-angle (radians)
  const halfAngles = new Float32Array(count)
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
  visionMesh = new THREE.InstancedMesh(geom, mat, count)
  visionMesh.userData.type = 'vision'
  visionMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  visionMesh.frustumCulled = false
  visionMesh.renderOrder = 6
  visionMesh.visible = true
  scene.add(visionMesh)
  visionCount = count
  visionStart = 0
  visionWidthCache.clear()
  visionPrimed = false
  try {
    const uiPrefs = useUiPrefs()
    if (uiPrefs.isLogOn?.('vision')) console.debug('[Vision] ensureVisionMesh count=', count)
  } catch {}
}

// Cached overlay appearance for action ranges
let actionRangeLastThin = true
let actionRangeLastAlpha = 0.2

// Ensure action range instanced meshes (separate by diet) exist and are configured
function ensureActionRangeMeshes(
  herbCount: number,
  carnCount: number,
  aro: { alpha?: number; thin?: boolean } | undefined,
) {
  const alpha = Number(aro?.alpha ?? actionRangeLastAlpha)
  const thin = aro?.thin ?? actionRangeLastThin
  const anyTypeOn = (() => {
    const bt: any = (aro as any)?.byType
    if (!bt) return true
    const keys = Object.keys(bt)
    if (keys.length === 0) return true
    for (const k of keys) if (bt[k] !== false) return true
    return false
  })()

  // Helper to (re)create an instanced ring mesh
  const createRingMesh = (
    count: number,
    color: THREE.Color | number,
  ): THREE.InstancedMesh | null => {
    if (count <= 0) return null
    // Unit ring around radius=1, scaled per instance
    const outer = 1.0
    const inner = thin ? Math.max(0.0, outer - 0.06) : Math.max(0.0, outer - 0.25)
    const geo = new THREE.RingGeometry(inner, outer, 48)
    const mat = new THREE.MeshBasicMaterial({
      color: color as any,
      transparent: true,
      opacity: Math.max(0, Math.min(1, alpha)),
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
    })
    const mesh = new THREE.InstancedMesh(geo, mat, count)
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    mesh.frustumCulled = false
    mesh.renderOrder = 7
    mesh.visible = true
    return mesh
  }

  // Recreate meshes if counts changed or appearance toggles changed
  const needRebuildHerb = !actionRangeHerbMesh || (actionRangeHerbMesh as any).count !== herbCount || thin !== actionRangeLastThin
  const needRebuildCarn = !actionRangeCarnMesh || (actionRangeCarnMesh as any).count !== carnCount || thin !== actionRangeLastThin

  if (needRebuildHerb) {
    if (actionRangeHerbMesh) {
      scene.remove(actionRangeHerbMesh)
      actionRangeHerbMesh.geometry?.dispose?.()
      ;(actionRangeHerbMesh.material as THREE.Material | undefined)?.dispose?.()
      actionRangeHerbMesh = null
    }
    if (herbCount > 0) {
      actionRangeHerbMesh = createRingMesh(herbCount, new THREE.Color(0.2, 0.9, 0.4))
      if (actionRangeHerbMesh) {
        actionRangeHerbMesh.userData.type = 'action_range_herb'
        scene.add(actionRangeHerbMesh)
        actionRangeHerbCount = herbCount
        actionRangeHerbStart = 0
      }
    } else {
      actionRangeHerbCount = 0
      actionRangeHerbStart = 0
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
      actionRangeCarnMesh = createRingMesh(carnCount, new THREE.Color(0.95, 0.25, 0.25))
      if (actionRangeCarnMesh) {
        actionRangeCarnMesh.userData.type = 'action_range_carn'
        scene.add(actionRangeCarnMesh)
        actionRangeCarnCount = carnCount
        actionRangeCarnStart = 0
      }
    } else {
      actionRangeCarnCount = 0
      actionRangeCarnStart = 0
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
  const indices: number[] = []
  for (let i = 0; i < len; i++) {
    const d = (((creatures[i] as any)?.phenotype?.diet || 'Herbivore') as string) === 'Carnivore' ? 'Carnivore' : 'Herbivore'
    if (d === diet) indices.push(i)
  }
  if (indices.length === 0) return 0

  const end = Math.min(indices.length, start + chunk)
  // Update only the subset [start, end) within the filtered list
  for (let k = start; k < end; k++) {
    const ci = indices[k]
    const c = creatures[ci]
    // TODO: replace with true per-action-type max range when available; using a heuristic for now
    const base = Math.max(2, c.radius * 3)
    tmpMatrix
      .makeTranslation(c.x, c.y, 1.4)
      .multiply(tmpScaleMatrix.makeScale(base, base, 1))
    mesh.setMatrixAt(k, tmpMatrix)
  }
  mesh.instanceMatrix.needsUpdate = true
  const next = end >= indices.length ? 0 : end
  return next
}

// Update per-instance transforms/colors
const tmpMatrix = new THREE.Matrix4()
const tmpScaleMatrix = new THREE.Matrix4()
const tmpRotMatrix = new THREE.Matrix4()
const tmpTransMatrix = new THREE.Matrix4()
const tmpColor = new THREE.Color()

function updateCreatureInstances(creatures: readonly Creature[]) {
  if (!creatureMesh) return
  for (let i = 0; i < creatures.length; i++) {
    const c = creatures[i]
    // Scale by radius, position at (x,y)
    tmpMatrix.makeTranslation(c.x, c.y, 0).multiply(tmpScaleMatrix.makeScale(c.radius, c.radius, 1))
    creatureMesh.setMatrixAt(i, tmpMatrix)

    // Base color by diet
    tmpColor.setRGB(
      c.phenotype.diet === 'Carnivore' ? 0.8 : 0.9,
      c.phenotype.diet === 'Carnivore' ? 0.3 : 0.7,
      c.phenotype.diet === 'Carnivore' ? 0.3 : 0.7,
    )
    const healthRatio = c.health / 100
    tmpColor.lerp(new THREE.Color(0.2, 0.2, 0.2), 1 - healthRatio)
    creatureMesh.setColorAt(i, tmpColor)
  }
  if (creatureMesh.instanceColor as any) {
    ;(creatureMesh.instanceColor as any).needsUpdate = true
  }
  creatureMesh.instanceMatrix.needsUpdate = true
}

function updatePlantInstances(plants: readonly Plant[]) {
  if (!plantMesh) return
  for (let i = 0; i < plants.length; i++) {
    const p = plants[i]
    tmpMatrix.makeTranslation(p.x, p.y, 0).multiply(tmpScaleMatrix.makeScale(p.radius, p.radius, 1))
    plantMesh.setMatrixAt(i, tmpMatrix)
  }
  plantMesh.instanceMatrix.needsUpdate = true
}

function updateCorpseInstances(corpses: readonly Corpse[]) {
  if (!corpseMesh) return
  for (let i = 0; i < corpses.length; i++) {
    const c = corpses[i]
    // Ensure visibility even when energyRemaining is 0 (WASM may emit 0 on death)
    const energyFactor = Math.max(0.6, (c.energyRemaining ?? 0) / 100)
    const scale = Math.max(0.5, c.radius * energyFactor)
    tmpMatrix.makeTranslation(c.x, c.y, 0).multiply(tmpScaleMatrix.makeScale(scale, scale, 1))
    corpseMesh.setMatrixAt(i, tmpMatrix)

    // Match OG gradient: gray while fresh; purple when heavy decay (< 25% remaining)
    const poisonThreshold = c.initialDecayTime * 0.25
    if (c.decayTimer < poisonThreshold) {
      // Approx rgba(120,50,120) -> normalized
      tmpColor.setRGB(120 / 255, 50 / 255, 120 / 255)
    } else {
      // Approx rgba(100,100,100)
      tmpColor.setRGB(100 / 255, 100 / 255, 100 / 255)
    }
    corpseMesh.setColorAt(i, tmpColor)
  }
  if (corpseMesh.instanceColor as any) {
    ;(corpseMesh.instanceColor as any).needsUpdate = true
  }
  corpseMesh.instanceMatrix.needsUpdate = true
}

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
  for (let i = start; i < end; i++) {
    const c = creatures[i]
    tmpMatrix.makeTranslation(c.x, c.y, 0).multiply(tmpScaleMatrix.makeScale(c.radius, c.radius, 1))
    creatureMesh.setMatrixAt(i, tmpMatrix)
    tmpColor.setRGB(
      c.phenotype.diet === 'Carnivore' ? 0.8 : 0.9,
      c.phenotype.diet === 'Carnivore' ? 0.3 : 0.7,
      c.phenotype.diet === 'Carnivore' ? 0.3 : 0.7,
    )
    const healthRatio = c.health / 100
    tmpColor.lerp(new THREE.Color(0.2, 0.2, 0.2), 1 - healthRatio)
    creatureMesh.setColorAt(i, tmpColor)
  }
  if (creatureMesh.instanceColor as any) {
    ;(creatureMesh.instanceColor as any).needsUpdate = true
  }
  creatureMesh.instanceMatrix.needsUpdate = true
  const next = end >= len ? 0 : end
  return next
}

// Chunked update for vision cones
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
  for (let i = start; i < end; i++) {
    const { ci, angleDeg, widthDeg } = visionFlat[i]
    const c = creatures[ci]
    // Prefer per-creature phenotype; fallback to global sliders
    const fovDeg = Number(
      (c as any)?.phenotype?.fieldOfViewDeg ??
        (simStore.simulationParams as any).visionFovDeg ??
        90,
    )
    const range = Number(
      (c as any)?.phenotype?.sightRange ?? (simStore.simulationParams as any).visionRange ?? 80,
    )
    const halfAngleRad = (Math.max(1, Math.min(179, widthDeg)) * 0.5 * Math.PI) / 180
    halfAttr.setX(i, halfAngleRad * VISION_SPACING)
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
    visionMesh.setMatrixAt(i, final)
  }
  visionMesh.instanceMatrix.needsUpdate = true
  if (halfAttr) halfAttr.needsUpdate = true
  const next = end >= len ? 0 : end
  return next
}

function updatePlantInstancesChunk(plants: readonly Plant[], start: number, chunk: number): number {
  if (!plantMesh) return 0
  const len = plants.length
  if (len === 0) return 0
  const end = Math.min(len, start + chunk)
  for (let i = start; i < end; i++) {
    const p = plants[i]
    tmpMatrix.makeTranslation(p.x, p.y, 0).multiply(tmpScaleMatrix.makeScale(p.radius, p.radius, 1))
    plantMesh.setMatrixAt(i, tmpMatrix)
  }
  plantMesh.instanceMatrix.needsUpdate = true
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
  for (let i = start; i < end; i++) {
    const c = corpses[i]
    const energyFactor = Math.max(0.6, (c.energyRemaining ?? 0) / 100)
    const scale = Math.max(0.5, c.radius * energyFactor)
    tmpMatrix.makeTranslation(c.x, c.y, 0).multiply(tmpScaleMatrix.makeScale(scale, scale, 1))
    corpseMesh.setMatrixAt(i, tmpMatrix)
    const poisonThreshold = c.initialDecayTime * 0.25
    if (c.decayTimer < poisonThreshold) {
      tmpColor.setRGB(120 / 255, 50 / 255, 120 / 255)
    } else {
      tmpColor.setRGB(100 / 255, 100 / 255, 100 / 255)
    }
    corpseMesh.setColorAt(i, tmpColor)
  }
  if (corpseMesh.instanceColor as any) {
    ;(corpseMesh.instanceColor as any).needsUpdate = true
  }
  corpseMesh.instanceMatrix.needsUpdate = true
  const next = end >= len ? 0 : end
  return next
}
