/**
 * #444 — a replay carries the cascade table it was recorded on, and plays on
 * that table whatever the spectator has selected (or whatever day it is).
 */
import { describe, expect, it } from 'vitest'
import { DailyCascadeState } from '../src/cascade/daily-cascade-state'
import { parseCascadeSeedParam } from '../src/game/daily-cascade-ui'
import { ReplayRecorder, type ReplayPayload } from '../src/replay/replay-recorder'

const BASE: ReplayPayload = {
  version: 3, buildId: 't', mapId: 'neon-helix', seed: 7, physicsEngine: 'wasm-owner',
  renderer: 'webgl2', createdAt: '2026-10-16T00:00:00.000Z', frames: [], finalScore: 0,
}

describe('replay cascade metadata (#444)', () => {
  it('describes a free-seed table and nothing on vanilla', () => {
    const state = new DailyCascadeState()
    expect(state.describeForReplay()).toBeNull()
    state.setFreeSeed(0xdeadbeef)
    expect(state.describeForReplay()).toEqual({ mode: 'free', seed: 0xdeadbeef, seedId: 'free-deadbeef' })
  })

  it('a replay borrows the state and gives the player their selection back', () => {
    const state = new DailyCascadeState()
    state.setFreeSeed(42)
    const own = state.ensureLayout()

    state.beginReplay({ mode: 'free', seed: 99, seedId: 'free-63' })
    expect(state.getSeed()).toBe(99)
    expect(state.ensureLayout()?.seed).toBe(99)

    state.endReplay()
    expect(state.getMode()).toBe('free')
    expect(state.getSeed()).toBe(42)
    expect(state.ensureLayout()).toBe(own)
  })

  it('a vanilla recording plays vanilla even when the spectator has a cascade selected', () => {
    const state = new DailyCascadeState()
    state.setFreeSeed(42)
    state.beginReplay(null)
    expect(state.getMode()).toBe('vanilla')
    expect(state.ensureLayout()).toBeNull()
    state.endReplay()
    expect(state.getSeed()).toBe(42)
  })

  it('a replayed daily keeps the day it was recorded on', () => {
    const state = new DailyCascadeState()
    state.beginReplay({ mode: 'daily', seed: 12345, seedId: '2020-01-01' })
    expect(state.ensureLayout()?.seed).toBe(12345)
    expect(state.getSeedId()).toBe('2020-01-01')
  })

  it('round-trips through the replay JSON and drops a malformed entry', () => {
    const cascade = { mode: 'daily' as const, seed: 12345, seedId: '2026-10-16' }
    expect(ReplayRecorder.fromJSON(ReplayRecorder.toJSON({ ...BASE, cascade })).cascade).toEqual(cascade)
    expect(ReplayRecorder.fromJSON(ReplayRecorder.toJSON(BASE)).cascade).toBeUndefined()
    expect(ReplayRecorder.fromJSON({ ...BASE, cascade: { mode: 'weekly', seed: 1, seedId: 'x' } }).cascade).toBeUndefined()
  })

  it('?cascade=<u32> names a free-seed table; anything else is ignored', () => {
    expect(parseCascadeSeedParam('?cascade=20261016')).toBe(20261016)
    expect(parseCascadeSeedParam('?seed=1&cascade=4294967295')).toBe(0xffffffff)
    expect(parseCascadeSeedParam('?cascade=4294967296')).toBeNull()
    expect(parseCascadeSeedParam('?cascade=-3')).toBeNull()
    expect(parseCascadeSeedParam('?cascade=0x10')).toBeNull()
    expect(parseCascadeSeedParam('?seed=1')).toBeNull()
  })
})
