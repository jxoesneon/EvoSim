<script setup lang="ts">
import { computed } from 'vue'
import { useSimulationStore } from '../composables/useSimulationStore'

const simulationStore = useSimulationStore()
const enabled = computed(() => simulationStore.simulationParams.enableCostTelemetry)
// Computed array (template unwraps computed refs)
const list = computed<any[]>(() => simulationStore.creatures as unknown as any[])

// Time/weather/terrain/decay telemetry
const worldTsec = computed(() => simulationStore.worldTimeSec?.value ?? 0)
const worldDoy = computed(() => simulationStore.dayOfYear01?.value ?? 0)
const worldSeason = computed(() => simulationStore.season01?.value ?? 0)
const worldTsecStr = computed(() => Number(worldTsec.value).toFixed(1))
const worldDoyStr = computed(() => Number(worldDoy.value).toFixed(3))
const worldSeasonStr = computed(() => Number(worldSeason.value).toFixed(3))
const worldTimeScale = computed(() =>
  Number((simulationStore as any).simulationParams?.worldTimeScale ?? 1),
)
const realSecondsPerDay = computed(() =>
  Number((simulationStore as any).simulationParams?.realSecondsPerDay ?? 0),
)
const atCamera = computed(() => {
  const cam = simulationStore.camera
  const w = simulationStore.sampleWeather(cam.x, cam.y)
  const tr = simulationStore.sampleTerrain(cam.x, cam.y)
  return { w, tr }
})
const corpseStats = computed(() => {
  const corpsesRef: any = (simulationStore as any).corpses
  const list: any[] = Array.isArray(corpsesRef?.value) ? corpsesRef.value : []
  const n = list.length
  let sum = 0
  let withFrac = 0
  for (const c of list as any) {
    if (typeof c?.decayFrac01 === 'number') {
      sum += c.decayFrac01
      withFrac++
    }
  }
  return { n, avgFrac: withFrac ? sum / withFrac : 0 }
})

// Parity stats (env + corpse)
const parity = computed<any>(() => (simulationStore as any).parityStats)

const corpsesList = computed<any[]>(() => {
  const ref: any = (simulationStore as any).corpses
  return Array.isArray(ref?.value) ? ref.value : []
})

function costOf(c: any): any | null {
  return (c && (c as any)._lastCost) || null
}
function decayOf(co: any): any | null {
  return (co && (co as any)._lastDecay) || null
}
function fmt(n: any, digits = 3): string {
  if (n == null || Number.isNaN(Number(n))) return '-'
  const num = Number(n)
  return num.toFixed(digits)
}
function hex(n: any): string {
  if (n == null || Number.isNaN(Number(n))) return '0x0'
  const v = (Number(n) >>> 0).toString(16)
  return '0x' + v
}
function pct(n: any): string {
  if (n == null || !Number.isFinite(Number(n))) return '-'
  return (Number(n) * 100).toFixed(2) + '%'
}
</script>

<template>
  <div
    v-if="enabled"
    class="absolute top-4 left-4 z-50 bg-black/70 text-white p-2 rounded text-xs max-h-[40vh] overflow-auto w-[360px]"
  >
    <div class="font-semibold mb-1">Cost & Action Telemetry</div>
    <div v-if="parity" class="mb-2">
      <div class="font-semibold">Parity</div>
      <div class="grid grid-cols-2 gap-x-2 gap-y-0.5 text-white/80">
        <div>
          env mism: <span class="text-white">{{ parity.env?.mismatches ?? 0 }}</span>
        </div>
        <div>
          env maxΔ%: <span class="text-white">{{ pct(parity.env?.maxRelDiff) }}</span>
        </div>
        <div>
          corpse mism: <span class="text-white">{{ parity.corpse?.mismatches ?? 0 }}</span>
        </div>
        <div>
          corpse maxΔ%: <span class="text-white">{{ pct(parity.corpse?.maxRelDiff) }}</span>
        </div>
        <div class="col-span-2 text-white/70">env comp maxΔ%:</div>
        <div class="col-span-2 grid grid-cols-5 gap-1 text-[10px]">
          <div>swm: <span class="text-white">{{ pct(parity.env?.compMaxRel?.envSwim) }}</span></div>
          <div>wnd: <span class="text-white">{{ pct(parity.env?.compMaxRel?.envWind) }}</span></div>
          <div>cld: <span class="text-white">{{ pct(parity.env?.compMaxRel?.envCold) }}</span></div>
          <div>hot: <span class="text-white">{{ pct(parity.env?.compMaxRel?.envHeat) }}</span></div>
          <div>hum: <span class="text-white">{{ pct(parity.env?.compMaxRel?.envHumid) }}</span></div>
          <div>oxy: <span class="text-white">{{ pct(parity.env?.compMaxRel?.envOxy) }}</span></div>
          <div>noi: <span class="text-white">{{ pct(parity.env?.compMaxRel?.envNoise) }}</span></div>
          <div>dis: <span class="text-white">{{ pct(parity.env?.compMaxRel?.envDisease) }}</span></div>
          <div>loc: <span class="text-white">{{ pct(parity.env?.compMaxRel?.locomotion) }}</span></div>
        </div>
        <div class="col-span-2 text-white/70 mt-1">corpse comp maxΔ%:</div>
        <div class="col-span-2 grid grid-cols-6 gap-1 text-[10px]">
          <div>base: <span class="text-white">{{ pct(parity.corpse?.compMaxRel?.base) }}</span></div>
          <div>temp: <span class="text-white">{{ pct(parity.corpse?.compMaxRel?.temp) }}</span></div>
          <div>hum: <span class="text-white">{{ pct(parity.corpse?.compMaxRel?.humid) }}</span></div>
          <div>rain: <span class="text-white">{{ pct(parity.corpse?.compMaxRel?.rain) }}</span></div>
          <div>wet: <span class="text-white">{{ pct(parity.corpse?.compMaxRel?.wet) }}</span></div>
          <div>tot: <span class="text-white">{{ pct(parity.corpse?.compMaxRel?.total) }}</span></div>
        </div>
      </div>
    </div>
    <div class="mb-2 grid grid-cols-2 gap-x-2 gap-y-0.5 text-white/80">
      <div>
        t(s): <span class="text-white">{{ worldTsecStr }}</span>
      </div>
      <div>
        DOY: <span class="text-white">{{ worldDoyStr }}</span>
      </div>
      <div>
        season: <span class="text-white">{{ worldSeasonStr }}</span>
      </div>
      <div>
        timeScale: <span class="text-white">{{ worldTimeScale.toFixed(2) }}</span>
      </div>
      <div>
        sec/day: <span class="text-white">{{ realSecondsPerDay.toFixed(0) }}</span>
      </div>
      <div>
        tempC: <span class="text-white">{{ (atCamera.w.temperatureC ?? 0).toFixed(1) }}</span>
      </div>
      <div>
        humid: <span class="text-white">{{ (atCamera.w.humidity01 ?? 0).toFixed(2) }}</span>
      </div>
      <div>
        precip: <span class="text-white">{{ (atCamera.w.precipitation01 ?? 0).toFixed(2) }}</span>
      </div>
      <div>
        UV: <span class="text-white">{{ (atCamera.w.uv01 ?? 0).toFixed(2) }}</span>
      </div>
      <div>
        vis: <span class="text-white">{{ (atCamera.w.visibility01 ?? 0).toFixed(2) }}</span>
      </div>
      <div>
        noise: <span class="text-white">{{ (atCamera.w.noise01 ?? 0).toFixed(2) }}</span>
      </div>
      <div>
        wind(m/s): <span class="text-white">{{ (atCamera.w.windSpeed ?? 0).toFixed(2) }}</span>
      </div>
      <div>
        wind(deg):
        <span class="text-white">{{
          ((((atCamera.w.windDirRad ?? 0) * 180) / Math.PI + 360) % 360).toFixed(0)
        }}</span>
      </div>
      <div>
        elev: <span class="text-white">{{ (atCamera.tr.elevation01 ?? 0).toFixed(2) }}</span>
      </div>
      <div>
        wet: <span class="text-white">{{ (atCamera.tr.wetness01 ?? 0).toFixed(2) }}</span>
      </div>
      <div>
        slope: <span class="text-white">{{ (atCamera.tr.slope01 ?? 0).toFixed(2) }}</span>
      </div>
      <div>
        rough: <span class="text-white">{{ (atCamera.tr.roughness01 ?? 0).toFixed(2) }}</span>
      </div>
      <div>
        fert: <span class="text-white">{{ (atCamera.tr.fertility01 ?? 0).toFixed(2) }}</span>
      </div>
      <div>
        water: <span class="text-white">{{ (atCamera.tr.waterDepth ?? 0).toFixed(2) }}</span>
      </div>
      <div>
        flow.x: <span class="text-white">{{ (atCamera.tr.flow?.x ?? 0).toFixed(2) }}</span>
      </div>
      <div>
        flow.y: <span class="text-white">{{ (atCamera.tr.flow?.y ?? 0).toFixed(2) }}</span>
      </div>
      <div class="col-span-2">
        corpses: <span class="text-white">{{ corpseStats.n }}</span> avg decay:
        <span class="text-white">{{ corpseStats.avgFrac.toFixed(2) }}</span>
      </div>
    </div>
    <div v-if="!list || list.length === 0" class="text-white/70">No creatures</div>
    <table v-else class="w-full text-[11px]">
      <thead class="text-white/70">
        <tr>
          <th class="text-left pr-2">id</th>
          <th class="text-right pr-2">act</th>
          <th class="text-right pr-2">feel</th>
          <th class="text-right pr-2">stag</th>
          <th class="text-right pr-2">E/sec</th>
          <th class="text-right pr-2">loc</th>
          <th class="text-right pr-2">env</th>
          <th class="text-right pr-2">swm</th>
          <th class="text-right pr-2">wnd</th>
          <th class="text-right pr-2">cld</th>
          <th class="text-right pr-2">hot</th>
          <th class="text-right pr-2">hum</th>
          <th class="text-right pr-2">oxy</th>
          <th class="text-right pr-2">noi</th>
          <th class="text-right pr-2">dis</th>
          <th class="text-right pr-2">s.of</th>
          <th class="text-right pr-2">post</th>
          <th class="text-right pr-2">drink</th>
          <th class="text-right pr-2">harv</th>
          <th class="text-right pr-2">scav</th>
          <th class="text-right pr-2">mate</th>
          <th class="text-right pr-2">gest</th>
          <th class="text-right pr-2">atk</th>
          <th class="text-right">amb ΔH</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="c in list" :key="c.id" class="odd:bg-white/5">
          <td class="truncate pr-2" style="max-width: 90px">{{ c?.name || c?.id }}</td>
          <td class="text-right pr-2" :title="String(c?.actionsMask ?? 0)">
            {{ hex(c?.actionsMask) }}
          </td>
          <td class="text-right pr-2" :title="String(c?.feelingsMask ?? 0)">
            {{ hex(c?.feelingsMask) }}
          </td>
          <td class="text-right pr-2">{{ c?.stagnantTicks ?? 0 }}</td>
          <td class="text-right pr-2">{{ fmt(costOf(c)?.totalEnergyPerSec) }}</td>
          <td class="text-right pr-2">{{ fmt(costOf(c)?.locomotion) }}</td>
          <td class="text-right pr-2">{{ fmt(costOf(c)?.envTotal) }}</td>
          <td class="text-right pr-2">{{ fmt(costOf(c)?.envSwim) }}</td>
          <td class="text-right pr-2">{{ fmt(costOf(c)?.envWind) }}</td>
          <td class="text-right pr-2">{{ fmt(costOf(c)?.envCold) }}</td>
          <td class="text-right pr-2">{{ fmt(costOf(c)?.envHeat) }}</td>
          <td class="text-right pr-2">{{ fmt(costOf(c)?.envHumid) }}</td>
          <td class="text-right pr-2">{{ fmt(costOf(c)?.envOxy) }}</td>
          <td class="text-right pr-2">{{ fmt(costOf(c)?.envNoise) }}</td>
          <td class="text-right pr-2">{{ fmt(costOf(c)?.envDisease) }}</td>
          <td class="text-right pr-2">{{ fmt(costOf(c)?.sprintOverflowE) }}</td>
          <td class="text-right pr-2">{{ fmt(costOf(c)?.postureE) }}</td>
          <td class="text-right pr-2">{{ fmt(costOf(c)?.drinkE) }}</td>
          <td class="text-right pr-2">{{ fmt(costOf(c)?.harvestE) }}</td>
          <td class="text-right pr-2">{{ fmt(costOf(c)?.scavengeE) }}</td>
          <td class="text-right pr-2">{{ fmt(costOf(c)?.matingE) }}</td>
          <td class="text-right pr-2">{{ fmt(costOf(c)?.gestationE) }}</td>
          <td class="text-right pr-2">{{ fmt(costOf(c)?.attackE) }}</td>
          <td class="text-right">{{ fmt(costOf(c)?.ambientHealthDelta) }}</td>
        </tr>
      </tbody>
    </table>
    <div v-if="corpsesList && corpsesList.length" class="mt-2">
      <div class="font-semibold mb-1">Corpse Decay Telemetry</div>
      <table class="w-full text-[11px]">
        <thead class="text-white/70">
          <tr>
            <th class="text-left pr-2">idx</th>
            <th class="text-right pr-2">tot</th>
            <th class="text-right pr-2">base</th>
            <th class="text-right pr-2">temp</th>
            <th class="text-right pr-2">hum</th>
            <th class="text-right pr-2">rain</th>
            <th class="text-right">wet</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(co, i) in corpsesList.slice(0, 5)" :key="i" class="odd:bg-white/5">
            <td class="truncate pr-2">{{ i }}</td>
            <td class="text-right pr-2">{{ fmt(decayOf(co)?.total) }}</td>
            <td class="text-right pr-2">{{ fmt(decayOf(co)?.base) }}</td>
            <td class="text-right pr-2">{{ fmt(decayOf(co)?.temp) }}</td>
            <td class="text-right pr-2">{{ fmt(decayOf(co)?.humid) }}</td>
            <td class="text-right pr-2">{{ fmt(decayOf(co)?.rain) }}</td>
            <td class="text-right">{{ fmt(decayOf(co)?.wet) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
table {
  border-collapse: collapse;
}
th,
td {
  padding: 2px 4px;
}
</style>
