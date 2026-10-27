/**
 * The side rails and flipper-area rails are walls the ball plays against, so their colliders
 * are part of the gameplay build, not the cabinet decoration (#464 item 2).
 *
 * `createCabinetDecoration()` runs from an idle callback after Start is enabled (or never, with
 * the cosmetic stage off). When it also created these four colliders, the C++ static table grew
 * from 9 to 13 boxes at a moment that depended on idle timing, so two identical `?seed=` loads
 * hashed different tables and played their first frames against different walls.
 */

import { describe, expect, it, vi } from 'vitest'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { Animation } from '@babylonjs/core/Animations/animation'
import { Scalar } from '@babylonjs/core/Maths/math.scalar'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'

vi.mock('../src/materials', () => ({
  getMaterialLibrary: () => new Proxy({}, { get: () => () => ({}) }),
}))
// GameObjects' other builders are not under test.
vi.mock('../src/objects/object-flippers', () => ({ FlipperBuilder: class { dispose = vi.fn() } }))
vi.mock('../src/objects/object-walls', () => ({ WallBuilder: class { dispose = vi.fn() } }))
vi.mock('../src/objects/object-rails', () => ({ RailBuilder: class { dispose = vi.fn() } }))
vi.mock('../src/objects/object-bumpers', () => ({ BumperBuilder: class { dispose = vi.fn() } }))
vi.mock('../src/objects/object-pachinko', () => ({ PachinkoBuilder: class { dispose = vi.fn() } }))

import { DecorationBuilder } from '../src/objects/decoration/decoration-builder'
import { GameObjects } from '../src/objects/object-core'
import { GameConfig } from '../src/config'
import type { PhysicsWorldSink } from '../src/core/physics-api'
import { WasmTableWorld } from '../src/wasm/wasm-table-world'
import { WASM_PHYSICS_API as api } from '../src/wasm/wasm-physics-api'
import type { Scene } from '@babylonjs/core/scene'
import { asSimEngine, makeFakeWasmEngine } from './helpers/fake-wasm-engine'

// The shared Babylon mock has no tube builder or RandomRange, and the decoration animates a few meshes.
function decorationMesh(name: string) {
  return {
    name,
    position: new Vector3(),
    rotation: { x: 0, y: 0, z: 0 },
    scaling: { x: 1, y: 1, z: 1 },
    material: null as unknown,
    parent: null as unknown,
    animations: [] as unknown[],
    isDisposed: () => false,
    dispose: vi.fn(),
  }
}
Object.assign(MeshBuilder, {
  CreateBox: vi.fn(decorationMesh),
  CreateCylinder: vi.fn(decorationMesh),
  CreateSphere: vi.fn(decorationMesh),
  CreateTorus: vi.fn(decorationMesh),
  CreateTube: vi.fn(decorationMesh),
})
Object.assign(Scalar, { RandomRange: (min: number) => min })
vi.mocked(Animation).mockImplementation(function (this: Record<string, unknown>) {
  this.setKeys = vi.fn()
})

function setup() {
  const world = new WasmTableWorld(asSimEngine(makeFakeWasmEngine()), { x: 0, y: -9.81, z: -5 })
  const scene = { getMeshByName: () => null, beginAnimation: vi.fn() } as unknown as Scene
  const builder = new DecorationBuilder(scene, world as PhysicsWorldSink, api, GameConfig)
  return { world, builder }
}

const RAIL_MESHES = ['leftRail', 'rightRail', 'leftFlipperRail', 'rightFlipperRail']

describe('DecorationBuilder rail colliders (#464 item 2)', () => {
  it('the cosmetic pass creates no physics bodies', () => {
    const { world, builder } = setup()
    const revision = world.structureRevision
    builder.createCabinetDecoration()
    expect(world.allBodies()).toHaveLength(0)
    expect(world.structureRevision).toBe(revision)
    // Nothing to bind to yet: no binding points at a body that does not exist.
    expect(builder.getBindings()).toHaveLength(0)
  })

  it('createRailColliders builds the four walls once, with their authored poses', () => {
    const { world, builder } = setup()
    builder.createRailColliders()
    builder.createRailColliders()
    const bodies = world.allBodies()
    expect(bodies).toHaveLength(4)
    expect(bodies.every((b) => b.isFixed())).toBe(true)
    expect(bodies.map((b) => b.translation())).toEqual([
      { x: -11.8, y: 0.8, z: 5 },
      { x: 12.8, y: 0.8, z: 5 },
      { x: -7, y: 0.3, z: -8 },
      { x: 8.5, y: 0.3, z: -8 },
    ])
    expect(bodies[2]!.rotation().y).toBeCloseTo(Math.sin(-0.15), 12)
    expect(bodies[3]!.rotation().y).toBeCloseTo(Math.sin(0.15), 12)
  })

  it('the cosmetic pass after the gameplay build binds each rail mesh to its collider', () => {
    const { world, builder } = setup()
    builder.createRailColliders()
    const bodies = world.allBodies()
    builder.createCabinetDecoration()
    expect(world.allBodies()).toHaveLength(4)
    const bindings = builder.getBindings()
    expect(bindings.map((b) => b.mesh.name)).toEqual(RAIL_MESHES)
    expect(bindings.map((b) => b.rigidBody)).toEqual(bodies)
  })

  it('dispose removes the colliders and lets a rebuild create them again', () => {
    const { world, builder } = setup()
    builder.createRailColliders()
    builder.dispose()
    expect(world.allBodies()).toHaveLength(0)
    builder.createRailColliders()
    expect(world.allBodies()).toHaveLength(4)
  })
})

describe('GameObjects rail colliders (#464 item 2)', () => {
  function table() {
    const world = new WasmTableWorld(asSimEngine(makeFakeWasmEngine()), { x: 0, y: -9.81, z: -5 })
    const scene = { getMeshByName: () => null, beginAnimation: vi.fn() } as unknown as Scene
    const objects = new GameObjects(scene, world as PhysicsWorldSink, api, GameConfig)
    objects.createRailColliders()
    return { world, objects }
  }

  // The C++ owner exports only the bodies in scope when the table changes. The rails' bindings
  // arrive with the cosmetic pass, which changes no body, so scoping them by binding left them
  // out of the C++ world for good.
  it('the rails are in the C++ export scope before any cosmetic pass', () => {
    const { world, objects } = table()
    const rails = world.allBodies()
    expect(rails).toHaveLength(4)
    expect(objects.getBindings()).toHaveLength(0)
    const scope = new Set(objects.getWasmExportBodies())
    for (const body of rails) expect(scope.has(body)).toBe(true)
  })

  it('setTableBodiesEnabled reaches the rails without their meshes', () => {
    const { world, objects } = table()
    objects.setTableBodiesEnabled(false)
    expect(world.allBodies().every((b) => !b.isEnabled())).toBe(true)
    objects.setTableBodiesEnabled(true)
    expect(world.allBodies().every((b) => b.isEnabled())).toBe(true)
  })
})
