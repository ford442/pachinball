#!/usr/bin/env node
/**
 * Replay verifier service (#444 Slice C) — Node + headless Chromium, run on
 * the storage host (README.md here). It claims pending leaderboard scores
 * (`claim_score_verifications`), replays each one's tape in the real game,
 * one fixed step per tape frame (scripts/lib/replay-harness.mjs), and records
 * the verdict (`record_score_verification`): verified when the tape replays
 * to the submitted score, rejected with the reason when it cannot.
 *
 * Builds: the game a run was recorded on is stamped in its tape (`buildId`).
 * With VERIFIER_BUILDS, a directory of builds named by build id (each a
 * `npm run build` dist with build-info.json), a run replays on its own build
 * when the verifier has it, else on the default build (VERIFIER_DIST, or the
 * newest in VERIFIER_BUILDS). `verifier_version` is the build that replayed it.
 *
 *   node services/replay-verifier/verifier.mjs          # poll forever
 *   node services/replay-verifier/verifier.mjs --once   # one claim round, then exit
 *
 * Environment:
 *   ARCADE_SECRET_KEY     required — a Supabase secret key (sb_secret_…)
 *   ARCADE_SUPABASE_URL   default https://znsioiaydrtsziwavdat.supabase.co
 *   VERIFIER_DIST         default <repo>/dist
 *   VERIFIER_BUILDS       optional directory of builds, one subdirectory per build id
 *   VERIFIER_POLL_MS      idle wait between claims, default 30000
 *   VERIFIER_BATCH        scores per claim, default 4
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchBrowser, repoRoot, runTape, serveDist } from '../../scripts/lib/replay-harness.mjs'
import { judge, precheck } from './judge.mjs'

const log = (event, fields = {}) => console.log(JSON.stringify({ t: new Date().toISOString(), event, ...fields }))

function readBuildId(dir) {
  try {
    return JSON.parse(readFileSync(path.join(dir, 'build-info.json'), 'utf8')).buildId ?? null
  } catch {
    return null
  }
}

/** Build id → dist directory, and the default build. */
export function discoverBuilds({ dist, builds }) {
  const byId = new Map()
  let newest = null
  if (builds && existsSync(builds)) {
    for (const name of readdirSync(builds)) {
      const dir = path.join(builds, name)
      const id = statSync(dir).isDirectory() ? readBuildId(dir) : null
      if (!id) continue
      byId.set(id, dir)
      if (!newest || statSync(dir).mtimeMs > statSync(newest.dir).mtimeMs) newest = { id, dir }
    }
  }
  const distId = dist && existsSync(dist) ? readBuildId(dist) : null
  if (distId) byId.set(distId, dist)
  const fallback = distId ? { id: distId, dir: dist } : newest
  if (!fallback) throw new Error(`no build with a build-info.json in ${dist ?? '(no VERIFIER_DIST)'} or ${builds ?? '(no VERIFIER_BUILDS)'}`)
  return { byId, fallback }
}

function client({ url, key }) {
  return async function rpc(name, body) {
    const res = await fetch(`${url}/rest/v1/rpc/${name}`, {
      method: 'POST',
      // A secret key goes in `apikey`; a bearer equal to it is accepted too.
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status} ${text.slice(0, 300)}`)
    return text ? JSON.parse(text) : null
  }
}

/**
 * Run the claim → replay → verdict loop. Resolves when `once` is set and one
 * round is done, or when `signal` aborts (the current replay finishes first;
 * unprocessed claims are handed out again after the claim goes stale).
 */
export async function runVerifier({ url, key, dist, builds, pollMs = 30_000, batch = 4, once = false, signal } = {}) {
  if (!key) throw new Error('ARCADE_SECRET_KEY is required')
  const rpc = client({ url, key })
  const { byId, fallback } = discoverBuilds({ dist, builds })
  log('start', { builds: [...byId.keys()], default: fallback.id, url })

  const servers = new Map()
  const serverFor = async (buildId) => {
    const build = byId.has(buildId) ? { id: buildId, dir: byId.get(buildId) } : fallback
    if (!servers.has(build.id)) servers.set(build.id, await serveDist(build.dir))
    return { id: build.id, base: servers.get(build.id).base }
  }

  let browser = await launchBrowser()
  const summary = { verified: 0, rejected: 0, retried: 0, errors: 0 }
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
        let version = fallback.id
        if (!verdict) {
          if (!browser.isConnected()) browser = await launchBrowser()
          const server = await serverFor(claim.payload.buildId)
          version = server.id
          const tape = { scenario: { seed: claim.payload.seed ?? 0, setup: [] }, replay: claim.payload }
          const result = await runTape(browser, server.base, 'verify', tape)
          verdict = judge(claim, result, { verifierVersion: version })
        }
        if (verdict.verdict === 'retry') {
          summary.retried++
          log('retry', { score_id: claim.score_id, attempts: claim.attempts, reason: verdict.reason })
          continue
        }
        try {
          await rpc('record_score_verification', {
            p_score_id: claim.score_id,
            p_verified: verdict.verdict === 'verified',
            p_verifier_version: version,
            p_verifier_score: verdict.verifierScore,
            p_reason: verdict.reason,
            p_state_hash: verdict.stateHash,
          })
          summary[verdict.verdict === 'verified' ? 'verified' : 'rejected']++
          log(verdict.verdict, {
            score_id: claim.score_id, map_id: claim.map_id, score: claim.score,
            replayed: verdict.verifierScore, reason: verdict.reason, build: version, ms: Date.now() - started,
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
    await browser.close().catch(() => {})
    for (const server of servers.values()) await server.close()
    log('stop', summary)
  }
  return summary
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
    signal: stop.signal,
  }).then(
    (summary) => process.exit(summary.errors > 0 && process.argv.includes('--once') ? 1 : 0),
    (err) => {
      log('fatal', { error: err instanceof Error ? err.message : String(err) })
      process.exit(1)
    },
  )
}
