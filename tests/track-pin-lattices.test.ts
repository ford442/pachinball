/**
 * Adventure pin lattices as thin instances (#443 A4b).
 *
 * `createPinLattice` (the native #424 field) and `createPinField` (the older per-pin ramp lattice)
 * each build ONE mesh whose static thin-instance buffer holds every pin. The physics side is not
 * under change here: the lattice is still ONE `pinField` descriptor, and the ramp field still has
 * one cylinder collider per pin. Babylon resolves to tests/mocks/babylon-core.ts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { Quaternion } from '@babylonjs/core/Maths/math.vector'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'

import { createPinField, createPinLattice, type TrackPrimitiveContext } from '../src/adventure/track-primitives'
import { pinFieldLayout } from '../src/adventure/track-geometry'
import type { AdventureColliderDesc } from '../src/adventure/track-collider-descriptors'
import { resolvePinField, type PinFieldSpec } from '../src/core/pin-field'
import type { PhysicsBody } from '../src/core/physics-api'

const INCLINE = 0.35
const aboutX = (angle: number) => ({ x: Math.sin(angle / 2), y: 0, z: 0, w: Math.cos(angle / 2) })

/** The mock's FromEulerAngles is not a rotation; give the code under test the real X-axis one. */
beforeEach(() => {
  vi.spyOn(Quaternion, 'FromEulerAngles').mockImplementation(
    (x: number) => new Quaternion(Math.sin(x / 2), 0, 0, Math.cos(x / 2)),
  )
  vi.mocked(MeshBuilder.CreateCylinder).mockClear()
})
afterEach(() => {
  vi.restoreAllMocks()
})

function makeCtx(hasWorld = true) {
  let handle = 0
  const emitted: AdventureColliderDesc[] = []
  const ctx = {
    scene: {},
    hasWorld,
    adventureTrack: [] as Mesh[],
    adventureBodies: [] as PhysicsBody[],
    kinematicBindings: [],
    gravityWells: [],
    chromaGates: [],
    resetSensors: [],
    materials: [],
    emit: vi.fn((desc: AdventureColliderDesc) => {
      emitted.push(desc)
      return { body: { handle: handle++ } as unknown as PhysicsBody, index: emitted.length - 1 }
    }),
    emitField: vi.fn(() => 0),
    attach: vi.fn(),
    getTrackMaterial: vi.fn(),
    setGoalSensor: vi.fn(),
  } as unknown as TrackPrimitiveContext
  return { ctx, emitted }
}

interface LatticeMock {
  material: unknown
  isPickable: boolean
  isVisible: boolean
  createInstance: ReturnType<typeof vi.fn>
  thinInstanceSetBuffer: ReturnType<typeof vi.fn>
}

function createdMeshes(): LatticeMock[] {
  return vi.mocked(MeshBuilder.CreateCylinder).mock.results.map((r) => r.value as LatticeMock)
}

/** The single matrix buffer handed to Babylon, split into rows. */
function matrices(mesh: LatticeMock): { translations: number[][]; yAxis: number[][]; stride: unknown; isStatic: unknown; kind: unknown } {
  expect(mesh.thinInstanceSetBuffer).toHaveBeenCalledTimes(1)
  const [kind, buffer, stride, isStatic] = mesh.thinInstanceSetBuffer.mock.calls[0] as [string, Float32Array, number, boolean]
  const translations: number[][] = []
  const yAxis: number[][] = []
  for (let i = 0; i < buffer.length; i += 16) {
    translations.push([buffer[i + 12]!, buffer[i + 13]!, buffer[i + 14]!])
    yAxis.push([buffer[i + 4]!, buffer[i + 5]!, buffer[i + 6]!])
  }
  return { translations, yAxis, stride, isStatic, kind }
}

const SPEC: PinFieldSpec = {
  origin: { x: 3, y: 1, z: -4 },
  rows: 4,
  cols: 5,
  spacingX: 1.3,
  spacingZ: 1.1,
  rowOffsetX: 0.65,
  radius: 0.12,
  halfHeight: 0.3,
  rotation: aboutX(INCLINE),
  restitution: 0.5,
  friction: 0.1,
}

describe('createPinLattice (native pin field)', () => {
  it('is one pinField descriptor and one mesh, however many pins', () => {
    const { ctx, emitted } = makeCtx()
    const material = {} as never
    createPinLattice(ctx, SPEC, material)

    expect(emitted).toHaveLength(1)
    expect(emitted[0]!.kind).toBe('pinField')
    expect(ctx.adventureBodies).toHaveLength(1)

    const meshes = createdMeshes()
    expect(meshes).toHaveLength(1)
    expect(ctx.adventureTrack).toHaveLength(1)
    expect(ctx.adventureTrack[0]).toBe(meshes[0])
    expect(meshes[0]!.material).toBe(material)
    expect(meshes[0]!.createInstance).not.toHaveBeenCalled() // no InstancedMesh per pin
  })

  it('fills one static thin-instance buffer from resolvePinField', () => {
    const { ctx } = makeCtx()
    createPinLattice(ctx, SPEC, {} as never)
    const mesh = createdMeshes()[0]!
    const { translations, yAxis, stride, isStatic, kind } = matrices(mesh)

    const pins = resolvePinField(SPEC)
    expect(pins).toHaveLength(SPEC.rows * SPEC.cols)
    expect([kind, stride, isStatic]).toEqual(['matrix', 16, true])
    expect(translations).toHaveLength(pins.length)
    pins.forEach((pin, i) => {
      expect(translations[i]![0]).toBeCloseTo(pin.position.x, 5)
      expect(translations[i]![1]).toBeCloseTo(pin.position.y, 5)
      expect(translations[i]![2]).toBeCloseTo(pin.position.z, 5)
      // Every pin carries the field's one rotation: local +Y leans to (0, cos, sin).
      expect(yAxis[i]![0]).toBeCloseTo(0, 6)
      expect(yAxis[i]![1]).toBeCloseTo(Math.cos(INCLINE), 6)
      expect(yAxis[i]![2]).toBeCloseTo(Math.sin(INCLINE), 6)
    })
  })

  it('leaves the mesh visible and unpickable', () => {
    const { ctx } = makeCtx()
    createPinLattice(ctx, SPEC, {} as never)
    const mesh = createdMeshes()[0]!
    expect(mesh.isVisible).toBe(true)
    expect(mesh.isPickable).toBe(false)
  })

  it('still emits the collider but builds no mesh when the mask keeps no pin', () => {
    const { ctx, emitted } = makeCtx()
    createPinLattice(ctx, { ...SPEC, occupancy: new Uint8Array(3) }, {} as never)
    expect(emitted).toHaveLength(1)
    expect(createdMeshes()).toHaveLength(0)
    expect(ctx.adventureTrack).toHaveLength(0)
  })

  it('is a no-op without a physics world', () => {
    const { ctx, emitted } = makeCtx(false)
    createPinLattice(ctx, SPEC, {} as never)
    expect(emitted).toHaveLength(0)
    expect(createdMeshes()).toHaveLength(0)
  })
})

describe('createPinField (ramp lattice)', () => {
  const RAMP = { x: 1, y: 0.5, z: -6 }
  const buildRampField = (ctx: TrackPrimitiveContext): void =>
    createPinField(ctx, RAMP as never, 0.4, INCLINE, 12, 1.5, [-2, 0, 2], [-1, 1], 0.25, 0.5, {} as never)
  const layout = pinFieldLayout(RAMP, 0.4, INCLINE, 12, 1.5, [-2, 0, 2], [-1, 1], 0.5)

  it('is ONE mesh for the whole lattice, not one per pin', () => {
    const { ctx } = makeCtx()
    buildRampField(ctx)
    expect(layout.length).toBeGreaterThan(5)

    const meshes = createdMeshes()
    expect(meshes).toHaveLength(1)
    expect(ctx.adventureTrack).toHaveLength(1)
    expect(meshes[0]!.isPickable).toBe(false)

    const { translations, yAxis, kind, stride, isStatic } = matrices(meshes[0]!)
    expect([kind, stride, isStatic]).toEqual(['matrix', 16, true])
    expect(translations).toHaveLength(layout.length)
    layout.forEach((pos, i) => {
      expect(translations[i]![0]).toBeCloseTo(pos.x, 5)
      expect(translations[i]![1]).toBeCloseTo(pos.y, 5)
      expect(translations[i]![2]).toBeCloseTo(pos.z, 5)
      // `pin.rotation.x = incline` before; one rotation for the lattice now.
      expect(yAxis[i]![1]).toBeCloseTo(Math.cos(INCLINE), 6)
      expect(yAxis[i]![2]).toBeCloseTo(Math.sin(INCLINE), 6)
    })
  })

  it('keeps one cylinder collider per pin (the physics is unchanged)', () => {
    const { ctx, emitted } = makeCtx()
    buildRampField(ctx)
    expect(emitted).toHaveLength(layout.length)
    expect(emitted.every((d) => d.kind === 'cylinder')).toBe(true)
    expect(ctx.adventureBodies).toHaveLength(layout.length)
  })

  it('builds nothing when the ramp is too short for a row', () => {
    const { ctx, emitted } = makeCtx()
    createPinField(ctx, RAMP as never, 0.4, INCLINE, 1, 1.5, [0], [0], 0.25, 0.5, {} as never)
    expect(emitted).toHaveLength(0)
    expect(createdMeshes()).toHaveLength(0)
    expect(ctx.adventureTrack).toHaveLength(0)
  })

  it('is a no-op without a physics world', () => {
    const { ctx, emitted } = makeCtx(false)
    buildRampField(ctx)
    expect(emitted).toHaveLength(0)
    expect(createdMeshes()).toHaveLength(0)
  })
})
