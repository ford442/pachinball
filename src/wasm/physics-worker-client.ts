/**
 * Main-thread proxy for a worker-owned WasmPhysicsEngine.
 * Mutations queue; step() posts and returns the previous snapshot's alpha.
 */

import type { EventBus } from '../core/event-bus'
import type { WasmBodyDesc, WasmHingeDesc } from './PhysicsModule'
import type { WasmPhysicsModule } from './wasm-types'
import type { WasmSimEngine } from './wasm-sim-engine'
import {
  decodeContactBuffer,
  toWasmContactEvent,
} from './contact-buffer'
import { decodeTransformSlot, TRANSFORM_STRIDE } from './transform-buffer'
import {
  decodeHingeAngle,
  WasmIdShadow,
  type PhysicsWorkerCommand,
  type PhysicsWorkerFromWorker,
  type PhysicsWorkerToWorker,
} from './physics-worker-protocol'

const ZERO3 = { x: 0, y: 0, z: 0 }
const IDENTITY_Q = { x: 0, y: 0, z: 0, w: 1 }

export function resolvePhysicsBundleUrl(bundleUrl: string): string {
  if (/^https?:/i.test(bundleUrl) || bundleUrl.startsWith('blob:')) return bundleUrl
  if (typeof window === 'undefined' || !window.location?.href) return bundleUrl
  try {
    return new URL(bundleUrl, window.location.href).href
  } catch {
    return bundleUrl
  }
}

export function createPhysicsWorker(): Worker {
  return new Worker(new URL('./physics-worker.ts', import.meta.url), { type: 'module' })
}

export type PrewarmedPhysicsWorker = {
  worker: Worker
  ready: Promise<boolean>
}

let prewarmed: PrewarmedPhysicsWorker | null = null

/** Start WASM load inside a Dedicated Worker (idle warm-path for wasm-worker). */
export function warmPhysicsWorker(bundleUrl: string): PrewarmedPhysicsWorker {
  if (prewarmed) return prewarmed
  const worker = createPhysicsWorker()
  const ready = new Promise<boolean>((resolve) => {
    const onMsg = (event: MessageEvent<PhysicsWorkerFromWorker>) => {
      const data = event.data
      if (data?.type === 'ready') {
        worker.removeEventListener('message', onMsg)
        resolve(true)
      } else if (data?.type === 'error') {
        worker.removeEventListener('message', onMsg)
        resolve(false)
      }
    }
    worker.addEventListener('message', onMsg)
  })
  worker.postMessage({
    type: 'init',
    bundleUrl: resolvePhysicsBundleUrl(bundleUrl),
  } satisfies PhysicsWorkerToWorker)
  prewarmed = { worker, ready }
  return prewarmed
}

export function consumePrewarmedPhysicsWorker(): PrewarmedPhysicsWorker | null {
  const held = prewarmed
  prewarmed = null
  return held
}

/** @internal */
export function resetPhysicsWorkerPrewarmForTests(): void {
  if (prewarmed) {
    prewarmed.worker.terminate()
    prewarmed = null
  }
}

export class PhysicsWorkerClient implements WasmSimEngine {
  isReady = false

  private worker: Worker | null = null
  private eventBus: EventBus | null = null
  private queue: PhysicsWorkerCommand[] = []
  private ids = new WasmIdShadow()
  private lastAlpha = 0
  private lastStepCount = 0
  private lastWorkerStepMs = 0
  private transformView: Float32Array | null = null
  private hingeView: Float32Array | null = null
  private snapshotReady = false
  private ownsWorker = true
  private readyWaiters: Array<(ok: boolean) => void> = []

  async load(moduleUrl = './wasm/PhysicsModule.js', _preloadedModule?: WasmPhysicsModule): Promise<void> {
    if (this.isReady) return

    const held = consumePrewarmedPhysicsWorker()
    if (held) {
      this.worker = held.worker
      this.ownsWorker = true
      this.worker.addEventListener('message', this.onMessage)
      const ok = await held.ready
      this.isReady = ok
      if (!ok) {
        this.worker.removeEventListener('message', this.onMessage)
        this.worker.terminate()
        this.worker = null
      }
      return
    }

    try {
      this.worker = createPhysicsWorker()
      this.ownsWorker = true
    } catch (err) {
      console.warn('[PhysicsWorkerClient] Worker construction failed', err)
      return
    }

    this.worker.addEventListener('message', this.onMessage)
    this.post({ type: 'init', bundleUrl: resolvePhysicsBundleUrl(moduleUrl) })

    const ok = await new Promise<boolean>((resolve) => {
      this.readyWaiters.push(resolve)
    })
    this.isReady = ok
  }

  init(bus: EventBus): void {
    this.eventBus = bus
  }

  setGravity(x: number, y: number, z: number): void {
    this.enqueue({ type: 'setGravity', x, y, z })
  }

  setRollingResistance(rr: number): void {
    this.enqueue({ type: 'setRollingResistance', rr })
  }

  addStaticPlane(normal: { x: number; y: number; z: number }, d: number, friction = 0.2): void {
    this.enqueue({ type: 'addStaticPlane', normal, d, friction })
  }

  addStaticBox(
    center: { x: number; y: number; z: number },
    halfExtents: { x: number; y: number; z: number },
    rotation: { x: number; y: number; z: number; w: number } = IDENTITY_Q,
    restitution = 0.4,
    friction = 0.2,
  ): number {
    if (!this.isReady) return -1
    const id = this.ids.allocStaticBox()
    this.enqueue({ type: 'addStaticBox', center, halfExtents, rotation, restitution, friction })
    return id
  }

  addStaticCapsule(
    center: { x: number; y: number; z: number },
    radius: number,
    halfHeight: number,
    rotation: { x: number; y: number; z: number; w: number } = IDENTITY_Q,
    restitution = 0.4,
    friction = 0.2,
  ): number {
    if (!this.isReady) return -1
    const id = this.ids.allocStaticCapsule()
    this.enqueue({ type: 'addStaticCapsule', center, radius, halfHeight, rotation, restitution, friction })
    return id
  }

  createBody(desc: WasmBodyDesc = {}): number {
    if (!this.isReady) return -1
    const id = this.ids.allocBody()
    this.enqueue({ type: 'createBody', desc })
    return id
  }

  removeBody(id: number): void {
    this.enqueue({ type: 'removeBody', id })
  }

  applyForce(id: number, fx: number, fy: number, fz: number): void {
    this.enqueue({ type: 'applyForce', id, fx, fy, fz })
  }

  applyImpulse(id: number, ix: number, iy: number, iz: number): void {
    this.enqueue({ type: 'applyImpulse', id, ix, iy, iz })
  }

  setVelocity(id: number, vx: number, vy: number, vz: number): void {
    this.enqueue({ type: 'setVelocity', id, vx, vy, vz })
  }

  setAngularVelocity(id: number, wx: number, wy: number, wz: number): void {
    this.enqueue({ type: 'setAngularVelocity', id, wx, wy, wz })
  }

  setBodyPosition(id: number, px: number, py: number, pz: number): void {
    this.enqueue({ type: 'setBodyPosition', id, px, py, pz })
  }

  setBodyRotation(id: number, qx: number, qy: number, qz: number, qw: number): void {
    this.enqueue({ type: 'setBodyRotation', id, qx, qy, qz, qw })
  }

  createHinge(desc: WasmHingeDesc): number {
    if (!this.isReady) return -1
    const id = this.ids.allocHinge()
    this.enqueue({ type: 'createHinge', desc })
    return id
  }

  setHingeMotor(id: number, targetVel: number, maxTorque: number): void {
    this.enqueue({ type: 'setHingeMotor', id, targetVel, maxTorque })
  }

  getHingeAngle(id: number): number {
    if (!this.hingeView) return 0
    return decodeHingeAngle(this.hingeView, id)
  }

  removeHinge(id: number): void {
    this.enqueue({ type: 'removeHinge', id })
  }

  getPosition(id: number): { x: number; y: number; z: number } {
    return this.readTransform(id)?.position ?? ZERO3
  }

  getVelocity(id: number): { x: number; y: number; z: number } {
    return this.readTransform(id)?.velocity ?? ZERO3
  }

  getAngularVelocity(id: number): { x: number; y: number; z: number } {
    return this.readTransform(id)?.angularVelocity ?? ZERO3
  }

  getRotation(id: number): { x: number; y: number; z: number; w: number } {
    return this.readTransform(id)?.rotation ?? IDENTITY_Q
  }

  step(rawDt: number): number {
    this.enqueue({ type: 'step', rawDt })
    this.flush()
    return this.lastAlpha
  }

  getStepCount(): number {
    return this.lastStepCount
  }

  getActiveBodyCount(): number {
    return 0
  }

  hasTransformSnapshot(): boolean {
    return this.snapshotReady
  }

  getLastWorkerStepMs(): number {
    return this.lastWorkerStepMs
  }

  dispose(): void {
    this.enqueue({ type: 'dispose' })
    this.flush()
    if (this.worker) {
      this.worker.removeEventListener('message', this.onMessage)
      if (this.ownsWorker) this.worker.terminate()
    }
    this.worker = null
    this.isReady = false
    this.eventBus = null
    this.queue = []
    this.ids.reset()
    this.transformView = null
    this.hingeView = null
    this.snapshotReady = false
    this.lastAlpha = 0
    this.lastStepCount = 0
    this.lastWorkerStepMs = 0
  }

  /** @internal Vitest: inject a loopback dispatcher instead of a Worker. */
  attachLoopback(dispatch: (batch: PhysicsWorkerCommand[]) => void): void {
    this.loopback = dispatch
    this.isReady = true
  }

  private loopback: ((batch: PhysicsWorkerCommand[]) => void) | null = null

  applyStepResult(msg: Extract<PhysicsWorkerFromWorker, { type: 'step-result' }>): void {
    this.lastAlpha = msg.alpha
    this.lastStepCount = msg.stepCount
    this.lastWorkerStepMs = msg.stepMs
    this.transformView = msg.transformBuffer.byteLength > 0
      ? new Float32Array(msg.transformBuffer)
      : null
    this.hingeView = msg.hingeBuffer.byteLength > 0
      ? new Float32Array(msg.hingeBuffer)
      : null
    this.snapshotReady = true

    if (!this.eventBus || msg.contactCount <= 0) return
    const view = new Float32Array(msg.contactBuffer)
    const contacts = decodeContactBuffer(view, msg.contactCount)
    for (const contact of contacts) {
      this.eventBus.emit('wasm:physics:contact', toWasmContactEvent(contact))
    }
  }

  private readTransform(id: number) {
    if (!this.transformView) return null
    return decodeTransformSlot(this.transformView, id, TRANSFORM_STRIDE)
  }

  private enqueue(cmd: PhysicsWorkerCommand): void {
    this.queue.push(cmd)
  }

  private flush(): void {
    if (this.queue.length === 0) return
    const commands = this.queue
    this.queue = []
    if (this.loopback) {
      this.loopback(commands)
      return
    }
    this.post({ type: 'batch', commands })
  }

  private post(msg: PhysicsWorkerToWorker): void {
    this.worker?.postMessage(msg)
  }

  private onMessage = (event: MessageEvent<PhysicsWorkerFromWorker>): void => {
    const data = event.data
    if (!data) return
    if (data.type === 'ready') {
      this.isReady = true
      this.flushReadyWaiters(true)
      return
    }
    if (data.type === 'error') {
      console.warn('[PhysicsWorkerClient]', data.message)
      this.isReady = false
      this.flushReadyWaiters(false)
      return
    }
    if (data.type === 'step-result') {
      this.applyStepResult(data)
    }
  }

  private flushReadyWaiters(ok: boolean): void {
    const waiters = this.readyWaiters
    this.readyWaiters = []
    for (const w of waiters) w(ok)
  }
}
