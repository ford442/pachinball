#!/usr/bin/env node
/**
 * Headless replay verifier (#444 Slice A).
 *
 * Plays each replay tape in the real game, headless Chromium on the
 * wasm-owner C++ engine, and prints what it reproduced:
 *
 *   { file, finalStateHash, score, steps }
 *
 * The harness (scripts/lib/replay-harness.mjs, shared with
 * services/replay-verifier) stops the page's render loop and calls
 * `GamePhysicsController.stepFixed` once per tape frame (one input frame per
 * physics step), after starting the game through `Game.playReplay` — the
 * spectate path — so the tape drives the game exactly as recorded:
 * frame-0 C++ snapshot restored, production builders, scoring and table
 * mechanics. A tape whose snapshot is refused, or whose numbers differ from
 * its golden, fails the run.
 *
 *   npm run verify:replay                         # every tests/replays/*.json
 *   npm run verify:replay -- tests/replays/a.json # just these
 *   npm run verify:replay -- --update             # write this build's numbers as the goldens
 *   npm run record:replay -- [files]              # re-record tapes from their scenarios
 *   npm run verify:replay -- --release <dir>      # an archived release on its own goldens (#490 B)
 *   npm run verify:replay -- --releases <dir>     # every release archived under <dir>
 *
 * --update is for an intentional numeric change (solver, tuning): the
 * goldens move in the same PR with a one-line rationale. --record is for
 * when the tape itself is stale (snapshot version, table geometry): it
 * records each scenario afresh, then verifies the new tape on a fresh page
 * before writing it.
 *
 * Options: --url <base> uses a running server (dev or preview) instead of
 * starting the Vite dev server; --verbose streams the page console and the
 * server log to stderr.
 *
 * --release / --releases replay a build the verifier keeps
 * (`npm run release:archive`) on the golden tapes archived with it, served
 * as shipped: run them on the storage host after a Chromium / Playwright
 * upgrade, so an old release that stopped reproducing is caught before an
 * honest old run is rejected on it.
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { launchBrowser, repoRoot as root, runTape, startDevServer } from './lib/replay-harness.mjs'
import { goldenDiffs as compare, listReleases } from './lib/build-info.mjs'
import { checkRelease } from './lib/release-archive.mjs'

const REPLAY_DIR = path.join(root, 'tests', 'replays')

function parseArgs(argv) {
  const opts = { mode: 'verify', update: false, url: null, verbose: false, files: [], releases: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--record') opts.mode = 'record'
    else if (a === '--update') opts.update = true
    else if (a === '--url') opts.url = argv[++i]
    else if (a === '--verbose') opts.verbose = true
    else if (a === '--release') opts.releases.push(path.resolve(argv[++i]))
    else if (a === '--releases') {
      const parent = path.resolve(argv[++i])
      const found = listReleases(parent)
      if (found.length === 0) throw new Error(`no archived release under ${parent}`)
      opts.releases.push(...found)
    } else if (a.startsWith('--')) throw new Error(`unknown option ${a}`)
    else opts.files.push(path.resolve(a))
  }
  if (opts.releases.length) return opts
  if (opts.files.length === 0) {
    opts.files = readdirSync(REPLAY_DIR)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .map((f) => path.join(REPLAY_DIR, f))
  }
  return opts
}

/** Each archived release on its own golden tapes; resolves the number of failing tapes. */
async function verifyReleases(dirs, { verbose }) {
  const browser = await launchBrowser()
  let failed = 0
  try {
    for (const dir of dirs) {
      const name = path.relative(process.cwd(), dir) || dir
      let checked
      try {
        checked = await checkRelease(dir, { browser, verbose })
      } catch (err) {
        failed++
        console.log(JSON.stringify({ release: name, ok: false, reason: err instanceof Error ? err.message : String(err) }))
        continue
      }
      for (const r of checked.results) {
        if (!r.ok) failed++
        console.log(JSON.stringify({ release: name, buildId: checked.build.id, wasmSha256: checked.build.wasmSha256, ...r }))
      }
    }
  } finally {
    await browser.close()
  }
  return failed
}

function writeTape(file, tape) {
  writeFileSync(file, `${JSON.stringify(tape, null, 2)}\n`)
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.releases.length) {
    const failed = await verifyReleases(opts.releases, opts)
    if (failed) {
      console.error(`verify-replay: ${failed} release tape(s) failed`)
      process.exit(1)
    }
    return
  }
  const server = opts.url ? null : await startDevServer({ verbose: opts.verbose })
  const base = opts.url ?? server.base
  const browser = await launchBrowser()
  let failed = 0
  try {
    for (const file of opts.files) {
      const name = path.relative(root, file)
      const tape = JSON.parse(readFileSync(file, 'utf8'))
      const started = Date.now()

      if (opts.mode === 'record') {
        const rec = await runTape(browser, base, 'record', tape, { verbose: opts.verbose })
        if (!rec.ok) {
          failed++
          console.log(JSON.stringify({ file: name, ok: false, reason: `record: ${rec.reason}` }))
          continue
        }
        const recorded = { ...tape, replay: rec.payload }
        // The new tape must reproduce itself on a fresh page before it is kept.
        const check = await runTape(browser, base, 'verify', recorded, { verbose: opts.verbose })
        const golden = { finalStateHash: rec.finalStateHash, score: rec.score, steps: rec.steps }
        const diffs = check.ok ? compare(golden, check) : [check.reason]
        if (diffs.length) {
          failed++
          console.log(JSON.stringify({ file: name, ok: false, reason: `recorded but did not replay: ${diffs.join('; ')}` }))
          continue
        }
        writeTape(file, { ...recorded, golden })
        console.log(JSON.stringify({ file: name, ok: true, recorded: true, ...golden, ms: Date.now() - started }))
        continue
      }

      const res = await runTape(browser, base, 'verify', tape, { verbose: opts.verbose })
      if (!res.ok) {
        failed++
        console.log(JSON.stringify({ file: name, ok: false, reason: res.reason }))
        continue
      }
      const out = { finalStateHash: res.finalStateHash, score: res.score, steps: res.steps }
      // Not compared with the tape's own `finalScore`: an --update moves the
      // golden past what the recorder saw; record mode checks the two agree.
      const diffs = compare(tape.golden, res)
      if (diffs.length && opts.update) {
        writeTape(file, { ...tape, golden: out })
        console.log(JSON.stringify({ file: name, ok: true, updated: true, was: tape.golden, ...out }))
        continue
      }
      if (diffs.length) failed++
      console.log(JSON.stringify({ file: name, ok: diffs.length === 0, ...out, ...(diffs.length ? { diffs } : {}), ms: Date.now() - started }))
    }
  } finally {
    await browser.close()
    server?.close()
  }
  if (failed) {
    console.error(`verify-replay: ${failed} of ${opts.files.length} tape(s) failed`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
