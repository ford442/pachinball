/**
 * #439 Slice 1: wasm-worker is the isolated default, so worker boot must not
 * hang. `startPhysicsWorker` settles `ready` once — on the worker's reply, on a
 * Worker `error` / `messageerror` event, or on the timeout backstop — and
 * terminates a worker that failed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  consumePrewarmedPhysicsWorker,
  resetPhysicsWorkerPrewarmForTests,
  startPhysicsWorker,
  warmPhysicsWorker,
} from '../src/wasm/physics-worker-boot'

class FakeWorker extends EventTarget {
  static instances: FakeWorker[] = []
  posted: unknown[] = []
  terminated = false
  listeners = new Map<string, number>()

  constructor(readonly url: URL, readonly options: WorkerOptions) {
    super()
    FakeWorker.instances.push(this)
  }

  postMessage(msg: unknown): void {
    this.posted.push(msg)
  }

  terminate(): void {
    this.terminated = true
  }

  override addEventListener(type: string, cb: EventListenerOrEventListenerObject | null): void {
    this.listeners.set(type, (this.listeners.get(type) ?? 0) + 1)
    super.addEventListener(type, cb)
  }

  override removeEventListener(type: string, cb: EventListenerOrEventListenerObject | null): void {
    this.listeners.set(type, (this.listeners.get(type) ?? 0) - 1)
    super.removeEventListener(type, cb)
  }

  reply(data: unknown): void {
    this.dispatchEvent(new MessageEvent('message', { data }))
  }

  liveListeners(): number {
    return [...this.listeners.values()].reduce((a, b) => a + b, 0)
  }
}

const BUNDLE = 'https://example.test/wasm/PhysicsModule.js'

function lastWorker(): FakeWorker {
  const w = FakeWorker.instances.at(-1)
  if (!w) throw new Error('no worker created')
  return w
}

describe('startPhysicsWorker', () => {
  beforeEach(() => {
    FakeWorker.instances = []
    vi.stubGlobal('Worker', FakeWorker)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.useFakeTimers()
  })

  afterEach(() => {
    resetPhysicsWorkerPrewarmForTests()
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('posts init with the bundle URL and resolves true on ready', async () => {
    const boot = startPhysicsWorker(BUNDLE, 1000)
    const worker = lastWorker()
    expect(worker.options).toEqual({ type: 'module' })
    expect(worker.posted).toEqual([{ type: 'init', bundleUrl: BUNDLE }])

    worker.reply({ type: 'ready' })
    await expect(boot.ready).resolves.toBe(true)
    expect(worker.terminated).toBe(false)
    expect(worker.liveListeners()).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('resolves false and terminates on an error reply', async () => {
    const boot = startPhysicsWorker(BUNDLE, 1000)
    const worker = lastWorker()
    worker.reply({ type: 'error', message: 'WASM physics bundle failed to load in worker' })
    await expect(boot.ready).resolves.toBe(false)
    expect(worker.terminated).toBe(true)
    expect(worker.liveListeners()).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('bundle failed to load'))
  })

  it('resolves false on a Worker error event (script failed to load)', async () => {
    const boot = startPhysicsWorker(BUNDLE, 1000)
    const worker = lastWorker()
    worker.dispatchEvent(new Event('error'))
    await expect(boot.ready).resolves.toBe(false)
    expect(worker.terminated).toBe(true)
    expect(worker.liveListeners()).toBe(0)
  })

  it('resolves false on messageerror', async () => {
    const boot = startPhysicsWorker(BUNDLE, 1000)
    lastWorker().dispatchEvent(new Event('messageerror'))
    await expect(boot.ready).resolves.toBe(false)
    expect(lastWorker().terminated).toBe(true)
  })

  it('resolves false and terminates when the worker never answers', async () => {
    const boot = startPhysicsWorker(BUNDLE, 1000)
    const worker = lastWorker()
    vi.advanceTimersByTime(999)
    expect(worker.terminated).toBe(false)
    vi.advanceTimersByTime(1)
    await expect(boot.ready).resolves.toBe(false)
    expect(worker.terminated).toBe(true)
    expect(worker.liveListeners()).toBe(0)

    // A late reply after the timeout changes nothing.
    worker.reply({ type: 'ready' })
    await expect(boot.ready).resolves.toBe(false)
  })

  it('ignores unrelated messages before ready', async () => {
    const boot = startPhysicsWorker(BUNDLE, 1000)
    const worker = lastWorker()
    worker.reply({ type: 'step-result' })
    worker.reply(null)
    worker.reply({ type: 'ready' })
    await expect(boot.ready).resolves.toBe(true)
  })
})

describe('warmPhysicsWorker', () => {
  beforeEach(() => {
    FakeWorker.instances = []
    vi.stubGlobal('Worker', FakeWorker)
  })

  afterEach(() => {
    resetPhysicsWorkerPrewarmForTests()
    vi.unstubAllGlobals()
  })

  it('starts one worker and hands it over once', () => {
    const a = warmPhysicsWorker(BUNDLE)
    const b = warmPhysicsWorker(BUNDLE)
    expect(b).toBe(a)
    expect(FakeWorker.instances).toHaveLength(1)

    expect(consumePrewarmedPhysicsWorker()).toBe(a)
    expect(consumePrewarmedPhysicsWorker()).toBeNull()
    lastWorker().reply({ type: 'ready' })
  })
})
