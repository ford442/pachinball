import { describe, expect, it, vi } from 'vitest'
import {
  assertUniformPinLattice,
  pinLatticeMatrices,
  setPinLatticeInstances,
} from '../src/objects/pin-lattice'

const POSITIONS = [
  { x: 1, y: 0.4, z: 2 },
  { x: -3, y: 0.4, z: 5.5 },
  { x: 0, y: 0.4, z: -7 },
]

/** Quaternion for a rotation of `angle` radians about X (the adventure ramp incline). */
const aboutX = (angle: number) => ({ x: Math.sin(angle / 2), y: 0, z: 0, w: Math.cos(angle / 2) })

function row(m: Float32Array, instance: number, r: number): number[] {
  const o = instance * 16 + r * 4
  return [m[o]!, m[o + 1]!, m[o + 2]!, m[o + 3]!]
}

describe('pinLatticeMatrices', () => {
  it('is one 16-float matrix per position with the translation in elements 12..14', () => {
    const m = pinLatticeMatrices(POSITIONS)
    expect(m).toBeInstanceOf(Float32Array)
    expect(m).toHaveLength(POSITIONS.length * 16)
    POSITIONS.forEach((p, i) => {
      expect(row(m, i, 0)).toEqual([1, 0, 0, 0])
      expect(row(m, i, 1)).toEqual([0, 1, 0, 0])
      expect(row(m, i, 2)).toEqual([0, 0, 1, 0])
      const t = row(m, i, 3)
      expect(t[0]).toBeCloseTo(p.x, 6)
      expect(t[1]).toBeCloseTo(p.y, 6)
      expect(t[2]).toBeCloseTo(p.z, 6)
      expect(t[3]).toBe(1)
    })
  })

  it('applies the one lattice rotation to every instance (Babylon row-vector layout)', () => {
    const incline = 0.35
    const m = pinLatticeMatrices(POSITIONS, aboutX(incline))
    for (let i = 0; i < POSITIONS.length; i++) {
      // Local +Y (the pin axis) leans to (0, cos, sin): the same as `mesh.rotation.x = incline`.
      const y = row(m, i, 1)
      expect(y[0]).toBeCloseTo(0, 6)
      expect(y[1]).toBeCloseTo(Math.cos(incline), 6)
      expect(y[2]).toBeCloseTo(Math.sin(incline), 6)
      // Translation is untouched by the rotation.
      expect(row(m, i, 3).slice(0, 3)).toEqual([POSITIONS[i]!.x, POSITIONS[i]!.y, POSITIONS[i]!.z].map(Math.fround))
    }
  })

  it('normalises a non-unit quaternion and treats a zero quaternion as identity', () => {
    const scaled = pinLatticeMatrices(POSITIONS, { x: 0, y: 0, z: 0, w: 3 })
    expect(row(scaled, 0, 0)).toEqual([1, 0, 0, 0])
    const zero = pinLatticeMatrices(POSITIONS, { x: 0, y: 0, z: 0, w: 0 })
    expect(row(zero, 1, 1)).toEqual([0, 1, 0, 0])
  })

  it('has no instances for no positions', () => {
    expect(pinLatticeMatrices([])).toHaveLength(0)
  })
})

describe('assertUniformPinLattice', () => {
  it('accepts a lattice built from one rotation, and an empty one', () => {
    expect(() => assertUniformPinLattice(pinLatticeMatrices(POSITIONS), 't')).not.toThrow()
    expect(() => assertUniformPinLattice(pinLatticeMatrices(POSITIONS, aboutX(0.7)), 't')).not.toThrow()
    expect(() => assertUniformPinLattice(new Float32Array(0), 't')).not.toThrow()
  })

  it('rejects a mixed-determinant set (a mirrored instance would flip its face winding)', () => {
    const m = pinLatticeMatrices(POSITIONS)
    m[16] = -1 // instance 1: mirror X → determinant -1
    expect(() => assertUniformPinLattice(m, 'pachinko pins')).toThrow(/pachinko pins: mixed-determinant instances/)
  })

  it('rejects two proper rotations in one lattice', () => {
    const m = pinLatticeMatrices(POSITIONS)
    const tilted = pinLatticeMatrices([POSITIONS[1]!], aboutX(0.5))
    m.set(tilted, 16) // instance 1 rotated, still determinant +1
    expect(() => assertUniformPinLattice(m, 'track pins')).toThrow(/track pins: a pin lattice takes one rotation per lattice/)
  })

  it('rejects a degenerate first instance and a ragged buffer', () => {
    const zeroed = pinLatticeMatrices(POSITIONS)
    for (const slot of [0, 1, 2, 4, 5, 6, 8, 9, 10]) zeroed[slot] = 0
    expect(() => assertUniformPinLattice(zeroed, 'x')).toThrow(/degenerate/)
    expect(() => assertUniformPinLattice(new Float32Array(17), 'x')).toThrow(/multiple of 16/)
  })
})

describe('setPinLatticeInstances', () => {
  function fakeMesh() {
    return {
      isPickable: true,
      isVisible: false,
      thinInstanceSetBuffer: vi.fn(),
      thinInstanceSetMatrixAt: vi.fn(),
    }
  }

  it('hands Babylon one static matrix buffer and makes the mesh visible and unpickable', () => {
    const mesh = fakeMesh()
    setPinLatticeInstances(mesh as never, POSITIONS, undefined, 'lattice')
    expect(mesh.thinInstanceSetBuffer).toHaveBeenCalledTimes(1)
    const [kind, buffer, stride, isStatic] = mesh.thinInstanceSetBuffer.mock.calls[0]!
    expect(kind).toBe('matrix')
    expect(buffer).toBeInstanceOf(Float32Array)
    expect(buffer).toHaveLength(POSITIONS.length * 16)
    expect(stride).toBe(16)
    expect(isStatic).toBe(true)
    expect(mesh.isPickable).toBe(false)
    expect(mesh.isVisible).toBe(true)
    expect(mesh.thinInstanceSetMatrixAt).not.toHaveBeenCalled()
  })
})
