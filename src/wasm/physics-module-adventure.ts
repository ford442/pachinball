/**
 * Adventure-geometry half of the in-process WASM engine: static cylinders /
 * spheres / cones / triangle meshes, kinematic movers, sensor volumes, dynamic
 * boxes, force fields and pin fields (#383 Slice A/B, cones #420, pin fields #421).
 *
 * `WasmPhysicsEngine` (PhysicsModule.ts) owns loading, the world, bodies and
 * hinges, and delegates each adventure method here with its private world /
 * module. Functions take `null` for a dormant engine and return -1 (or no-op),
 * matching the wrapper's "not ready" contract.
 *
 * Stays lib-agnostic: part of the Worker-lib compile graph (tsconfig.worker.json).
 */

import type { PinFieldSpec } from '../core/pin-field'
import type { WasmPhysicsModule, WasmPhysicsWorldInstance } from './wasm-types'

type Vec3 = { x: number; y: number; z: number }
type Quat = { x: number; y: number; z: number; w: number }
type World = WasmPhysicsWorldInstance | null

const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 }

/**
 * Shape tag for the volume colliders (kinematic movers, sensor volumes).
 * Mirrors `VolumeShape` in native/src/VolumeShape.h — do not renumber
 * independently of that file.
 *
 * `halfExtents` is read per tag: Box takes all three, Cylinder reads
 * (radius, halfHeight, radius), Sphere reads (radius, _, _).
 */
export const WasmVolumeShape = {
  Box: 0,
  Cylinder: 1,
  Sphere: 2,
} as const
export type WasmVolumeShape = (typeof WasmVolumeShape)[keyof typeof WasmVolumeShape]

/** Mirrors native `BodyType` (RigidBody.h): the runtime body-type flip (#420). */
export const WasmBodyType = {
  Dynamic: 0,
  Static: 1,
  Kinematic: 2,
} as const
export type WasmBodyType = (typeof WasmBodyType)[keyof typeof WasmBodyType]

/** Whether a force field's vector is world-space or in the field's own frame. */
export const WasmForceSpace = {
  World: 0,
  Local: 1,
} as const
export type WasmForceSpace = (typeof WasmForceSpace)[keyof typeof WasmForceSpace]

/** Dynamic oriented-box body (Firewall-style crate). */
export interface WasmBoxBodyDesc {
  position?:       Vec3
  velocity?:       Vec3
  halfExtents:     Vec3
  mass?:           number
  restitution?:    number
  linearDamping?:  number
  friction?:       number
  angularDamping?: number
  /** 0=Dynamic, 1=Static, 2=Kinematic */
  bodyType?:       WasmBodyType
}

/** Oriented box force region — updraft, conveyor, solar wind. */
export interface WasmForceFieldDesc {
  center:       Vec3
  halfExtents:  Vec3
  rotation?:    Quat
  /** Acceleration in m/s² when `acceleration` is set, otherwise force in newtons. */
  force:        Vec3
  space?:       WasmForceSpace
  /** Mass-independent form — a light ball and a heavy one drift alike. */
  acceleration?: boolean
}

/** HEAPF32 view, rebuilt from `wasmMemory` when the runtime method is not exported. */
export function heapF32(mod: WasmPhysicsModule | null): Float32Array | null {
  if (!mod) return null
  if (mod.HEAPF32) return mod.HEAPF32
  return mod.wasmMemory?.buffer ? new Float32Array(mod.wasmMemory.buffer) : null
}

export function addStaticCylinder(
  world: World, center: Vec3, radius: number, halfHeight: number,
  rotation: Quat = IDENTITY, restitution = 0.4, friction = 0.2,
): number {
  if (!world) return -1
  return world.addStaticCylinder(
    center.x, center.y, center.z,
    radius, halfHeight,
    rotation.x, rotation.y, rotation.z, rotation.w,
    restitution,
    friction
  )
}

export function addStaticSphere(
  world: World, center: Vec3, radius: number, restitution = 0.4, friction = 0.2,
): number {
  if (!world) return -1
  return world.addStaticSphere(center.x, center.y, center.z, radius, restitution, friction)
}

export function addStaticCone(
  world: World, center: Vec3, radius: number, halfHeight: number,
  rotation: Quat = IDENTITY, restitution = 0.4, friction = 0.2,
): number {
  if (!world?.addStaticCone) return -1
  return world.addStaticCone(
    center.x, center.y, center.z,
    radius, halfHeight,
    rotation.x, rotation.y, rotation.z, rotation.w,
    restitution,
    friction
  )
}

export function addKinematicMover(
  world: World, position: Vec3, halfExtents: Vec3, rotation: Quat = IDENTITY,
  restitution = 0.4, friction = 0.2, shape: WasmVolumeShape = WasmVolumeShape.Box,
): number {
  if (!world) return -1
  if (world.addKinematicMoverShaped) {
    return world.addKinematicMoverShaped(
      shape,
      position.x, position.y, position.z,
      halfExtents.x, halfExtents.y, halfExtents.z,
      rotation.x, rotation.y, rotation.z, rotation.w,
      restitution,
      friction
    )
  }
  return world.addKinematicMover(
    position.x, position.y, position.z,
    halfExtents.x, halfExtents.y, halfExtents.z,
    rotation.x, rotation.y, rotation.z, rotation.w,
    restitution,
    friction
  )
}

export function setNextKinematicTransform(
  world: World, id: number, position: Vec3, rotation: Quat,
): void {
  world?.setNextKinematicTransform(
    id,
    position.x, position.y, position.z,
    rotation.x, rotation.y, rotation.z, rotation.w
  )
}

export function addSensorVolume(
  world: World, center: Vec3, halfExtents: Vec3, rotation: Quat = IDENTITY,
  shape: WasmVolumeShape = WasmVolumeShape.Box,
): number {
  if (!world) return -1
  if (world.addSensorVolumeShaped) {
    return world.addSensorVolumeShaped(
      shape,
      center.x, center.y, center.z,
      halfExtents.x, halfExtents.y, halfExtents.z,
      rotation.x, rotation.y, rotation.z, rotation.w
    )
  }
  return world.addSensorVolume(
    center.x, center.y, center.z,
    halfExtents.x, halfExtents.y, halfExtents.z,
    rotation.x, rotation.y, rotation.z, rotation.w
  )
}

/**
 * The arrays are copied into the WASM heap for the duration of the call and
 * freed immediately: the C++ side denormalizes them into its own triangle
 * soup, so it keeps no reference to this memory.
 */
export function addStaticTriangleMesh(
  world: World, mod: WasmPhysicsModule | null,
  vertices: Float32Array, indices: Uint32Array,
  restitution = 0.4, friction = 0.2, doubleSided = false,
): number {
  if (!world?.addStaticTriangleMesh || !mod?._malloc || !mod._free) return -1
  if (vertices.length < 9 || indices.length < 3) return -1

  const vertexPtr = mod._malloc(vertices.byteLength)
  const indexPtr = mod._malloc(indices.byteLength)
  if (!vertexPtr || !indexPtr) {
    if (vertexPtr) mod._free(vertexPtr)
    if (indexPtr) mod._free(indexPtr)
    return -1
  }

  try {
    // Re-read the heap views after _malloc: a growing heap detaches them.
    const f32 = heapF32(mod)
    const u32 = mod.HEAPU32 ?? (mod.wasmMemory ? new Uint32Array(mod.wasmMemory.buffer) : null)
    if (!f32 || !u32) return -1

    f32.set(vertices, vertexPtr >> 2)
    u32.set(indices, indexPtr >> 2)

    return world.addStaticTriangleMesh(
      vertexPtr, vertices.length / 3,
      indexPtr, indices.length,
      restitution, friction, doubleSided
    )
  } finally {
    mod._free(vertexPtr)
    mod._free(indexPtr)
  }
}

/**
 * One pin lattice → one C++ handle (#421). Keep-outs and the occupancy mask
 * are copied into the heap for the call and freed straight after; C++ keeps
 * its own copy. Collision groups travel separately (`setCollisionGroups` on
 * the returned id), as for every other static.
 */
export function addPinField(world: World, mod: WasmPhysicsModule | null, spec: PinFieldSpec): number {
  if (!world?.addPinField || !mod?._malloc || !mod._free) return -1
  const keepOuts = spec.keepOuts ?? []
  const mask = spec.occupancy ?? new Uint8Array(0)
  const keepOutBytes = keepOuts.length * 16
  const keepOutPtr = keepOutBytes > 0 ? mod._malloc(keepOutBytes) : 0
  const maskPtr = mask.byteLength > 0 ? mod._malloc(mask.byteLength) : 0
  const release = () => {
    if (keepOutPtr) mod._free!(keepOutPtr)
    if (maskPtr) mod._free!(maskPtr)
  }
  if ((keepOutBytes > 0 && !keepOutPtr) || (mask.byteLength > 0 && !maskPtr)) {
    release()
    return -1
  }

  try {
    // Re-read the heap views after _malloc: a growing heap detaches them.
    const f32 = heapF32(mod)
    if (!f32) return -1
    if (keepOutPtr) {
      const base = keepOutPtr >> 2
      keepOuts.forEach((k, i) => f32.set([k.minX, k.maxX, k.minZ, k.maxZ], base + i * 4))
    }
    if (maskPtr) new Uint8Array(f32.buffer).set(mask, maskPtr)

    const o = spec.origin
    const q = spec.rotation ?? IDENTITY
    return world.addPinField(
      o.x, o.y, o.z,
      spec.rows, spec.cols,
      spec.spacingX, spec.spacingZ, spec.rowOffsetX,
      spec.radius, spec.halfHeight,
      q.x, q.y, q.z, q.w,
      spec.restitution, spec.friction,
      keepOutPtr, keepOuts.length,
      maskPtr, mask.byteLength,
      (spec.dropoutSeed ?? 0) >>> 0, spec.dropout ?? 0,
    )
  } finally {
    release()
  }
}

export function createBoxBody(world: World, desc: WasmBoxBodyDesc): number {
  if (!world?.createBoxBody) return -1
  const p = desc.position ?? { x: 0, y: 0, z: 0 }
  const v = desc.velocity ?? { x: 0, y: 0, z: 0 }
  const h = desc.halfExtents
  return world.createBoxBody(
    p.x, p.y, p.z,
    v.x, v.y, v.z,
    desc.mass ?? 1,
    h.x, h.y, h.z,
    desc.restitution ?? 0.4,
    desc.linearDamping ?? 0.02,
    desc.bodyType ?? 0,
    desc.friction ?? 0.2,
    desc.angularDamping ?? 0.1
  )
}

export function addForceField(world: World, desc: WasmForceFieldDesc): number {
  if (!world?.addForceField) return -1
  const rot = desc.rotation ?? IDENTITY
  return world.addForceField(
    desc.center.x, desc.center.y, desc.center.z,
    desc.halfExtents.x, desc.halfExtents.y, desc.halfExtents.z,
    rot.x, rot.y, rot.z, rot.w,
    desc.force.x, desc.force.y, desc.force.z,
    desc.space ?? WasmForceSpace.World,
    desc.acceleration ?? false
  )
}
