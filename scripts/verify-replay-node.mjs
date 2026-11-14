#!/usr/bin/env node
/**
 * Golden replay tapes in Node, without Babylon or a browser (#528).
 *
 * Each tape (tests/replays/*.json) is replayed by the headless runner (`src/sim/node-replay.ts`):
 * the C++ world from `public/wasm/PhysicsModule.wasm`, the frame-0 snapshot restored, the tape rows
 * applied, the same TypeScript tick the game runs — and must land on its golden
 * `{ finalStateHash, score, steps }`. `npm run verify:replay` (headless Chromium) stays the
 * rendering smoke and the only way to re-record or `--update` goldens; this is the fast hash check.
 *
 * A tape that reaches gameplay still owned by a presentation class (adventure tracks, a feeder or
 * toy that engages, the backbox slot machine / fever / jackpot) is reported `skipped` with the
 * reason, never guessed. The run fails on any mismatch or runner error, and when no tape at all
 * was checked.
 *
 *   npm run verify:replay:node                          # every tests/replays/*.json, this tree's source
 *   npm run verify:replay:node -- tests/replays/a.json  # just these
 *   npm run verify:replay:node -- --dist dist           # a build's own dist/sim/node-replay.mjs + dist/wasm
 *   npm run verify:replay:node -- --strict              # a skipped tape fails too
 *
 * Needs `npm run build:wasm` (or `--dist`).
 */

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { goldenDiffs, inspectBuild } from './lib/build-info.mjs'
import { buildSimBundle, loadSimBundle, SIM_BUNDLE, wasmModuleFactory } from './lib/sim-bundle.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REPLAY_DIR = path.join(root, 'tests', 'replays')

function parseArgs(argv) {
  const opts = { dist: null, strict: false, files: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dist') opts.dist = path.resolve(argv[++i])
    else if (a === '--strict') opts.strict = true
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`)
    else opts.files.push(path.resolve(a))
  }
  if (opts.files.length === 0) {
    opts.files = readdirSync(REPLAY_DIR).filter((f) => f.endsWith('.json')).sort().map((f) => path.join(REPLAY_DIR, f))
  }
  return opts
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))

  let bundle
  let wasmDir
  let expectSha256 = null
  let scratch = null
  if (opts.dist) {
    const build = inspectBuild(opts.dist)
    if (!build) throw new Error(`${opts.dist} has no build-info.json`)
    if (build.problem) throw new Error(`${opts.dist}: ${build.problem}`)
    bundle = path.join(opts.dist, SIM_BUNDLE)
    if (!existsSync(bundle)) throw new Error(`${bundle} is missing (a build from before #528?)`)
    wasmDir = path.join(opts.dist, 'wasm')
    expectSha256 = build.wasmSha256
  } else {
    wasmDir = path.join(root, 'public', 'wasm')
    if (!existsSync(path.join(wasmDir, 'PhysicsModule.wasm'))) {
      throw new Error('public/wasm/PhysicsModule.wasm is missing: run `npm run build:wasm` first')
    }
    scratch = mkdtempSync(path.join(tmpdir(), 'pachinball-sim-'))
    bundle = path.join(scratch, 'node-replay.mjs')
    await buildSimBundle({ outfile: bundle })
  }

  const replayTapeInNode = await loadSimBundle(bundle)
  const { moduleFactory, sha256 } = await wasmModuleFactory(wasmDir, { expectSha256 })
  console.error(`verify-replay-node: ${opts.dist ? path.relative(root, bundle) : 'src/sim/node-replay.ts (bundled)'} on PhysicsModule.wasm ${sha256.slice(0, 12)}`)

  let failed = 0
  let verified = 0
  let skipped = 0
  try {
    for (const file of opts.files) {
      const name = path.relative(root, file)
      const tape = JSON.parse(readFileSync(file, 'utf8'))
      const started = Date.now()
      const res = await replayTapeInNode(tape, { moduleFactory })
      const ms = Date.now() - started
      if (!res.ok && res.code === 'unsupported') {
        skipped++
        if (opts.strict) failed++
        console.log(JSON.stringify({ file: name, ok: !opts.strict, skipped: true, reason: res.reason, ms }))
        continue
      }
      if (!res.ok) {
        failed++
        console.log(JSON.stringify({ file: name, ok: false, code: res.code, reason: res.reason, ms }))
        continue
      }
      const out = { finalStateHash: res.finalStateHash, score: res.score, steps: res.steps }
      const diffs = goldenDiffs(tape.golden, res)
      if (diffs.length) failed++
      else verified++
      console.log(JSON.stringify({ file: name, ok: diffs.length === 0, ...out, ...(diffs.length ? { diffs } : {}), ms }))
    }
  } finally {
    if (scratch) rmSync(scratch, { recursive: true, force: true })
  }

  console.error(`verify-replay-node: ${verified} verified, ${skipped} skipped (Chromium only), ${failed} failed`)
  if (verified === 0) {
    console.error('verify-replay-node: no tape was checked in Node')
    process.exit(1)
  }
  if (failed) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
