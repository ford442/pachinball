/**
 * Pose maths for adventure bodies that move while the C++ engine owns the
 * track (#383 cutover).
 *
 * Nothing here touches Rapier or the WASM module: `WasmOwner` advances each
 * moving body's pose in TypeScript and pushes the composed collider poses
 * through `setNextKinematicTransform`, so no Rapier world has to integrate a
 * kinematic body for the C++ movers to move.
 *
 * The engine-free pose helpers live in `src/core/pose-math.ts` (the WASM table
 * world needs them too) and are re-exported here for the adventure code.
 */

import type { DescQuat, DescVec3 } from '../../adventure/track-collider-descriptors'
import { quatMul } from '../../core/pose-math'

export {
  IDENTITY_POSE_ROTATION,
  composePose,
  quatMul,
  quatRotateVec,
  sphereTouchesVolume,
  type Pose,
  type VolumeKind,
} from '../../core/pose-math'

/**
 * Rotate `rotation` by a constant world-space angular velocity for `dt`.
 * Exact for constant ω (axis-angle, not a first-order step), so a platter
 * spun for N frames lands where N·dt·|ω| says it should.
 */
export function integrateSpin(rotation: DescQuat, angularVelocity: DescVec3, dt: number): DescQuat {
  const speed = Math.hypot(angularVelocity.x, angularVelocity.y, angularVelocity.z)
  if (speed < 1e-12 || dt <= 0) return rotation
  const half = (speed * dt) / 2
  const s = Math.sin(half) / speed
  const delta = { x: angularVelocity.x * s, y: angularVelocity.y * s, z: angularVelocity.z * s, w: Math.cos(half) }
  const q = quatMul(delta, rotation)
  const len = Math.hypot(q.x, q.y, q.z, q.w)
  return { x: q.x / len, y: q.y / len, z: q.z / len, w: q.w / len }
}

