/**
 * postMessage protocol for #361 Phase 1 (transferable ArrayBuffers, no SAB).
 * JSON-serializable commands plus packed float snapshots on STEP_RESULT.
 */

import type { WasmBodyDesc, WasmHingeDesc } from './PhysicsModule'

/** Mirrors native PhysicsWorld.h static collider id bases. */
export const STATIC_BOX_ID_BASE = -1000
export const STATIC_CAPSULE_ID_BASE = -2000

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

  allocBody(): number {
    return this.nextBodyId++
  }

  allocHinge(): number {
    return this.nextHingeId++
  }

  allocStaticBox(): number {
    const idx = this.nextBox++
    return STATIC_BOX_ID_BASE - idx
  }

  allocStaticCapsule(): number {
    const idx = this.nextCapsule++
    return STATIC_CAPSULE_ID_BASE - idx
  }

  reset(): void {
    this.nextBodyId = 0
    this.nextHingeId = 0
    this.nextBox = 0
    this.nextCapsule = 0
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
