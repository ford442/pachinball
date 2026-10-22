/**
 * Owner modes move the flippers only through C++ hinges realised by
 * `rebuildHandleCaches()`. Boot (GameSystemsInitializer, scene_critical) now
 * realises them before Start is enabled and fails the stage when a table that
 * needs them does not get both; `getWasmFlipperHingeCount()` is what it reads.
 */

import { describe, expect, it, vi } from 'vitest'
import { GamePhysicsController } from '../src/game/game-physics-controller'
import { EventBus } from '../src/core/event-bus'
import type { PhysicsBody } from '../src/core/physics-api'
import { WasmTableWorld } from '../src/wasm/wasm-table-world'
import { WASM_PHYSICS_API as api } from '../src/wasm/wasm-physics-api'
import { asSimEngine, makeFakeWasmEngine } from './helpers/fake-wasm-engine'
import { makeBallManagerStub, makeGameObjectsStub, makePhysicsHostShell } from './helpers/make-physics-host'

/** A flipper authored as FlipperBuilder authors it: pivot body + offset blade + tip. */
function authorFlipper(world: WasmTableWorld, pivotX: number): PhysicsBody {
  const isRight = pivotX > 0
  const body = world.createRigidBody(api.RigidBodyDesc.dynamic().setTranslation(pivotX, -0.25, -7))
  world.createCollider(api.ColliderDesc.cuboid(1.55, 0.3, 0.25).setTranslation(isRight ? 1.55 : -1.55, 0, 0), body)
  world.createCollider(api.ColliderDesc.ball(0.3).setTranslation(isRight ? 3.2 : -3.2, 0.05, 0), body)
  return body
}

function setup(opts: { owner: boolean; flipperCount: number }) {
  const engine = makeFakeWasmEngine()
  const world = new WasmTableWorld(asSimEngine(engine), { x: 0, y: -9.81, z: -5 })
  const physics = {
    step: vi.fn(() => 1),
    getWorld: () => world,
    getRapier: vi.fn(() => null),
    isWasmActive: () => opts.owner,
    isWasmOwnerMode: () => opts.owner,
    getWasmEngine: () => asSimEngine(engine),
    getWasmTableWorld: () => world,
    getWasmMode: () => (opts.owner ? 'wasm-owner' as const : 'rapier' as const),
    setMirrorOverheadMs: vi.fn(),
    getLastMirrorOverheadMs: () => 0,
    setWasmDebugColliders: vi.fn(),
  }
  const flippers = new Map<string, { body: PhysicsBody }>()
  if (opts.flipperCount > 0) flippers.set('left', { body: authorFlipper(world, -4) })
  if (opts.flipperCount > 1) flippers.set('right', { body: authorFlipper(world, 4) })
  const host = makePhysicsHostShell({
    physics,
    eventBus: new EventBus(),
    ballManager: makeBallManagerStub(),
    gameObjects: makeGameObjectsStub({ getAllFlippers: vi.fn(() => flippers) }),
  })
  return { engine, controller: new GamePhysicsController(host) }
}

describe('GamePhysicsController.getWasmFlipperHingeCount', () => {
  it('is null outside an owner mode: Rapier joints drive the flippers there', () => {
    const { controller } = setup({ owner: false, flipperCount: 2 })
    controller.rebuildHandleCaches()
    expect(controller.getWasmFlipperHingeCount()).toBeNull()
  })

  it('is 0 in an owner mode until rebuildHandleCaches() has realised the hinges', () => {
    const { controller, engine } = setup({ owner: true, flipperCount: 2 })
    expect(controller.getWasmFlipperHingeCount()).toBe(0)

    controller.rebuildHandleCaches()

    expect(engine.createHinge).toHaveBeenCalledTimes(2)
    expect(controller.getWasmFlipperHingeCount()).toBe(2)
  })

  it('reports a table that only got one hinge, which boot treats as a failed critical stage', () => {
    const { controller } = setup({ owner: true, flipperCount: 1 })
    controller.rebuildHandleCaches()
    expect(controller.getWasmFlipperHingeCount()).toBe(1)
  })

  it('does not add hinges when rebuildHandleCaches() runs again after the gameplay build', () => {
    const { controller, engine } = setup({ owner: true, flipperCount: 2 })
    controller.rebuildHandleCaches()
    controller.rebuildHandleCaches()
    expect(engine.createHinge).toHaveBeenCalledTimes(2)
    expect(controller.getWasmFlipperHingeCount()).toBe(2)
  })
})
