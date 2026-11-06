/**
 * #503 A3 — one contact handler that throws must not drop the rest of that step's contacts, on
 * either contact path: the WASM batch (`'wasm:physics:contacts'` → `onWasmContactBatch`) and the
 * Rapier drain (the callbacks `PhysicsSystem.step` drains collision events into). Each throw is
 * reported to the host as a physics-phase sim fault.
 */
import { describe, expect, it, vi } from 'vitest'
import { EventBus } from '../src/core/event-bus'
import { GamePhysicsController } from '../src/game/physics/physics-controller'
import type { CollisionDispatcher } from '../src/game/physics/collision-dispatch'
import type { SimFaultReport } from '../src/core/fault-window'
import { CONTACT_STRIDE, ContactPhase, encodeContactBuffer, toWasmContactEvent } from '../src/wasm/contact-buffer'
import { makeBallManagerStub, makeGameObjectsStub, makePhysicsHostShell } from './helpers/make-physics-host'

vi.mock('../src/boot-log', () => ({ bootError: vi.fn(), bootWarn: vi.fn() }))

function table(drain: Array<[number, number]> = []) {
  const eventBus = new EventBus()
  const physics = {
    // As PhysicsSystem.stepRapier: every drained event goes to the collision callback.
    step: vi.fn((_dt: number, onCollision: (a: number, b: number, started: boolean) => void, onForce: (a: number, b: number, f: number) => void) => {
      for (const [a, b] of drain) onCollision(a, b, true)
      for (const [a, b] of drain) onForce(a, b, 10)
      return 0
    }),
    getStepCount: () => 0,
    getWorld: () => null,
    isWasmActive: () => false,
    isWasmOwnerMode: () => false,
  }
  const faults: SimFaultReport[] = []
  const host = Object.assign(
    makePhysicsHostShell({ physics, eventBus, ballManager: makeBallManagerStub(), gameObjects: makeGameObjectsStub() }),
    { onSimFault: (f: SimFaultReport) => faults.push(f) },
  )
  const controller = new GamePhysicsController(host)
  const dispatcher = (controller as unknown as { collisionDispatcher: CollisionDispatcher }).collisionDispatcher
  return { eventBus, controller, dispatcher, faults }
}

/** A spy that throws on its first call and records every call. */
function throwsFirst() {
  return vi.fn((..._args: unknown[]) => {
    if (throwsFirst.calls++ === 0) throw new Error('bad contact')
  })
}
throwsFirst.calls = 0

const enter = (bodyId1: number, bodyId2: number) => toWasmContactEvent({
  bodyId1, bodyId2, normal: { x: 0, y: 1, z: 0 }, point: { x: 0, y: 0, z: 0 }, impulse: 1, phase: ContactPhase.Enter, isSensor: false,
})

describe('per-contact fault isolation (#503 A3)', () => {
  it('WASM batch: a throw on contact 0 still dispatches contacts 1 and 2, and reports one sim fault', () => {
    const { eventBus, dispatcher, faults } = table()
    throwsFirst.calls = 0
    const spy = throwsFirst()
    ;(dispatcher as unknown as { dispatchWasmPair: typeof spy }).dispatchWasmPair = spy
    const bus = vi.fn()
    eventBus.on('handler:quarantined', bus)

    eventBus.emit('wasm:physics:contacts', {
      data: encodeContactBuffer([enter(0, -8000), enter(0, -8001), enter(0, -8002)]),
      count: 3,
      stride: CONTACT_STRIDE,
    })

    expect(spy.mock.calls.map((c) => c[1])).toEqual([-8000, -8001, -8002])
    expect(faults).toEqual([{ phase: 'physics', name: 'contact', message: 'bad contact' }])
    // The batch subscriber itself never threw: the bus did not count a strike against it.
    expect(bus).not.toHaveBeenCalled()
  })

  it('Rapier drain: a throw on the first event still processes the rest of the step', () => {
    const { controller, dispatcher, faults } = table([[1, 2], [3, 4], [5, 6]])
    throwsFirst.calls = 0
    const collisions = throwsFirst()
    const forces = vi.fn((..._args: unknown[]) => { throw new Error('bad force') })
    ;(dispatcher as unknown as { processCollision: typeof collisions }).processCollision = collisions
    ;(dispatcher as unknown as { processContactForce: typeof forces }).processContactForce = forces
    const actions = { handleFlipperLeft: () => {}, handleFlipperRight: () => {}, handlePlunger: () => true }

    expect(() => controller.stepFixed(null, actions, null, null)).not.toThrow()

    expect(collisions.mock.calls.map((c) => c[0])).toEqual([1, 3, 5])
    expect(forces).toHaveBeenCalledTimes(3)
    expect(faults.map((f) => f.message)).toEqual(['bad contact', 'bad force', 'bad force', 'bad force'])
  })
})
