/**
 * Shared worker command application + snapshot copy.
 * Used by the Dedicated Worker and by Vitest in-process loopback.
 */

import type { WasmSimEngine } from './wasm-sim-engine'
import {
  encodeHingeAngleBuffer,
  type PhysicsWorkerCommand,
  type PhysicsWorkerFromWorker,
} from './physics-worker-protocol'
import {
  canUseSharedMemory,
  createSharedSnapshotBuffer,
  grownCapacities,
  SharedSnapshotWriter,
} from './physics-shared-layout'
import { TRANSFORM_STRIDE } from './transform-buffer'

export interface WorkerRuntimeState {
  hingeIds: Set<number>
}

export function createWorkerRuntimeState(): WorkerRuntimeState {
  return { hingeIds: new Set() }
}

/** Snapshot accessors the in-process engine exposes for HEAP copies. */
export interface WasmSnapshotSource {
  copyTransformBuffer(): ArrayBuffer
  copyContactBuffer(): { buffer: ArrayBuffer; count: number }
  getHingeAngle(id: number): number
  getStepCount(): number
}

export function applyPhysicsCommand(
  engine: Pick<
    WasmSimEngine,
    | 'setGravity'
    | 'setRollingResistance'
    | 'addStaticPlane'
    | 'addStaticBox'
    | 'addStaticCapsule'
    | 'addStaticCylinder'
    | 'addStaticSphere'
    | 'addStaticCone'
    | 'addStaticTriangleMesh'
    | 'addSensorVolume'
    | 'addKinematicMover'
    | 'setNextKinematicTransform'
    | 'setCollisionGroups'
    | 'clearStaticGeometry'
    | 'addForceField'
    | 'setForceFieldEnabled'
    | 'setForceFieldVector'
    | 'createBody'
    | 'createBoxBody'
    | 'removeBody'
    | 'applyForce'
    | 'applyImpulse'
    | 'setVelocity'
    | 'setAngularVelocity'
    | 'setBodyPosition'
    | 'setBodyRotation'
    | 'setBodyType'
    | 'createHinge'
    | 'setHingeMotor'
    | 'removeHinge'
    | 'step'
    | 'dispose'
  >,
  cmd: PhysicsWorkerCommand,
  state: WorkerRuntimeState,
): number {
  switch (cmd.type) {
    case 'setGravity':
      engine.setGravity(cmd.x, cmd.y, cmd.z)
      return 0
    case 'setRollingResistance':
      engine.setRollingResistance(cmd.rr)
      return 0
    case 'addStaticPlane':
      engine.addStaticPlane(cmd.normal, cmd.d, cmd.friction)
      return 0
    case 'addStaticBox':
      return engine.addStaticBox(cmd.center, cmd.halfExtents, cmd.rotation, cmd.restitution, cmd.friction)
    case 'addStaticCapsule':
      return engine.addStaticCapsule(
        cmd.center, cmd.radius, cmd.halfHeight, cmd.rotation, cmd.restitution, cmd.friction,
      )
    case 'addStaticCylinder':
      return engine.addStaticCylinder(
        cmd.center, cmd.radius, cmd.halfHeight, cmd.rotation, cmd.restitution, cmd.friction,
      )
    case 'addStaticSphere':
      return engine.addStaticSphere(cmd.center, cmd.radius, cmd.restitution, cmd.friction)
    case 'addStaticCone':
      return engine.addStaticCone(
        cmd.center, cmd.radius, cmd.halfHeight, cmd.rotation, cmd.restitution, cmd.friction,
      )
    case 'addStaticTriangleMesh':
      return engine.addStaticTriangleMesh(
        cmd.vertices, cmd.indices, cmd.restitution, cmd.friction, cmd.doubleSided,
      )
    case 'addSensorVolume':
      return engine.addSensorVolume(cmd.center, cmd.halfExtents, cmd.rotation, cmd.shape)
    case 'addKinematicMover':
      return engine.addKinematicMover(
        cmd.position, cmd.halfExtents, cmd.rotation, cmd.restitution, cmd.friction, cmd.shape,
      )
    case 'setNextKinematicTransform':
      engine.setNextKinematicTransform(cmd.id, cmd.position, cmd.rotation)
      return 0
    case 'setCollisionGroups':
      engine.setCollisionGroups(cmd.id, cmd.membership, cmd.filter)
      return 0
    case 'clearStaticGeometry':
      engine.clearStaticGeometry()
      return 0
    case 'addForceField':
      return engine.addForceField(cmd.desc)
    case 'setForceFieldEnabled':
      engine.setForceFieldEnabled(cmd.fieldId, cmd.enabled)
      return 0
    case 'setForceFieldVector':
      engine.setForceFieldVector(cmd.fieldId, cmd.fx, cmd.fy, cmd.fz)
      return 0
    case 'createBody':
      return engine.createBody(cmd.desc)
    case 'createBoxBody':
      return engine.createBoxBody(cmd.desc)
    case 'removeBody':
      engine.removeBody(cmd.id)
      return 0
    case 'applyForce':
      engine.applyForce(cmd.id, cmd.fx, cmd.fy, cmd.fz)
      return 0
    case 'applyImpulse':
      engine.applyImpulse(cmd.id, cmd.ix, cmd.iy, cmd.iz)
      return 0
    case 'setVelocity':
      engine.setVelocity(cmd.id, cmd.vx, cmd.vy, cmd.vz)
      return 0
    case 'setAngularVelocity':
      engine.setAngularVelocity(cmd.id, cmd.wx, cmd.wy, cmd.wz)
      return 0
    case 'setBodyPosition':
      engine.setBodyPosition(cmd.id, cmd.px, cmd.py, cmd.pz)
      return 0
    case 'setBodyRotation':
      engine.setBodyRotation(cmd.id, cmd.qx, cmd.qy, cmd.qz, cmd.qw)
      return 0
    case 'setBodyType':
      engine.setBodyType(cmd.id, cmd.bodyType)
      return 0
    case 'createHinge': {
      const id = engine.createHinge(cmd.desc)
      if (id >= 0) state.hingeIds.add(id)
      return id
    }
    case 'setHingeMotor':
      engine.setHingeMotor(cmd.id, cmd.targetVel, cmd.maxTorque)
      return 0
    case 'removeHinge':
      engine.removeHinge(cmd.id)
      state.hingeIds.delete(cmd.id)
      return 0
    case 'step':
      return engine.step(cmd.rawDt)
    case 'dispose':
      engine.dispose()
      state.hingeIds.clear()
      return 0
  }
}

export function collectStepSnapshot(
  source: WasmSnapshotSource,
  state: WorkerRuntimeState,
  alpha: number,
  stepMs: number,
): {
  alpha: number
  stepCount: number
  stepMs: number
  transformBuffer: ArrayBuffer
  contactBuffer: ArrayBuffer
  contactCount: number
  hingeBuffer: ArrayBuffer
} {
  const transforms = source.copyTransformBuffer()
  const contacts = source.copyContactBuffer()
  const hinges: Array<{ id: number; angle: number }> = []
  for (const id of state.hingeIds) {
    hinges.push({ id, angle: source.getHingeAngle(id) })
  }
  return {
    alpha,
    stepCount: source.getStepCount(),
    stepMs,
    transformBuffer: transforms,
    contactBuffer: contacts.buffer,
    contactCount: contacts.count,
    hingeBuffer: encodeHingeAngleBuffer(hinges),
  }
}

/** Zero-copy HEAP accessors for the shared transport. */
export interface WasmHeapSnapshotSource extends WasmSnapshotSource {
  getTransformHeapView(): Float32Array | null
  getContactHeapView(): { view: Float32Array; count: number } | null
}

export type WorkerPost = (msg: PhysicsWorkerFromWorker, transfer: Transferable[]) => void

/**
 * Worker-side snapshot publication after each stepped batch.
 *
 * Shared mode (requested by the client *and* possible in this realm) writes
 * HEAP straight into the shared buffer and posts nothing per step. When a step
 * outgrows the buffer it allocates a larger one and posts `shared-attach`
 * before writing to it. Past `SHARED_MAX_BYTES`, or without shared memory,
 * that step goes out as a transferred `step-result` instead.
 */
export class WorkerSnapshotPublisher {
  private writer: SharedSnapshotWriter | null = null
  private sharedRequested = false
  private readonly post: WorkerPost
  private readonly sharedAvailable: boolean

  constructor(post: WorkerPost, sharedAvailable = canUseSharedMemory()) {
    this.post = post
    this.sharedAvailable = sharedAvailable
  }

  requestShared(): void {
    this.sharedRequested = true
  }

  isShared(): boolean {
    return this.writer !== null
  }

  publish(source: WasmHeapSnapshotSource, state: WorkerRuntimeState, alpha: number, stepMs: number): void {
    if (this.sharedRequested && this.sharedAvailable && this.publishShared(source, state, alpha, stepMs)) return

    const snap = collectStepSnapshot(source, state, alpha, stepMs)
    this.post(
      { type: 'step-result', ...snap },
      [snap.transformBuffer, snap.contactBuffer, snap.hingeBuffer],
    )
  }

  private publishShared(
    source: WasmHeapSnapshotSource,
    state: WorkerRuntimeState,
    alpha: number,
    stepMs: number,
  ): boolean {
    const transforms = source.getTransformHeapView()
    const contacts = source.getContactHeapView()
    const transformFloats = transforms?.length ?? 0
    const contactCount = contacts?.count ?? 0
    const hingeCount = state.hingeIds.size

    let writer = this.writer
    if (!writer || !writer.fits(transformFloats, hingeCount) || writer.contactSpace() < contactCount) {
      const caps = grownCapacities(writer?.capacities ?? null, {
        transformSlots: Math.ceil(transformFloats / TRANSFORM_STRIDE),
        hinges: hingeCount,
        // Records still queued stay in the old ring; the new one starts empty.
        contacts: contactCount,
      })
      if (!caps) return false
      writer = new SharedSnapshotWriter(createSharedSnapshotBuffer(caps))
      this.writer = writer
      // Posted before the first write: the reader drains the old ring, then
      // switches, so contact order survives the swap.
      this.post({ type: 'shared-attach', buffer: writer.buffer }, [])
    }

    if (contacts) writer.pushContacts(contacts.view, contacts.count)
    writer.publish(alpha, source.getStepCount(), stepMs, transforms, state.hingeIds, (id) => source.getHingeAngle(id))
    return true
  }
}
