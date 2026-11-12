/**
 * Physics worker supervision (#503 A2): a dead or wedged worker is detected, and its world is
 * rebuilt in-process from the client's command log (structure + checkpoint + recent commands).
 */
import { describe, expect, it, vi } from 'vitest'
import { PhysicsCommandLog, RECOVERY_REQUEST_ID, compactStructure } from '../src/wasm/physics-command-log'
import { PhysicsWorkerClient } from '../src/wasm/physics-worker-client'
import type { PhysicsWorkerCommand } from '../src/wasm/physics-worker-protocol'
import type { WorkerBatchEngine } from '../src/wasm/physics-worker-runtime'
import { WasmSnapshotStatus } from '../src/wasm/wasm-types'
import { encodeTransformBuffer } from '../src/wasm/transform-buffer'
import { fakeSnapshot } from './helpers/fake-snapshot'

vi.mock('../src/boot-log', () => ({ bootError: vi.fn(), bootWarn: vi.fn() }))

/** An in-process engine whose calls are recorded in order. */
function fakeEngine() {
  const calls: string[] = []
  let nextBody = 0
  let steps = 0
  const target: Record<string, unknown> = {
    createBody: () => { calls.push('createBody'); return nextBody++ },
    step: () => { calls.push('step'); steps++; return 0.5 },
    restoreSnapshot: () => { calls.push('restoreSnapshot'); return WasmSnapshotStatus.Ok },
    serializeSnapshot: () => fakeSnapshot({ hashHi: 1, hashLo: 2, ids: [0], stepCount: steps }),
    getStaticContentHash: () => 'abc',
    getStateHash: () => null,
    getStepCount: () => steps,
    getHingeAngle: () => 0,
    copyTransformBuffer: () => {
      const view = encodeTransformBuffer([])
      return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength)
    },
    copyContactBuffer: () => ({ buffer: new ArrayBuffer(0), count: 0 }),
    getTransformHeapView: () => null,
    getContactHeapView: () => null,
    dispose: () => { calls.push('dispose') },
  }
  const engine = new Proxy(target, {
    get: (t, key: string | symbol) => {
      if (typeof key !== 'string' || key === 'then') return undefined
      return key in t ? t[key] : () => { calls.push(key); return 0 }
    },
  }) as unknown as WorkerBatchEngine
  return { engine, calls, steps: () => steps }
}

const flushAsync = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

describe('PhysicsCommandLog', () => {
  it('compacts structure: drops steps / impulses / requests, keeps the last write per target', () => {
    const cmds: PhysicsWorkerCommand[] = [
      { type: 'createBody', desc: { mass: 1 } },
      { type: 'setVelocity', id: 0, vx: 1, vy: 0, vz: 0 },
      { type: 'step', rawDt: 1 / 60 },
      { type: 'applyImpulse', id: 0, ix: 1, iy: 0, iz: 0 },
      { type: 'setVelocity', id: 0, vx: 2, vy: 0, vz: 0 },
      { type: 'setVelocity', id: 1, vx: 3, vy: 0, vz: 0 },
      { type: 'serializeSnapshot', requestId: 4 },
    ]
    expect(compactStructure(cmds)).toEqual([
      { type: 'createBody', desc: { mass: 1 } },
      { type: 'setVelocity', id: 0, vx: 2, vy: 0, vz: 0 },
      { type: 'setVelocity', id: 1, vx: 3, vy: 0, vz: 0 },
    ])
  })

  it('replays prefix → checkpoint restore → suffix after a checkpoint', () => {
    const log = new PhysicsCommandLog()
    log.record([{ type: 'createBody', desc: { mass: 1 } }, { type: 'step', rawDt: 0.016 }])
    const at = log.mark()
    log.record([{ type: 'serializeSnapshot', requestId: 1 }, { type: 'step', rawDt: 0.016 }])
    log.checkpoint(new Uint8Array([1, 2, 3]), at)
    expect(log.stepsSinceCheckpoint).toBe(1)
    const batch = log.recoveryBatch()
    expect(batch.map((c) => c.type)).toEqual(['createBody', 'restoreSnapshot', 'serializeSnapshot', 'step'])
    expect(batch[1]).toMatchObject({ requestId: RECOVERY_REQUEST_ID })
  })

  it('keeps a copy of buffers that the send transfers', () => {
    const log = new PhysicsCommandLog()
    const vertices = new Float32Array([1, 2, 3])
    log.record([{ type: 'addStaticTriangleMesh', vertices, indices: new Uint32Array([0]), restitution: 0, friction: 0, doubleSided: false }])
    const logged = log.recoveryBatch()[0] as Extract<PhysicsWorkerCommand, { type: 'addStaticTriangleMesh' }>
    expect(logged.vertices).not.toBe(vertices)
    expect([...logged.vertices]).toEqual([1, 2, 3])
  })
})

describe('PhysicsWorkerClient supervision', () => {
  function deadWorkerClient(opts: { watchdogSteps?: number; checkpointSteps?: number } = {}) {
    const fallback = fakeEngine()
    const client = new PhysicsWorkerClient({
      sharedTransport: false,
      watchdogSteps: opts.watchdogSteps ?? 4,
      checkpointSteps: opts.checkpointSteps ?? 1000,
      createFallbackEngine: () => Promise.resolve(fallback.engine),
    })
    // A worker that never answers: ready, but every post goes nowhere.
    client.isReady = true
    const switched = vi.fn()
    client.onEngineSwitched = switched
    return { client, fallback, switched }
  }

  it('falls back in-process when steps go unanswered, replaying the logged world', async () => {
    const { client, fallback, switched } = deadWorkerClient({ watchdogSteps: 4 })
    const ball = client.createBody({ mass: 1 })
    for (let i = 0; i < 5; i++) client.step(1 / 60)
    expect(client.getSupervisionState()).toBe('recovering')
    await flushAsync()
    expect(client.getSupervisionState()).toBe('in-process')
    expect(switched).toHaveBeenCalledWith(expect.objectContaining({ from: 'wasm-worker', to: 'wasm-owner' }))
    expect(fallback.calls.filter((c) => c === 'createBody')).toHaveLength(1)
    expect(fallback.steps()).toBe(5)
    // From here every call runs on the main thread, synchronously.
    client.setVelocity(ball, 0, 0, 1)
    client.step(1 / 60)
    expect(fallback.steps()).toBe(6)
    expect(client.getStepCount()).toBe(6)
    expect(client.isReady).toBe(true)
  })

  it('a fatal message from the worker triggers the fallback at once', async () => {
    const { client, switched } = deadWorkerClient({ watchdogSteps: 1000 })
    client.step(1 / 60)
    client.receiveWorkerMessage({ type: 'fatal', message: 'RuntimeError: unreachable' })
    await flushAsync()
    expect(client.getSupervisionState()).toBe('in-process')
    expect(client.getFailureReason()).toContain('unreachable')
    expect(switched).toHaveBeenCalledTimes(1)
  })

  it('replays from the last checkpoint rather than from the start', async () => {
    const { client, fallback } = deadWorkerClient({ watchdogSteps: 1000, checkpointSteps: 3 })
    client.createBody({ mass: 1 })
    for (let i = 0; i < 4; i++) client.step(1 / 60)
    // The worker answers the checkpoint request (request id 1).
    client.receiveWorkerMessage({
      type: 'snapshot-reply', requestId: 1, bytes: fakeSnapshot({ hashHi: 1, hashLo: 2, ids: [0], stepCount: 3 }),
      status: WasmSnapshotStatus.Ok, staticHash: 'abc', stateHash: null, stepCount: 3,
    })
    await flushAsync()
    client.step(1 / 60)
    client.fail('test')
    await flushAsync()
    expect(fallback.calls.slice(0, 2)).toEqual(['createBody', 'restoreSnapshot'])
    // Steps 4 and 5 were sent after the checkpoint request: only those replay.
    expect(fallback.steps()).toBe(2)
  })

  it('commands issued while the fallback loads are applied after the replay', async () => {
    const fallback = fakeEngine()
    let resolveEngine: (e: WorkerBatchEngine) => void = () => {}
    const client = new PhysicsWorkerClient({
      sharedTransport: false,
      createFallbackEngine: () => new Promise((r) => { resolveEngine = r }),
    })
    client.isReady = true
    client.step(1 / 60)
    client.fail('test')
    client.createBody({ mass: 1 })
    client.step(1 / 60)
    resolveEngine(fallback.engine)
    await flushAsync()
    expect(fallback.calls).toEqual(['step', 'createBody', 'step'])
  })

  it('without supervision a dead worker just stops the client', () => {
    const client = new PhysicsWorkerClient({ sharedTransport: false, supervise: false, watchdogSteps: 2 })
    client.isReady = true
    for (let i = 0; i < 3; i++) client.step(1 / 60)
    expect(client.getSupervisionState()).toBe('failed')
    expect(client.isReady).toBe(false)
  })
})
