import { describe, it, expect, vi } from 'vitest'
import { WasmOwner } from '../src/game/physics/wasm-owner'
import { WasmTableWorld } from '../src/wasm/wasm-table-world'
import { WASM_PHYSICS_API } from '../src/wasm/wasm-physics-api'
import { PhysicsConfig } from '../src/config'
import { PhysicsSystem } from '../src/game-elements/physics'
import type { InputFrame } from '../src/game-elements/types'
import { asSimEngine, makeFakeWasmEngine } from './helpers/fake-wasm-engine'

/** A flipper authored exactly as FlipperBuilder authors it: pivot body + offset blade + tip. */
function authorFlipper(world: WasmTableWorld, pivotX: number) {
  const api = WASM_PHYSICS_API
  const isRight = pivotX > 0
  const body = world.createRigidBody(
    api.RigidBodyDesc.dynamic().setTranslation(pivotX, -0.25, -7).setLinearDamping(0.5).setAngularDamping(2),
  )
  world.createCollider(api.ColliderDesc.cuboid(1.55, 0.3, 0.25).setTranslation(isRight ? 1.55 : -1.55, 0, 0), body)
  world.createCollider(api.ColliderDesc.ball(0.3).setTranslation(isRight ? 3.2 : -3.2, 0.05, 0), body)
  return body
}

function setup() {
  const engine = makeFakeWasmEngine()
  const world = new WasmTableWorld(asSimEngine(engine), { x: 0, y: -9.81, z: -5 })
  const owner = new WasmOwner(asSimEngine(engine), world)
  return { engine, world, owner }
}

describe('WasmOwner native hinges', () => {
  it('realises each authored flipper as a world-anchored C++ hinge', () => {
    const { engine, world, owner } = setup()
    const left = authorFlipper(world, -4)
    const right = authorFlipper(world, 4)
    // A dynamic flipper's first collider is a box, so the world did not auto-realise it.
    expect(left.wasmId).toBeNull()

    owner.rebuild([left, right])

    expect(engine.createHinge).toHaveBeenCalledTimes(2)
    const leftCall = engine.createHinge.mock.calls[0][0]
    expect(leftCall.worldAnchor).toEqual({ x: -4, y: -0.25, z: -7 })
    expect(leftCall.worldAxis).toEqual({ x: 0, y: 1, z: 0 })
    expect(leftCall.minAngle).toBe(PhysicsConfig.flipper.leftLimits[0])
    expect(leftCall.maxAngle).toBe(PhysicsConfig.flipper.leftLimits[1])
    // The capsule sits on the blade, centred where the blade collider was authored.
    expect(engine.createBody.mock.calls[0][0]).toMatchObject({ position: { x: -5.55, y: -0.25, z: -7 }, shape: 'capsule' })
    expect(left.wasmId).not.toBeNull()
    expect(owner.getDebugColliders().filter((c) => c.kind === 'capsule')).toHaveLength(2)
  })

  it('keeps the authored flipper reporting its pivot and blade frame', () => {
    const { engine, world, owner } = setup()
    const left = authorFlipper(world, -4)
    owner.rebuild([left])
    const id = left.wasmId!

    // The capsule is 3 units off the pivot in C++, but the body reports the pivot, as Rapier did.
    engine.setBodyPosition(id, -5.55, -0.25, -7)
    engine.setAngularVelocity(id, 0, 12, 0)
    engine.step(1 / 60)
    expect(left.translation()).toEqual({ x: -4, y: -0.25, z: -7 })
    expect(left.angvel().y).toBe(12)
    // C++ capsule axis rotated back onto the blade: identity once the capsule is at its authored rotation.
    const r = left.rotation()
    expect(r.w).toBeCloseTo(1, 6)
    expect(r.z).toBeCloseTo(0, 6)
  })

  it('removes the hinge and C++ body when the flipper body is removed', () => {
    const { engine, world, owner } = setup()
    const left = authorFlipper(world, -4)
    owner.rebuild([left])
    const id = left.wasmId!
    world.removeRigidBody(left)
    expect(engine.removeHinge).toHaveBeenCalledTimes(1)
    expect(engine.removeBody).toHaveBeenCalledWith(id)
  })

  it('driveFlippers sets a motor from PhysicsConfig rest/active angles', () => {
    const { engine, world, owner } = setup()
    owner.rebuild([authorFlipper(world, -4)])
    engine.setHingeMotor.mockClear()

    const frame: InputFrame = {
      flipperLeft: true,
      flipperRight: null,
      plunger: false,
      nudge: null,
      timestamp: 0,
    }
    owner.driveFlippers(frame, 1 / 60)
    expect(engine.setHingeMotor).toHaveBeenCalled()
    const [, targetVel, maxTorque] = engine.setHingeMotor.mock.calls[0]
    expect(targetVel).not.toBe(0)
    expect(maxTorque).toBeGreaterThan(1000)
  })
})

describe('PhysicsSystem owner-mode stepping', () => {
  it('steps only the C++ world — there is no Rapier to step', () => {
    const physics = new PhysicsSystem()
    const wasmStep = vi.fn(() => 0.25)
    Object.assign(physics as unknown as Record<string, unknown>, {
      wasmEngine: { isReady: true, step: wasmStep, getLastWorkerStepMs: () => 0 },
      wasmActive: true,
      wasmMode: 'wasm-owner',
    })
    const callback = vi.fn()
    const alpha = physics.step(1 / 60, callback)
    expect(alpha).toBe(0.25)
    expect(wasmStep).toHaveBeenCalled()
    expect(physics.getLastRapierStepMs()).toBe(0)
    expect(physics.getRapier()).toBeNull()
    expect(physics.getRapierWorld()).toBeNull()
    expect(callback).not.toHaveBeenCalled()
  })
})
