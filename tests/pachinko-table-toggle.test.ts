/**
 * Table enable/disable with a thin-instance pin lattice (#443 A4).
 *
 * The lattice is ONE mesh bound to ONE body, so the pins' other colliders (on Rapier: one fixed
 * body per pin) are no longer reachable through the bindings. `GameObjects` keeps them in
 * `pinBodies`; this proves `setTableBodiesEnabled` and the C++ export scope still reach every
 * pin collider, on the C++ owner (one pin-field body) and on the Rapier path (a body per pin),
 * and that the mesh stays reachable for the caller that hides the table meshes.
 */

import { describe, expect, it, vi } from 'vitest'

function stubMesh(name: string): Record<string, unknown> {
  return {
    name,
    position: { x: 0, y: 0, z: 0, set: vi.fn() },
    rotation: { x: 0, y: 0, z: 0 },
    material: null as unknown,
    isPickable: true,
    isVisible: true,
    thinInstanceSetBuffer: vi.fn(),
    disposed: false,
    isDisposed() {
      return this.disposed as boolean
    },
    dispose() {
      this.disposed = true
    },
    setEnabled: vi.fn(),
  }
}

// Every `@babylonjs/core/*` path resolves to ONE module under the Vitest alias, so the stub must
// carry every Babylon export these files import: a second vi.mock factory would replace it.
function babylonStub() {
  return {
    MeshBuilder: {
      CreateCylinder: (name: string) => stubMesh(name),
      CreateSphere: (name: string) => stubMesh(name),
      CreateTorus: (name: string) => stubMesh(name),
    },
    Mesh: { MergeMeshes: (meshes: { name: string }[]) => stubMesh(`${meshes[0]!.name}_merged`) },
    Vector3: class {
      constructor(public x = 0, public y = 0, public z = 0) {}
    },
    AbstractMesh: class {},
    Scene: class {},
    TransformNode: class {},
    StandardMaterial: class {},
    Color3: class {},
  }
}
vi.mock('@babylonjs/core/Meshes/mesh', () => babylonStub())
vi.mock('../src/materials', () => ({
  getMaterialLibrary: () => ({
    getEnhancedPinMaterial: () => null,
    getCatcherMaterial: () => null,
  }),
}))

// The pachinko builder is the real one; its siblings are not under test.
vi.mock('../src/objects/object-flippers', () => ({ FlipperBuilder: class { dispose = vi.fn() } }))
vi.mock('../src/objects/object-walls', () => ({ WallBuilder: class { dispose = vi.fn() } }))
vi.mock('../src/objects/object-rails', () => ({ RailBuilder: class { dispose = vi.fn() } }))
vi.mock('../src/objects/object-decoration', () => ({ DecorationBuilder: class { dispose = vi.fn() } }))
vi.mock('../src/objects/object-bumpers', () => ({
  BumperBuilder: class {
    dispose = vi.fn()
    createBumpers() {
      return { bumpers: new Map(), bindings: [], bumperBodies: [], bumperVisuals: [], meshes: [] }
    }
  },
}))

import { GameObjects } from '../src/objects/object-core'
import { generateTableLayout } from '../src/cascade/daily-cascade-layout'
import { pachinkoPinFieldSpec } from '../src/objects/pachinko-pin-field'
import { resolvePinField } from '../src/core/pin-field'
import type { PhysicsBody, PhysicsWorldSink } from '../src/core/physics-api'
import { WASM_PHYSICS_API as api } from '../src/wasm/wasm-physics-api'
import { WasmTableWorld } from '../src/wasm/wasm-table-world'
import { GameConfig } from '../src/config'
import { asSimEngine, makeFakeWasmEngine } from './helpers/fake-wasm-engine'

const CENTER = { x: 0, y: 0.5, z: 6 }

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

function table(path: 'owner' | 'rapier') {
  const engine = makeFakeWasmEngine()
  const world = new WasmTableWorld(asSimEngine(engine), { x: 0, y: -9.81, z: -5 })
  const sink = path === 'owner' ? world : withoutPinFields(world)
  const objects = new GameObjects({} as never, sink, api, GameConfig)
  objects.createPachinkoField(CENTER as never)
  return { world, objects }
}

/** Bodies that are pin colliders: the pin-field body, or a fixed cylinder at pin height. */
function pinBodiesIn(world: WasmTableWorld): PhysicsBody[] {
  return world.allBodies().filter((b) => {
    const kind = b.colliders[0]?.desc.shape.kind
    return kind === 'pinField' || (kind === 'cylinder' && b.colliders[0]?.desc.shape.halfHeight === 0.75)
  }) as unknown as PhysicsBody[]
}

describe.each([['owner' as const], ['rapier' as const]])('table toggle with a pin lattice — %s path', (path) => {
  const expectedPins = resolvePinField(pachinkoPinFieldSpec(CENTER, 24, 22)!).length

  it('has one lattice mesh and one binding, and the mesh is among the table meshes', () => {
    const { objects } = table(path)
    const bindings = objects.getBindings()
    expect(bindings).toHaveLength(1)
    const lattice = bindings[0]!.mesh
    expect(objects.getPinballMeshes()).toContain(lattice) // what GameSlotAdventure hides with setEnabled(false)
  })

  it('exports every pin collider to C++, not just the bound one', () => {
    const { world, objects } = table(path)
    const pins = pinBodiesIn(world)
    expect(pins).toHaveLength(path === 'owner' ? 1 : expectedPins)
    const exported = new Set(objects.getWasmExportBodies())
    for (const body of pins) expect(exported.has(body)).toBe(true)
  })

  it('setTableBodiesEnabled toggles every pin collider off and back on', () => {
    const { world, objects } = table(path)
    const pins = pinBodiesIn(world)
    expect(pins.every((b) => b.isEnabled())).toBe(true)

    objects.setTableBodiesEnabled(false)
    expect(objects.areTableBodiesEnabled()).toBe(false)
    expect(pins.filter((b) => b.isEnabled())).toHaveLength(0)

    objects.setTableBodiesEnabled(true)
    expect(pins.every((b) => b.isEnabled())).toBe(true)
  })

  it('a Daily Cascade rebuild replaces the lattice, its bindings and its pin bodies', () => {
    const { world, objects } = table(path)
    const first = objects.getBindings()[0]!.mesh as unknown as { isDisposed(): boolean }
    const layout = generateTableLayout({ seed: 20260925, seedId: 'toggle' })

    objects.rebuildMutableToys(layout)

    expect(first.isDisposed()).toBe(true)
    const bindings = objects.getBindings()
    expect(bindings).toHaveLength(1)
    expect(bindings[0]!.mesh).not.toBe(first)
    const pins = pinBodiesIn(world)
    expect(pins.length).toBeGreaterThan(0)
    // Nothing stale: every exported pin body still lives in the world.
    const live = new Set(world.allBodies())
    for (const body of objects.getWasmExportBodies()) expect(live.has(body as never)).toBe(true)
    const exported = new Set(objects.getWasmExportBodies())
    for (const body of pins) expect(exported.has(body)).toBe(true)

    objects.setTableBodiesEnabled(false)
    expect(pins.filter((b) => b.isEnabled())).toHaveLength(0)
  })

  it('dispose() leaves no pin body behind in the export scope', () => {
    const { objects } = table(path)
    objects.dispose()
    expect(objects.getWasmExportBodies()).toEqual([])
  })
})
