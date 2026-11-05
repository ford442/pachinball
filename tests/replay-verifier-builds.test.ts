/**
 * #490 Slice B — the replay verifier is pinned to the physics binary a run
 * was played on: builds are known by the SHA-256 of their own
 * `wasm/PhysicsModule.wasm` (scripts/lib/build-info.mjs), a tape picks the
 * build shipping its binary (judge.mjs `selectBuild`), and a run whose binary
 * the verifier does not hold is retried before it is rejected.
 * The end-to-end run is `npm run test:verifier`.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { discoverBuilds, goldenDiffs, inspectBuild, listReleases } from '../scripts/lib/build-info.mjs'
import { judge, MAX_ATTEMPTS, selectBuild, tapeWasmSha256 } from '../services/replay-verifier/judge.mjs'
import { ReplayRecorder } from '../src/replay/replay-recorder'

const sha = (text: string) => createHash('sha256').update(text).digest('hex')
const WASM_A = sha('binary A')
const WASM_B = sha('binary B')

let root: string
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'pachinball-builds-'))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/** A build dir: build-info.json and, unless `binary` is null, wasm/PhysicsModule.wasm. */
function makeBuild(dir: string, info: Record<string, unknown>, binary: string | null, ageSeconds = 0): string {
  const full = path.join(root, dir)
  mkdirSync(path.join(full, 'wasm'), { recursive: true })
  writeFileSync(path.join(full, 'build-info.json'), JSON.stringify(info))
  if (binary !== null) writeFileSync(path.join(full, 'wasm', 'PhysicsModule.wasm'), binary)
  const t = Date.now() / 1000 - ageSeconds
  utimesSync(full, t, t)
  return full
}

describe('builds the verifier holds (#490 Slice B)', () => {
  it('knows a build by the binary on disk, and refuses one that is not what build-info.json declares', () => {
    const good = makeBuild('good', { buildId: 'aaa111', wasmSha256: WASM_A }, 'binary A')
    const legacy = makeBuild('legacy', { buildId: 'old000' }, 'binary B')
    const swapped = makeBuild('swapped', { buildId: 'bad222', wasmSha256: WASM_A }, 'binary B')
    expect(inspectBuild(good)).toEqual({ id: 'aaa111', dir: good, wasmSha256: WASM_A, problem: null })
    // Archived before the stamp: the binary is still hashed from the file.
    expect(inspectBuild(legacy)?.wasmSha256).toBe(WASM_B)
    expect(inspectBuild(swapped)?.problem).toMatch(/hashes to .*, build-info.json declares /)
    expect(inspectBuild(path.join(root, 'nothing-here'))).toBeNull()
  })

  it('lists dist first, then the archive newest first, skipping bad and half-written copies', () => {
    const dist = makeBuild('dist', { buildId: 'cur333', wasmSha256: WASM_A }, 'binary A')
    makeBuild('archive/old000', { buildId: 'old000', wasmSha256: WASM_B }, 'binary B', 3600)
    makeBuild('archive/mid111', { buildId: 'mid111', wasmSha256: WASM_A }, 'binary A', 60)
    makeBuild('archive/bad222', { buildId: 'bad222', wasmSha256: WASM_B }, 'binary A')
    makeBuild('archive/new444.partial-99', { buildId: 'new444', wasmSha256: WASM_B }, 'binary B')
    const skipped: string[] = []
    const { builds, fallback } = discoverBuilds({ dist, builds: path.join(root, 'archive'), onSkip: (b: { id: string }) => skipped.push(b.id) })
    expect(builds.map((b: { id: string }) => b.id)).toEqual(['cur333', 'mid111', 'old000'])
    expect(fallback.id).toBe('cur333')
    expect(skipped).toEqual(['bad222'])
    // Without dist the newest archived build is the default.
    expect(discoverBuilds({ dist: null, builds: path.join(root, 'archive') }).fallback.id).toBe('mid111')
    expect(() => discoverBuilds({ dist: path.join(root, 'none'), builds: null })).toThrow(/no usable build/)
  })

  it('finds archived releases and compares goldens field by field', () => {
    const rel = makeBuild('archive/rel1', { buildId: 'rel1' }, 'binary A')
    writeFileSync(path.join(rel, 'release.json'), '{}')
    makeBuild('archive/plain', { buildId: 'plain' }, 'binary A')
    expect(listReleases(path.join(root, 'archive'))).toEqual([rel])
    const golden = { finalStateHash: '0123456789abcdef', score: 1670, steps: 1200 }
    expect(goldenDiffs(golden, { ...golden })).toEqual([])
    expect(goldenDiffs(golden, { ...golden, score: 1671 })).toEqual(['score 1670 → 1671'])
  })
})

describe('a tape replays on its own binary (#490 Slice B)', () => {
  const builds = [
    { id: 'cur333', dir: '/b/cur', wasmSha256: WASM_A },
    { id: 'mid111', dir: '/b/mid', wasmSha256: WASM_A },
    { id: 'old000', dir: '/b/old', wasmSha256: WASM_B },
  ]
  const [fallback] = builds

  it('prefers its own build with its binary, then any build with it', () => {
    expect(selectBuild({ buildId: 'mid111', wasmSha256: WASM_A }, builds, fallback)).toEqual({ build: builds[1], binary: 'same' })
    expect(selectBuild({ buildId: 'gone99', wasmSha256: WASM_B }, builds, fallback)).toEqual({ build: builds[2], binary: 'same' })
    // Same binary, unknown build: the default build when it ships it.
    expect(selectBuild({ buildId: 'gone99', wasmSha256: WASM_A }, builds, fallback)).toEqual({ build: fallback, binary: 'same' })
  })

  it('an unheld binary still replays (its build id\'s build, else the default); an unstamped tape picks by build id', () => {
    const unheld = sha('binary C')
    expect(selectBuild({ buildId: 'old000', wasmSha256: unheld }, builds, fallback)).toEqual({ build: builds[2], binary: 'missing' })
    expect(selectBuild({ buildId: 'gone99', wasmSha256: unheld }, builds, fallback)).toEqual({ build: fallback, binary: 'missing' })
    expect(selectBuild({ buildId: 'old000' }, builds, fallback)).toEqual({ build: builds[2], binary: 'unstamped' })
    expect(selectBuild({ buildId: 'gone99', wasmSha256: 'not-a-hash' }, builds, fallback)).toEqual({ build: fallback, binary: 'unstamped' })
    expect(tapeWasmSha256({ wasmSha256: WASM_A.toUpperCase() })).toBeNull()
  })

  const payload = { buildId: 'gone99', wasmSha256: sha('binary C'), initialSnapshot: 'x' }
  const claim = (attempts: number, score = 50_000) => ({ score_id: 1, score, map_id: 'neon-helix', replay_id: 'r', payload, physics_engine: 'wasm-owner', attempts })
  const replayed = (score: number) => ({ ok: true, score, steps: 60, finalStateHash: '0123456789abcdef' })

  it('a step-exact replay to the submitted score verifies on any binary', () => {
    expect(judge(claim(1), replayed(50_000), { verifierVersion: 'cur333', binary: 'missing' })).toMatchObject({ verdict: 'verified', verifierScore: 50_000 })
  })

  it('a run that does not replay on another binary waits for its release, then is rejected naming the binary', () => {
    const opts = { verifierVersion: 'cur333', binary: 'missing' }
    const waiting = judge(claim(1, 5_000_000), replayed(50_000), opts)
    expect(waiting.verdict).toBe('retry')
    expect(waiting.reason).toMatch(/^the tape was played on PhysicsModule\.wasm [0-9a-f]{12}, which this verifier does not hold: score mismatch/)
    const rejected = judge(claim(MAX_ATTEMPTS, 5_000_000), replayed(50_000), opts)
    expect(rejected).toMatchObject({ verdict: 'rejected', verifierScore: 50_000 })
    expect(rejected.reason).toMatch(/\(recorded on build gone99\) \(the tape was played on PhysicsModule\.wasm [0-9a-f]{12}, which this verifier does not hold\)$/)
    expect(judge(claim(1), { ok: false, code: 'snapshot', outcome: 'table-mismatch', reason: 'x' }, opts).verdict).toBe('retry')
    // On its own binary a forged score is rejected at once, as before.
    expect(judge(claim(1, 5_000_000), replayed(50_000), { verifierVersion: 'cur333', binary: 'same' }).verdict).toBe('rejected')
  })
})

describe('tapes carry their binary (#490 Slice B)', () => {
  const base = { version: 3, buildId: 'b', mapId: 'neon-helix', seed: 1, physicsEngine: 'wasm-owner', finalScore: 0, frames: [] }

  it('round-trips a well-formed wasmSha256 and drops anything else', () => {
    expect(ReplayRecorder.fromJSON(JSON.stringify({ ...base, wasmSha256: WASM_A })).wasmSha256).toBe(WASM_A)
    expect(ReplayRecorder.fromJSON({ ...base, wasm_sha256: WASM_B }).wasmSha256).toBe(WASM_B)
    expect('wasmSha256' in ReplayRecorder.fromJSON({ ...base, wasmSha256: 'nope' })).toBe(false)
    expect('wasmSha256' in ReplayRecorder.fromJSON(base)).toBe(false)
  })
})
