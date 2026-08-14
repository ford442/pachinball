#!/usr/bin/env node
/**
 * Compare gzipped Vite output against bundle-budget.json.
 *
 * Usage:
 *   node scripts/check-bundle-size.mjs            # fail if over budget
 *   node scripts/check-bundle-size.mjs --print    # print measurements only
 */
import { gzipSync } from 'node:zlib'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const distDir = join(root, 'dist')
const assetsDir = join(distDir, 'assets')
const budgetPath = join(root, 'bundle-budget.json')

function walkFiles(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walkFiles(full))
    else out.push(full)
  }
  return out
}

function gzipKb(buf) {
  return gzipSync(buf).length / 1024
}

function findChunk(files, prefix) {
  const matches = files.filter((f) => {
    const name = f.split(/[/\\]/).pop() ?? ''
    return name.startsWith(`${prefix}-`) && name.endsWith('.js')
  })
  // Vite may emit more than one `index-*.js` (entry + tiny helpers).
  // Budget the largest — that's the app entry.
  return matches.sort((a, b) => statSync(b).size - statSync(a).size)[0]
}

function measure() {
  if (!statSync(distDir, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`Missing ${distDir} — run \`npx vite build\` first`)
  }
  if (!statSync(assetsDir, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`Missing ${assetsDir}`)
  }

  const jsFiles = readdirSync(assetsDir)
    .filter((name) => name.endsWith('.js'))
    .map((name) => join(assetsDir, name))

  const entry = findChunk(jsFiles, 'index')
  const babylonCore = findChunk(jsFiles, 'babylon-core')
  const rapier = findChunk(jsFiles, 'rapier')

  const readGzip = (path) => (path ? gzipKb(readFileSync(path)) : 0)

  const workboxIgnores = [
    /backbox[/\\].*\.(mp4|webm)$/,
    /babylon-loaders-.*\.js$/,
    /ui-overlays-.*\.js$/,
    /reel\.png$/,
  ]

  let precacheTotalKiB = 0
  for (const file of walkFiles(distDir)) {
    const rel = relative(distDir, file).replaceAll('\\', '/')
    if (workboxIgnores.some((re) => re.test(rel))) continue
    if (!/\.(js|css|html|wasm|svg|png|ogg|env|webp|ico|txt|webmanifest)$/.test(rel)) continue
    precacheTotalKiB += statSync(file).size / 1024
  }

  return {
    entryGzipKb: Number(readGzip(entry).toFixed(2)),
    babylonCoreGzipKb: Number(readGzip(babylonCore).toFixed(2)),
    rapierGzipKb: Number(readGzip(rapier).toFixed(2)),
    precacheTotalKiB: Number(precacheTotalKiB.toFixed(2)),
    files: {
      entry: entry ? relative(root, entry) : null,
      babylonCore: babylonCore ? relative(root, babylonCore) : null,
      rapier: rapier ? relative(root, rapier) : null,
    },
  }
}

const printOnly = process.argv.includes('--print')
const measured = measure()

console.log('Bundle size report')
console.log(JSON.stringify(measured, null, 2))

if (printOnly) process.exit(0)

const budget = JSON.parse(readFileSync(budgetPath, 'utf8'))
const chunks = budget.chunks
const tolerance = Number(budget.tolerancePercent ?? 0) / 100

const checks = [
  ['entryGzipKb', measured.entryGzipKb, chunks.entryGzipMaxKb],
  ['babylonCoreGzipKb', measured.babylonCoreGzipKb, chunks.babylonCoreGzipMaxKb],
  ['rapierGzipKb', measured.rapierGzipKb, chunks.rapierGzipMaxKb],
  ['precacheTotalKiB', measured.precacheTotalKiB, chunks.precacheTotalKiBMax],
]

let failed = false
for (const [name, actual, max] of checks) {
  if (typeof max !== 'number') {
    console.error(`Budget missing numeric ${name}`)
    failed = true
    continue
  }
  const limit = max * (1 + tolerance)
  const status = actual <= limit ? 'ok' : 'OVER'
  console.log(`${status}  ${name}: ${actual.toFixed(2)} / max ${max} (+${budget.tolerancePercent ?? 0}% → ${limit.toFixed(2)})`)
  if (actual > limit) failed = true
}

if (failed) {
  console.error('Bundle size gate failed.')
  process.exit(1)
}

console.log('Bundle size gate passed.')
