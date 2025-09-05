<template>
  <transition name="fade">
    <div v-if="visible" class="fixed inset-0 z-[100] flex items-center justify-center bg-base-200/95 overflow-hidden">
      <!-- Animated background -->
      <div class="absolute inset-0 pointer-events-none -z-10 animated-bg"></div>
      <div class="w-full max-w-xl mx-4">
        <div class="card shadow-2xl bg-base-100/90 backdrop-blur">
          <div class="card-body">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center overflow-hidden">
                <img src="@/assets/evosim-logo.svg" alt="EvoSim Logo" class="w-7 h-7 opacity-90" />
              </div>
              <div>
                <h2 class="card-title leading-tight">EvoSim</h2>
                <p class="text-sm opacity-70">Evolutionary ecosystem simulator</p>
              </div>
            </div>

            <div class="mt-4">
              <p v-if="!error" class="text-base">
                Initializing WebAssembly module…
              </p>
              <p v-else class="text-base text-warning">
                WASM failed to initialize.
              </p>
              <div class="mt-3 flex items-center gap-3">
                <span v-if="!error" class="loading loading-dots loading-md text-primary"></span>
                <div v-else class="flex items-center gap-2">
                  <button class="btn btn-primary" :disabled="retrying" @click="$emit('retry')">
                    <span v-if="!retrying">Retry</span>
                    <span v-else class="loading loading-spinner loading-xs"></span>
                  </button>
                  <button class="btn" @click="toggleDiag">{{ showDiag ? 'Hide' : 'Details' }} <span class="opacity-60 text-xs ml-1">(D)</span></button>
                  <button class="btn btn-ghost" :disabled="!error || copied" @click="copyError">
                    <span v-if="!copied">Copy Error</span>
                    <span v-else>Copied!</span>
                  </button>
                </div>
              </div>
              <div v-if="error && showDiag" class="mt-3 text-xs p-2 bg-base-200 rounded">
                <div class="font-semibold mb-1">Error</div>
                <pre class="whitespace-pre-wrap break-words text-xs opacity-80">{{ error }}</pre>
              </div>
            </div>

            <div class="mt-6 grid grid-cols-3 gap-4 text-center">
              <div>
                <div class="text-sm opacity-60">Renderer</div>
                <div class="text-sm font-semibold">WebGL</div>
              </div>
              <div>
                <div class="text-sm opacity-60">Mode</div>
                <div class="text-sm font-semibold">{{ brainMode }}</div>
              </div>
              <div>
                <div class="text-sm opacity-60">Target FPS</div>
                <div class="text-sm font-semibold">{{ targetFps }}</div>
              </div>
            </div>

            <div class="mt-2 text-xs opacity-60">
              Tip: You can change settings later in the sidebar.
            </div>
          </div>
        </div>
      </div>
    </div>
  </transition>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps<{
  visible: boolean
  error: string | null
  retrying?: boolean
  brainMode: 'OG' | 'Zegion'
  targetFps: number
}>()

defineEmits<{
  (e: 'retry'): void
}>()

const showDiag = ref(false)
const copied = ref(false)
let copyT: number | undefined
function toggleDiag() {
  showDiag.value = !showDiag.value
}

async function copyError() {
  if (!props.error) return
  try {
    await navigator.clipboard?.writeText(props.error)
    copied.value = true
  } catch {
    // ignore
  }
  if (copyT) window.clearTimeout(copyT)
  copyT = window.setTimeout(() => (copied.value = false), 1200)
}

function onKey(e: KeyboardEvent) {
  if (!props.visible) return
  if (e.key === 'd' || e.key === 'D') {
    e.preventDefault()
    toggleDiag()
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  if (copyT) window.clearTimeout(copyT)
})

watch(
  () => props.visible,
  (v) => {
    if (!v) showDiag.value = false
  },
)
</script>

<style scoped>
.animated-bg {
  background: radial-gradient(800px 800px at 20% 20%, hsl(var(--p)/0.15), transparent 60%),
              radial-gradient(700px 700px at 80% 30%, hsl(var(--s)/0.15), transparent 60%),
              radial-gradient(900px 900px at 50% 80%, hsl(var(--a)/0.12), transparent 60%),
              linear-gradient(120deg, hsl(var(--b1)) 0%, hsl(var(--b2)) 100%);
  background-size: 200% 200%, 200% 200%, 200% 200%, 100% 100%;
  animation: bg-move 12s ease-in-out infinite;
  filter: blur(12px);
}

@keyframes bg-move {
  0% { background-position: 0% 50%, 100% 50%, 50% 100%, 0% 0%; }
  50% { background-position: 100% 50%, 0% 50%, 50% 0%, 0% 0%; }
  100% { background-position: 0% 50%, 100% 50%, 50% 100%, 0% 0%; }
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity 250ms ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
