/**
 * Pure pose maths shared by the C++ owner path (#412): the WASM table world
 * (`src/wasm/`), the static and adventure exporters, and the adventure
 * kinematics. No engine, Rapier or Babylon dependency.
 */

import type { PhysicsRotation, PhysicsVector } from './physics-api'

export interface Pose {
  position: PhysicsVector
  rotation: PhysicsRotation
}

export type VolumeKind = 'box' | 'cylinder' | 'sphere'

export const IDENTITY_POSE_ROTATION: PhysicsRotation = { x: 0, y: 0, z: 0, w: 1 }

export function quatMul(a: PhysicsRotation, b: PhysicsRotation): PhysicsRotation {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  }
}

export function quatRotateVec(q: PhysicsRotation, v: PhysicsVector): PhysicsVector {
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
 * Whether a sphere touches a volume at `pose`. `halfExtents` follows the C++
 * VolumeShape convention: box (hx, hy, hz), cylinder (r, halfHeight, r) along
 * local Y, sphere (r, r, r).
 *
 * Used for sensors that ride on a moving body (casino-heist's roulette
 * pockets): C++ sensor volumes are static, and a trigger applies no impulse,
 * so testing it here against the C++ ball position is the whole behaviour.
 */
export function sphereTouchesVolume(
  center: PhysicsVector,
  radius: number,
  kind: VolumeKind,
  halfExtents: PhysicsVector,
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
