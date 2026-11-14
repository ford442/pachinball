#!/usr/bin/env node
/**
 * Replay verifier service (#444 Slice C) — run on the storage host (README.md
 * here). It claims pending leaderboard scores (`claim_score_verifications`),
 * replays each one's tape one fixed step per tape frame, and records
 * the verdict (`record_score_verification`): verified when the tape replays
 * to the submitted score, rejected with the reason when it cannot. A verified
 * run's ball path goes to `ghost_tracks`: the race ghost of a challenge.
 *
 * Builds: the game a run was recorded on is stamped in its tape (`buildId`),
 * and so is the SHA-256 of its physics binary (`wasmSha256`, #490 Slice B).
 * With VERIFIER_BUILDS, a directory of builds named by build id (each a
 * `npm run build` dist with build-info.json, archived by `npm run
 * release:archive`), a run replays on a build shipping its own
 * `PhysicsModule.wasm` — its own build when held — else on its build id's,
 * else on the default build (VERIFIER_DIST, or the newest in VERIFIER_BUILDS;
 * judge.mjs `selectBuild`). A build whose binary is not the one its
 * build-info.json declares is never used. `verifier_version` is the build
 * that replayed the run, `verify_wasm_sha256` its binary.
 *
 * Runners (#528): `chromium` (the default) plays the tape in the real game in
 * headless Chromium (scripts/lib/replay-harness.mjs). `node` replays it with
 * the build's headless runner, `dist/sim/node-replay.mjs` — the same
 * TypeScript tick, no Babylon, no browser — on the build's own
 * `PhysicsModule.wasm` (SHA-256 checked against build-info.json). A tape the
 * Node runner cannot replay exactly (`unsupported`: adventure, an engaged toy
 * or feeder, the backbox slot machine / fever / jackpot), a build archived
 * before the runner existed, or a Node runner error goes to Chromium, which is
 * launched only then. With VERIFIER_NODE_CONFIRM_REJECTIONS=1 a run Node
 * rejects is replayed in Chromium too, and Chromium's verdict is recorded.
 *
 *   node services/replay-verifier/verifier.mjs                  # poll forever
 *   node services/replay-verifier/verifier.mjs --once           # one claim round, then exit
 *   node services/replay-verifier/verifier.mjs --runner node    # headless Node runner first
 *
 * Environment:
 *   ARCADE_SECRET_KEY     required — a Supabase secret key (sb_secret_…)
 *   ARCADE_SUPABASE_URL   default https://znsioiaydrtsziwavdat.supabase.co
 *   VERIFIER_DIST         default <repo>/dist
 *   VERIFIER_BUILDS       optional directory of builds, one subdirectory per build id
 *   VERIFIER_POLL_MS      idle wait between claims, default 30000
 *   VERIFIER_BATCH        scores per claim, default 4
 *   VERIFIER_RUNNER       chromium (default) | node
 *   VERIFIER_NODE_CONFIRM_REJECTIONS  1: a Node rejection is re-run in Chromium
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { discoverBuilds } from '../../scripts/lib/build-info.mjs'
import { loadSimBundle, SIM_BUNDLE, wasmModuleFactory } from '../../scripts/lib/sim-bundle.mjs'
import { launchBrowser, repoRoot, runTape, serveDist } from '../../scripts/lib/replay-harness.mjs'
import { judge, precheck, selectBuild } from './judge.mjs'

const log = (event, fields = {}) => console.log(JSON.stringify({ t: new Date().toISOString(), event, ...fields }))

/** One sample of the race ghost every this many fixed steps (30 Hz). */
const GHOST_STRIDE = 2

/** PostgREST with the secret key: `rpc(name, body)` and `rest(path, row)` (an upsert). */
function client({ url, key }) {
  const post = async (path, body, prefer) => {
    const res = await fetch(`${url}/rest/v1/${path}`, {
      method: 'POST',
      // A secret key goes in `apikey`; a bearer equal to it is accepted too.
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        ...(prefer ? { Prefer: prefer } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${text.slice(0, 300)}`)
    return text ? JSON.parse(text) : null
  }
  return {
    rpc: (name, body) => post(`rpc/${name}`, body),
    rest: (path, row) => post(path, row, 'resolution=merge-duplicates,return=minimal'),
  }
}

/**
 * Run the claim → replay → verdict loop. Resolves when `once` is set and one
 * round is done, or when `signal` aborts (the current replay finishes first;
 * unprocessed claims are handed out again after the claim goes stale).
 * `injectContactFault(claim)` is the self-test's: true makes that replay's
 * first contact handler throw, a sim fault the strict playback must reject.
 */
export async function runVerifier({
  url, key, dist, builds, pollMs = 30_000, batch = 4, once = false, signal, injectContactFault,
  runner = 'chromium', confirmRejections = false,
} = {}) {
  if (!key) throw new Error('ARCADE_SECRET_KEY is required')
  if (runner !== 'chromium' && runner !== 'node') throw new Error(`unknown runner ${runner}: chromium | node`)
  const { rpc, rest } = client({ url, key })
  // A build whose binary is not the one its build-info.json declares is never replayed on.
  const known = discoverBuilds({
    dist,
    builds,
    onSkip: (build) => log('build-skipped', { build: build.id, dir: build.dir, reason: build.problem }),
  })
  log('start', {
    builds: known.builds.map((b) => ({ id: b.id, wasm: b.wasmSha256?.slice(0, 12) ?? null })),
    default: known.fallback.id,
    url,
    runner,
  })

  const servers = new Map()
  const serverFor = async (build) => {
    if (!servers.has(build.id)) servers.set(build.id, await serveDist(build.dir))
    return servers.get(build.id).base
  }

  // Chromium is launched up front on the chromium runner, and on first need on the node runner.
  let browser = runner === 'chromium' ? await launchBrowser() : null
  const chromium = async (build, tape, opts) => {
    if (!browser?.isConnected()) browser = await launchBrowser()
    return runTape(browser, await serverFor(build), 'verify', tape, opts)
  }

  // Each build's headless runner and wasm, loaded once (null: a build from before #528).
  const nodeRunners = new Map()
  const nodeRunnerFor = async (build) => {
    if (!nodeRunners.has(build.id)) {
      const file = path.join(build.dir, SIM_BUNDLE)
      if (!existsSync(file)) nodeRunners.set(build.id, null)
      else {
        const replay = await loadSimBundle(file)
        // The binary build-info.json declares (discoverBuilds checked it) — refused if it changed since.
        const { moduleFactory } = await wasmModuleFactory(path.join(build.dir, 'wasm'), { expectSha256: build.wasmSha256 })
        nodeRunners.set(build.id, { replay, moduleFactory })
      }
    }
    return nodeRunners.get(build.id)
  }

  /** One tape on `build`: `{ result, runner, fallback }`, `fallback` saying why Node handed it to Chromium. */
  const replayTape = async (build, tape, opts) => {
    if (runner === 'node') {
      let node = null
      let fallback = null
      try {
        node = await nodeRunnerFor(build)
        if (!node) fallback = `build ${build.id} has no ${SIM_BUNDLE}`
      } catch (err) {
        fallback = `node runner: ${err instanceof Error ? err.message : String(err)}`
      }
      if (node) {
        try {
          const result = await node.replay(tape, { moduleFactory: node.moduleFactory, ...opts })
          // A replay outcome (verified, or the tape's own failure) is Node's to give; anything else is Chromium's.
          if (result.ok || ['snapshot', 'rejected', 'incomplete'].includes(result.code)) {
            return { result, runner: 'node', fallback: null }
          }
          fallback = result.code === 'unsupported' ? `unsupported in node: ${result.reason}` : `node ${result.code}: ${result.reason}`
        } catch (err) {
          fallback = `node runner threw: ${err instanceof Error ? err.message : String(err)}`
        }
      }
      return { result: await chromium(build, tape, opts), runner: 'chromium', fallback }
    }
    return { result: await chromium(build, tape, opts), runner: 'chromium', fallback: null }
  }

  const summary = { verified: 0, rejected: 0, retried: 0, errors: 0, node: 0, chromium: 0 }
  try {
    while (!signal?.aborted) {
      let claims = []
      try {
        claims = (await rpc('claim_score_verifications', { p_limit: batch })) ?? []
      } catch (err) {
        summary.errors++
        log('claim-failed', { error: String(err) })
      }
      for (const claim of claims) {
        if (signal?.aborted) break
        const started = Date.now()
        let verdict = precheck(claim)
        let build = known.fallback
        let replayedOn = null
        const replayed = !verdict
        if (!verdict) {
          const pick = selectBuild(claim.payload, known.builds, known.fallback)
          build = pick.build
          const tape = { scenario: { seed: claim.payload.seed ?? 0, setup: [] }, replay: claim.payload }
          const opts = { ghostStride: GHOST_STRIDE, throwOnContact: injectContactFault?.(claim) ?? false }
          let run = await replayTape(build, tape, opts)
          verdict = judge(claim, run.result, { verifierVersion: build.id, binary: pick.binary })
          if (run.runner === 'node' && confirmRejections && verdict.verdict === 'rejected') {
            // Rollout safety: Node may verify on its own, but a rejection is Chromium's to confirm.
            run = { result: await chromium(build, tape, opts), runner: 'chromium', fallback: `confirming a node rejection: ${verdict.reason}` }
            verdict = judge(claim, run.result, { verifierVersion: build.id, binary: pick.binary })
          }
          summary[run.runner]++
          replayedOn = run
          if (run.fallback) log('chromium-fallback', { score_id: claim.score_id, build: build.id, reason: run.fallback })
        }
        const version = build.id
        if (verdict.verdict === 'retry') {
          summary.retried++
          log('retry', { score_id: claim.score_id, attempts: claim.attempts, reason: verdict.reason })
          continue
        }
        if (verdict.ghost) {
          // The race ghost a challenge shows (Slice D); a failed upload does not block the verdict.
          try {
            await rest('ghost_tracks?on_conflict=replay_id', {
              replay_id: claim.replay_id, stride: verdict.ghost.stride, samples: verdict.ghost.samples,
              track: verdict.ghost.track, verifier_version: version,
            })
          } catch (err) {
            log('ghost-failed', { score_id: claim.score_id, error: String(err) })
          }
        }
        try {
          await rpc('record_score_verification', {
            p_score_id: claim.score_id,
            p_verified: verdict.verdict === 'verified',
            p_verifier_version: version,
            p_verifier_score: verdict.verifierScore,
            p_reason: verdict.reason,
            p_state_hash: verdict.stateHash,
            // The binary that replayed it; null for a run rejected without replaying.
            p_wasm_sha256: replayed ? build.wasmSha256 ?? null : null,
          })
          summary[verdict.verdict === 'verified' ? 'verified' : 'rejected']++
          log(verdict.verdict, {
            score_id: claim.score_id, map_id: claim.map_id, score: claim.score,
            replayed: verdict.verifierScore, reason: verdict.reason, build: version, runner: replayedOn?.runner ?? null,
            wasm: replayed ? build.wasmSha256?.slice(0, 12) ?? null : null, ms: Date.now() - started,
          })
        } catch (err) {
          summary.errors++
          log('record-failed', { score_id: claim.score_id, error: String(err) })
        }
      }
      if (once) break
      if (claims.length === 0) {
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, pollMs)
          signal?.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true })
        })
      }
    }
  } finally {
    await browser?.close().catch(() => {})
    for (const server of servers.values()) await server.close()
    log('stop', summary)
  }
  return summary
}

/** `--name value` from the command line, or undefined. */
function argValue(name) {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const stop = new AbortController()
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => stop.abort())
  runVerifier({
    url: (process.env.ARCADE_SUPABASE_URL ?? 'https://znsioiaydrtsziwavdat.supabase.co').replace(/\/+$/, ''),
    key: process.env.ARCADE_SECRET_KEY,
    dist: path.resolve(process.env.VERIFIER_DIST ?? path.join(repoRoot, 'dist')),
    builds: process.env.VERIFIER_BUILDS ? path.resolve(process.env.VERIFIER_BUILDS) : null,
    pollMs: Number(process.env.VERIFIER_POLL_MS ?? 30_000),
    batch: Number(process.env.VERIFIER_BATCH ?? 4),
    once: process.argv.includes('--once'),
    runner: argValue('--runner') ?? process.env.VERIFIER_RUNNER ?? 'chromium',
    confirmRejections: process.env.VERIFIER_NODE_CONFIRM_REJECTIONS === '1',
    signal: stop.signal,
  }).then(
    (summary) => process.exit(summary.errors > 0 && process.argv.includes('--once') ? 1 : 0),
    (err) => {
      log('fatal', { error: err instanceof Error ? err.message : String(err) })
      process.exit(1)
    },
  )
}
