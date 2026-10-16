#!/usr/bin/env node
/**
 * End-to-end self-test of the replay verifier (#444 Slice C): the real
 * service, a production build (`dist/`, `npm run build` first) and headless
 * Chromium, against a fake Supabase that hands out crafted claims and keeps
 * the verdicts. Golden tapes stand in for players' runs.
 *
 *   npm run test:verifier
 */

import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import { freePort, repoRoot } from '../../scripts/lib/replay-harness.mjs'
import { boardFor } from './judge.mjs'
import { runVerifier } from './verifier.mjs'

const KEY = 'sb_secret_selftest'
const tape = (name) => JSON.parse(readFileSync(path.join(repoRoot, 'tests', 'replays', `${name}.json`), 'utf8'))
const vanilla = tape('vanilla-rally')
const cascade = tape('free-cascade')

let nextId = 1
const claim = (label, payload, score, mapId, expect) => ({
  label,
  expect,
  row: {
    score_id: nextId++,
    score,
    map_id: mapId,
    replay_id: payload ? '00000000-0000-4000-8000-0000000000aa' : null,
    payload,
    physics_engine: payload?.physicsEngine ?? null,
    attempts: 1,
    submitted_at: new Date().toISOString(),
  },
})

const cases = [
  claim('legitimate vanilla run', vanilla.replay, vanilla.golden.score, 'neon-helix', { verified: true, score: vanilla.golden.score }),
  claim('legitimate cascade run', cascade.replay, cascade.golden.score, boardFor(cascade.replay), { verified: true, score: cascade.golden.score }),
  claim('forged score', vanilla.replay, 5_000_000, 'neon-helix', { verified: false, reason: /score mismatch: the tape replays to 1670, 5000000 was submitted/ }),
  claim('replay from another board', cascade.replay, cascade.golden.score, 'neon-helix', { verified: false, reason: /submitted to neon-helix, but the tape was played on free-cascade-/ }),
  claim('worker recording', { ...vanilla.replay, physicsEngine: 'wasm-worker' }, vanilla.golden.score, 'neon-helix', { verified: false, reason: /unverifiable engine wasm-worker/ }),
  claim('no replay', null, 12_345, 'neon-helix', { verified: false, reason: /^no replay$/ }),
]

const recorded = new Map()
let handedOut = false
const port = await freePort()
const server = createServer((req, res) => {
  let body = ''
  req.on('data', (chunk) => { body += chunk })
  req.on('end', () => {
    if (req.headers.apikey !== KEY) {
      res.writeHead(401).end()
      return
    }
    if (req.url === '/rest/v1/rpc/claim_score_verifications') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(handedOut ? [] : cases.map((c) => c.row)))
      handedOut = true
    } else if (req.url === '/rest/v1/rpc/record_score_verification') {
      const v = JSON.parse(body)
      recorded.set(v.p_score_id, v)
      res.writeHead(204).end()
    } else {
      res.writeHead(404).end()
    }
  })
})
await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve))

let failures = 0
try {
  await runVerifier({
    url: `http://127.0.0.1:${port}`,
    key: KEY,
    dist: path.join(repoRoot, 'dist'),
    once: true,
  })
  for (const c of cases) {
    const v = recorded.get(c.row.score_id)
    const problems = []
    if (!v) problems.push('no verdict recorded')
    else {
      if (v.p_verified !== c.expect.verified) problems.push(`verified=${v.p_verified}`)
      if (c.expect.score !== undefined && v.p_verifier_score !== c.expect.score) problems.push(`verifier_score=${v.p_verifier_score}`)
      if (c.expect.reason && !c.expect.reason.test(v.p_reason ?? '')) problems.push(`reason=${JSON.stringify(v.p_reason)}`)
      if (c.expect.verified && !/^[0-9a-f]{16}$/.test(v.p_state_hash ?? '')) problems.push(`state_hash=${v.p_state_hash}`)
    }
    if (problems.length) failures++
    console.log(`${problems.length ? 'FAIL' : 'ok  '} ${c.label}${problems.length ? ` — ${problems.join(', ')}` : ''}`)
  }
} finally {
  server.close()
}
if (failures) {
  console.error(`verifier self-test: ${failures} of ${cases.length} case(s) failed`)
  process.exit(1)
}
console.log(`verifier self-test: ${cases.length} cases ok`)
