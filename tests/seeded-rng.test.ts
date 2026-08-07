/**
 * Unit tests for SeededRng determinism.
 */
import { describe, it, expect } from 'vitest'
import {
  createSeededRng,
  hashStringToSeed,
  dailySeedId,
  seedFromDailyId,
  initSessionRng,
  getSessionRng,
  getSessionSeed,
} from '../src/game-elements/seeded-rng'

describe('createSeededRng', () => {
  it('same seed produces identical sequences', () => {
    const a = createSeededRng(42)
    const b = createSeededRng(42)
    const seqA = Array.from({ length: 20 }, () => a.next())
    const seqB = Array.from({ length: 20 }, () => b.next())
    expect(seqA).toEqual(seqB)
  })

  it('different seeds diverge', () => {
    const a = createSeededRng(1)
    const b = createSeededRng(2)
    const seqA = Array.from({ length: 10 }, () => a.next())
    const seqB = Array.from({ length: 10 }, () => b.next())
    expect(seqA).not.toEqual(seqB)
  })

  it('nextInt stays in range', () => {
    const rng = createSeededRng(99)
    for (let i = 0; i < 50; i++) {
      const n = rng.nextInt(3, 7)
      expect(n).toBeGreaterThanOrEqual(3)
      expect(n).toBeLessThanOrEqual(7)
    }
  })

  it('shuffle is deterministic', () => {
    const a = createSeededRng(7).shuffle([1, 2, 3, 4, 5])
    const b = createSeededRng(7).shuffle([1, 2, 3, 4, 5])
    expect(a).toEqual(b)
  })
})

describe('daily seed helpers', () => {
  it('hashStringToSeed is stable', () => {
    expect(hashStringToSeed('2026-07-23')).toBe(hashStringToSeed('2026-07-23'))
    expect(hashStringToSeed('a')).not.toBe(hashStringToSeed('b'))
  })

  it('dailySeedId formats UTC date', () => {
    expect(dailySeedId(new Date(Date.UTC(2026, 6, 23)))).toBe('2026-07-23')
  })

  it('seedFromDailyId matches hash', () => {
    expect(seedFromDailyId('2026-07-23')).toBe(hashStringToSeed('2026-07-23'))
  })
})

describe('session SeededRng', () => {
  it('initSessionRng sets seed and session RNG instance', () => {
    const { seed, rng } = initSessionRng(12345)
    expect(seed).toBe(12345)
    expect(getSessionSeed()).toBe(12345)
    expect(getSessionRng()).toBe(rng)
  })

  it('fixed session seed produces identical spawn sequence and feeder angle sequence', () => {
    initSessionRng(98765)
    const rng1 = getSessionRng()
    const seq1 = Array.from({ length: 10 }, () => rng1.next())
    const angles1 = Array.from({ length: 5 }, () => (rng1.next() - 0.5) * 2)

    initSessionRng(98765)
    const rng2 = getSessionRng()
    const seq2 = Array.from({ length: 10 }, () => rng2.next())
    const angles2 = Array.from({ length: 5 }, () => (rng2.next() - 0.5) * 2)

    expect(seq1).toEqual(seq2)
    expect(angles1).toEqual(angles2)
  })
})
