#!/usr/bin/env node
// Merge bad brain hashes from one or more save-state JSON files into scripts/bad-brains.json
// Usage: node scripts/merge-bad-brains.mjs path/to/save1.json [save2.json ...]

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
// Centralized canonical bad-brains file under public/
const BAD_PATH = path.join(__dirname, '..', 'public', 'bad-brains.json')

function uniq(arr) {
  return Array.from(new Set(arr))
}

function keep(s) {
  return typeof s === 'string' && !s.startsWith('cascade-test-hash-')
}

async function loadBad() {
  try {
    const txt = await readFile(BAD_PATH, 'utf-8')
    const json = JSON.parse(txt)
    return Array.isArray(json) ? json.filter(keep) : []
  } catch {
    return []
  }
}

async function loadSaves(paths) {
  const hashes = []
  for (const p of paths) {
    try {
      const txt = await readFile(p, 'utf-8')
      const json = JSON.parse(txt)
      if (Array.isArray(json.badBrainHashes)) {
        for (const h of json.badBrainHashes) if (keep(h)) hashes.push(h)
      } else if (Array.isArray(json)) {
        // allow merging a raw array of hashes as well
        for (const h of json) if (keep(h)) hashes.push(h)
      }
    } catch (e) {
      console.error(`Failed reading ${p}:`, e.message)
    }
  }
  return hashes
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length === 0) {
    console.error('Provide one or more save-state JSON files to merge from.')
    process.exit(2)
  }
  const baseline = await loadBad()
  const extra = await loadSaves(args)

  const merged = uniq([...baseline, ...extra].filter(keep))
  await writeFile(BAD_PATH, JSON.stringify(merged, null, 2), 'utf-8')

  console.log(`Merged ${extra.length} incoming hashes.`)
  console.log(`Result size: ${merged.length}. Wrote -> ${BAD_PATH}`)
}

main().catch((e) => {
  console.error('Error:', e)
  process.exit(1)
})
