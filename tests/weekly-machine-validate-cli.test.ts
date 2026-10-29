/**
 * CLI wrapper for `npm run machine:validate` — validates the weekly machine the
 * way `npm run tracks:validate` validates track JSON: every fixture descriptor
 * through `validateWeeklyMachine`, and every seed the game will actually be
 * asked for (the next year of ISO weeks, plus a spread of free seeds) through
 * the generator and the validator.
 *
 * `tests/fixtures/weekly-machines/2026-W44.json` is a golden: the generator is
 * part of the replay contract. A recording made on one build and spectated on
 * another rebuilds its table from the seed alone, so changing what a seed draws
 * moves every weekly table (and every tape's `staticContentHash()`). If that is
 * intended, regenerate the file, bump `WEEKLY_MACHINE_VERSION` and say so in the PR.
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  generateWeeklyMachine,
  plainWeeklyMachine,
  validateWeeklyMachine,
  weeklyMachineHash,
} from '../src/cascade/weekly-machine'
import { initSessionRng, seedFromWeeklyId, weeklySeedId } from '../src/core/seeded-rng'

const fixtureDir = join(import.meta.dirname, 'fixtures/weekly-machines')
const fixtures = readdirSync(fixtureDir).filter((name) => name.endsWith('.json'))

describe('machine:validate CLI', () => {
  it('has fixture descriptors', () => {
    expect(fixtures.length).toBeGreaterThan(0)
  })

  for (const file of fixtures) {
    it(`validates tests/fixtures/weekly-machines/${file}`, () => {
      const raw: unknown = JSON.parse(readFileSync(join(fixtureDir, file), 'utf8'))
      const result = validateWeeklyMachine(raw)
      expect(result.ok, result.ok ? '' : JSON.stringify(result.errors)).toBe(true)
    })
  }

  it('2026-W44 is pinned: the seed still draws the golden descriptor', () => {
    const seed = seedFromWeeklyId('2026-W44')
    initSessionRng(seed)
    const golden: unknown = JSON.parse(readFileSync(join(fixtureDir, '2026-W44.json'), 'utf8'))
    expect(generateWeeklyMachine(seed)).toEqual(golden)
  })

  it('the plain fixture is the plain machine', () => {
    const plain: unknown = JSON.parse(readFileSync(join(fixtureDir, 'plain.json'), 'utf8'))
    expect(plain).toEqual(plainWeeklyMachine(1))
  })

  it('every ISO week from this one for a year generates a valid machine', () => {
    const start = Date.UTC(2026, 9, 26) // Monday of 2026-W44
    const seen = new Set<string>()
    for (let week = 0; week < 53; week++) {
      const id = weeklySeedId(new Date(start + week * 7 * 86_400_000))
      const seed = seedFromWeeklyId(id)
      initSessionRng(seed)
      const machine = generateWeeklyMachine(seed)
      const result = validateWeeklyMachine(machine)
      expect(result.ok, `${id}: ${JSON.stringify(result.ok ? [] : result.errors)}`).toBe(true)
      seen.add(weeklyMachineHash(machine))
    }
    expect(seen.size).toBe(53) // no two weeks share a machine
  })

  it('a spread of free seeds generates valid machines', () => {
    for (let i = 0; i < 100; i++) {
      const seed = (Math.imul(i + 1, 0x9e3779b1) ^ 0x5bd1e995) >>> 0
      initSessionRng(seed)
      const result = validateWeeklyMachine(generateWeeklyMachine(seed))
      expect(result.ok, `seed ${seed}: ${JSON.stringify(result.ok ? [] : result.errors)}`).toBe(true)
    }
  })
})

describe('machine:validate rejects bad descriptors', () => {
  const golden = (): Record<string, unknown> =>
    JSON.parse(readFileSync(join(fixtureDir, '2026-W44.json'), 'utf8')) as Record<string, unknown>

  it('an offset past the envelope fails and names the field', () => {
    const d = golden() as { bumpers: Array<{ dx: number; dz: number }> }
    d.bumpers[0]!.dx = 2
    const result = validateWeeklyMachine(d)
    expect(result.ok).toBe(false)
    expect(result.ok ? [] : result.errors.map((e) => e.path)).toContain('bumpers[0].dx')
  })

  it('a descriptor that is not an object fails', () => {
    for (const raw of [null, 7, 'machine', []]) expect(validateWeeklyMachine(raw).ok).toBe(false)
  })
})
