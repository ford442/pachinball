/**
 * The weekly machine descriptor: one seed → one table, the same on every
 * client. Pure TS — the table build and its static hash are covered in
 * weekly-machine-owner.test.ts, the validator CLI sweep in
 * weekly-machine-validate-cli.test.ts.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  CANONICAL_BUMPERS,
  FEEDER_KEYS,
  KEEP_OUT_BOXES,
  runSpawnProbes,
  validateLayout,
} from '../src/cascade/daily-cascade-layout'
import {
  WEEKLY_ENVELOPE,
  generateWeeklyLayout,
  generateWeeklyMachine,
  plainWeeklyMachine,
  resolveWeeklyLayout,
  validateWeeklyMachine,
  weeklyMachineHash,
  weeklyMachineRng,
  type WeeklyMachineDescriptor,
} from '../src/cascade/weekly-machine'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolvePinField } from '../src/core/pin-field'
import { pachinkoPinFieldSpec } from '../src/objects/pachinko-pin-field'
import { initSessionRng, weeklySeedId } from '../src/core/seeded-rng'

/** A machine for `seed`, drawn the way `startGame` does: session RNG first, then the descriptor. */
function machineFor(seed: number): WeeklyMachineDescriptor {
  initSessionRng(seed)
  return generateWeeklyMachine(seed)
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

describe('weekly machine descriptor', () => {
  beforeEach(() => initSessionRng(1))

  describe('determinism', () => {
    it.each([0, 1, 20261029, 0xdeadbeef])('seed %i gives the same bumper offsets, pin field and armed feeders every time', (seed) => {
      const a = machineFor(seed)
      machineFor(seed ^ 0x55) // another client in between must not move this one
      const b = machineFor(seed)
      expect(b.bumpers).toEqual(a.bumpers)
      expect(b.pinField).toEqual(a.pinField)
      expect(b.feeders).toEqual(a.feeders)
      expect(JSON.stringify(b)).toBe(JSON.stringify(a))
      expect(weeklyMachineHash(b)).toBe(weeklyMachineHash(a))
    })

    it('resolves to the same table: pins, bumpers and feeders', () => {
      const a = resolveWeeklyLayout(machineFor(77))
      const b = resolveWeeklyLayout(machineFor(77))
      expect(b.pins).toEqual(a.pins)
      expect(b.bumpers).toEqual(a.bumpers)
      expect(b.feedersEnabled).toEqual(a.feedersEnabled)
      expect(b.pinField).toEqual(a.pinField)
    })

    it('different seeds are different machines, not just different pins', () => {
      const machines = Array.from({ length: 40 }, (_, i) => machineFor(1000 + i))
      expect(new Set(machines.map((m) => weeklyMachineHash(m))).size).toBe(machines.length)
      expect(new Set(machines.map((m) => JSON.stringify(m.bumpers))).size).toBeGreaterThan(30)
      expect(new Set(machines.map((m) => JSON.stringify(m.feeders))).size).toBeGreaterThan(5)
      expect(new Set(machines.map((m) => m.pinField.dropout)).size).toBeGreaterThan(5)
      expect(new Set(machines.map((m) => `${m.pinField.rows}x${m.pinField.cols}`)).size).toBeGreaterThan(5)
    })

    it('draws through getLayoutRng("weekly:" + seed), so it needs the session seeded with that seed', () => {
      initSessionRng(5)
      expect(() => generateWeeklyMachine(6)).toThrow(/initSessionRng\(6\)/)
      expect(() => weeklyMachineRng(5)).not.toThrow()
    })

    it('the descriptor survives JSON exactly', () => {
      const d = machineFor(31337)
      expect(clone(d)).toEqual(d)
      expect(validateWeeklyMachine(clone(d)).ok).toBe(true)
    })
  })

  describe('what a seed changes', () => {
    it('moves bumpers off the canonical set, inside the envelope', () => {
      const moved = Array.from({ length: 20 }, (_, i) => machineFor(i)).flatMap((m) => m.bumpers)
      expect(moved.some((o) => o.dx !== 0 || o.dz !== 0)).toBe(true)
      for (const o of moved) {
        expect(Math.abs(o.dx)).toBeLessThanOrEqual(WEEKLY_ENVELOPE.bumperOffsetMax)
        expect(Math.abs(o.dz)).toBeLessThanOrEqual(WEEKLY_ENVELOPE.bumperOffsetMax)
      }
    })

    it('arms 2–4 of the five existing feeders', () => {
      for (let seed = 0; seed < 50; seed++) {
        const armed = FEEDER_KEYS.filter((k) => machineFor(seed).feeders[k]).length
        expect(armed).toBeGreaterThanOrEqual(WEEKLY_ENVELOPE.armedFeeders.min)
        expect(armed).toBeLessThanOrEqual(WEEKLY_ENVELOPE.armedFeeders.max)
      }
    })

    it('sets pin density and keep-outs through the pin field, with the table keep-outs and one clearance box per bumper', () => {
      const d = machineFor(404)
      const { pinField } = resolveWeeklyLayout(d)
      expect(pinField!.dropout).toBe(d.pinField.dropout)
      expect(pinField!.dropoutSeed).toBe(d.pinField.dropoutSeed)
      expect(pinField!.keepOuts).toHaveLength(KEEP_OUT_BOXES.length + d.pinField.keepOuts.length + CANONICAL_BUMPERS.length)
      expect(pinField!.keepOuts.slice(0, KEEP_OUT_BOXES.length)).toEqual(
        KEEP_OUT_BOXES.map(({ minX, maxX, minZ, maxZ }) => ({ minX, maxX, minZ, maxZ })),
      )
    })

    it('differs from the vanilla table in feeders, bumpers and pins together', () => {
      const layout = resolveWeeklyLayout(machineFor(2026))
      expect(layout.bumpers).not.toEqual(CANONICAL_BUMPERS)
      expect(FEEDER_KEYS.every((k) => layout.feedersEnabled[k])).toBe(false)
      expect(layout.pins.length).toBeLessThan(90)
    })
  })

  describe('what C++ resolves', () => {
    // native/tests/pin_field_test.cpp ("a weekly machine's field ...") repeats these numbers: the
    // 2026-W44 fixture's field — seeded dropout + keep-outs, no mask — must hold the same pins on both sides.
    const GOLDEN_INDICES = [
      0, 12, 13, 24, 28, 30, 32, 33, 34, 36, 38, 39, 40, 41, 42, 43, 49, 50, 52, 56, 57, 58, 60, 61, 63, 64, 65, 66, 67, 68,
      69, 72, 73, 74, 75, 77, 78, 79, 80, 81, 84, 87, 88, 89, 90, 91, 92, 93,
    ]

    it('2026-W44 resolves the golden pins on the table’s full pin-field spec', () => {
      const fixture = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures/weekly-machines/2026-W44.json'), 'utf8')) as WeeklyMachineDescriptor
      const layout = resolveWeeklyLayout(fixture)
      const spec = pachinkoPinFieldSpec({ x: 0, z: 6 }, 24, 22, layout.pins, layout.pinLattice, layout.pinField)!
      expect(spec.dropout).toBe(0.1875)
      expect(spec.dropoutSeed).toBe(199252044)
      expect(spec.occupancy).toBeUndefined()
      expect(spec.keepOuts).toHaveLength(KEEP_OUT_BOXES.length + fixture.pinField.keepOuts.length + CANONICAL_BUMPERS.length)
      expect(resolvePinField(spec).map((p) => p.index)).toEqual(GOLDEN_INDICES)
    })
  })

  describe('every generated machine is a playable table', () => {
    it('validates, passes the Daily Cascade constraints and the spawn probes (seeds 0–119)', () => {
      for (let seed = 0; seed < 120; seed++) {
        const d = machineFor(seed)
        const result = validateWeeklyMachine(d)
        expect(result.ok, `seed ${seed}: ${JSON.stringify(result.ok ? [] : result.errors)}`).toBe(true)
        const { layout } = generateWeeklyLayout(seed)
        expect(validateLayout(layout).reasons, `seed ${seed}`).toEqual([])
        expect(runSpawnProbes(layout).ok, `seed ${seed}`).toBe(true)
        expect(layout.pins.length).toBeGreaterThanOrEqual(WEEKLY_ENVELOPE.minPins)
      }
    })

    it('the generator rarely needs the plain fallback', () => {
      let fallbacks = 0
      for (let seed = 0; seed < 120; seed++) {
        if (weeklyMachineHash(machineFor(seed)) === weeklyMachineHash(plainWeeklyMachine(seed))) fallbacks++
      }
      expect(fallbacks).toBeLessThanOrEqual(2)
    })

    it('the plain fallback is valid for every seed, with three armed feeders', () => {
      for (let seed = 0; seed < 60; seed++) {
        const plain = plainWeeklyMachine(seed * 7919)
        expect(validateWeeklyMachine(plain).ok, `seed ${seed}`).toBe(true)
        expect(FEEDER_KEYS.filter((k) => plain.feeders[k])).toHaveLength(3)
      }
    })

    it('keeps pins out of every bumper and out of the extra keep-outs', () => {
      const d = machineFor(9)
      const layout = resolveWeeklyLayout(d)
      for (const pin of layout.pins) {
        for (const k of d.pinField.keepOuts) {
          expect(pin.x >= k.minX && pin.x <= k.maxX && pin.z >= k.minZ && pin.z <= k.maxZ).toBe(false)
        }
      }
    })
  })

  describe('validation rejects, it does not clamp', () => {
    const good = (): WeeklyMachineDescriptor => clone(machineFor(123))
    const errorsOf = (raw: unknown): string[] => {
      const result = validateWeeklyMachine(raw)
      expect(result.ok).toBe(false)
      return result.ok ? [] : result.errors.map((e) => `${e.path}: ${e.message}`)
    }

    it('rejects a bumper offset past the envelope and leaves the descriptor as it was', () => {
      const d = good()
      d.bumpers[3] = { dx: 1.5, dz: 0 }
      const before = JSON.stringify(d)
      expect(errorsOf(d).some((e) => e.startsWith('bumpers[3].dx') && e.includes('outside the envelope'))).toBe(true)
      expect(JSON.stringify(d)).toBe(before) // nothing was clamped in place
    })

    it('rejects an offset at the edge of the envelope that puts a bumper on the flipper arcs', () => {
      const d = good()
      d.bumpers[10] = { dx: 0, dz: -1 } // (-4, -1) → z = -2: the rim is inside the flipper arcs
      expect(errorsOf(d).some((e) => e.startsWith('bumpers[10]') && e.includes('flipper arcs'))).toBe(true)
    })

    it('rejects two bumpers pushed into each other', () => {
      const d = clone(plainWeeklyMachine(123)) // every bumper on its canonical spot
      d.bumpers[1] = { dx: -1, dz: 1 } // (-4,4) → (-5,5), 1.0 from (-5,6): 0.24 between the rims
      expect(errorsOf(d).some((e) => e.startsWith('bumpers[1]') && e.includes('clear of bumpers[8]'))).toBe(true)
    })

    it('rejects an offset off the 1/64 grid', () => {
      const d = good()
      d.bumpers[0] = { dx: 0.3, dz: 0 }
      expect(errorsOf(d)).toContain('bumpers[0].dx: must be a multiple of 1/64')
    })

    it('rejects a missing or extra bumper offset', () => {
      const d = good()
      d.bumpers.pop()
      expect(errorsOf(d).some((e) => e.startsWith('bumpers:'))).toBe(true)
    })

    it.each([
      ['rows too small', (d: WeeklyMachineDescriptor) => { d.pinField.rows = 3 }, 'pinField.rows'],
      ['cols too large', (d: WeeklyMachineDescriptor) => { d.pinField.cols = 40 }, 'pinField.cols'],
      ['dropout past the envelope', (d: WeeklyMachineDescriptor) => { d.pinField.dropout = 0.9 }, 'pinField.dropout'],
      ['dropout of zero', (d: WeeklyMachineDescriptor) => { d.pinField.dropout = 0 }, 'pinField.dropout'],
      ['a non-u32 dropout seed', (d: WeeklyMachineDescriptor) => { d.pinField.dropoutSeed = -1 }, 'pinField.dropoutSeed'],
      ['a wrong schema version', (d: WeeklyMachineDescriptor) => { (d as unknown as { schemaVersion: number }).schemaVersion = 2 }, 'schemaVersion'],
      ['a non-u32 seed', (d: WeeklyMachineDescriptor) => { d.seed = 2 ** 33 }, 'seed'],
    ])('rejects %s', (_name, mutate, path) => {
      const d = good()
      mutate(d)
      expect(errorsOf(d).some((e) => e.startsWith(path))).toBe(true)
    })

    it('rejects too many keep-outs, and keep-outs that are too small or leave the field', () => {
      const d = good()
      const box = { minX: -2, maxX: 0, minZ: 0, maxZ: 5 }
      d.pinField.keepOuts = [box, box, box, box]
      expect(errorsOf(d).some((e) => e.includes('at most 3'))).toBe(true)

      const thin = good()
      thin.pinField.keepOuts = [{ minX: 0, maxX: 0.25, minZ: 0, maxZ: 5 }]
      expect(errorsOf(thin).some((e) => e.includes('width'))).toBe(true)

      const outside = good()
      outside.pinField.keepOuts = [{ minX: 20, maxX: 22, minZ: 0, maxZ: 5 }]
      expect(errorsOf(outside).some((e) => e.includes('outside the envelope'))).toBe(true)
    })

    it('rejects arming fewer than two or more than four feeders', () => {
      const none = good()
      for (const k of FEEDER_KEYS) none.feeders[k] = false
      expect(errorsOf(none).some((e) => e.startsWith('feeders:'))).toBe(true)
      const all = good()
      for (const k of FEEDER_KEYS) all.feeders[k] = true
      expect(errorsOf(all).some((e) => e.startsWith('feeders:'))).toBe(true)
    })

    it('rejects a field so sparse it is not a pachinko field', () => {
      const d = good()
      d.pinField.rows = 8
      d.pinField.cols = 11
      d.pinField.dropout = WEEKLY_ENVELOPE.dropout.max
      d.pinField.keepOuts = [
        { minX: -9, maxX: -6, minZ: -1, maxZ: 9 },
        { minX: -2, maxX: 1, minZ: 6, maxZ: 16 },
        { minX: 5, maxX: 8, minZ: -1, maxZ: 9 },
      ]
      expect(resolveWeeklyLayout(d).pins.length).toBeLessThan(WEEKLY_ENVELOPE.minPins)
      expect(errorsOf(d).some((e) => e.startsWith('pinField:') && e.includes('needs'))).toBe(true)
    })

    it('rejects unknown fields and non-objects', () => {
      expect(errorsOf(null)).toEqual([': descriptor must be an object'])
      const d = good() as unknown as Record<string, unknown>
      d.extra = 1
      expect(errorsOf(d).some((e) => e.startsWith('extra: unknown field'))).toBe(true)
    })
  })
})

describe('weeklySeedId', () => {
  it('is the UTC ISO-8601 week', () => {
    expect(weeklySeedId(new Date('2026-10-29T12:00:00Z'))).toBe('2026-W44')
    expect(weeklySeedId(new Date('2026-10-26T00:00:00Z'))).toBe('2026-W44') // Monday
    expect(weeklySeedId(new Date('2026-11-01T23:59:59Z'))).toBe('2026-W44') // Sunday
    expect(weeklySeedId(new Date('2026-11-02T00:00:00Z'))).toBe('2026-W45')
  })

  it('belongs to the year of the week’s Thursday', () => {
    expect(weeklySeedId(new Date('2025-12-29T00:00:00Z'))).toBe('2026-W01')
    expect(weeklySeedId(new Date('2027-01-01T00:00:00Z'))).toBe('2026-W53')
  })
})
