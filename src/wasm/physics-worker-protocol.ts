/**
 * Worker protocol for `wasm-worker` (#361 / #414).
 *
 * Commands always travel main → worker as one ordered `postMessage` batch per
 * frame. Snapshots come back either over the shared layout in
 * `physics-shared-layout.ts` (cross-origin isolated) or as transferred
 * `ArrayBuffer`s on `step-result` (the fallback, and the overflow path).
 */

import type {
  WasmBodyDesc,
  WasmBodyType,
  WasmBoxBodyDesc,
  WasmForceFieldDesc,
  WasmHingeDesc,
  WasmVolumeShape,
} from './PhysicsModule'
import type { PinFieldSpec } from '../core/pin-field'
import { STATIC_HANDLE_OVERFLOW, type WasmSnapshotStatus } from './wasm-types'

/** Mirrors native PhysicsWorld.h static collider id bases. */
export const STATIC_BOX_ID_BASE = -1000
export const STATIC_CAPSULE_ID_BASE = -2000
export const KINEMATIC_MOVER_ID_BASE = -3000
export const SENSOR_VOLUME_ID_BASE = -4000
export const STATIC_CYLINDER_ID_BASE = -5000
export const STATIC_MESH_ID_BASE = -6000
export const FORCE_FIELD_ID_BASE = -7000
export const STATIC_SPHERE_ID_BASE = -8000
export const STATIC_CONE_ID_BASE = -9000
export const PIN_FIELD_ID_BASE = -10000

/**
 * Mirrors native `STATIC_HANDLE_CAPACITY` in PhysicsWorld.h. Families are
 * spaced 1000 apart, so the 1001st shape of a family would take the next
 * family's base and alias it.
 */
export const STATIC_HANDLE_CAPACITY = 1000

export { STATIC_HANDLE_OVERFLOW } from './wasm-types'

/** Packed hinge snapshot: id, angle (radians) per entry. */
export const HINGE_ANGLE_STRIDE = 2

export type Vec3Msg = { x: number; y: number; z: number }
export type QuatMsg = { x: number; y: number; z: number; w: number }

export type PhysicsWorkerCommand =
  | { type: 'setGravity'; x: number; y: number; z: number }
  | { type: 'setRollingResistance'; rr: number }
  | { type: 'addStaticPlane'; normal: Vec3Msg; d: number; friction: number }
  | { type: 'addStaticBox'; center: Vec3Msg; halfExtents: Vec3Msg; rotation: QuatMsg; restitution: number; friction: number }
  | { type: 'addStaticCapsule'; center: Vec3Msg; radius: number; halfHeight: number; rotation: QuatMsg; restitution: number; friction: number }
  | { type: 'addStaticCylinder'; center: Vec3Msg; radius: number; halfHeight: number; rotation: QuatMsg; restitution: number; friction: number }
  | { type: 'addStaticSphere'; center: Vec3Msg; radius: number; restitution: number; friction: number }
  | { type: 'addStaticCone'; center: Vec3Msg; radius: number; halfHeight: number; rotation: QuatMsg; restitution: number; friction: number }
  /** One command per lattice — never one `addStaticCylinder` per pin. `desc.occupancy` is transferred. */
  | { type: 'addPinField'; desc: PinFieldSpec }
  | { type: 'addStaticTriangleMesh'; vertices: Float32Array; indices: Uint32Array; restitution: number; friction: number; doubleSided: boolean }
  | { type: 'addSensorVolume'; center: Vec3Msg; halfExtents: Vec3Msg; rotation: QuatMsg; shape: WasmVolumeShape }
  | { type: 'addKinematicMover'; position: Vec3Msg; halfExtents: Vec3Msg; rotation: QuatMsg; restitution: number; friction: number; shape: WasmVolumeShape }
  /** `id` is a mover (negative) or a kinematic rigid body (≥ 0). */
  | { type: 'setNextKinematicTransform'; id: number; position: Vec3Msg; rotation: QuatMsg }
  | { type: 'setCollisionGroups'; id: number; membership: number; filter: number }
  | { type: 'clearStaticGeometry' }
  | { type: 'addForceField'; desc: WasmForceFieldDesc }
  | { type: 'setForceFieldEnabled'; fieldId: number; enabled: boolean }
  | { type: 'setForceFieldVector'; fieldId: number; fx: number; fy: number; fz: number }
  | { type: 'createBody'; desc: WasmBodyDesc }
  | { type: 'createBoxBody'; desc: WasmBoxBodyDesc }
  | { type: 'removeBody'; id: number }
  | { type: 'applyForce'; id: number; fx: number; fy: number; fz: number }
  | { type: 'applyImpulse'; id: number; ix: number; iy: number; iz: number }
  | { type: 'setVelocity'; id: number; vx: number; vy: number; vz: number }
  | { type: 'setAngularVelocity'; id: number; wx: number; wy: number; wz: number }
  | { type: 'setBodyPosition'; id: number; px: number; py: number; pz: number }
  | { type: 'setBodyRotation'; id: number; qx: number; qy: number; qz: number; qw: number }
  | { type: 'setBodyType'; id: number; bodyType: WasmBodyType }
  | { type: 'createHinge'; desc: WasmHingeDesc }
  | { type: 'setHingeMotor'; id: number; targetVel: number; maxTorque: number }
  | { type: 'removeHinge'; id: number }
  | { type: 'step'; rawDt: number }
  | { type: 'dispose' }
  /**
   * World snapshot request/reply (#441). Carried in the ordered batch like any
   * mutator, so it takes effect exactly where it was issued (e.g. right before
   * the frame's `step`); the worker answers with a `snapshot-reply` carrying
   * the same `requestId`. Off the hot path: replay capture / spectate / debug.
   */
  | { type: 'serializeSnapshot'; requestId: number }
  /** `bytes` is transferred. */
  | { type: 'restoreSnapshot'; requestId: number; bytes: Uint8Array }

export type PhysicsWorkerToWorker =
  | { type: 'init'; bundleUrl: string }
  /**
   * Opt the worker into the shared snapshot layout. Sent only when the page is
   * cross-origin isolated; the worker allocates the buffer itself (it knows the
   * slot count) and answers with `shared-attach`.
   */
  | { type: 'use-shared-transport' }
  | { type: 'batch'; commands: PhysicsWorkerCommand[] }

export type PhysicsWorkerStepResult = {
  type: 'step-result'
  alpha: number
  stepCount: number
  stepMs: number
  transformBuffer: ArrayBuffer
  contactBuffer: ArrayBuffer
  contactCount: number
  hingeBuffer: ArrayBuffer
}

/**
 * The worker switched to a (new) shared buffer. Every write to the previous
 * buffer finished before this was posted, so the receiver drains the old
 * contact ring before reading the new one.
 */
export type PhysicsWorkerSharedAttach = {
  type: 'shared-attach'
  buffer: SharedArrayBuffer
}

/**
 * Answer to `serializeSnapshot` / `restoreSnapshot`, posted after the batch
 * that carried the request and before that batch's step result.
 */
export type PhysicsWorkerSnapshotReply = {
  type: 'snapshot-reply'
  requestId: number
  /** `serializeSnapshot`: the blob (transferred), null when the bundle cannot snapshot. */
  bytes: Uint8Array | null
  /** `restoreSnapshot`: the restore status; `serializeSnapshot`: Ok or Unsupported. */
  status: WasmSnapshotStatus
  /** The worker world's static-table hash after the operation. */
  staticHash: string | null
  /** The worker world's step counter after the operation. */
  stepCount: number
}

export type PhysicsWorkerFromWorker =
  | { type: 'ready' }
  | { type: 'error'; message: string }
  | PhysicsWorkerStepResult
  | PhysicsWorkerSharedAttach
  | PhysicsWorkerSnapshotReply

/**
 * Client-side id allocator matching C++ HandleTable + static collider ids.
 * Body/hinge ids are monotonic and never reused. Failed createHinge in C++
 * does not increment — callers must only alloc on commands they actually send.
 */
export class WasmIdShadow {
  private nextBodyId = 0
  private nextHingeId = 0
  private nextBox = 0
  private nextCapsule = 0
  private nextCylinder = 0
  private nextSphere = 0
  private nextCone = 0
  private nextPinField = 0
  private nextMover = 0
  private nextSensor = 0
  private nextMesh = 0
  private nextField = 0

  allocBody(): number {
    return this.nextBodyId++
  }

  allocHinge(): number {
    return this.nextHingeId++
  }

  allocStaticBox(): number {
    if (this.nextBox >= STATIC_HANDLE_CAPACITY) return STATIC_HANDLE_OVERFLOW
    const idx = this.nextBox++
    return STATIC_BOX_ID_BASE - idx
  }

  allocStaticCapsule(): number {
    if (this.nextCapsule >= STATIC_HANDLE_CAPACITY) return STATIC_HANDLE_OVERFLOW
    const idx = this.nextCapsule++
    return STATIC_CAPSULE_ID_BASE - idx
  }

  allocStaticCylinder(): number {
    if (this.nextCylinder >= STATIC_HANDLE_CAPACITY) return STATIC_HANDLE_OVERFLOW
    const idx = this.nextCylinder++
    return STATIC_CYLINDER_ID_BASE - idx
  }

  allocStaticSphere(): number {
    if (this.nextSphere >= STATIC_HANDLE_CAPACITY) return STATIC_HANDLE_OVERFLOW
    const idx = this.nextSphere++
    return STATIC_SPHERE_ID_BASE - idx
  }

  allocStaticCone(): number {
    if (this.nextCone >= STATIC_HANDLE_CAPACITY) return STATIC_HANDLE_OVERFLOW
    const idx = this.nextCone++
    return STATIC_CONE_ID_BASE - idx
  }

  /** A whole pin lattice consumes one slot of its own family. */
  allocPinField(): number {
    if (this.nextPinField >= STATIC_HANDLE_CAPACITY) return STATIC_HANDLE_OVERFLOW
    const idx = this.nextPinField++
    return PIN_FIELD_ID_BASE - idx
  }

  allocKinematicMover(): number {
    if (this.nextMover >= STATIC_HANDLE_CAPACITY) return STATIC_HANDLE_OVERFLOW
    const idx = this.nextMover++
    return KINEMATIC_MOVER_ID_BASE - idx
  }

  allocSensorVolume(): number {
    if (this.nextSensor >= STATIC_HANDLE_CAPACITY) return STATIC_HANDLE_OVERFLOW
    const idx = this.nextSensor++
    return SENSOR_VOLUME_ID_BASE - idx
  }

  /**
   * Native meshes and force fields have no capacity check, so neither does
   * the shadow: it must hand out exactly the id C++ will.
   */
  allocStaticMesh(): number {
    return STATIC_MESH_ID_BASE - this.nextMesh++
  }

  allocForceField(): number {
    return FORCE_FIELD_ID_BASE - this.nextField++
  }

  /** Mirror of PhysicsWorld::clearStaticGeometry — negative handles restart. */
  resetStaticHandles(): void {
    this.nextMesh = 0
    this.nextField = 0
    this.nextBox = 0
    this.nextCapsule = 0
    this.nextCylinder = 0
    this.nextSphere = 0
    this.nextCone = 0
    this.nextPinField = 0
    this.nextMover = 0
    this.nextSensor = 0
  }

  reset(): void {
    this.resetStaticHandles()
    this.nextBodyId = 0
    this.nextHingeId = 0
  }

  /** Body / hinge counters, to save around a restore and put back if it fails. */
  getCounters(): { nextBodyId: number; nextHingeId: number } {
    return { nextBodyId: this.nextBodyId, nextHingeId: this.nextHingeId }
  }

  /**
   * A world snapshot restore replaces bodies and hinges with their recorded
   * ids, and the C++ counters with the recorded ones (`readSnapshotIds`).
   * Static handles are rebuilt, not restored, so those counters stay.
   */
  adoptCounters(counters: { nextBodyId: number; nextHingeId: number }): void {
    this.nextBodyId = counters.nextBodyId
    this.nextHingeId = counters.nextHingeId
  }
}

export function cloneFloat32Array(source: ArrayLike<number>): ArrayBuffer {
  const copy = new Float32Array(source.length)
  copy.set(source)
  return copy.buffer
}

export function encodeHingeAngleBuffer(
  entries: Array<{ id: number; angle: number }>,
): ArrayBuffer {
  const buf = new Float32Array(entries.length * HINGE_ANGLE_STRIDE)
  for (let i = 0; i < entries.length; i++) {
    const o = i * HINGE_ANGLE_STRIDE
    buf[o] = entries[i].id
    buf[o + 1] = entries[i].angle
  }
  return buf.buffer
}

export function decodeHingeAngle(
  data: ArrayLike<number>,
  hingeId: number,
  stride = HINGE_ANGLE_STRIDE,
): number {
  const n = data.length
  for (let o = 0; o + 1 < n; o += stride) {
    if (data[o] === hingeId) return data[o + 1] ?? 0
  }
  return 0
}
