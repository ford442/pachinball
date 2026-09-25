/**
 * PachinkoBuilder on the C++ owner path (#421): the whole lattice is ONE
 * `addPinField` — never one `addStaticCylinder` per pin — while the Rapier
 * path (a sink without `createPinField`) still gets a fixed cylinder per pin.
 * Babylon is stubbed: only the physics authoring is under test.
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('@babylonjs/core/Maths/math.vector', () => ({
  Vector3: class {
    constructor(public x = 0, public y = 0, public z = 0) {}
  },
}))
vi.mock('@babylonjs/core/Meshes/abstractMesh', () => ({ AbstractMesh: class {} }))
vi.mock('@babylonjs/core/scene', () => ({ Scene: class {} }))

function meshModuleStub() {
  return {
    MeshBuilder: {
      CreateCylinder: (name: string) => stubMesh(name),
      CreateSphere: (name: string) => stubMesh(name),
      CreateTorus: (name: string) => stubMesh(name),
    },
    Mesh: { MergeMeshes: (meshes: { name: string }[]) => stubMesh(`${meshes[0]!.name}_merged`) },
  }
}

function stubMesh(name: string): Record<string, unknown> {
  return {
    name,
    position: { x: 0, y: 0, z: 0, set: vi.fn() },
    rotation: { x: 0, y: 0, z: 0 },
    material: null as unknown,
    isPickable: true,
    isVisible: true,
    addLODLevel: vi.fn(),
    freezeWorldMatrix: vi.fn(),
    isDisposed: () => false,
    dispose: vi.fn(),
    createInstance(instanceName: string) {
      return stubMesh(instanceName)
    },
  }
}

// One stub for both mesh modules: vitest matches the `Meshes/mesh` mock for
// `Meshes/meshBuilder` imports too, so each must carry both exports.
vi.mock('@babylonjs/core/Meshes/meshBuilder', () => meshModuleStub())
vi.mock('@babylonjs/core/Meshes/mesh', () => meshModuleStub())
vi.mock('../src/materials', () => ({
  getMaterialLibrary: () => ({
    getEnhancedPinMaterial: () => null,
    getCatcherMaterial: () => null,
  }),
}))

import { PachinkoBuilder } from '../src/objects/object-pachinko'
import { pachinkoPinFieldSpec } from '../src/objects/pachinko-pin-field'
import { resolvePinField } from '../src/core/pin-field'
import { supportsPinFields, type PhysicsWorldSink } from '../src/core/physics-api'
import { generateTableLayout } from '../src/cascade/daily-cascade-layout'
import { COLLISION_GROUP_PRESETS } from '../src/game-elements/physics'
import { WASM_PHYSICS_API as api } from '../src/wasm/wasm-physics-api'
import { WasmTableWorld } from '../src/wasm/wasm-table-world'
import { unpackCollisionGroups } from '../src/wasm/wasm-body'
import { PIN_FIELD_ID_BASE } from '../src/wasm/physics-worker-protocol'
import { exportTableBodiesToWasm } from '../src/game/physics/wasm-static-export'
import { GameConfig } from '../src/config'
import { asSimEngine, makeFakeWasmEngine } from './helpers/fake-wasm-engine'

const CENTER = { x: 0, y: 0.5, z: 6 }

function ownerTable() {
  const engine = makeFakeWasmEngine()
  const world = new WasmTableWorld(asSimEngine(engine), { x: 0, y: -9.81, z: -5 })
  const builder = new PachinkoBuilder({} as never, world, api, GameConfig)
  return { engine, world, builder }
}

/** The same world without the pin-field capability — what a Rapier world looks like to the builder. */
function withoutPinFields(world: WasmTableWorld): PhysicsWorldSink {
  return {
    get gravity() { return world.gravity },
    createRigidBody: (d) => world.createRigidBody(d),
    createCollider: (d, p) => world.createCollider(d, p),
    removeRigidBody: (b) => world.removeRigidBody(b),
    getRigidBody: (h) => world.getRigidBody(h),
    getCollider: (h) => world.getCollider(h),
    createImpulseJoint: (p, a, b) => world.createImpulseJoint(p, a, b),
    removeImpulseJoint: (j) => world.removeImpulseJoint(j),
    intersectionPair: (a, b) => world.intersectionPair(a, b),
  }
}

describe('PachinkoBuilder pin field (#421)', () => {
  it('the owner path exports the vanilla lattice as ONE addPinField', () => {
    const { engine, world, builder } = ownerTable()
    expect(supportsPinFields(world)).toBe(true)
    const field = builder.createPachinkoField(CENTER as never)

    const expected = resolvePinField(pachinkoPinFieldSpec(CENTER, 24, 22)!)
    expect(field.pins).toHaveLength(expected.length)
    expect(expected.length).toBeGreaterThan(80)

    const result = exportTableBodiesToWasm(world.allBodies(), asSimEngine(engine))
    expect(result.unsupported).toEqual([])
    expect(engine.addPinField).toHaveBeenCalledTimes(1)
    expect(engine.addStaticCylinder).not.toHaveBeenCalled()
    expect(engine.addSensorVolume).toHaveBeenCalledTimes(1) // the catcher

    const [desc] = engine.addPinField.mock.calls[0] as unknown as [ReturnType<typeof pachinkoPinFieldSpec>]
    expect(desc).toMatchObject({ rows: 10, cols: 13, restitution: 0.65, friction: 0.1 })
    expect(desc!.keepOuts).toHaveLength(4)

    // One id for the whole field, carrying the pins' WALL groups.
    const fieldBody = field.bindings[0]!.rigidBody
    expect(field.bindings.every((b) => b.rigidBody === fieldBody)).toBe(true)
    expect(result.idsByBody.get(fieldBody as never)).toEqual([PIN_FIELD_ID_BASE])
    const groups = unpackCollisionGroups(COLLISION_GROUP_PRESETS.WALL)
    expect(engine.setCollisionGroups).toHaveBeenCalledWith(PIN_FIELD_ID_BASE, groups.membership, groups.filter)

    // Debug draw gets the descriptor, not one mesh per pin.
    expect(result.debug.filter((d) => d.kind === 'pinField')).toHaveLength(1)
    expect(result.debug.filter((d) => d.kind === 'cylinder')).toHaveLength(0)
  })

  it('a Daily Cascade layout is one masked field on the owner path', () => {
    const layout = generateTableLayout({ seed: 20260925, seedId: 'owner' })
    const { engine, world, builder } = ownerTable()
    const field = builder.createPachinkoField(CENTER as never, 24, 22, layout.pins, layout.pinLattice)

    exportTableBodiesToWasm(world.allBodies(), asSimEngine(engine))
    expect(engine.addPinField).toHaveBeenCalledTimes(1)
    expect(engine.addStaticCylinder).not.toHaveBeenCalled()
    const [desc] = engine.addPinField.mock.calls[0] as unknown as [{ occupancy: Uint8Array; rows: number; cols: number }]
    expect(desc.rows).toBe(layout.pinLattice!.rows)
    expect(desc.cols).toBe(layout.pinLattice!.cols)
    expect(desc.occupancy).toBeInstanceOf(Uint8Array)
    expect(field.pins.length).toBeGreaterThan(0)
  })

  it('disabling the table zeroes the field id in place', () => {
    const { engine, world, builder } = ownerTable()
    const field = builder.createPachinkoField(CENTER as never)
    const body = field.bindings[0]!.rigidBody
    body.setEnabled(false)
    const result = exportTableBodiesToWasm(world.allBodies(), asSimEngine(engine))
    expect(result.idsByBody.get(body as never)).toEqual([PIN_FIELD_ID_BASE])
    expect(engine.setCollisionGroups).toHaveBeenCalledWith(PIN_FIELD_ID_BASE, 0, 0)
  })

  it('a rebuild removes the field with the rest of the builder', () => {
    const { world, builder } = ownerTable()
    builder.createPachinkoField(CENTER as never)
    const before = world.structureRevision
    const fieldBodies = world.allBodies().filter((b) => b.colliders[0]?.desc.shape.kind === 'pinField')
    expect(fieldBodies).toHaveLength(1)
    builder.dispose()
    expect(world.structureRevision).toBeGreaterThan(before)
    expect(world.allBodies()).toHaveLength(0)
  })

  it('a world without pin fields (Rapier) still gets one fixed cylinder per pin', () => {
    const engine = makeFakeWasmEngine()
    const world = new WasmTableWorld(asSimEngine(engine), { x: 0, y: -9.81, z: -5 })
    const builder = new PachinkoBuilder({} as never, withoutPinFields(world), api, GameConfig)
    const field = builder.createPachinkoField(CENTER as never)

    exportTableBodiesToWasm(world.allBodies(), asSimEngine(engine))
    expect(engine.addPinField).not.toHaveBeenCalled()
    expect(engine.addStaticCylinder).toHaveBeenCalledTimes(field.pins.length)
    // Same pins either way.
    const cylinders = engine.addStaticCylinder.mock.calls.map((c) => (c as unknown as [{ x: number; z: number }])[0])
    const expected = resolvePinField(pachinkoPinFieldSpec(CENTER, 24, 22)!)
    cylinders.forEach((center, i) => {
      expect(center.x).toBeCloseTo(expected[i]!.position.x, 6)
      expect(center.z).toBeCloseTo(expected[i]!.position.z, 6)
    })
  })
})
