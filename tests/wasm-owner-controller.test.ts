/**
 * GamePhysicsController on the owner path (#412): the C++ world is the whole
 * simulation. Around each step the controller pins held balls, pushes table
 * kinematic bodies into their C++ movers and commits their poses — without a
 * Rapier module or world anywhere, adventure running or not.
 */

import { describe, expect, it, vi } from 'vitest'
import { GamePhysicsController } from '../src/game/game-physics-controller'
import { EventBus } from '../src/core/event-bus'
import { PhysicsBodyType, type PhysicsBody } from '../src/core/physics-api'
import { WasmTableWorld } from '../src/wasm/wasm-table-world'
import { WASM_PHYSICS_API as api } from '../src/wasm/wasm-physics-api'
import { asSimEngine, makeFakeWasmEngine } from './helpers/fake-wasm-engine'
import { makeBallManagerStub, makeGameObjectsStub, makePhysicsHostShell } from './helpers/make-physics-host'

function setup(opts: { adventureActive?: boolean } = {}) {
  const engine = makeFakeWasmEngine()
  const world = new WasmTableWorld(asSimEngine(engine), { x: 0, y: -9.81, z: -5 })
  const physics = {
    step: vi.fn((dt: number) => {
      engine.step(dt)
      return 1
    }),
    getWorld: () => world,
    getRapier: vi.fn(() => null),
    isWasmActive: () => true,
    isWasmOwnerMode: () => true,
    getWasmEngine: () => asSimEngine(engine),
    getWasmTableWorld: () => world,
    getWasmMode: () => 'wasm-owner' as const,
    setMirrorOverheadMs: vi.fn(),
    getLastMirrorOverheadMs: () => 0,
    setWasmDebugColliders: vi.fn(),
  }

  const plunger = world.createRigidBody(api.RigidBodyDesc.kinematicPositionBased().setTranslation(10.5, 0.5, -9.8))
  world.createCollider(api.ColliderDesc.cuboid(0.3, 0.3, 0.4), plunger)
  const ball = world.createRigidBody(api.RigidBodyDesc.dynamic().setTranslation(0, 0.25, 0))
  world.createCollider(api.ColliderDesc.ball(0.25), ball)

  const scope: PhysicsBody[] = [plunger]
  const host = makePhysicsHostShell({
    physics,
    eventBus: new EventBus(),
    ballManager: makeBallManagerStub({ getBallBodies: vi.fn(() => [ball]) }),
    gameObjects: makeGameObjectsStub({ getWasmExportBodies: vi.fn(() => scope) }),
  })
  if (opts.adventureActive) {
    Object.assign(host as unknown as Record<string, unknown>, {
      adventureMode: {
        isActive: () => true,
        update: vi.fn(),
        setPhysicsBridge: vi.fn(),
        getColliderEpoch: () => 1,
        getColliderDescriptors: () => [],
        getUnexportedColliders: () => [],
        getBodyForDescriptor: () => null,
        getSensor: () => null,
      },
    })
  }
  const controller = new GamePhysicsController(host)
  controller.rebuildHandleCaches()
  return { engine, world, physics, controller, plunger, ball }
}

describe('owner-mode stepping without Rapier', () => {
  it('pushes a table kinematic body into its C++ mover before the step and commits it after', () => {
    const { engine, physics, controller, plunger } = setup()
    expect(engine.addKinematicMover).toHaveBeenCalledTimes(1)

    plunger.setNextKinematicTranslation({ x: 10.5, y: 0.5, z: -9 })
    controller.stepPhysics(null, null)

    expect(engine.setNextKinematicTransform).toHaveBeenCalledWith(-3000, { x: 10.5, y: 0.5, z: -9 }, { x: 0, y: 0, z: 0, w: 1 })
    const moverCall = engine.setNextKinematicTransform.mock.invocationCallOrder[0]
    expect(moverCall).toBeLessThan(engine.step.mock.invocationCallOrder[0])
    // Rapier semantics: after the step the kinematic body sits at its target.
    expect(plunger.translation()).toEqual({ x: 10.5, y: 0.5, z: -9 })
    expect(physics.getRapier).not.toHaveBeenCalled()
  })

  it('pins a ball a toy holds kinematic before every step', () => {
    const { engine, controller, ball } = setup()
    ball.setBodyType(PhysicsBodyType.KinematicPositionBased, true)
    ball.setNextKinematicTranslation({ x: 1, y: 2, z: 3 })
    engine.setVelocity(ball.wasmId!, 5, 0, 0) // a stray write while held
    engine.setBodyPosition.mockClear()

    controller.stepPhysics(null, null)

    expect(engine.setBodyPosition).toHaveBeenCalledWith(ball.wasmId, 1, 2, 3)
    expect(engine.setBodyPosition.mock.invocationCallOrder[0]).toBeLessThan(engine.step.mock.invocationCallOrder[0])
    expect(ball.translation()).toEqual({ x: 1, y: 2, z: 3 })
    expect(ball.linvel()).toEqual({ x: 0, y: 0, z: 0 })
  })

  it('steps an adventure track with no Rapier world either', () => {
    const { physics, controller } = setup({ adventureActive: true })
    controller.stepPhysics(null, null)
    expect(physics.step).toHaveBeenCalled()
    expect(physics.getRapier).not.toHaveBeenCalled()
  })
})
