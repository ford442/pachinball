import { describe, it, expect, vi } from 'vitest'
import {
  CONTACT_STRIDE,
  decodeContactBuffer,
  encodeContactBuffer,
  ContactPhase,
} from '../src/wasm/contact-buffer'
import {
  TRANSFORM_STRIDE,
  decodeTransformSlot,
  encodeTransformBuffer,
  type WasmTransform,
} from '../src/wasm/transform-buffer'
import {
  WasmIdShadow,
  STATIC_BOX_ID_BASE,
  STATIC_CAPSULE_ID_BASE,
  cloneFloat32Array,
  encodeHingeAngleBuffer,
  decodeHingeAngle,
  type PhysicsWorkerCommand,
} from '../src/wasm/physics-worker-protocol'
import {
  applyPhysicsCommand,
  collectStepSnapshot,
  createWorkerRuntimeState,
} from '../src/wasm/physics-worker-runtime'
import { PhysicsWorkerClient } from '../src/wasm/physics-worker-client'
import { EventBus } from '../src/core/event-bus'

function identityTransform(id: number, px: number): WasmTransform {
  return {
    id,
    position: { x: px, y: 1, z: 2 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    velocity: { x: 0.1, y: 0, z: 0 },
    angularVelocity: { x: 0, y: 0.2, z: 0 },
    active: true,
  }
}

function makeMockEngine() {
  let nextBody = 0
  let nextHinge = 0
  let nextBox = 0
  let nextCapsule = 0
  const bodies: number[] = []
  const hinges = new Map<number, number>()
  let stepCount = 0
  const transform = encodeTransformBuffer([
    { id: 0, transform: identityTransform(0, 3) },
    { id: 1, transform: identityTransform(1, 9) },
  ])
  const contacts = encodeContactBuffer([
    {
      bodyId1: 0,
      bodyId2: 1,
      normal: { x: 0, y: 1, z: 0 },
      point: { x: 1, y: 2, z: 3 },
      impulse: 4,
      phase: ContactPhase.Enter,
    },
  ])

  return {
    setGravity: vi.fn(),
    setRollingResistance: vi.fn(),
    addStaticPlane: vi.fn(),
    addStaticBox: vi.fn(() => STATIC_BOX_ID_BASE - nextBox++),
    addStaticCapsule: vi.fn(() => STATIC_CAPSULE_ID_BASE - nextCapsule++),
    createBody: vi.fn(() => {
      const id = nextBody++
      bodies.push(id)
      return id
    }),
    removeBody: vi.fn(),
    applyForce: vi.fn(),
    applyImpulse: vi.fn(),
    setVelocity: vi.fn(),
    setAngularVelocity: vi.fn(),
    setBodyPosition: vi.fn(),
    setBodyRotation: vi.fn(),
    createHinge: vi.fn((desc: { bodyId: number }) => {
      if (desc.bodyId < 0) return -1
      const id = nextHinge++
      hinges.set(id, 0.25)
      return id
    }),
    setHingeMotor: vi.fn(),
    getHingeAngle: vi.fn((id: number) => hinges.get(id) ?? 0),
    removeHinge: vi.fn((id: number) => { hinges.delete(id) }),
    step: vi.fn((_dt: number) => {
      stepCount++
      return 0.4
    }),
    dispose: vi.fn(),
    getStepCount: () => stepCount,
    copyTransformBuffer: () => cloneFloat32Array(transform),
    copyContactBuffer: () => ({ buffer: cloneFloat32Array(contacts), count: 1 }),
    bodies,
  }
}

describe('physics worker protocol', () => {
  it('JSON round-trips command payloads', () => {
    const cmds: PhysicsWorkerCommand[] = [
      { type: 'setGravity', x: 0, y: -9.81, z: -5 },
      { type: 'createBody', desc: { mass: 1, radius: 0.25 } },
      { type: 'createHinge', desc: { bodyId: 0, worldAnchor: { x: 1, y: 2, z: 3 } } },
      { type: 'step', rawDt: 1 / 60 },
    ]
    expect(JSON.parse(JSON.stringify(cmds))).toEqual(cmds)
  })

  it('shadow body/hinge/static ids match sequential C++ allocation', () => {
    const shadow = new WasmIdShadow()
    const engine = makeMockEngine()
    expect(shadow.allocBody()).toBe(engine.createBody())
    expect(shadow.allocBody()).toBe(engine.createBody())
    expect(shadow.allocHinge()).toBe(engine.createHinge({ bodyId: 0 }))
    expect(shadow.allocStaticBox()).toBe(engine.addStaticBox())
    expect(shadow.allocStaticCapsule()).toBe(engine.addStaticCapsule())
    expect(shadow.allocStaticBox()).toBe(STATIC_BOX_ID_BASE - 1)
  })

  it('does not reuse body ids after remove', () => {
    const shadow = new WasmIdShadow()
    expect(shadow.allocBody()).toBe(0)
    expect(shadow.allocBody()).toBe(1)
    expect(shadow.allocBody()).toBe(2)
  })

  it('STEP_RESULT transform/contact buffers round-trip codecs', () => {
    const packed = encodeTransformBuffer([{ id: 2, transform: identityTransform(2, 5) }])
    const slot = decodeTransformSlot(packed, 2, TRANSFORM_STRIDE)
    expect(slot?.position.x).toBe(5)
    expect(slot?.velocity.x).toBeCloseTo(0.1, 5)

    const contacts = encodeContactBuffer([
      {
        bodyId1: 2,
        bodyId2: -1000,
        normal: { x: 1, y: 0, z: 0 },
        point: { x: 0, y: 1, z: 0 },
        impulse: 8,
        phase: ContactPhase.Stay,
      },
    ])
    const decoded = decodeContactBuffer(contacts, 1, CONTACT_STRIDE)
    expect(decoded[0].bodyId1).toBe(2)
    expect(decoded[0].phase).toBe(ContactPhase.Stay)

    const cloned = new Float32Array(cloneFloat32Array(packed))
    expect(decodeTransformSlot(cloned, 2)?.position.x).toBe(5)

    const hingeBuf = new Float32Array(encodeHingeAngleBuffer([{ id: 3, angle: 0.5 }]))
    expect(decodeHingeAngle(hingeBuf, 3)).toBe(0.5)
    expect(decodeHingeAngle(hingeBuf, 9)).toBe(0)
  })
})

describe('physics worker in-process loopback', () => {
  it('applies queued commands and publishes a delayed snapshot', () => {
    const engine = makeMockEngine()
    const runtime = createWorkerRuntimeState()
    const client = new PhysicsWorkerClient()
    const bus = new EventBus()
    const contacts: unknown[] = []
    bus.on('wasm:physics:contact', (e) => { contacts.push(e) })
    client.init(bus)
    let pending: {
      type: 'step-result'
      alpha: number
      stepCount: number
      stepMs: number
      transformBuffer: ArrayBuffer
      contactBuffer: ArrayBuffer
      contactCount: number
      hingeBuffer: ArrayBuffer
    } | null = null
    client.attachLoopback((commands) => {
      if (pending) {
        client.applyStepResult(pending)
        pending = null
      }
      let alpha = 0
      let stepped = false
      for (const cmd of commands) {
        const result = applyPhysicsCommand(engine, cmd, runtime)
        if (cmd.type === 'step') {
          alpha = result
          stepped = true
        }
      }
      if (!stepped) return
      pending = { type: 'step-result', ...collectStepSnapshot(engine, runtime, alpha, 1.25) }
    })

    const bodyId = client.createBody({ mass: 1 })
    const hingeId = client.createHinge({ bodyId, worldAnchor: { x: 0, y: 0, z: 0 } })
    expect(bodyId).toBe(0)
    expect(hingeId).toBe(0)
    expect(engine.createBody).toHaveBeenCalledTimes(0)

    const firstAlpha = client.step(1 / 60)
    expect(firstAlpha).toBe(0)
    expect(engine.createBody).toHaveBeenCalledTimes(1)
    expect(engine.createHinge).toHaveBeenCalledTimes(1)
    expect(engine.step).toHaveBeenCalledWith(1 / 60)
    expect(client.hasTransformSnapshot()).toBe(false)

    const secondAlpha = client.step(1 / 30)
    expect(secondAlpha).toBe(0.4)
    expect(client.hasTransformSnapshot()).toBe(true)
    expect(client.getLastWorkerStepMs()).toBe(1.25)
    expect(client.getPosition(0).x).toBe(3)
    expect(client.getHingeAngle(0)).toBe(0.25)
    expect(contacts).toHaveLength(1)
  })
})
