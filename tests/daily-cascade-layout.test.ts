/**
 * Daily Cascade layout: determinism, constraints, 20-seed spawn probes.
 */
import { describe, it, expect } from 'vitest'
import {
  generateTableLayout,
  validateLayout,
  runSpawnProbes,
} from '../src/game-elements/daily-cascade-layout'
import { hashStringToSeed } from '../src/game-elements/seeded-rng'

const PROBE_SEEDS = Array.from({ length: 20 }, (_, i) => hashStringToSeed(`probe-${i}`))

describe('generateTableLayout', () => {
  it('same seed → identical layout', () => {
    const a = generateTableLayout({ seed: 12345, seedId: 'free-3039' })
    const b = generateTableLayout({ seed: 12345, seedId: 'free-3039' })
    expect(a).toEqual(b)
  })

  it('different seeds diverge', () => {
    const a = generateTableLayout({ seed: 1, seedId: 'free-1' })
    const b = generateTableLayout({ seed: 2, seedId: 'free-2' })
    expect(a.pins).not.toEqual(b.pins)
  })
})

describe('validateLayout + spawn probes (20 seeds)', () => {
  it('all probe seeds validate and pass spawn probes', () => {
    const failures: string[] = []

    for (const seed of PROBE_SEEDS) {
      const layout = generateTableLayout({
        seed,
        seedId: `free-${seed.toString(16)}`,
      })
      const v = validateLayout(layout)
      if (!v.ok) {
        failures.push(`seed ${seed}: constraints ${v.reasons.slice(0, 3).join('; ')}`)
        continue
      }
      const probe = runSpawnProbes(layout)
      if (!probe.ok) {
        failures.push(`seed ${seed}: stuck probes ${probe.stuckCount}/${probe.probeCount}`)
      }
    }

    expect(failures).toEqual([])
  })
})
