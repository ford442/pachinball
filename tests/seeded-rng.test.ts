/**
 * Unit tests for SeededRng determinism.
 */
import { describe, it, expect } from 'vitest'
import {
  createSeededRng,
  hashStringToSeed,
  dailySeedId,
  seedFromDailyId,
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
