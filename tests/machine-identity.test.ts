import { describe, it, expect } from 'vitest'
import { generateTableLayout } from '../src/cascade/daily-cascade-layout'
import { deriveMachineIdentity, FEEDER_LABELS } from '../src/cascade/machine-identity'
import { seedFromDailyId } from '../src/core/seeded-rng'

const layoutFor = (seed: number) => generateTableLayout({ seed, seedId: `free-${seed.toString(16)}` })

describe('deriveMachineIdentity', () => {
  it('is deterministic for a seed', () => {
    const a = deriveMachineIdentity(layoutFor(0x1a2b3c4d))
    const b = deriveMachineIdentity(layoutFor(0x1a2b3c4d))
    expect(a).toEqual(b)
  })

  it('keeps past machine names stable (word lists are append-only)', () => {
    expect(GOLDEN.map(([seed]) => deriveMachineIdentity(layoutFor(seed)).title)).toEqual(GOLDEN.map(([, title]) => title))
  })

  it('titles carry a three-digit series number', () => {
    for (let i = 0; i < 25; i++) {
      const seed = Math.imul(i + 7, 0x9e3779b1) >>> 0
      const id = deriveMachineIdentity(layoutFor(seed))
      expect(id.title).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+ #\d{3}$/)
      expect(id.series).toBe(100 + (seed % 900))
      expect(id.seedHex).toBe(seed.toString(16))
    }
  })

  it('describes the layout it was given', () => {
    const layout = layoutFor(0xdeadbeef)
    const id = deriveMachineIdentity(layout)
    expect(id.traits.pinCount).toBe(layout.pins.length)
    const enabled = Object.entries(layout.feedersEnabled).filter(([, on]) => on).map(([k]) => k)
    expect([...id.traits.activeFeeders].sort()).toEqual(enabled.sort())
    for (const k of id.traits.activeFeeders) expect(id.descriptor).toContain(FEEDER_LABELS[k])
    expect(id.descriptor).toContain(`${enabled.length} feeders`)
  })

  it('spreads density across machines', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 60; i++) seen.add(deriveMachineIdentity(layoutFor(Math.imul(i + 1, 0x85ebca6b) >>> 0)).traits.pinDensity)
    expect([...seen].sort()).toEqual(['dense', 'sparse', 'standard'])
  })

  it('picks valid backbox colours', () => {
    const { backbox } = deriveMachineIdentity(layoutFor(seedFromDailyId('2026-10-02')))
    for (const hex of [backbox.primaryHex, backbox.accentHex, backbox.characterTint]) expect(hex).toMatch(/^#[0-9a-f]{6}$/)
    expect(backbox.hue).toBeGreaterThanOrEqual(0)
    expect(backbox.hue).toBeLessThan(360)
    expect(backbox.shaderSpeed).toBeGreaterThanOrEqual(0.4)
    expect(backbox.shaderSpeed).toBeLessThanOrEqual(1)
  })
})

const GOLDEN: [number, string][] = [
  [0x1a2b3c4d, 'Violet Tempest #501'],
  [0xdeadbeef, 'Solar Hive #759'],
  [seedFromDailyId('2026-10-02'), 'Phantom Carousel #816'],
]
