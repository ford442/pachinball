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
  STATIC_CYLINDER_ID_BASE,
  STATIC_SPHERE_ID_BASE,
  STATIC_CONE_ID_BASE,
  STATIC_HANDLE_CAPACITY,
  STATIC_HANDLE_OVERFLOW,
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
import { WasmSnapshotStatus } from '../src/wasm/wasm-types'
import { fakeSnapshot } from './helpers/fake-snapshot'

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
  let nextCone = 0
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
    addStaticCone: vi.fn(() => STATIC_CONE_ID_BASE - nextCone++),
    setNextKinematicTransform: vi.fn(),
    setBodyType: vi.fn(),
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

describe('physics worker capture (#420)', () => {
  it('carries a capture → steer → release sequence to the worker engine in order', () => {
    const engine = makeMockEngine()
    const runtime = createWorkerRuntimeState()
    const client = new PhysicsWorkerClient()
    const order: string[] = []
    client.attachLoopback((commands) => {
      for (const cmd of commands) {
        order.push(cmd.type)
        applyPhysicsCommand(engine, cmd, runtime)
      }
    })

    const ball = client.createBody({ mass: 1, radius: 0.25 })
    const cone = client.addStaticCone({ x: -5, y: 0.5, z: 10 }, 0.2, 0.6)
    expect(cone).toBe(STATIC_CONE_ID_BASE)

    client.setBodyType(ball, 2)
    client.setNextKinematicTransform(ball, { x: 1, y: 2, z: 3 }, { x: 0, y: 0, z: 0, w: 1 })
    client.setBodyType(ball, 0)
    client.applyImpulse(ball, 0, 0, 4)
    client.step(1 / 60)

    expect(order).toEqual([
      'createBody', 'addStaticCone', 'setBodyType', 'setNextKinematicTransform', 'setBodyType', 'applyImpulse', 'step',
    ])
    expect(engine.addStaticCone).toHaveBeenCalledWith({ x: -5, y: 0.5, z: 10 }, 0.2, 0.6, { x: 0, y: 0, z: 0, w: 1 }, 0.4, 0.2)
    expect(engine.setBodyType).toHaveBeenNthCalledWith(1, ball, 2)
    expect(engine.setNextKinematicTransform).toHaveBeenCalledWith(ball, { x: 1, y: 2, z: 3 }, { x: 0, y: 0, z: 0, w: 1 })
    expect(engine.setBodyType).toHaveBeenNthCalledWith(2, ball, 0)
  })

  it('shadows cone handles like native: own family, capacity, reset', () => {
    const ids = new WasmIdShadow()
    expect(ids.allocStaticCone()).toBe(STATIC_CONE_ID_BASE)
    expect(ids.allocStaticSphere()).toBe(STATIC_SPHERE_ID_BASE)
    expect(ids.allocStaticCone()).toBe(STATIC_CONE_ID_BASE - 1)
    for (let i = 2; i < STATIC_HANDLE_CAPACITY; i++) ids.allocStaticCone()
    expect(ids.allocStaticCone()).toBe(STATIC_HANDLE_OVERFLOW)
    ids.resetStaticHandles()
    expect(ids.allocStaticCone()).toBe(STATIC_CONE_ID_BASE)
  })
})

describe('static handle capacity', () => {
  it('refuses a family past STATIC_HANDLE_CAPACITY instead of aliasing the next one', () => {
    const ids = new WasmIdShadow()

    // The families are 1000 apart, so the 1001st cylinder would otherwise be
    // handed STATIC_CYLINDER_ID_BASE - 1000 === STATIC_MESH_ID_BASE (-6000)
    // and alias a triangle mesh. Native refuses at the same point.
    const last = Array.from({ length: STATIC_HANDLE_CAPACITY }, () => ids.allocStaticCylinder())
    expect(last[0]).toBe(STATIC_CYLINDER_ID_BASE)
    expect(last[STATIC_HANDLE_CAPACITY - 1]).toBe(STATIC_CYLINDER_ID_BASE - (STATIC_HANDLE_CAPACITY - 1))
    expect(ids.allocStaticCylinder()).toBe(STATIC_HANDLE_OVERFLOW)

    // The overflow must not consume or disturb another family's range.
    expect(ids.allocStaticSphere()).toBe(STATIC_SPHERE_ID_BASE)
  })

  it('restarts every family after resetStaticHandles', () => {
    const ids = new WasmIdShadow()
    for (let i = 0; i < STATIC_HANDLE_CAPACITY; i++) ids.allocStaticBox()
    expect(ids.allocStaticBox()).toBe(STATIC_HANDLE_OVERFLOW)

    ids.resetStaticHandles()
    expect(ids.allocStaticBox()).toBe(STATIC_BOX_ID_BASE)
  })
})

/**
 * #441 — world snapshots over the worker protocol: the request rides in the
 * ordered batch, the reply is correlated by request id, and the client keeps
 * its id shadow and step-count guards consistent with the restored world.
 */
describe('worker snapshot request/reply', () => {
  type Reply = Extract<Parameters<PhysicsWorkerClient['receiveWorkerMessage']>[0], { type: 'snapshot-reply' }>

  function setup(restoreStatus = WasmSnapshotStatus.Ok) {
    const engine = {
      ...makeMockEngine(),
      serializeSnapshot: vi.fn(() => new Uint8Array([1, 2, 3, 4])),
      restoreSnapshot: vi.fn(() => restoreStatus),
      getStaticContentHash: vi.fn(() => 'feedfacecafebeef'),
    }
    const runtime = createWorkerRuntimeState()
    const client = new PhysicsWorkerClient({ sharedTransport: false })
    const batches: PhysicsWorkerCommand[][] = []
    const held: Reply[] = []
    let holdReplies = false
    client.attachLoopback((commands) => {
      batches.push(commands)
      for (const cmd of commands) applyPhysicsCommand(engine, cmd, runtime)
      const replies = runtime.replies
      runtime.replies = []
      for (const r of replies) {
        if (holdReplies) held.push(r)
        else client.receiveWorkerMessage(r)
      }
    })
    return {
      engine, runtime, client, batches,
      hold: () => { holdReplies = true },
      release: () => { holdReplies = false; for (const r of held.splice(0)) client.receiveWorkerMessage(r) },
    }
  }

  const blob = fakeSnapshot({ hashHi: 1, hashLo: 2, ids: [0, 3], stepCount: 500, hinges: [{ id: 4, bodyId: 3 }] })

  it('serializes at its place in the command order and correlates the reply', async () => {
    const { client, batches, engine } = setup()
    client.createBody({ mass: 1 })
    const a = client.serializeSnapshot()
    const b = client.serializeSnapshot()
    await expect(a).resolves.toEqual(new Uint8Array([1, 2, 3, 4]))
    await expect(b).resolves.toEqual(new Uint8Array([1, 2, 3, 4]))
    // createBody went out in the same ordered batch, ahead of the request.
    expect(batches[0]!.map((c) => c.type)).toEqual(['createBody', 'serializeSnapshot'])
    expect(engine.serializeSnapshot).toHaveBeenCalledTimes(2)
    expect(client.getStaticContentHash()).toBe('feedfacecafebeef')
  })

  it('a restore takes effect before the next step and adopts the snapshot ids and step count', async () => {
    const { client, batches, runtime, engine, hold, release } = setup()
    client.createBody({ mass: 1 }) // live id 0
    hold()
    const status = client.restoreSnapshot(blob)
    client.step(1 / 60)
    // In flight: the client already reports the snapshot's counters.
    expect(client.getStepCount()).toBe(500)
    expect(client.createBody({ mass: 1 })).toBe(4) // nextBodyId of the snapshot
    release()
    await expect(status).resolves.toBe(WasmSnapshotStatus.Ok)
    const order = batches.flat().map((c) => c.type)
    expect(order.indexOf('restoreSnapshot')).toBeLessThan(order.indexOf('step'))
    expect(engine.restoreSnapshot).toHaveBeenCalledTimes(1)
    // The worker now publishes exactly the restored world's hinges.
    expect([...runtime.hingeIds]).toEqual([4])
  })

  it('drops step results that arrive while a restore is in flight', () => {
    const { client, hold, release } = setup()
    hold()
    void client.restoreSnapshot(blob)
    const stale = {
      type: 'step-result' as const, alpha: 0.5, stepCount: 9999, stepMs: 1,
      transformBuffer: new ArrayBuffer(0), contactBuffer: new ArrayBuffer(0), contactCount: 0, hingeBuffer: new ArrayBuffer(0),
    }
    client.applyStepResult(stale)
    expect(client.getStepCount()).toBe(500)
    expect(client.getTransportStats().staleSnapshots).toBe(1)
    release()
    // After the reply, the restored world's (lower) step counts are accepted.
    client.applyStepResult({ ...stale, stepCount: 501 })
    expect(client.getStepCount()).toBe(501)
  })

  it('a refused restore puts the previous id counters and step count back', async () => {
    const { client } = setup(WasmSnapshotStatus.StaticMismatch)
    expect(client.createBody({ mass: 1 })).toBe(0)
    await expect(client.restoreSnapshot(blob)).resolves.toBe(WasmSnapshotStatus.StaticMismatch)
    expect(client.getStepCount()).toBe(0)
    expect(client.createBody({ mass: 1 })).toBe(1)
  })
})
