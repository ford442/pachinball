/**
 * Main-thread proxy for a worker-owned WasmPhysicsEngine.
 * Mutations queue; step() posts and returns the previous snapshot's alpha.
 *
 * Snapshots arrive over the shared layout when the page is cross-origin
 * isolated (read at the top of `step()`, never blocking), otherwise as
 * transferred `step-result` buffers.
 */

import type {
  WasmBodyDesc,
  WasmBodyType,
  WasmBoxBodyDesc,
  WasmContactEventBus,
  WasmForceFieldDesc,
  WasmHingeDesc,
} from './PhysicsModule'
import { WasmVolumeShape } from './physics-module-adventure'
import { WasmSnapshotStatus, type WasmPhysicsModule } from './wasm-types'
import type { WasmSimEngine } from './wasm-sim-engine'
import type { PinFieldSpec } from '../core/pin-field'
import {
  decodeContactBuffer,
  toWasmContactEvent,
} from './contact-buffer'
import { decodeTransformSlot, TRANSFORM_STRIDE } from './transform-buffer'
import { SharedSnapshotReader } from './physics-shared-layout'
import { isCrossOriginIsolated } from '../config/physics'
import {
  decodeHingeAngle,
  STATIC_HANDLE_OVERFLOW,
  WasmIdShadow,
  type PhysicsWorkerCommand,
  type PhysicsWorkerFromWorker,
  type PhysicsWorkerToWorker,
} from './physics-worker-protocol'

const ZERO3 = { x: 0, y: 0, z: 0 }
const IDENTITY_Q = { x: 0, y: 0, z: 0, w: 1 }

export function resolvePhysicsBundleUrl(bundleUrl: string): string {
  if (/^https?:/i.test(bundleUrl) || bundleUrl.startsWith('blob:')) return bundleUrl
  // Accessed via globalThis (not the bare `window` identifier) — this file compiles
  // under both the DOM app project and the WebWorker-lib worker project.
  const win = (globalThis as Record<string, unknown>).window as
    | { location?: { href?: string } }
    | undefined
  if (!win?.location?.href) return bundleUrl
  try {
    return new URL(bundleUrl, win.location.href).href
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

export type PhysicsWorkerTransport = 'shared' | 'post-message'

/** Debug counters; Playwright asserts the shared path allocates no per-step buffers. */
export interface PhysicsWorkerTransportStats {
  transport: PhysicsWorkerTransport
  /** Snapshots copied out of the shared buffer. */
  sharedSnapshots: number
  /** `step-result` messages received — each carries freshly allocated buffers. */
  postMessageSnapshots: number
  /** `shared-attach` messages (first attach plus every growth). */
  sharedAttaches: number
  /** Snapshots discarded because a newer one had already been applied. */
  staleSnapshots: number
}

export interface PhysicsWorkerClientOptions {
  /** Ask the worker for the shared transport. Defaults to `crossOriginIsolated`. */
  sharedTransport?: boolean
}

export class PhysicsWorkerClient implements WasmSimEngine {
  isReady = false

  private worker: Worker | null = null
  private eventBus: WasmContactEventBus | null = null
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
  private readonly wantShared: boolean
  private shared: SharedSnapshotReader | null = null
  private stats: PhysicsWorkerTransportStats = PhysicsWorkerClient.emptyStats()

  constructor(options: PhysicsWorkerClientOptions = {}) {
    this.wantShared = options.sharedTransport ?? isCrossOriginIsolated()
  }

  private static emptyStats(): PhysicsWorkerTransportStats {
    return {
      transport: 'post-message',
      sharedSnapshots: 0,
      postMessageSnapshots: 0,
      sharedAttaches: 0,
      staleSnapshots: 0,
    }
  }

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
        return
      }
      this.requestSharedTransport()
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
    if (ok) this.requestSharedTransport()
  }

  private requestSharedTransport(): void {
    if (this.wantShared) this.post({ type: 'use-shared-transport' })
  }

  init(bus: WasmContactEventBus): void {
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
    if (id === STATIC_HANDLE_OVERFLOW) return STATIC_HANDLE_OVERFLOW
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
    if (id === STATIC_HANDLE_OVERFLOW) return STATIC_HANDLE_OVERFLOW
    this.enqueue({ type: 'addStaticCapsule', center, radius, halfHeight, rotation, restitution, friction })
    return id
  }

  addStaticCylinder(
    center: { x: number; y: number; z: number },
    radius: number,
    halfHeight: number,
    rotation: { x: number; y: number; z: number; w: number } = IDENTITY_Q,
    restitution = 0.4,
    friction = 0.2,
  ): number {
    if (!this.isReady) return -1
    const id = this.ids.allocStaticCylinder()
    if (id === STATIC_HANDLE_OVERFLOW) return STATIC_HANDLE_OVERFLOW
    this.enqueue({ type: 'addStaticCylinder', center, radius, halfHeight, rotation, restitution, friction })
    return id
  }

  addStaticSphere(
    center: { x: number; y: number; z: number },
    radius: number,
    restitution = 0.4,
    friction = 0.2,
  ): number {
    if (!this.isReady) return -1
    const id = this.ids.allocStaticSphere()
    if (id === STATIC_HANDLE_OVERFLOW) return STATIC_HANDLE_OVERFLOW
    this.enqueue({ type: 'addStaticSphere', center, radius, restitution, friction })
    return id
  }

  addStaticCone(
    center: { x: number; y: number; z: number },
    radius: number,
    halfHeight: number,
    rotation: { x: number; y: number; z: number; w: number } = IDENTITY_Q,
    restitution = 0.4,
    friction = 0.2,
  ): number {
    if (!this.isReady) return -1
    const id = this.ids.allocStaticCone()
    if (id === STATIC_HANDLE_OVERFLOW) return STATIC_HANDLE_OVERFLOW
    this.enqueue({ type: 'addStaticCone', center, radius, halfHeight, rotation, restitution, friction })
    return id
  }

  /**
   * One command for the whole lattice. The mask and keep-outs are copied now
   * (the caller may reuse them) and the mask's buffer is transferred on flush.
   */
  addPinField(desc: PinFieldSpec): number {
    if (!this.isReady) return -1
    const id = this.ids.allocPinField()
    if (id === STATIC_HANDLE_OVERFLOW) return STATIC_HANDLE_OVERFLOW
    this.enqueue({
      type: 'addPinField',
      desc: {
        ...desc,
        origin: { ...desc.origin },
        rotation: desc.rotation ? { ...desc.rotation } : undefined,
        keepOuts: desc.keepOuts?.map((k) => ({ ...k })),
        occupancy: desc.occupancy?.slice(),
      },
    })
    return id
  }

  /**
   * Mirrors the in-process wrapper's guard: a mesh it would refuse before
   * reaching C++ consumes no native id, so it must not consume a shadow one.
   * The arrays are copied now (the caller may reuse them) and transferred on flush.
   */
  addStaticTriangleMesh(
    vertices: Float32Array,
    indices: Uint32Array,
    restitution = 0.4,
    friction = 0.2,
    doubleSided = false,
  ): number {
    if (!this.isReady) return -1
    if (vertices.length < 9 || indices.length < 3) return -1
    const id = this.ids.allocStaticMesh()
    this.enqueue({
      type: 'addStaticTriangleMesh',
      vertices: vertices.slice(),
      indices: indices.slice(),
      restitution,
      friction,
      doubleSided,
    })
    return id
  }

  addSensorVolume(
    center: { x: number; y: number; z: number },
    halfExtents: { x: number; y: number; z: number },
    rotation: { x: number; y: number; z: number; w: number } = IDENTITY_Q,
    shape: WasmVolumeShape = WasmVolumeShape.Box,
  ): number {
    if (!this.isReady) return -1
    const id = this.ids.allocSensorVolume()
    if (id === STATIC_HANDLE_OVERFLOW) return STATIC_HANDLE_OVERFLOW
    this.enqueue({ type: 'addSensorVolume', center, halfExtents, rotation, shape })
    return id
  }

  addKinematicMover(
    position: { x: number; y: number; z: number },
    halfExtents: { x: number; y: number; z: number },
    rotation: { x: number; y: number; z: number; w: number } = IDENTITY_Q,
    restitution = 0.4,
    friction = 0.2,
    shape: WasmVolumeShape = WasmVolumeShape.Box,
  ): number {
    if (!this.isReady) return -1
    const id = this.ids.allocKinematicMover()
    if (id === STATIC_HANDLE_OVERFLOW) return STATIC_HANDLE_OVERFLOW
    this.enqueue({ type: 'addKinematicMover', position, halfExtents, rotation, restitution, friction, shape })
    return id
  }

  setNextKinematicTransform(
    id: number,
    position: { x: number; y: number; z: number },
    rotation: { x: number; y: number; z: number; w: number },
  ): void {
    this.enqueue({ type: 'setNextKinematicTransform', id, position, rotation })
  }

  setCollisionGroups(id: number, membership: number, filter: number): void {
    this.enqueue({ type: 'setCollisionGroups', id, membership, filter })
  }

  clearStaticGeometry(): void {
    this.ids.resetStaticHandles()
    this.enqueue({ type: 'clearStaticGeometry' })
  }

  addForceField(desc: WasmForceFieldDesc): number {
    if (!this.isReady) return -1
    const id = this.ids.allocForceField()
    this.enqueue({ type: 'addForceField', desc })
    return id
  }

  setForceFieldEnabled(fieldId: number, enabled: boolean): void {
    this.enqueue({ type: 'setForceFieldEnabled', fieldId, enabled })
  }

  setForceFieldVector(fieldId: number, fx: number, fy: number, fz: number): void {
    this.enqueue({ type: 'setForceFieldVector', fieldId, fx, fy, fz })
  }

  createBody(desc: WasmBodyDesc = {}): number {
    if (!this.isReady) return -1
    const id = this.ids.allocBody()
    this.enqueue({ type: 'createBody', desc })
    return id
  }

  /** Box bodies share the rigid-body handle table with spheres. */
  createBoxBody(desc: WasmBoxBodyDesc): number {
    if (!this.isReady) return -1
    const id = this.ids.allocBody()
    this.enqueue({ type: 'createBoxBody', desc })
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

  setBodyType(id: number, bodyType: WasmBodyType): void {
    this.enqueue({ type: 'setBodyType', id, bodyType })
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
    this.pollShared()
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

  /**
   * Snapshots are in-process only (#422): the C++ world lives on the worker
   * and a blob would need a request/reply round trip the batch protocol does
   * not have. Report the gap instead of returning a stale or partial state.
   */
  serializeSnapshot(): Uint8Array | null {
    return null
  }

  restoreSnapshot(_bytes: Uint8Array): WasmSnapshotStatus {
    return WasmSnapshotStatus.Unsupported
  }

  getStaticContentHash(): string | null {
    return null
  }

  getTransportStats(): PhysicsWorkerTransportStats {
    return { ...this.stats }
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
    this.shared = null
    this.stats = PhysicsWorkerClient.emptyStats()
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
    this.stats.postMessageSnapshots++
    // A `step-result` can be overtaken by a later shared publish that step()
    // already read. Its contacts still count; its poses are stale.
    if (this.snapshotReady && msg.stepCount < this.lastStepCount) {
      this.stats.staleSnapshots++
    } else {
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
    }

    if (msg.contactCount > 0) this.emitContacts(new Float32Array(msg.contactBuffer), msg.contactCount)
  }

  /** @internal Route one worker message (the Worker listener and loopback tests). */
  receiveWorkerMessage(data: PhysicsWorkerFromWorker): void {
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
      return
    }
    if (data.type === 'shared-attach') {
      this.attachShared(data.buffer)
    }
  }

  private attachShared(buffer: SharedArrayBuffer): void {
    let reader: SharedSnapshotReader
    try {
      reader = new SharedSnapshotReader(buffer)
    } catch (err) {
      // A layout mismatch is a stale worker bundle; stay on step-result.
      console.warn('[PhysicsWorkerClient] shared transport rejected', err)
      return
    }
    // The worker finished writing the old buffer before posting this, so
    // draining it first keeps contact order across the swap.
    this.pollShared()
    this.shared = reader
    this.stats.transport = 'shared'
    this.stats.sharedAttaches++
  }

  private pollShared(): void {
    const shared = this.shared
    if (!shared) return
    shared.drainContacts((packed, count) => this.emitContacts(packed, count))
    if (!shared.read()) return
    if (this.snapshotReady && shared.stepCount < this.lastStepCount) {
      this.stats.staleSnapshots++
      return
    }
    this.stats.sharedSnapshots++
    this.lastAlpha = shared.alpha
    this.lastStepCount = shared.stepCount
    this.lastWorkerStepMs = shared.stepMs
    this.transformView = shared.transforms
    this.hingeView = shared.hinges
    this.snapshotReady = true
  }

  private emitContacts(packed: Float32Array, count: number): void {
    if (!this.eventBus) return
    for (const contact of decodeContactBuffer(packed, count)) {
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
    // Mesh arrays and pin masks were copied at enqueue, so hand them over instead of cloning again.
    const transfer: Transferable[] = []
    for (const cmd of commands) {
      if (cmd.type === 'addStaticTriangleMesh') transfer.push(cmd.vertices.buffer, cmd.indices.buffer)
      if (cmd.type === 'addPinField' && cmd.desc.occupancy) transfer.push(cmd.desc.occupancy.buffer)
    }
    this.post({ type: 'batch', commands }, transfer)
  }

  private post(msg: PhysicsWorkerToWorker, transfer: Transferable[] = []): void {
    this.worker?.postMessage(msg, transfer)
  }

  private onMessage = (event: MessageEvent<PhysicsWorkerFromWorker>): void => {
    if (event.data) this.receiveWorkerMessage(event.data)
  }

  private flushReadyWaiters(ok: boolean): void {
    const waiters = this.readyWaiters
    this.readyWaiters = []
    for (const w of waiters) w(ok)
  }
}
