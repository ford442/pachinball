/**
 * The weekly machine on the C++ owner path: a seed builds the table through the
 * same PhysicsApi calls as any other table — ONE `addPinField` carrying the
 * seeded dropout and keep-outs, no new collider type — and two clients that load
 * the same seed export exactly the same statics, so the frame-0 fingerprint
 * (pin occupancy here, `staticContentHash()` in the compiled bundle) matches.
 *
 * The compiled bundle is not loaded in this suite: the fake engine records the
 * exports a real `staticContentHash()` is computed over. Babylon is stubbed
 * the way pachinko-pin-field-owner.test.ts does.
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
    thinInstanceSetBuffer: vi.fn(),
    thinInstanceSetMatrixAt: vi.fn(),
    isDisposed: () => false,
    dispose: vi.fn(),
    createInstance(instanceName: string) {
      return stubMesh(instanceName)
    },
  }
}

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
import { resolvePinField, type PinFieldSpec } from '../src/core/pin-field'
import { CANONICAL_BUMPERS, KEEP_OUT_BOXES, type TableLayout } from '../src/cascade/daily-cascade-layout'
import { generateWeeklyLayout } from '../src/cascade/weekly-machine'
import { initSessionRng } from '../src/core/seeded-rng'
import { WASM_PHYSICS_API as api } from '../src/wasm/wasm-physics-api'
import { WasmTableWorld } from '../src/wasm/wasm-table-world'
import { exportTableBodiesToWasm } from '../src/game/physics/wasm-static-export'
import { pinFieldOccupancyHash, tablePinFieldSpecs } from '../src/replay/replay-snapshot'
import { GameConfig } from '../src/config'
import { asSimEngine, makeFakeWasmEngine } from './helpers/fake-wasm-engine'

const CENTER = { x: 0, y: 0.5, z: 6 }

/** One client: seed the session, draw the machine, author its pin field, export the statics. */
function client(seed: number) {
  initSessionRng(seed)
  const { layout } = generateWeeklyLayout(seed)
  const engine = makeFakeWasmEngine()
  const world = new WasmTableWorld(asSimEngine(engine), { x: 0, y: -9.81, z: -5 })
  const builder = new PachinkoBuilder({} as never, world, api, GameConfig)
  const field = builder.createPachinkoField(CENTER as never, 24, 22, layout.pins, layout.pinLattice, layout.pinField)
  const exported = exportTableBodiesToWasm(world.allBodies(), asSimEngine(engine))
  return { layout, engine, world, field, exported }
}

/** What a real `staticContentHash()` is computed over, as the fake engine saw it. */
function staticCalls(c: ReturnType<typeof client>): string {
  const calls = {
    pinField: c.engine.addPinField.mock.calls,
    boxes: c.engine.addStaticBox.mock.calls,
    cylinders: c.engine.addStaticCylinder.mock.calls,
    sensors: c.engine.addSensorVolume.mock.calls,
  }
  return JSON.stringify(calls, (_k, v: unknown) => (v instanceof Uint8Array ? Array.from(v) : v))
}

describe('weekly machine on the owner path', () => {
  it('builds the pin field as ONE addPinField with seeded dropout and keep-outs, and no new collider type', () => {
    const c = client(20261029)
    expect(c.exported.unsupported).toEqual([])
    expect(c.engine.addPinField).toHaveBeenCalledTimes(1)
    expect(c.engine.addStaticCylinder).not.toHaveBeenCalled()
    expect(c.engine.addSensorVolume).toHaveBeenCalledTimes(1) // the catcher, as on every table

    const [desc] = c.engine.addPinField.mock.calls[0] as unknown as [PinFieldSpec]
    expect(desc.rows).toBe(c.layout.pinField!.rows)
    expect(desc.cols).toBe(c.layout.pinField!.cols)
    expect(desc.dropout).toBe(c.layout.pinField!.dropout)
    expect(desc.dropoutSeed).toBe(c.layout.pinField!.dropoutSeed)
    expect(desc.occupancy).toBeUndefined() // C++ resolves the field; no TS-side mask
    expect(desc.keepOuts).toHaveLength(c.layout.pinField!.keepOuts.length)
    expect(desc.keepOuts!.length).toBeGreaterThanOrEqual(KEEP_OUT_BOXES.length + CANONICAL_BUMPERS.length)
  })

  it('the lattice mesh sits on exactly the pins the layout was validated against', () => {
    const c = client(77)
    const spec = pachinkoPinFieldSpec({ x: 0, z: 6 }, 24, 22, c.layout.pins, c.layout.pinLattice, c.layout.pinField)!
    const resolved = resolvePinField(spec)
    expect(resolved.map((p) => [p.position.x, p.position.z])).toEqual(c.layout.pins.map((p) => [p.x, p.z]))

    expect(c.field.pins).toHaveLength(1)
    const mesh = c.field.pins[0] as unknown as { thinInstanceSetBuffer: ReturnType<typeof vi.fn> }
    const [, buffer] = mesh.thinInstanceSetBuffer.mock.calls[0] as [string, Float32Array]
    expect(buffer.length / 16).toBe(c.layout.pins.length)
  })

  it('two clients with the same seed export identical statics and the same pin occupancy', () => {
    const a = client(424242)
    client(1) // an unrelated game in between
    const b = client(424242)
    expect(staticCalls(b)).toBe(staticCalls(a))
    const hashA = pinFieldOccupancyHash(tablePinFieldSpecs(a.world))
    expect(hashA).not.toBeNull()
    expect(pinFieldOccupancyHash(tablePinFieldSpecs(b.world))).toBe(hashA)
  })

  it('a different seed is a different static table', () => {
    const a = client(424242)
    const b = client(424243)
    expect(staticCalls(b)).not.toBe(staticCalls(a))
    expect(pinFieldOccupancyHash(tablePinFieldSpecs(b.world))).not.toBe(pinFieldOccupancyHash(tablePinFieldSpecs(a.world)))
  })

  it('a rebuild from the same layout is stable: dispose and build again gives the same statics', () => {
    const seed = 99
    initSessionRng(seed)
    const { layout } = generateWeeklyLayout(seed)
    const engine = makeFakeWasmEngine()
    const world = new WasmTableWorld(asSimEngine(engine), { x: 0, y: -9.81, z: -5 })
    const builder = new PachinkoBuilder({} as never, world, api, GameConfig)
    const build = (l: TableLayout) => builder.createPachinkoField(CENTER as never, 24, 22, l.pins, l.pinLattice, l.pinField)

    build(layout)
    const first = pinFieldOccupancyHash(tablePinFieldSpecs(world))
    builder.dispose()
    build(layout)
    expect(pinFieldOccupancyHash(tablePinFieldSpecs(world))).toBe(first)
  })
})
