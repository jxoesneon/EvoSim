#!/usr/bin/env node
// Brain smoke test and simple training filter.
// - Default: randomly initialized MLPs get random inputs and produce outputs.
// - Train mode: simulate N seconds, detect if x-output collapses ~0, and persist bad brain hashes.
// Usage:
//   node scripts/brain-smoke.mjs [OG|Zegion] [runs]
//   node scripts/brain-smoke.mjs [OG|Zegion] [runs] --train [--seconds=10] [--epsilon=0.02]

import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const modes = {
  OG: { sizes: [14, 8, 8] },
  ZEGION: { sizes: [24, 16, 6] },
  Zegion: { sizes: [24, 16, 6] },
}

function initBrain(layerSizes) {
  const weights = []
  const biases = []
  for (let li = 1; li < layerSizes.length; li++) {
    const nIn = layerSizes[li - 1]
    const nOut = layerSizes[li]
    const scale = Math.sqrt(2 / Math.max(1, nIn))
    const w = []
    for (let o = 0; o < nOut; o++) {
      for (let i = 0; i < nIn; i++) {
        const r = Math.random() * 2 - 1
        w.push(r * scale)
      }
    }
    const b = []
    for (let o = 0; o < nOut; o++) {
      const r = Math.random() * 2 - 1
      b.push(r * 0.5)
    }
    weights.push(w)
    biases.push(b)
  }
  return { layerSizes: layerSizes.slice(), weights, biases }
}

function relu(x) {
  return x > 0 ? x : 0
}
function tanh(x) {
  return Math.tanh(x)
}

function brainForward(brain, inputs) {
  const ls = brain.layerSizes
  let cur = inputs.slice()
  for (let li = 1; li < ls.length; li++) {
    const nIn = ls[li - 1]
    const nOut = ls[li]
    const w = brain.weights[li - 1]
    const b = brain.biases[li - 1]
    const next = new Array(nOut).fill(0)
    for (let o = 0; o < nOut; o++) {
      let sum = b[o]
      const base = o * nIn
      for (let ii = 0; ii < nIn; ii++) sum += w[base + ii] * cur[ii]
      // hidden layers relu, output tanh
      if (li === ls.length - 1) next[o] = tanh(sum)
      else next[o] = relu(sum)
    }
    cur = next
  }
  return cur.slice()
}

function randVec(n) {
  const v = new Array(n)
  for (let i = 0; i < n; i++) v[i] = Math.random() * 2 - 1
  return v
}

function pad(n, w = 6) {
  return String(n).padStart(w)
}

function simpleHash(str) {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    hash = (hash << 5) - hash + ch
    hash |= 0
  }
  return (hash >>> 0).toString(36)
}

function brainToJSON(brain) {
  return { layerSizes: brain.layerSizes, weights: brain.weights, biases: brain.biases }
}

function parseArgs(argv) {
  const out = { train: false, seconds: 10, epsilon: 0.02 }
  for (const a of argv) {
    if (a === '--train') out.train = true
    else if (a.startsWith('--seconds='))
      out.seconds = Math.max(1, parseInt(a.split('=')[1] || '10', 10))
    else if (a.startsWith('--epsilon='))
      out.epsilon = Math.max(0, parseFloat(a.split('=')[1] || '0.02'))
  }
  return out
}

async function loadBadBrains(badPath) {
  try {
    const data = await readFile(badPath, 'utf-8')
    const json = JSON.parse(data)
    return new Set(Array.isArray(json) ? json : [])
  } catch {
    return new Set()
  }
}

async function saveBadBrains(badPath, set) {
  const arr = Array.from(set)
  await writeFile(badPath, JSON.stringify(arr, null, 2), 'utf-8')
}

function simulateCollapseCheck(brain, seconds, sizes, epsilon) {
  const steps = Math.max(1, Math.round(seconds * 60))
  let sumAbs = 0
  let nearZeroCount = 0
  for (let t = 0; t < steps; t++) {
    const inputs = randVec(sizes[0])
    const out = brainForward(brain, inputs)
    const x = out[0] ?? 0
    const ax = Math.abs(x)
    sumAbs += ax
    if (ax < epsilon) nearZeroCount++
  }
  const meanAbs = sumAbs / steps
  const fracNearZero = nearZeroCount / steps
  // Define collapse as both low mean |x| and high fraction near-zero
  const collapsed = meanAbs < epsilon * 1.25 && fracNearZero > 0.75
  return {
    collapsed,
    meanAbs: Number(meanAbs.toFixed(5)),
    fracNearZero: Number(fracNearZero.toFixed(3)),
  }
}

async function main() {
  const raw = process.argv[2] || 'OG'
  const modeArg = raw.toUpperCase()
  const runs = Math.max(1, parseInt(process.argv[3] || '5', 10))
  const modeKey = modes[modeArg] ? modeArg : modes[raw] ? raw : 'OG'
  const sizes = modes[modeKey].sizes
  const opts = parseArgs(process.argv.slice(4))

  const __filename = fileURLToPath(import.meta.url)
  const __dirname = path.dirname(__filename)
  // Centralized canonical bad-brains file lives under public/ so the app can fetch it
  const badPath = path.join(__dirname, '..', 'public', 'bad-brains.json')
  const badBrains = await loadBadBrains(badPath)

  console.log(`Brain Smoke Test`)
  console.log(`Mode: ${modeKey}`)
  console.log(`Architecture: ${sizes.join(' -> ')}`)
  console.log(`Runs: ${runs}`)
  if (opts.train) console.log(`Train: seconds=${opts.seconds} epsilon=${opts.epsilon}`)
  console.log(`Bad set loaded: ${badBrains.size}`)

  let added = 0
  for (let r = 1; r <= runs; r++) {
    const brain = initBrain(sizes)
    const bjson = brainToJSON(brain)
    const bhash = simpleHash(JSON.stringify(bjson))
    if (badBrains.has(bhash)) {
      console.log(`Run ${pad(r, 2)} | skipped (known-bad hash=${bhash})`)
      continue
    }

    if (opts.train) {
      const res = simulateCollapseCheck(brain, opts.seconds, sizes, opts.epsilon)
      if (res.collapsed) {
        badBrains.add(bhash)
        added++
        console.log(
          `Run ${pad(r, 2)} | COLLAPSED (mean|x|=${res.meanAbs}, frac<eps=${res.fracNearZero}) -> added hash=${bhash}`,
        )
        continue
      } else {
        console.log(
          `Run ${pad(r, 2)} | OK (mean|x|=${res.meanAbs}, frac<eps=${res.fracNearZero}) hash=${bhash}`,
        )
      }
    } else {
      const inputs = randVec(sizes[0])
      const out = brainForward(brain, inputs)
      const okLen = out.length === sizes[sizes.length - 1]
      const allFinite = out.every(Number.isFinite)
      console.log(
        `Run ${pad(r, 2)} | inputs=${inputs.length}, outputs=${out.length} | okLen=${okLen} allFinite=${allFinite}`,
      )
      console.log(`  out: [${out.map((v) => v.toFixed(3)).join(', ')}] hash=${bhash}`)
    }
  }

  if (opts.train && added > 0) {
    await saveBadBrains(badPath, badBrains)
    console.log(`Persisted ${added} new bad brain hashes -> ${badPath}`)
  }

  console.log('DONE')
}

main().catch((e) => {
  console.error('Error:', e)
  process.exit(1)
})
