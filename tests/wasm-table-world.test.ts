/**
 * WasmTableWorld / WasmBody / descriptor export (#412): authoring the table
 * through WASM_PHYSICS_API records Rapier-equivalent descriptors, realises
 * balls in C++ at birth, and exports every other collider from its
 * descriptor — reporting what C++ cannot represent instead of dropping it.
 */

import { describe, expect, it } from 'vitest'
import { PhysicsBodyType, type PhysicsApi } from '../src/core/physics-api'
import { COLLISION_GROUP_PRESETS, CollisionGroups } from '../src/game-elements/physics'
import { WASM_PHYSICS_API as api, WasmColliderDesc } from '../src/wasm/wasm-physics-api'
import { WasmTableWorld } from '../src/wasm/wasm-table-world'
import { exportTableBodiesToWasm } from '../src/game/physics/wasm-static-export'
import { asSimEngine, makeFakeWasmEngine } from './helpers/fake-wasm-engine'

function setup() {
  const engine = makeFakeWasmEngine()
  const world = new WasmTableWorld(asSimEngine(engine), { x: 0, y: -9.81, z: -5 })
  return { engine, world }
}

function spawnBall(world: WasmTableWorld, x = 0, y = 0.25, z = 0) {
  const ball = world.createRigidBody(api.RigidBodyDesc.dynamic().setTranslation(x, y, z).setLinearDamping(0.1))
  world.createCollider(
    api.ColliderDesc.ball(0.25).setRestitution(0.76).setFriction(0.14).setDensity(1 / ((4 / 3) * Math.PI * 0.25 ** 3))
      .setCollisionGroups(COLLISION_GROUP_PRESETS.BALL),
    ball,
  )
  return ball
}

describe('WASM_PHYSICS_API descriptors', () => {
  it('records Rapier ColliderDesc defaults for anything a builder leaves unset', () => {
    const desc = (api.ColliderDesc.cuboid(1, 2, 3) as WasmColliderDesc).desc
    expect(desc).toMatchObject({
      shape: { kind: 'box', halfExtents: { x: 1, y: 2, z: 3 } },
      friction: 0.5,
      restitution: 0,
      density: 1,
      sensor: false,
      collisionGroups: 0xffffffff,
    })
  })

  it('shares Rapier enum values so builders can pass either namespace', () => {
    const shape: Pick<PhysicsApi, 'RigidBodyType' | 'ActiveEvents'> = api
    expect(shape.RigidBodyType).toEqual({ Dynamic: 0, Fixed: 1, KinematicPositionBased: 2, KinematicVelocityBased: 3 })
    expect(shape.ActiveEvents.COLLISION_EVENTS | shape.ActiveEvents.CONTACT_FORCE_EVENTS).toBe(3)
  })
})

describe('WasmTableWorld balls', () => {
  it('creates the C++ body the moment a dynamic sphere collider is attached', () => {
    const { engine, world } = setup()
    const ball = spawnBall(world, 10.5, 0.5, -9)
    expect(engine.createBody).toHaveBeenCalledWith(expect.objectContaining({
      position: { x: 10.5, y: 0.5, z: -9 },
      radius: 0.25,
      restitution: 0.76,
      friction: 0.14,
      linearDamping: 0.1,
      bodyType: 0,
    }))
    expect((engine.createBody.mock.calls[0][0] as { mass: number }).mass).toBeCloseTo(1, 6)
    expect(ball.wasmId).toBe(0)
    expect(world.bodyForLinkedId(0)).toBe(ball)
    // The ball keeps C++'s all-groups default (see WasmBody.applyLinkedCollisionGroups).
    expect(engine.setCollisionGroups).not.toHaveBeenCalled()
  })

  it('forwards writes to C++ and reads back what was written before the next step', () => {
    const { engine, world } = setup()
    const ball = spawnBall(world)
    ball.setTranslation({ x: 1, y: 2, z: 3 }, true)
    ball.setLinvel({ x: 0, y: 0, z: 4 }, true)
    ball.applyImpulse({ x: 0, y: 0, z: 2.5 }, true)
    expect(engine.setBodyPosition).toHaveBeenCalledWith(0, 1, 2, 3)
    expect(engine.applyImpulse).toHaveBeenCalledWith(0, 0, 0, 2.5)
    expect(ball.translation()).toEqual({ x: 1, y: 2, z: 3 })
    // Like Rapier (and C++ itself), an impulse shows in the velocity at once — before any step.
    expect(ball.linvel().z).toBeCloseTo(6.5, 6)
    engine.step(1)
    expect(ball.translation()).toEqual({ x: 1, y: 2, z: 9.5 })
  })

  it('holds a ball a toy made kinematic and releases it on Dynamic', () => {
    const { engine, world } = setup()
    const ball = spawnBall(world)
    ball.setLinvel({ x: 3, y: 0, z: 0 }, true)
    ball.setBodyType(PhysicsBodyType.KinematicPositionBased, true)
    expect(ball.isKinematic()).toBe(true)
    ball.setNextKinematicTranslation({ x: 4.5, y: 1, z: 15 })
    ball.applyImpulse({ x: 9, y: 9, z: 9 }, true)
    expect(engine.applyImpulse).not.toHaveBeenCalled()

    world.beginStep()
    engine.step(1 / 60)
    expect(ball.translation()).toEqual({ x: 4.5, y: 1, z: 15 })
    expect(ball.linvel()).toEqual({ x: 0, y: 0, z: 0 })

    ball.setBodyType(PhysicsBodyType.Dynamic, true)
    ball.applyImpulse({ x: 0, y: 0, z: 1 }, true)
    expect(engine.applyImpulse).toHaveBeenCalledWith(0, 0, 0, 1)
  })

  it('takes a disabled ball out of every collision group and restores it', () => {
    const { engine, world } = setup()
    const ball = spawnBall(world)
    ball.setEnabled(false)
    expect(engine.setCollisionGroups).toHaveBeenLastCalledWith(0, 0, 0)
    ball.setEnabled(true)
    expect(engine.setCollisionGroups).toHaveBeenLastCalledWith(0, 0xffffffff, 0xffffffff)
    // A chroma-style group word stays on the collider but does not reach C++.
    ball.collider(0).setCollisionGroups((0x0001 << 16) | 0x0201)
    expect(engine.setCollisionGroups).toHaveBeenCalledTimes(2)
  })

  it('removes the C++ body with the ball', () => {
    const { engine, world } = setup()
    const ball = spawnBall(world)
    world.removeRigidBody(ball)
    expect(engine.removeBody).toHaveBeenCalledWith(0)
    expect(ball.isValid()).toBe(false)
    expect(world.getRigidBody(ball.handle)).toBeNull()
  })
})

describe('WasmTableWorld pose stores', () => {
  it('commits a kinematic target after the step, as Rapier does', () => {
    const { world } = setup()
    const gate = world.createRigidBody(api.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 0.5, 16))
    world.createCollider(api.ColliderDesc.cuboid(1, 0.5, 0.1), gate)
    gate.setNextKinematicTranslation({ x: 2, y: 0.5, z: 16 })
    expect(gate.nextTranslation()).toEqual({ x: 2, y: 0.5, z: 16 })
    expect(gate.translation()).toEqual({ x: 0, y: 0.5, z: 16 })
    world.endStep()
    expect(gate.translation()).toEqual({ x: 2, y: 0.5, z: 16 })
  })

  it('bumps the structure revision for static edits but not for ball traffic', () => {
    const { world } = setup()
    const start = world.structureRevision
    spawnBall(world)
    expect(world.structureRevision).toBe(start)
    const wall = world.createRigidBody(api.RigidBodyDesc.fixed())
    world.createCollider(api.ColliderDesc.cuboid(1, 1, 1), wall)
    expect(world.structureRevision).toBe(start + 1)
    world.removeRigidBody(wall)
    expect(world.structureRevision).toBe(start + 2)
  })

  it('answers intersectionPair analytically for a ball against a sensor', () => {
    const { world } = setup()
    const sensorBody = world.createRigidBody(api.RigidBodyDesc.fixed().setTranslation(-11.5, 0.5, 14))
    const sensor = world.createCollider(api.ColliderDesc.ball(1.2).setSensor(true), sensorBody)
    const ball = spawnBall(world, -11.5, 0.5, 15)
    expect(world.intersectionPair(sensor, ball.collider(0))).toBe(true)
    ball.setTranslation({ x: -11.5, y: 0.5, z: 20 }, true)
    expect(world.intersectionPair(sensor, ball.collider(0))).toBe(false)
  })

  it('refuses a Rapier descriptor instead of silently mixing engines', () => {
    const { world } = setup()
    expect(() => world.createRigidBody({} as never)).toThrow(/WASM_PHYSICS_API/)
  })
})

describe('exportTableBodiesToWasm', () => {
  it('exports each authored shape to its C++ equivalent with its material and groups', () => {
    const { engine, world } = setup()
    const wall = world.createRigidBody(api.RigidBodyDesc.fixed().setTranslation(0, 1, 5))
    world.createCollider(api.ColliderDesc.cuboid(10, 1, 0.5).setRestitution(0.3).setFriction(0.2)
      .setCollisionGroups(COLLISION_GROUP_PRESETS.WALL), wall)
    const pin = world.createRigidBody(api.RigidBodyDesc.fixed().setTranslation(2, 0.4, 12))
    world.createCollider(api.ColliderDesc.cylinder(0.75, 0.09), pin)
    const rail = world.createRigidBody(api.RigidBodyDesc.fixed())
    world.createCollider(api.ColliderDesc.capsule(1, 0.1).setTranslation(3, 0, 0), rail)
    const lane = world.createRigidBody(api.RigidBodyDesc.fixed().setTranslation(10.5, 0.5, -4))
    world.createCollider(api.ColliderDesc.cuboid(0.15, 0.4, 1.2).setSensor(true), lane)
    const plunger = world.createRigidBody(api.RigidBodyDesc.kinematicPositionBased().setTranslation(10.5, 0.5, -9.8))
    world.createCollider(api.ColliderDesc.cuboid(0.3, 0.3, 0.4), plunger)

    const result = exportTableBodiesToWasm(world.allBodies(), asSimEngine(engine))

    expect(engine.addStaticBox).toHaveBeenCalledWith({ x: 0, y: 1, z: 5 }, { x: 10, y: 1, z: 0.5 }, { x: 0, y: 0, z: 0, w: 1 }, 0.3, 0.2)
    expect(engine.setCollisionGroups).toHaveBeenCalledWith(-1000, CollisionGroups.WALL, CollisionGroups.BALL)
    // Cylinders used to be dropped silently by the Rapier-reading exporter.
    expect(engine.addStaticCylinder).toHaveBeenCalledWith({ x: 2, y: 0.4, z: 12 }, 0.09, 0.75, { x: 0, y: 0, z: 0, w: 1 }, 0, 0.5)
    expect(engine.addStaticCapsule).toHaveBeenCalledWith({ x: 3, y: 0, z: 0 }, 0.1, 1, { x: 0, y: 0, z: 0, w: 1 }, 0, 0.5)
    expect(engine.addSensorVolume).toHaveBeenCalledWith({ x: 10.5, y: 0.5, z: -4 }, { x: 0.15, y: 0.4, z: 1.2 }, { x: 0, y: 0, z: 0, w: 1 }, 0)
    expect(result.movers).toEqual([expect.objectContaining({ moverId: -3000, body: plunger })])
    expect(result.idsByBody.get(wall)).toEqual([-1000])
    expect(result.bodyById.get(-4000)).toBe(lane)
    expect(result.unsupported).toEqual([])
  })

  it('reports what C++ cannot represent instead of dropping it', () => {
    const { engine, world } = setup()
    const trap = world.createRigidBody(api.RigidBodyDesc.fixed().setTranslation(-5, 0.5, 10))
    world.createCollider(api.ColliderDesc.cone(0.4, 0.6), trap)
    world.createCollider(api.ColliderDesc.ball(0.45).setSensor(true), trap)
    const result = exportTableBodiesToWasm(world.allBodies(), asSimEngine(engine))
    expect(result.unsupported).toEqual([
      { bodyHandle: trap.handle, colliderIndex: 0, shape: 'cone', reason: 'the C++ world has no cone shape' },
    ])
    // The sensor on the same body still exports.
    expect(result.idsByBody.get(trap)).toEqual([-4000])
  })

  it('hands every collider the same WASM id on a re-export', () => {
    const { engine, world } = setup()
    for (let i = 0; i < 3; i++) {
      const b = world.createRigidBody(api.RigidBodyDesc.fixed().setTranslation(i, 0, 0))
      world.createCollider(api.ColliderDesc.cuboid(1, 1, 1), b)
    }
    const first = exportTableBodiesToWasm(world.allBodies(), asSimEngine(engine))
    engine.clearStaticGeometry()
    const second = exportTableBodiesToWasm(world.allBodies(), asSimEngine(engine))
    expect([...second.bodyById.keys()]).toEqual([...first.bodyById.keys()])
  })
})
