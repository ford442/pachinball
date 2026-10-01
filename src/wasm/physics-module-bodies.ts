/**
 * Table-statics / rigid-body / hinge half of the in-process WASM engine: the
 * infinite plane and oriented box / capsule statics, dynamic sphere + capsule
 * bodies, the transform-query fallbacks, and world-anchored hinges (flippers).
 *
 * `WasmPhysicsEngine` (PhysicsModule.ts) owns loading, the world, stepping and
 * the transform / contact buffers, and delegates each of these methods here
 * with its private world. Functions take `null` for a dormant engine and
 * return -1 (or no-op), matching the wrapper's "not ready" contract — the same
 * pattern as physics-module-adventure.ts.
 *
 * Stays lib-agnostic: part of the Worker-lib compile graph (tsconfig.worker.json).
 */

import type { WasmPhysicsWorldInstance } from './wasm-types'
import type { WasmBodyType } from './physics-module-adventure'

type Vec3 = { x: number; y: number; z: number }
type Quat = { x: number; y: number; z: number; w: number }
type World = WasmPhysicsWorldInstance | null

const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 }

// ---------------------------------------------------------------------------
// Descriptors
// ---------------------------------------------------------------------------

export interface WasmBodyDesc {
  position?:       Vec3
  velocity?:       Vec3
  mass?:           number  // kg, default 1
  radius?:         number  // metres; sphere radius, or capsule radius, default 0.1
  restitution?:    number  // 0–1, default 0.4
  linearDamping?:  number  // 0–1, default 0.02
  /** Coulomb friction coefficient, default 0.2. Combined per-pair as sqrt(μ_a μ_b). */
  friction?:       number
  /** Angular drag factor for dynamic spheres, default 0.1. */
  angularDamping?: number
  /** 0=Dynamic, 1=Static, 2=Kinematic */
  bodyType?:       WasmBodyType
  /** 'sphere' (default) or 'capsule' — capsule segment runs along local +Y. */
  shape?:          'sphere' | 'capsule'
  /** Half-length of the capsule segment (metres). Ignored for sphere shape. */
  capsuleHalfHeight?: number
}

/** World-anchored revolute hinge (flipper vs static table). */
export interface WasmHingeDesc {
  bodyId: number
  worldAnchor: Vec3
  worldAxis?: Vec3
  minAngle?: number
  maxAngle?: number
}

// ---------------------------------------------------------------------------
// Table statics
// ---------------------------------------------------------------------------

export function addStaticPlane(world: World, normal: Vec3, d: number, friction = 0.2): void {
  world?.addStaticPlane(normal.x, normal.y, normal.z, d, friction)
}

export function addStaticBox(
  world: World, center: Vec3, halfExtents: Vec3,
  rotation: Quat = IDENTITY, restitution = 0.4, friction = 0.2,
): number {
  if (!world) return -1
  return world.addStaticBox(
    center.x, center.y, center.z,
    halfExtents.x, halfExtents.y, halfExtents.z,
    rotation.x, rotation.y, rotation.z, rotation.w,
    restitution,
    friction
  )
}

export function addStaticCapsule(
  world: World, center: Vec3, radius: number, halfHeight: number,
  rotation: Quat = IDENTITY, restitution = 0.4, friction = 0.2,
): number {
  if (!world) return -1
  return world.addStaticCapsule(
    center.x, center.y, center.z,
    radius, halfHeight,
    rotation.x, rotation.y, rotation.z, rotation.w,
    restitution,
    friction
  )
}

// ---------------------------------------------------------------------------
// Rigid bodies
// ---------------------------------------------------------------------------

export function createBody(world: World, desc: WasmBodyDesc = {}): number {
  if (!world) return -1
  const p = desc.position      ?? { x: 0, y: 0, z: 0 }
  const v = desc.velocity      ?? { x: 0, y: 0, z: 0 }
  return world.createRigidBody(
    p.x, p.y, p.z,
    v.x, v.y, v.z,
    desc.mass          ?? 1,
    desc.radius        ?? 0.1,
    desc.restitution   ?? 0.4,
    desc.linearDamping ?? 0.02,
    desc.bodyType      ?? 0,
    desc.shape === 'capsule' ? 1 : 0,
    desc.capsuleHalfHeight ?? 0.5,
    desc.friction          ?? 0.2,
    desc.angularDamping    ?? 0.1
  )
}

/**
 * Per-getter fallbacks for the transform queries: the engine reads its packed
 * transform buffer first and only falls back to these Embind getters when the
 * buffer has no snapshot for the id (or is not allocated). A dormant world
 * reads as the origin / identity.
 */
export function readPosition(world: World, id: number): Vec3 {
  if (!world) return { x: 0, y: 0, z: 0 }
  return { x: world.getPosX(id), y: world.getPosY(id), z: world.getPosZ(id) }
}

export function readVelocity(world: World, id: number): Vec3 {
  if (!world) return { x: 0, y: 0, z: 0 }
  return { x: world.getVelX(id), y: world.getVelY(id), z: world.getVelZ(id) }
}

export function readAngularVelocity(world: World, id: number): Vec3 {
  if (!world) return { x: 0, y: 0, z: 0 }
  return { x: world.getAngVelX(id), y: world.getAngVelY(id), z: world.getAngVelZ(id) }
}

export function readRotation(world: World, id: number): Quat {
  if (!world) return { x: 0, y: 0, z: 0, w: 1 }
  return { x: world.getRotX(id), y: world.getRotY(id), z: world.getRotZ(id), w: world.getRotW(id) }
}

// ---------------------------------------------------------------------------
// Hinges
// ---------------------------------------------------------------------------

export function createHinge(world: World, desc: WasmHingeDesc): number {
  if (!world?.createHinge) return -1
  const a = desc.worldAnchor
  const n = desc.worldAxis ?? { x: 0, y: 1, z: 0 }
  return world.createHinge(
    desc.bodyId,
    a.x, a.y, a.z,
    n.x, n.y, n.z,
    desc.minAngle ?? -Math.PI,
    desc.maxAngle ?? Math.PI
  )
}

export function setHingeMotor(world: World, id: number, targetVel: number, maxTorque: number): void {
  world?.setHingeMotor?.(id, targetVel, maxTorque)
}

export function getHingeAngle(world: World, id: number): number {
  return world?.getHingeAngle?.(id) ?? 0
}

export function removeHinge(world: World, id: number): void {
  world?.removeHinge?.(id)
}
