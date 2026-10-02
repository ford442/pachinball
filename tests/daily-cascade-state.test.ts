import { describe, it, expect, beforeEach } from 'vitest'
import { DailyCascadeState } from '../src/cascade/daily-cascade-state'
import { dailySeedId } from '../src/core/seeded-rng'

describe('DailyCascadeState', () => {
  let state: DailyCascadeState
  beforeEach(() => {
    state = new DailyCascadeState()
  })

  it('starts on the vanilla table with no layout', () => {
    expect(state.getMode()).toBe('vanilla')
    expect(state.displaySeedLabel()).toBe('Vanilla table')
    expect(state.ensureLayout()).toBeNull()
    expect(state.getLeaderboardMapId('neon-helix')).toBe('neon-helix')
  })

  it('daily mode labels and boards by the UTC date', () => {
    state.setMode('daily')
    const today = dailySeedId()
    expect(state.displaySeedLabel()).toBe(`Daily: ${today}`)
    expect(state.getLeaderboardMapId('x')).toBe(`daily-cascade-${today}`)
    expect(state.ensureLayout()?.seedId).toBe(today)
  })

  it('a shared free seed opens exactly that layout and board', () => {
    state.setFreeSeed(0x1a2b3c4d)
    expect(state.getMode()).toBe('free')
    expect(state.getSeedId()).toBe('free-1a2b3c4d')
    expect(state.displaySeedLabel()).toBe('Seed: 1a2b3c4d')
    expect(state.getLeaderboardMapId('x')).toBe('free-cascade-1a2b3c4d')
    expect(state.ensureLayout()?.seed).toBe(0x1a2b3c4d)
  })
})
