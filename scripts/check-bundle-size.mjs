#!/usr/bin/env node
/**
 * Compare gzipped Vite output against bundle-budget.json, and keep Rapier out
 * of the default graph (#412): the rapier chunk may exist (the explicit
 * `rapier` mode and the fail-closed degrade import it lazily) but must be
 * neither precached by the service worker nor modulepreloaded by index.html.
 * Also caps the raw size of everything `vite build` puts in dist/ (#486 A1):
 * `dist.distTotalMiBMax` for the whole tree, `dist.distFileMiBMax` per file.
 *
 * Usage:
 *   node scripts/check-bundle-size.mjs            # fail if over budget
 *   node scripts/check-bundle-size.mjs --print    # print measurements only
 */
import { gzipSync } from 'node:zlib'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bootChunks } from './bundle-graph.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const distDir = join(root, 'dist')
const assetsDir = join(distDir, 'assets')
const budgetPath = join(root, 'bundle-budget.json')

function gzipKb(buf) {
  return gzipSync(buf).length / 1024
}

/** Relative URLs in Workbox's `precacheAndRoute([{url:"…",revision:…},…])` call. */
function precacheManifestUrls(serviceWorker) {
  const start = serviceWorker.indexOf('precacheAndRoute([')
  if (start < 0) return []
  const end = serviceWorker.indexOf('],', start)
  const manifest = serviceWorker.slice(start, end < 0 ? undefined : end)
  return [...manifest.matchAll(/url:"([^"]+)"/g)].map((m) => m[1])
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

/** Every file under dir with its byte size (recursive). */
function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(path))
    else if (entry.isFile()) out.push({ path, size: statSync(path).size })
  }
  return out
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

  const babylonCore = findChunk(jsFiles, 'babylon-core')
  const rapier = findChunk(jsFiles, 'rapier')

  const readGzip = (path) => (path ? gzipKb(readFileSync(path)) : 0)

  // The entry is whatever index.html boots (`<script type="module" src>`), not "the largest
  // index-*.js": a dynamic import of a barrel named `index` would otherwise be mistaken for it.
  // Fall back to the old heuristic only if index.html cannot be parsed.
  const indexHtmlText = statSync(join(distDir, 'index.html'), { throwIfNoEntry: false })?.isFile()
    ? readFileSync(join(distDir, 'index.html'), 'utf8')
    : ''
  // babylon-core is budgeted on its own row; everything else the browser fetches before boot
  // (the entry + its modulepreloaded static imports) counts toward `initialJsGzipKb`, so moving
  // code into an eagerly-loaded manual chunk (ui-overlays) cannot make the entry look smaller.
  const boot = bootChunks(indexHtmlText, { excludePrefixes: ['babylon-core-'] })
  const entryFromHtml = boot.entry ? join(assetsDir, boot.entry) : null
  const entry =
    entryFromHtml && statSync(entryFromHtml, { throwIfNoEntry: false })?.isFile()
      ? entryFromHtml
      : findChunk(jsFiles, 'index')
  const initialChunks = boot.preloaded
    .map((name) => join(assetsDir, name))
    .filter((file) => statSync(file, { throwIfNoEntry: false })?.isFile())
  const initialJsGzipKbValue = readGzip(entry) + initialChunks.reduce((sum, file) => sum + readGzip(file), 0)

  const readText = (path) => (statSync(path, { throwIfNoEntry: false })?.isFile() ? readFileSync(path, 'utf8') : '')
  const serviceWorker = readText(join(distDir, 'sw.js'))

  // What the service worker actually precaches: the URLs in its precacheAndRoute([...])
  // manifest, so the budget follows vite.config.ts globPatterns / globIgnores (#464 item 8)
  // instead of a hand-kept copy of them.
  const precached = precacheManifestUrls(serviceWorker)
  if (precached.length === 0) throw new Error('dist/sw.js has no precache manifest — was the PWA plugin disabled?')
  let precacheTotalKiB = 0
  for (const url of precached) {
    const file = join(distDir, decodeURIComponent(url))
    const size = statSync(file, { throwIfNoEntry: false })?.size
    if (size === undefined) throw new Error(`precached ${url} is not in dist/`)
    precacheTotalKiB += size / 1024
  }

  // Rapier must stay a lazy, degrade-only chunk.
  const rapierName = rapier ? rapier.split(/[/\\]/).pop() : null
  const indexHtml = readText(join(distDir, 'index.html'))
  const rapierPrecached = rapierName !== null && serviceWorker.includes(rapierName)
  const rapierPreloaded = rapierName !== null && indexHtml.includes(rapierName)

  const distFiles = walk(distDir)
  const distTotalMiB = distFiles.reduce((sum, f) => sum + f.size, 0) / 1024 / 1024
  const largest = [...distFiles].sort((a, b) => b.size - a.size)

  return {
    distTotalMiB: Number(distTotalMiB.toFixed(2)),
    distLargestFiles: largest.slice(0, 5).map((f) => ({ file: relative(root, f.path), MiB: Number((f.size / 1024 / 1024).toFixed(2)) })),
    distFiles: largest,
    entryGzipKb: Number(readGzip(entry).toFixed(2)),
    initialJsGzipKb: Number(initialJsGzipKbValue.toFixed(2)),
    babylonCoreGzipKb: Number(readGzip(babylonCore).toFixed(2)),
    rapierGzipKb: Number(readGzip(rapier).toFixed(2)),
    precacheTotalKiB: Number(precacheTotalKiB.toFixed(2)),
    rapierPrecached,
    rapierPreloaded,
    files: {
      entry: entry ? relative(root, entry) : null,
      initialChunks: initialChunks.map((file) => relative(root, file)),
      babylonCore: babylonCore ? relative(root, babylonCore) : null,
      rapier: rapier ? relative(root, rapier) : null,
    },
  }
}

const printOnly = process.argv.includes('--print')
const measured = measure()

console.log('Bundle size report')
console.log(JSON.stringify({ ...measured, distFiles: undefined }, null, 2))

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
// Reported always; enforced only once bundle-budget.json carries `initialJsGzipMaxKb`
// (set in the entry-chunk slice after the lazy-adventure cuts land).
if (typeof chunks.initialJsGzipMaxKb === 'number') {
  checks.push(['initialJsGzipKb', measured.initialJsGzipKb, chunks.initialJsGzipMaxKb])
} else {
  console.log(`info  initialJsGzipKb: ${measured.initialJsGzipKb.toFixed(2)} (no initialJsGzipMaxKb budget set yet)`)
}

let failed = false
if (measured.rapierPrecached || measured.rapierPreloaded) {
  console.error(
    `OVER  rapier chunk is in the default graph (precached=${measured.rapierPrecached}, ` +
      `modulepreloaded=${measured.rapierPreloaded}); only loadRapier() may import it (#412)`,
  )
  failed = true
} else {
  console.log('ok  rapier chunk is lazy: not precached, not modulepreloaded')
}
// Raw dist/ size: what deploy.py uploads. Untoleranced — these are hard caps.
const distBudget = budget.dist ?? {}
if (typeof distBudget.distTotalMiBMax !== 'number' || typeof distBudget.distFileMiBMax !== 'number') {
  console.error('Budget missing numeric dist.distTotalMiBMax / dist.distFileMiBMax')
  failed = true
} else {
  const totalOk = measured.distTotalMiB <= distBudget.distTotalMiBMax
  console.log(`${totalOk ? 'ok' : 'OVER'}  distTotalMiB: ${measured.distTotalMiB.toFixed(2)} / max ${distBudget.distTotalMiBMax}`)
  if (!totalOk) {
    failed = true
    for (const f of measured.distLargestFiles) console.error(`        ${f.MiB.toFixed(2)} MiB  ${f.file}`)
  }
  const fileCap = distBudget.distFileMiBMax * 1024 * 1024
  const offenders = measured.distFiles.filter((f) => f.size > fileCap)
  if (offenders.length > 0) {
    failed = true
    console.error(`OVER  ${offenders.length} dist file(s) above ${distBudget.distFileMiBMax} MiB:`)
    for (const f of offenders) console.error(`        ${(f.size / 1024 / 1024).toFixed(2)} MiB  ${relative(root, f.path)}`)
  } else {
    console.log(`ok  no dist file above ${distBudget.distFileMiBMax} MiB`)
  }
}

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
