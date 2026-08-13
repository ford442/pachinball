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
} from '../src/core/seeded-rng'

describe('createSeededRng', () => {
  it('same seed produces identical sequences', () => {
    const a = createSeededRng(42)
    const b = createSeededRng(42)
    const seqA = Array.from({ length: 20 }, () => a.next())
    const seqB = Array.from({ length: 20 }, () => b.next())
    expect(seqA).toEqual(seqB)
  })

  it('string seed hashes to a stable numeric seed', () => {
    const a = createSeededRng('nexus-cascade')
    const b = createSeededRng(hashStringToSeed('nexus-cascade'))
    const seqA = Array.from({ length: 10 }, () => a.next())
    const seqB = Array.from({ length: 10 }, () => b.next())
    expect(seqA).toEqual(seqB)
  })

  it('different seeds diverge', () => {
    const a = createSeededRng(1)
    const b = createSeededRng(2)
    const seqA = Array.from({ length: 10 }, () => a.next())
    const seqB = Array.from({ length: 10 }, () => b.next())
    expect(seqA).not.toEqual(seqB)
  })

  it('int stays in [0, maxExclusive)', () => {
    const rng = createSeededRng(99)
    for (let i = 0; i < 100; i++) {
      const n = rng.int(7)
      expect(n).toBeGreaterThanOrEqual(0)
      expect(n).toBeLessThan(7)
    }
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

  it('fork streams are independent and reproducible', () => {
    const parent = createSeededRng(100)
    const forkA1 = parent.fork('ball-spawn')
    const forkB1 = parent.fork('feeder-angle')

    const parentSeq1 = Array.from({ length: 5 }, () => parent.next())
    const forkASeq1 = Array.from({ length: 5 }, () => forkA1.next())
    const forkBSeq1 = Array.from({ length: 5 }, () => forkB1.next())

    const parent2 = createSeededRng(100)
    const forkA2 = parent2.fork('ball-spawn')
    const forkB2 = parent2.fork('feeder-angle')

    const parentSeq2 = Array.from({ length: 5 }, () => parent2.next())
    const forkASeq2 = Array.from({ length: 5 }, () => forkA2.next())
    const forkBSeq2 = Array.from({ length: 5 }, () => forkB2.next())

    expect(parentSeq1).toEqual(parentSeq2)
    expect(forkASeq1).toEqual(forkASeq2)
    expect(forkBSeq1).toEqual(forkBSeq2)
    expect(forkASeq1).not.toEqual(forkBSeq1)
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
