#!/usr/bin/env node
/**
 * Check what the live site serves after a deploy (#519 B). Read-only: GET requests only.
 *
 * Fails unless
 *   - `build-info.json` matches the local `dist/build-info.json` (same `buildId`, i.e. commit,
 *     and the same `wasmSha256`: the verifier rejects every run played on another binary),
 *   - `index.html` and `wasm/PhysicsModule.wasm` carry COOP `same-origin` + COEP `require-corp`
 *     (production headers live in the server config, outside this repo; without them
 *     `wasm-worker` silently loses SharedArrayBuffer), and the wasm is `application/wasm`,
 *   - the service worker script answers 200 with a JavaScript content type,
 *   - every script / stylesheet / modulepreload / manifest `index.html` names answers 200.
 *
 * A CDN or proxy cache can lag the upload, so the build-info check retries.
 *
 *   node scripts/verify-live.mjs                                  # https://test.1ink.us/pachinball/
 *   node scripts/verify-live.mjs --url <base/> --dist dist --retries 10 --delay-ms 15000
 *   node scripts/verify-live.mjs --headers-only                   # skip the build-info match
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

const DEFAULT_URL = 'https://test.1ink.us/pachinball/'

function parseArgs(argv) {
  const opts = { url: process.env.LIVE_URL || DEFAULT_URL, dist: 'dist', retries: 8, delayMs: 15_000, headersOnly: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--url') opts.url = argv[++i]
    else if (a === '--dist') opts.dist = argv[++i]
    else if (a === '--retries') opts.retries = Number(argv[++i])
    else if (a === '--delay-ms') opts.delayMs = Number(argv[++i])
    else if (a === '--headers-only') opts.headersOnly = true
    else throw new Error(`unknown argument ${a}`)
  }
  if (!opts.url.endsWith('/')) opts.url += '/'
  return opts
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** GET with redirects not followed: a 302 to a 404 page must read as missing, not as 200. */
async function get(url) {
  const res = await fetch(url, { redirect: 'manual', cache: 'no-store', headers: { 'cache-control': 'no-cache' } })
  return res
}

function isolationProblems(res, what) {
  const problems = []
  const coop = res.headers.get('cross-origin-opener-policy')
  const coep = res.headers.get('cross-origin-embedder-policy')
  if (coop !== 'same-origin') problems.push(`${what}: Cross-Origin-Opener-Policy is ${coop ?? 'missing'}, want same-origin`)
  if (coep !== 'require-corp') problems.push(`${what}: Cross-Origin-Embedder-Policy is ${coep ?? 'missing'}, want require-corp`)
  return problems
}

/** Same-origin asset URLs index.html loads at boot. */
function bootAssets(html, base) {
  const urls = new Set()
  const attr = /<(script|link)\b[^>]*?\s(src|href)=["']([^"']+)["'][^>]*>/gi
  for (const m of html.matchAll(attr)) {
    const tag = m[0]
    const ref = m[3] ?? ''
    if (/^(data:|https?:\/\/(?!localhost))/i.test(ref) && !ref.startsWith(base)) continue
    if (m[1]?.toLowerCase() === 'link' && !/rel=["']?(stylesheet|modulepreload|manifest|icon)/i.test(tag)) continue
    urls.add(new URL(ref, base).href)
  }
  return [...urls]
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const failures = []
  const report = { url: opts.url }

  const index = await get(new URL('index.html', opts.url))
  report.index = index.status
  if (index.status !== 200) failures.push(`index.html: HTTP ${index.status}`)
  failures.push(...isolationProblems(index, 'index.html'))
  const html = index.status === 200 ? await index.text() : ''

  const wasm = await get(new URL('wasm/PhysicsModule.wasm', opts.url))
  report.wasm = wasm.status
  if (wasm.status !== 200) failures.push(`wasm/PhysicsModule.wasm: HTTP ${wasm.status}`)
  if (wasm.status === 200 && !(wasm.headers.get('content-type') ?? '').startsWith('application/wasm')) {
    failures.push(`wasm/PhysicsModule.wasm: Content-Type ${wasm.headers.get('content-type')}, want application/wasm (streaming compile needs it)`)
  }
  failures.push(...isolationProblems(wasm, 'wasm/PhysicsModule.wasm'))
  await wasm.body?.cancel()

  const sw = await get(new URL('sw.js', opts.url))
  report.sw = sw.status
  if (sw.status !== 200) failures.push(`sw.js: HTTP ${sw.status}`)
  else if (!/javascript|ecmascript/.test(sw.headers.get('content-type') ?? '')) {
    failures.push(`sw.js: Content-Type ${sw.headers.get('content-type')} is not a JavaScript type (the browser refuses to register it)`)
  }
  await sw.body?.cancel()

  const assets = bootAssets(html, opts.url)
  report.assets = assets.length
  for (const asset of assets) {
    const res = await get(asset)
    if (res.status !== 200) failures.push(`${asset}: HTTP ${res.status}`)
    await res.body?.cancel()
  }

  if (!opts.headersOnly) {
    const local = JSON.parse(readFileSync(path.join(opts.dist, 'build-info.json'), 'utf8'))
    report.expected = local
    let live = null
    for (let attempt = 0; attempt <= opts.retries; attempt++) {
      const res = await get(new URL('build-info.json', opts.url))
      live = res.status === 200 ? await res.json().catch(() => null) : null
      if (res.status !== 200) await res.body?.cancel()
      if (live && live.buildId === local.buildId && live.wasmSha256 === local.wasmSha256) break
      if (attempt < opts.retries) await sleep(opts.delayMs)
    }
    report.live = live
    if (!live) failures.push('build-info.json: missing (HTTP ≠ 200 or not JSON) — the live build predates the stamp')
    else {
      if (live.buildId !== local.buildId) failures.push(`build-info.json: live buildId ${live.buildId}, deployed ${local.buildId}`)
      if (live.wasmSha256 !== local.wasmSha256) failures.push(`build-info.json: live wasmSha256 ${live.wasmSha256}, deployed ${local.wasmSha256}`)
    }
  }

  console.log(JSON.stringify(report, null, 2))
  if (failures.length > 0) {
    for (const f of failures) console.error(`FAIL  ${f}`)
    process.exit(1)
  }
  console.log('verify-live: ok')
}

main().catch((err) => {
  console.error(`verify-live FAILED: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
