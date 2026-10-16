/**
 * #444 Slice C — the replay verifier's verdicts (services/replay-verifier/judge.mjs).
 * The end-to-end run (real build, Chromium, fake backend) is `npm run test:verifier`.
 */
import { describe, expect, it } from 'vitest'
import { boardFor, judge, MAX_ATTEMPTS, precheck } from '../services/replay-verifier/judge.mjs'

const payload = {
  version: 3, buildId: 'abc123', mapId: 'neon-helix', seed: 7, physicsEngine: 'wasm-owner',
  finalScore: 50_000, initialSnapshot: 'UEJTTg==', compressedFrames: '60:0,0,0,0,0,0,-',
}
const claim = (over: Record<string, unknown> = {}) => ({
  score_id: 1, score: 50_000, map_id: 'neon-helix', replay_id: 'r', payload, physics_engine: 'wasm-owner', attempts: 1, ...over,
})
const ok = (score: number) => ({ ok: true, score, steps: 60, finalStateHash: '0123456789abcdef' })

describe('replay verifier verdicts (#444 Slice C)', () => {
  it('verifies a tape that replays to the submitted score', () => {
    expect(precheck(claim())).toBeNull()
    expect(judge(claim(), ok(50_000))).toEqual({ verdict: 'verified', reason: null, verifierScore: 50_000, stateHash: '0123456789abcdef' })
  })

  it('rejects a forged score: the tape says 50 000, the row says 5 000 000', () => {
    const v = judge(claim({ score: 5_000_000 }), ok(50_000), { verifierVersion: 'def456' })
    expect(v).toMatchObject({ verdict: 'rejected', verifierScore: 50_000 })
    expect(v.reason).toBe('score mismatch: the tape replays to 50000, 5000000 was submitted (recorded on build abc123)')
  })

  it('rejects before replaying what can never verify', () => {
    expect(precheck(claim({ replay_id: null, payload: null }))?.reason).toBe('no replay')
    expect(precheck(claim({ physics_engine: 'wasm-worker' }))?.reason).toMatch(/unverifiable engine wasm-worker/)
    expect(precheck(claim({ payload: { ...payload, initialSnapshot: undefined } }))?.reason).toMatch(/no frame-0 snapshot/)
    expect(precheck(claim({ map_id: 'storm-board' }))?.reason).toBe('submitted to storm-board, but the tape was played on neon-helix')
  })

  it('names the board a cascade tape belongs to', () => {
    expect(boardFor({ mapId: 'neon-helix', cascade: { mode: 'free', seed: 20261016, seedId: 'free-1352898' } })).toBe('free-cascade-1352898')
    expect(boardFor({ mapId: 'neon-helix', cascade: { mode: 'daily', seed: 1, seedId: '2026-10-16' } })).toBe('daily-cascade-2026-10-16')
    expect(boardFor({ mapId: 'neon-helix' })).toBe('neon-helix')
  })

  it('rejects an unknown table, a rejected replay and an incomplete tape', () => {
    expect(judge(claim(), { ok: false, code: 'snapshot', outcome: 'table-mismatch', reason: 'x' }).reason).toMatch(/table not recognised/)
    expect(judge(claim(), { ok: false, code: 'rejected', reason: 'replay rejected: id-layout' })).toMatchObject({ verdict: 'rejected' })
    expect(judge(claim(), { ok: false, code: 'incomplete', reason: 'played 10 of 60 tape frames', score: 900 })).toMatchObject({ verdict: 'rejected', verifierScore: 900 })
  })

  it('retries its own failures, then gives up with the reason', () => {
    const boot = { ok: false, code: 'harness', reason: 'navigation timeout' }
    expect(judge(claim({ attempts: 1 }), boot)).toMatchObject({ verdict: 'retry' })
    expect(judge(claim({ attempts: MAX_ATTEMPTS }), boot)).toMatchObject({ verdict: 'rejected', reason: `verifier error after ${MAX_ATTEMPTS} attempts: navigation timeout` })
  })
})
