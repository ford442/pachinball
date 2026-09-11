/**
 * postMessage protocol for #361 Phase 1 (transferable ArrayBuffers, no SAB).
 * JSON-serializable commands plus packed float snapshots on STEP_RESULT.
 */

import type { WasmBodyDesc, WasmHingeDesc } from './PhysicsModule'
import { STATIC_HANDLE_OVERFLOW } from './wasm-types'

/** Mirrors native PhysicsWorld.h static collider id bases. */
export const STATIC_BOX_ID_BASE = -1000
export const STATIC_CAPSULE_ID_BASE = -2000
export const KINEMATIC_MOVER_ID_BASE = -3000
export const SENSOR_VOLUME_ID_BASE = -4000
export const STATIC_CYLINDER_ID_BASE = -5000
export const STATIC_SPHERE_ID_BASE = -8000

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
  | { type: 'addSensorVolume'; center: Vec3Msg; halfExtents: Vec3Msg; rotation: QuatMsg }
  | { type: 'addKinematicMover'; position: Vec3Msg; halfExtents: Vec3Msg; rotation: QuatMsg; restitution: number; friction: number }
  | { type: 'setNextKinematicTransform'; moverId: number; position: Vec3Msg; rotation: QuatMsg }
  | { type: 'setCollisionGroups'; id: number; membership: number; filter: number }
  | { type: 'clearStaticGeometry' }
  | { type: 'createBody'; desc: WasmBodyDesc }
  | { type: 'removeBody'; id: number }
  | { type: 'applyForce'; id: number; fx: number; fy: number; fz: number }
  | { type: 'applyImpulse'; id: number; ix: number; iy: number; iz: number }
  | { type: 'setVelocity'; id: number; vx: number; vy: number; vz: number }
  | { type: 'setAngularVelocity'; id: number; wx: number; wy: number; wz: number }
  | { type: 'setBodyPosition'; id: number; px: number; py: number; pz: number }
  | { type: 'setBodyRotation'; id: number; qx: number; qy: number; qz: number; qw: number }
  | { type: 'createHinge'; desc: WasmHingeDesc }
  | { type: 'setHingeMotor'; id: number; targetVel: number; maxTorque: number }
  | { type: 'removeHinge'; id: number }
  | { type: 'step'; rawDt: number }
  | { type: 'dispose' }

export type PhysicsWorkerToWorker =
  | { type: 'init'; bundleUrl: string }
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

export type PhysicsWorkerFromWorker =
  | { type: 'ready' }
  | { type: 'error'; message: string }
  | PhysicsWorkerStepResult

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
  private nextMover = 0
  private nextSensor = 0

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

  /** Mirror of PhysicsWorld::clearStaticGeometry — negative handles restart. */
  resetStaticHandles(): void {
    this.nextBox = 0
    this.nextCapsule = 0
    this.nextCylinder = 0
    this.nextSphere = 0
    this.nextMover = 0
    this.nextSensor = 0
  }

  reset(): void {
    this.nextBodyId = 0
    this.nextHingeId = 0
    this.nextBox = 0
    this.nextCapsule = 0
    this.nextCylinder = 0
    this.nextSphere = 0
    this.nextMover = 0
    this.nextSensor = 0
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
