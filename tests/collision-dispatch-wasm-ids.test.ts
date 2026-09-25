/**
 * Collision dispatch in WASM public-id space (#412).
 *
 * On the owner path every dispatch set holds WASM public ids: a ball's C++
 * body id, and a static body's first exported collider id. A contact arrives
 * as a pair of WASM ids and resolves collider → body → key in `WasmOwner`,
 * the C++ analogue of Rapier's collider-handle → body-handle conversion that
 * #266 guarded. No Rapier body, handle or world is involved anywhere.
 */

import { describe, expect, it, vi } from 'vitest'
import { EventBus } from '../src/core/event-bus'
import { GamePhysicsController } from '../src/game/game-physics-controller'
import { WASM_PHYSICS_API as api } from '../src/wasm/wasm-physics-api'
import { WasmTableWorld } from '../src/wasm/wasm-table-world'
import type { WasmBody } from '../src/wasm/wasm-body'
import { COLLISION_GROUP_PRESETS } from '../src/game-elements/physics'
import type { BumperVisual } from '../src/game-elements/types'
import { ContactPhase, toWasmContactEvent } from '../src/wasm/contact-buffer'
import type { LaneSensorDef } from '../src/objects/object-lane-sensors'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { asSimEngine, makeFakeWasmEngine } from './helpers/fake-wasm-engine'
import { makeBallManagerStub, makeGameObjectsStub, makePhysicsHostShell } from './helpers/make-physics-host'

function fixedBody(world: WasmTableWorld, x: number, y: number, z: number): WasmBody {
  return world.createRigidBody(api.RigidBodyDesc.fixed().setTranslation(x, y, z))
}

function setup() {
  const engine = makeFakeWasmEngine()
  const world = new WasmTableWorld(asSimEngine(engine), { x: 0, y: -9.81, z: -5 })
  const eventBus = new EventBus()

  // Authored as BumperBuilder does: a solid ball plus a tall hologram sensor on one body.
  const bumper = fixedBody(world, 0, 0.5, 8)
  world.createCollider(api.ColliderDesc.ball(0.4).setCollisionGroups(COLLISION_GROUP_PRESETS.BUMPER), bumper)
  world.createCollider(
    api.ColliderDesc.cylinder(1.5, 0.5).setSensor(true).setTranslation(0, 2, 0).setCollisionGroups(COLLISION_GROUP_PRESETS.SENSOR),
    bumper,
  )
  const laneBody = fixedBody(world, 10.5, 0.5, -4)
  world.createCollider(api.ColliderDesc.cuboid(0.15, 0.4, 1.2).setSensor(true), laneBody)
  const deathZone = fixedBody(world, 0, -2, -14)
  world.createCollider(api.ColliderDesc.cuboid(20, 2, 2).setSensor(true), deathZone)
  const ball = world.createRigidBody(api.RigidBodyDesc.dynamic().setTranslation(0.5, 0.25, 8))
  world.createCollider(api.ColliderDesc.ball(0.25), ball)

  const lane: LaneSensorDef = { id: 'launch-1', kind: 'launch', body: laneBody } as unknown as LaneSensorDef
  const bumperVisual = {
    body: bumper,
    mesh: { position: new Vector3(0, 0.5, 8) },
    hitTime: 0,
    sweep: 0,
  } as unknown as BumperVisual
  const gameObjects = makeGameObjectsStub({
    getBumperBodies: vi.fn(() => [bumper]),
    getBumperVisuals: vi.fn(() => [bumperVisual]),
    getLaneSensors: vi.fn(() => [lane]),
    getDeathZoneBody: vi.fn(() => deathZone),
    getWasmExportBodies: vi.fn(() => world.allBodies().filter((b) => b.isValid())),
  })
  const ballStub: Record<string | symbol, unknown> = {
    ...makeBallManagerStub({
      getBallBodies: vi.fn(() => [ball]),
      getBallBody: vi.fn(() => ball),
    }),
    collectBall: vi.fn(() => null),
  }
  // The drain path touches a long tail of BallManager methods; stub them on demand.
  const ballManager = new Proxy(ballStub, {
    get: (target, key) => (key in target ? target[key] : (target[key] = vi.fn())),
  }) as typeof ballStub & { collectBall: ReturnType<typeof vi.fn> }
  const physics = {
    step: vi.fn(() => 1),
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
  const host = makePhysicsHostShell({ physics, eventBus, ballManager, gameObjects })
  const controller = new GamePhysicsController(host)
  controller.rebuildHandleCaches()

  const contact = (id1: number, id2: number, isSensor = false) => {
    eventBus.emit(
      'wasm:physics:contact',
      toWasmContactEvent({
        bodyId1: id1,
        bodyId2: id2,
        normal: { x: 1, y: 0, z: 0 },
        point: { x: 0, y: 0, z: 0 },
        impulse: 1,
        phase: ContactPhase.Enter,
        isSensor,
      }),
    )
  }
  return { engine, world, eventBus, controller, contact, gameObjects, ballManager, physics, ball, bumper, laneBody, deathZone }
}

describe('collision dispatch keyed on WASM public ids (#412)', () => {
  it('assigns deterministic WASM ids: C++ body id for the ball, first exported collider for statics', () => {
    const { ball, engine } = setup()
    expect(ball.wasmId).toBe(0)
    // Sphere family starts at -8000; sensors at -4000 in export order: bumper hologram, lane, drain.
    expect(engine.addStaticSphere).toHaveBeenCalledTimes(1)
    expect(engine.addSensorVolume).toHaveBeenCalledTimes(3)
  })

  it('scores a bumper from a contact between the ball id and the bumper sphere id', () => {
    const { contact, controller, gameObjects, bumper, physics } = setup()
    contact(0, -8000)
    expect(gameObjects.activateBumperHit).toHaveBeenCalledWith(bumper)
    expect(controller.getBumperMatches()).toBe(1)
    expect(physics.getRapier).not.toHaveBeenCalled()
  })

  it('routes a hit on a secondary collider (the hologram sensor) to its body key', () => {
    const { contact, controller, gameObjects, bumper } = setup()
    // -4000 is the bumper's second collider; it resolves to the bumper (key -8000), not a lane.
    contact(-4000, 0, true)
    expect(gameObjects.activateBumperHit).toHaveBeenCalledWith(bumper)
    expect(controller.getBumperMatches()).toBe(1)
    expect(controller.getLastLaneHit()).toBeNull()
  })

  it('awards a lane rollover keyed on the ball WASM id', () => {
    const { contact, controller, eventBus } = setup()
    const rollovers: Array<{ laneId: string; ballHandle: number }> = []
    eventBus.on('lane:rollover', (e) => rollovers.push(e))
    contact(-4001, 0, true)
    expect(controller.getLastLaneHit()).toBe('launch-1')
    expect(rollovers).toEqual([expect.objectContaining({ laneId: 'launch-1', ballHandle: 0 })])
  })

  it('drains the ball through the death-zone sensor id', () => {
    const { contact, ballManager, ball } = setup()
    contact(0, -4002, true)
    expect(ballManager.collectBall).toHaveBeenCalledWith(ball)
  })

  it('ignores ids that resolve to no exported body', () => {
    const { contact, controller, gameObjects } = setup()
    contact(0, -1234)
    contact(77, -8000)
    expect(gameObjects.activateBumperHit).not.toHaveBeenCalled()
    expect(controller.getRawCollisionEvents()).toBe(0)
  })

  it('dispatches a ball spawned without a rebuildHandleCaches() call', () => {
    const { contact, controller, world, ballManager, gameObjects } = setup()
    const extra = world.createRigidBody(api.RigidBodyDesc.dynamic().setTranslation(1, 0.25, 8))
    world.createCollider(api.ColliderDesc.ball(0.25), extra)
    ;(ballManager.getBallBodies as ReturnType<typeof vi.fn>).mockReturnValue([extra])
    // The spawner forgot to rebuild; the link bumps the id epoch instead.
    contact(extra.wasmId!, -8000)
    expect(gameObjects.activateBumperHit).toHaveBeenCalled()
    expect(controller.getBumperMatches()).toBe(1)
  })

  it('rebuilds its sets when a table edit reassigns static ids', () => {
    const { contact, controller, world, bumper, gameObjects } = setup()
    // Removing the bumper drops its sphere and hologram sensor; the re-export
    // hands the lane sensor -4000 and the drain -4001.
    world.removeRigidBody(bumper)
    controller.stepPhysics(null, null)
    contact(-4000, 0, true)
    expect(controller.getLastLaneHit()).toBe('launch-1')
    expect(gameObjects.activateBumperHit).not.toHaveBeenCalled()
  })
})
