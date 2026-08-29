/**
 * Packed-buffer debug draw helpers for wasm-owner / wasm-worker.
 * Reuses transform-buffer / contact-buffer codecs — no third layout.
 */

import { CONTACT_STRIDE, decodeContactBuffer } from '../wasm/contact-buffer'
import { TRANSFORM_STRIDE, decodeTransformSlot } from '../wasm/transform-buffer'
import type { WasmSimEngine } from '../wasm/wasm-sim-engine'

export type Vec3 = { x: number; y: number; z: number }
export type Quat = { x: number; y: number; z: number; w: number }

export type WasmDebugCollider =
  | { kind: 'box'; center: Vec3; halfExtents: Vec3; rotation: Quat }
  | { kind: 'capsule'; center: Vec3; radius: number; halfHeight: number; rotation: Quat; bodyId?: number }
  | { kind: 'sphere'; center: Vec3; radius: number; bodyId?: number }

const WASM_LINE_RGBA = [0, 0.85, 1, 1] as const
const CONTACT_LINE_RGBA = [1, 0.45, 0.1, 1] as const

interface PackedViews {
  transforms: Float32Array | null
  contacts: Float32Array | null
  contactCount: number
}

interface HeapWorld {
  transformView?: Float32Array | null
  world?: {
    getTransformBufferPtr?: () => number
    getTransformSlotCount?: () => number
    getTransformStride?: () => number
    getContactBufferPtr?: () => number
    getContactCount?: () => number
  }
  module?: {
    HEAPF32?: Float32Array
    wasmMemory?: { buffer: ArrayBuffer }
  }
}

function heapF32(engine: HeapWorld): Float32Array | null {
  if (engine.module?.HEAPF32) return engine.module.HEAPF32
  const buf = engine.module?.wasmMemory?.buffer
  return buf ? new Float32Array(buf) : null
}

/** Duck-type packed views the in-process / worker engines already maintain. */
export function peekPackedPhysicsBuffers(engine: WasmSimEngine | null): PackedViews {
  if (!engine) return { transforms: null, contacts: null, contactCount: 0 }
  const e = engine as unknown as HeapWorld
  let transforms = e.transformView ?? null
  const heap = heapF32(e)
  const world = e.world
  if (!transforms && heap && world?.getTransformBufferPtr) {
    const ptr = world.getTransformBufferPtr()
    const slots = world.getTransformSlotCount?.() ?? 0
    const stride = world.getTransformStride?.() ?? TRANSFORM_STRIDE
    if (ptr && slots > 0) {
      const start = ptr >> 2
      transforms = heap.subarray(start, start + slots * stride)
    }
  }

  let contacts: Float32Array | null = null
  let contactCount = 0
  if (heap && world?.getContactBufferPtr) {
    contactCount = world.getContactCount?.() ?? 0
    const ptr = world.getContactBufferPtr()
    if (ptr && contactCount > 0) {
      const start = ptr >> 2
      contacts = heap.subarray(start, start + contactCount * CONTACT_STRIDE)
    }
  }

  return { transforms, contacts, contactCount }
}

function rotateLocal(q: Quat, lx: number, ly: number, lz: number): Vec3 {
  const qx = q.x
  const qy = q.y
  const qz = q.z
  const qw = q.w
  const tx = 2 * (qy * lz - qz * ly)
  const ty = 2 * (qz * lx - qx * lz)
  const tz = 2 * (qx * ly - qy * lx)
  return {
    x: lx + qw * tx + (qy * tz - qz * ty),
    y: ly + qw * ty + (qz * tx - qx * tz),
    z: lz + qw * tz + (qx * ty - qy * tx),
  }
}

function pushVertex(
  positions: number[],
  colors: number[],
  p: Vec3,
  rgba: readonly [number, number, number, number],
): void {
  positions.push(p.x, p.y, p.z)
  colors.push(rgba[0], rgba[1], rgba[2], rgba[3])
}

function pushSegment(
  positions: number[],
  colors: number[],
  a: Vec3,
  b: Vec3,
  rgba: readonly [number, number, number, number] = WASM_LINE_RGBA,
): void {
  pushVertex(positions, colors, a, rgba)
  pushVertex(positions, colors, b, rgba)
}

function add(c: Vec3, o: Vec3): Vec3 {
  return { x: c.x + o.x, y: c.y + o.y, z: c.z + o.z }
}

export function appendOrientedBoxEdges(
  positions: number[],
  colors: number[],
  center: Vec3,
  half: Vec3,
  rotation: Quat,
): void {
  const signs: Array<[number, number, number]> = [
    [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
    [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
  ]
  const corners = signs.map(([sx, sy, sz]) =>
    add(center, rotateLocal(rotation, sx * half.x, sy * half.y, sz * half.z)),
  )
  const edges: Array<[number, number]> = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ]
  for (const [i, j] of edges) {
    const a = corners[i]
    const b = corners[j]
    if (a && b) pushSegment(positions, colors, a, b)
  }
}

export function appendSphereWire(
  positions: number[],
  colors: number[],
  center: Vec3,
  radius: number,
  segments = 12,
): void {
  const rings = [
    (i: number) => {
      const a = (i / segments) * Math.PI * 2
      return { x: center.x + Math.cos(a) * radius, y: center.y, z: center.z + Math.sin(a) * radius }
    },
    (i: number) => {
      const a = (i / segments) * Math.PI * 2
      return { x: center.x + Math.cos(a) * radius, y: center.y + Math.sin(a) * radius, z: center.z }
    },
    (i: number) => {
      const a = (i / segments) * Math.PI * 2
      return { x: center.x, y: center.y + Math.cos(a) * radius, z: center.z + Math.sin(a) * radius }
    },
  ]
  for (const pointAt of rings) {
    for (let i = 0; i < segments; i++) {
      pushSegment(positions, colors, pointAt(i), pointAt((i + 1) % segments))
    }
  }
}

export function appendCapsuleWire(
  positions: number[],
  colors: number[],
  center: Vec3,
  radius: number,
  halfHeight: number,
  rotation: Quat,
): void {
  const top = add(center, rotateLocal(rotation, 0, halfHeight, 0))
  const bot = add(center, rotateLocal(rotation, 0, -halfHeight, 0))
  appendSphereWire(positions, colors, top, radius, 10)
  appendSphereWire(positions, colors, bot, radius, 10)
  const spokes: Array<[number, number, number]> = [
    [radius, 0, 0], [-radius, 0, 0], [0, 0, radius], [0, 0, -radius],
  ]
  for (const [lx, ly, lz] of spokes) {
    const o = rotateLocal(rotation, lx, ly, lz)
    pushSegment(positions, colors, add(top, o), add(bot, o))
  }
}

export function buildWasmDebugLineBuffers(
  engine: WasmSimEngine | null,
  colliders: readonly WasmDebugCollider[],
): { positions: number[]; colors: number[] } {
  const positions: number[] = []
  const colors: number[] = []
  const packed = peekPackedPhysicsBuffers(engine)

  const poseOf = (bodyId: number | undefined, fallback: Vec3, fallbackRot?: Quat): { p: Vec3; r: Quat } => {
    if (bodyId === undefined || !packed.transforms) {
      return { p: fallback, r: fallbackRot ?? { x: 0, y: 0, z: 0, w: 1 } }
    }
    const slot = decodeTransformSlot(packed.transforms, bodyId)
    if (!slot) return { p: fallback, r: fallbackRot ?? { x: 0, y: 0, z: 0, w: 1 } }
    return { p: slot.position, r: slot.rotation }
  }

  for (const c of colliders) {
    if (c.kind === 'box') {
      appendOrientedBoxEdges(positions, colors, c.center, c.halfExtents, c.rotation)
    } else if (c.kind === 'sphere') {
      const { p } = poseOf(c.bodyId, c.center)
      appendSphereWire(positions, colors, p, c.radius)
    } else {
      const { p, r } = poseOf(c.bodyId, c.center, c.rotation)
      appendCapsuleWire(positions, colors, p, c.radius, c.halfHeight, r)
    }
  }

  if (packed.transforms) {
    const stride = TRANSFORM_STRIDE
    const slots = Math.floor(packed.transforms.length / stride)
    const known = new Set(
      colliders
        .map((c) => ('bodyId' in c ? c.bodyId : undefined))
        .filter((id): id is number => id !== undefined),
    )
    for (let id = 0; id < slots; id++) {
      if (known.has(id)) continue
      const slot = decodeTransformSlot(packed.transforms, id)
      if (!slot?.active) continue
      appendSphereWire(positions, colors, slot.position, 0.25)
    }
  }

  if (packed.contacts && packed.contactCount > 0) {
    const contacts = decodeContactBuffer(packed.contacts, packed.contactCount)
    for (const contact of contacts) {
      const n = contact.normal
      const pt = contact.point
      pushSegment(
        positions,
        colors,
        pt,
        { x: pt.x + n.x * 0.2, y: pt.y + n.y * 0.2, z: pt.z + n.z * 0.2 },
        CONTACT_LINE_RGBA,
      )
    }
  }

  return { positions, colors }
}
