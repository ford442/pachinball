/**
 * Pin-field resolver (#421) — the TS half of native/src/PinField.cpp.
 *
 * `resolvePinField` decides where the visual pin instances go; C++ decides
 * where the collision is. These tests hold the two to the same rules and the
 * same numbers (hash goldens and the dropout count are repeated verbatim in
 * native/tests/pin_field_test.cpp).
 */

import { describe, expect, it } from 'vitest'
import {
  pinFieldDropped,
  pinFieldHash,
  pinFieldOccupancy,
  pinFieldOccupancyForPositions,
  pinFieldPinBounds,
  pinFieldSlotPosition,
  resolvePinField,
  type PinFieldSpec,
} from '../src/core/pin-field'
import { KEEP_OUT_BOXES, generateTableLayout } from '../src/cascade/daily-cascade-layout'
import { pachinkoPinFieldSpec, VANILLA_LATTICE } from '../src/objects/pachinko-pin-field'

/** The 12×12 field native/tests/pin_field_test.cpp builds. */
function denseField(overrides: Partial<PinFieldSpec> = {}): PinFieldSpec {
  return {
    origin: { x: -3.3, y: 0, z: 0 },
    rows: 12,
    cols: 12,
    spacingX: 0.6,
    spacingZ: 0.6,
    rowOffsetX: 0.3,
    radius: 0.09,
    halfHeight: 0.75,
    restitution: 0.65,
    friction: 0.1,
    ...overrides,
  }
}

function inKeepOut(x: number, z: number): boolean {
  return KEEP_OUT_BOXES.some((b) => x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ)
}

describe('pin-field hash / dropout (shared with C++)', () => {
  it('matches the native golden values', () => {
    expect(pinFieldHash(0, 0)).toBe(0)
    expect(pinFieldHash(12345, 0)).toBe(0x912efcf7)
    expect(pinFieldHash(12345, 77)).toBe(0x7c96f560)
  })

  it('drops the same slots as C++ for the same seed', () => {
    const pins = resolvePinField(denseField({ dropoutSeed: 12345, dropout: 0.25 }))
    expect(pins.length).toBe(DROPOUT_COUNT_12345_025)
    expect(resolvePinField(denseField({ dropoutSeed: 12345, dropout: 0.25 }))).toEqual(pins)
    expect(resolvePinField(denseField({ dropout: 0 }))).toHaveLength(144)
    expect(resolvePinField(denseField({ dropout: 1 }))).toHaveLength(0)
    expect(pinFieldDropped(1, 0, 3)).toBe(false)
  })
})

/** native/tests/pin_field_test.cpp asserts the same count. */
const DROPOUT_COUNT_12345_025 = 116

describe('resolvePinField', () => {
  it('resolves every slot of a plain lattice, in lattice order', () => {
    const pins = resolvePinField(denseField())
    expect(pins).toHaveLength(144)
    expect(pins.map((p) => p.index)).toEqual([...Array(144).keys()])
    expect(pins[13]).toMatchObject({ row: 1, col: 1 })
    // Row 1 is odd: shifted half a column.
    expect(pins[13]!.position.x).toBeCloseTo(-3.3 + 0.6 + 0.3, 5)
    expect(pins[13]!.position.z).toBeCloseTo(0.6, 5)
  })

  it('positions are float32 values, as C++ stores them', () => {
    for (const pin of resolvePinField(denseField({ rotation: { x: 0, y: 0.3826834, z: 0, w: 0.9238795 } }))) {
      expect(Math.fround(pin.position.x)).toBe(pin.position.x)
      expect(Math.fround(pin.position.z)).toBe(pin.position.z)
    }
  })

  it('omits pins inside a keep-out (inclusive edges)', () => {
    const pins = resolvePinField(denseField({ keepOuts: [{ minX: -3.5, maxX: -2.5, minZ: -0.1, maxZ: 0.7 }] }))
    expect(pins).toHaveLength(141)
    expect(pins.find((p) => p.index === 0)).toBeUndefined()
  })

  it('an occupancy mask punches a hole; a short mask clears what it does not cover', () => {
    const occupancy = new Uint8Array(18).fill(0xff)
    const hole = 5 * 12 + 6
    occupancy[hole >> 3]! &= ~(1 << (hole & 7))
    const pins = resolvePinField(denseField({ occupancy }))
    expect(pins).toHaveLength(143)
    expect(pins.some((p) => p.index === hole)).toBe(false)
    expect(resolvePinField(denseField({ occupancy: Uint8Array.of(0xff) }))).toHaveLength(8)
  })

  it('rotates the lattice about its origin', () => {
    const s = Math.SQRT1_2
    const spec = denseField({ origin: { x: 0, y: 0, z: 0 }, rows: 3, cols: 3, rowOffsetX: 0, rotation: { x: 0, y: s, z: 0, w: s } })
    const p = pinFieldSlotPosition(spec, 1, 2)
    expect(p.x).toBeCloseTo(0.6, 5)
    expect(p.z).toBeCloseTo(-1.2, 5)
  })

  it('bounds every pin with its axis-aligned box for debug draw', () => {
    const bounds = pinFieldPinBounds(denseField({ rows: 2, cols: 2 }))
    expect(bounds).toHaveLength(4)
    expect(bounds[0]!.halfExtents.x).toBeCloseTo(0.09, 6)
    expect(bounds[0]!.halfExtents.y).toBeCloseTo(0.75, 6)
    expect(bounds[0]!.halfExtents.z).toBeCloseTo(0.09, 6)
  })
})

describe('occupancy from explicit positions', () => {
  it('round-trips the slots it was built from', () => {
    const spec = denseField()
    const kept = resolvePinField(spec).filter((p) => (p.row + p.col) % 3 === 0)
    const occupancy = pinFieldOccupancyForPositions(spec, kept.map((p) => p.position))
    expect(occupancy).toEqual(pinFieldOccupancy(12, 12, kept))
    expect(resolvePinField({ ...spec, occupancy: occupancy! }).map((p) => p.index)).toEqual(kept.map((p) => p.index))
  })

  it('refuses positions that are off the lattice', () => {
    expect(pinFieldOccupancyForPositions(denseField(), [{ x: -3.0, z: 0.1 }])).toBeNull()
    expect(pinFieldOccupancyForPositions(denseField(), [{ x: 50, z: 0 }])).toBeNull()
  })
})

describe('the pachinko table field', () => {
  const center = { x: 0, z: 6 }

  it('vanilla: the 10×13 lattice minus the keep-outs, same pins as the old per-pin loop', () => {
    const spec = pachinkoPinFieldSpec(center, 24, 22)!
    expect(spec.rows).toBe(VANILLA_LATTICE.rows)
    expect(spec.cols).toBe(VANILLA_LATTICE.cols)
    expect(spec.occupancy).toBeUndefined()

    // The loop object-pachinko.ts ran before #421.
    const legacy: { x: number; z: number }[] = []
    const spacingX = 24 / 13
    const spacingZ = 22 / 10
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 13; c++) {
        const x = -12 + c * spacingX + (r % 2 === 0 ? 0 : spacingX / 2)
        const z = 6 - 11 + r * spacingZ
        if (!inKeepOut(x, z)) legacy.push({ x, z })
      }
    }
    const pins = resolvePinField(spec)
    expect(pins).toHaveLength(legacy.length)
    pins.forEach((pin, i) => {
      expect(pin.position.x).toBeCloseTo(legacy[i]!.x, 5)
      expect(pin.position.z).toBeCloseTo(legacy[i]!.z, 5)
      expect(pin.position.y).toBeCloseTo(0.4, 6)
    })
  })

  it('Daily Cascade: every seeded layout fits its lattice as one masked field', () => {
    for (let seed = 1; seed <= 24; seed++) {
      const layout = generateTableLayout({ seed: seed * 7919, seedId: `t${seed}` })
      expect(layout.pinLattice).toBeDefined()
      const spec = pachinkoPinFieldSpec(center, 24, 22, layout.pins, layout.pinLattice)
      expect(spec, `seed ${seed}`).not.toBeNull()
      expect(spec!.occupancy).toBeInstanceOf(Uint8Array)

      const expected = layout.pins.filter((p) => !inKeepOut(p.x, p.z))
      const pins = resolvePinField(spec!)
      expect(pins.length, `seed ${seed}`).toBe(expected.length)
      const key = (x: number, z: number) => `${x.toFixed(3)},${z.toFixed(3)}`
      expect(new Set(pins.map((p) => key(p.position.x, p.position.z))))
        .toEqual(new Set(expected.map((p) => key(p.x, p.z))))
    }
  })

  it('a seeded pin on a keep-out edge in float32 stays (the mask is authoritative)', () => {
    // Daily Cascade seed 2: x = 8.000000000000004 is outside flipperArcs
    // (maxX 8) in double but exactly on its inclusive edge in float32.
    const layout = generateTableLayout({ seed: 2 * 7919, seedId: 't2' })
    const edge = layout.pins.find((p) => p.x > 8 && p.x - 8 < 1e-9 && p.z < -1.5)
    expect(edge).toBeDefined()
    const spec = pachinkoPinFieldSpec(center, 24, 22, layout.pins, layout.pinLattice)!
    expect(spec.keepOuts ?? []).toEqual([])
    expect(resolvePinField(spec).some((p) => Math.abs(p.position.x - 8) < 1e-5 && Math.abs(p.position.z - edge!.z) < 1e-5)).toBe(true)
  })

  it('seeded positions without a lattice fall back to per-pin placement', () => {
    expect(pachinkoPinFieldSpec(center, 24, 22, [{ x: 1, z: 1 }])).toBeNull()
  })
})
