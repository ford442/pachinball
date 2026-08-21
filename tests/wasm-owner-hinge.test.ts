import { describe, it, expect, vi } from 'vitest'
import { WasmOwner } from '../src/game/physics/wasm-owner'
import { PhysicsConfig } from '../src/config'
import { PhysicsSystem } from '../src/game-elements/physics'
import type { WasmPhysicsEngine } from '../src/wasm'
import type { InputFrame } from '../src/game-elements/types'

function fakeBody(x: number, colliderX: number, handle: number) {
  return {
    handle,
    translation: () => ({ x, y: -0.25, z: -7 }),
    linvel: () => ({ x: 0, y: 0, z: 0 }),
    collider: () => ({
      translation: () => ({ x: colliderX, y: -0.25, z: -7 }),
    }),
    setEnabled: vi.fn(),
  }
}

function makeEngine() {
  let nextId = 1
  return {
    addStaticPlane: vi.fn(),
    createBody: vi.fn(() => nextId++),
    setBodyRotation: vi.fn(),
    createHinge: vi.fn(() => nextId++),
    setHingeMotor: vi.fn(),
    getHingeAngle: vi.fn(() => 0),
    getAngularVelocity: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
    removeBody: vi.fn(),
    removeHinge: vi.fn(),
    applyImpulse: vi.fn(),
    getPosition: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
    getVelocity: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
    getRotation: vi.fn(() => ({ x: 0, y: 0, z: 0, w: 1 })),
  }
}

describe('WasmOwner native hinges', () => {
  it('creates a world-anchored hinge per flipper instead of a kinematic proxy', () => {
    const engine = makeEngine()
    const owner = new WasmOwner(engine as unknown as WasmPhysicsEngine)
    const left = fakeBody(-4, -5.55, 10)
    const right = fakeBody(4, 5.55, 11)

    owner.rebuild([], [], [], [], [left, right] as never)

    expect(engine.createHinge).toHaveBeenCalledTimes(2)
    const leftCall = engine.createHinge.mock.calls[0][0]
    expect(leftCall.worldAnchor.x).toBe(-4)
    expect(leftCall.worldAxis).toEqual({ x: 0, y: 1, z: 0 })
    expect(leftCall.minAngle).toBe(PhysicsConfig.flipper.leftLimits[0])
    expect(leftCall.maxAngle).toBe(PhysicsConfig.flipper.leftLimits[1])
    expect(left.setEnabled).toHaveBeenCalledWith(false)
    expect(right.setEnabled).toHaveBeenCalledWith(false)
  })

  it('driveFlippers sets a motor from PhysicsConfig rest/active angles', () => {
    const engine = makeEngine()
    const owner = new WasmOwner(engine as unknown as WasmPhysicsEngine)
    owner.rebuild([], [], [], [], [fakeBody(-4, -5.55, 10)] as never)
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

describe('PhysicsSystem wasm-owner Rapier skip', () => {
  it('skips Rapier world.step when ownerSkipRapierStep is set', () => {
    const physics = new PhysicsSystem()
    const wasmStep = vi.fn(() => 0.25)
    Object.assign(physics as unknown as Record<string, unknown>, {
      wasmEngine: { isReady: true, step: wasmStep, getLastWorkerStepMs: () => 0 },
      wasmActive: true,
      wasmMode: 'wasm-owner',
    })
    physics.setOwnerSkipRapierStep(true)
    const callback = vi.fn()
    const alpha = physics.step(1 / 60, callback)
    expect(alpha).toBe(0.25)
    expect(wasmStep).toHaveBeenCalled()
    expect(physics.getLastRapierStepMs()).toBe(0)
    expect(callback).not.toHaveBeenCalled()
  })
})
