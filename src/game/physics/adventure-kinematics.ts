/**
 * Pose maths for adventure bodies that move while the C++ engine owns the
 * track (#383 cutover).
 *
 * Nothing here touches Rapier or the WASM module: `WasmOwner` advances each
 * moving body's pose in TypeScript and pushes the composed collider poses
 * through `setNextKinematicTransform`, so no Rapier world has to integrate a
 * kinematic body for the C++ movers to move.
 */

import type { DescQuat, DescVec3 } from '../../adventure/track-collider-descriptors'

export interface Pose {
  position: DescVec3
  rotation: DescQuat
}

export type VolumeKind = 'box' | 'cylinder' | 'sphere'

export const IDENTITY_POSE_ROTATION: DescQuat = { x: 0, y: 0, z: 0, w: 1 }

export function quatMul(a: DescQuat, b: DescQuat): DescQuat {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  }
}

export function quatRotateVec(q: DescQuat, v: DescVec3): DescVec3 {
  const ux = q.y * v.z - q.z * v.y
  const uy = q.z * v.x - q.x * v.z
  const uz = q.x * v.y - q.y * v.x
  return {
    x: v.x + 2 * (q.w * ux + (q.y * uz - q.z * uy)),
    y: v.y + 2 * (q.w * uy + (q.z * ux - q.x * uz)),
    z: v.z + 2 * (q.w * uz + (q.x * uy - q.y * ux)),
  }
}

/** `local` expressed in the frame of `parent`. */
export function composePose(parent: Pose, local: Pose): Pose {
  const offset = quatRotateVec(parent.rotation, local.position)
  return {
    position: {
      x: parent.position.x + offset.x,
      y: parent.position.y + offset.y,
      z: parent.position.z + offset.z,
    },
    rotation: quatMul(parent.rotation, local.rotation),
  }
}

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

/**
 * Whether a sphere touches a volume at `pose`. `halfExtents` follows the C++
 * VolumeShape convention: box (hx, hy, hz), cylinder (r, halfHeight, r) along
 * local Y, sphere (r, r, r).
 *
 * Used for sensors that ride on a moving body (casino-heist's roulette
 * pockets): C++ sensor volumes are static, and a trigger applies no impulse,
 * so testing it here against the C++ ball position is the whole behaviour.
 */
export function sphereTouchesVolume(
  center: DescVec3,
  radius: number,
  kind: VolumeKind,
  halfExtents: DescVec3,
  pose: Pose
): boolean {
  const inv = { x: -pose.rotation.x, y: -pose.rotation.y, z: -pose.rotation.z, w: pose.rotation.w }
  const p = quatRotateVec(inv, {
    x: center.x - pose.position.x,
    y: center.y - pose.position.y,
    z: center.z - pose.position.z,
  })
  const clamp = (v: number, h: number) => Math.max(-h, Math.min(h, v))

  let dx: number
  let dy: number
  let dz: number
  if (kind === 'sphere') {
    const reach = halfExtents.x + radius
    return p.x * p.x + p.y * p.y + p.z * p.z <= reach * reach
  } else if (kind === 'cylinder') {
    const radial = Math.hypot(p.x, p.z)
    const excess = Math.max(0, radial - halfExtents.x)
    const scale = radial > 1e-12 ? excess / radial : 0
    dx = p.x * scale
    dz = p.z * scale
    dy = p.y - clamp(p.y, halfExtents.y)
  } else {
    dx = p.x - clamp(p.x, halfExtents.x)
    dy = p.y - clamp(p.y, halfExtents.y)
    dz = p.z - clamp(p.z, halfExtents.z)
  }
  return dx * dx + dy * dy + dz * dz <= radius * radius
}
