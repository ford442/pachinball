/**
 * Packed WASM transform buffer layout (16 floats per public body id slot).
 *
 *   id, px, py, pz, qx, qy, qz, qw, vx, vy, vz, wx, wy, wz, active, pad
 */

export const TRANSFORM_STRIDE = 16

export interface WasmTransform {
  id: number
  position: { x: number; y: number; z: number }
  rotation: { x: number; y: number; z: number; w: number }
  velocity: { x: number; y: number; z: number }
  angularVelocity: { x: number; y: number; z: number }
  active: boolean
}

/** A zeroed record for `decodeTransformSlot(…, out)` to fill. */
export function createTransformRecord(): WasmTransform {
  return {
    id: -1,
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    velocity: { x: 0, y: 0, z: 0 },
    angularVelocity: { x: 0, y: 0, z: 0 },
    active: false,
  }
}

/**
 * Read one body slot from a packed transform buffer at public `bodyId`.
 *
 * Without `out` it returns a fresh record (five objects). With `out`, the slot is written into
 * that record — every field, the nested vectors in place — and `out` is returned, so a per-frame
 * reader allocates nothing; the record is then only valid until the next decode into it. A
 * missing or stale slot returns null and leaves `out` untouched.
 */
export function decodeTransformSlot(
  data: ArrayLike<number>,
  bodyId: number,
  stride = TRANSFORM_STRIDE,
  out?: WasmTransform,
): WasmTransform | null {
  const o = bodyId * stride
  if (o + 14 > data.length) return null
  const slotId = data[o] ?? -1
  if (slotId !== bodyId) return null
  const t = out ?? createTransformRecord()
  t.id = bodyId
  t.position.x = data[o + 1] ?? 0
  t.position.y = data[o + 2] ?? 0
  t.position.z = data[o + 3] ?? 0
  t.rotation.x = data[o + 4] ?? 0
  t.rotation.y = data[o + 5] ?? 0
  t.rotation.z = data[o + 6] ?? 0
  t.rotation.w = data[o + 7] ?? 1
  t.velocity.x = data[o + 8] ?? 0
  t.velocity.y = data[o + 9] ?? 0
  t.velocity.z = data[o + 10] ?? 0
  t.angularVelocity.x = data[o + 11] ?? 0
  t.angularVelocity.y = data[o + 12] ?? 0
  t.angularVelocity.z = data[o + 13] ?? 0
  t.active = (data[o + 14] ?? 0) > 0.5
  return t
}

/** Encode slots into a sparse buffer (test helper). */
export function encodeTransformBuffer(
  slots: Array<{ id: number; transform: WasmTransform }>,
  stride = TRANSFORM_STRIDE,
): Float32Array {
  let maxId = 0
  for (const s of slots) maxId = Math.max(maxId, s.id)
  const buf = new Float32Array((maxId + 1) * stride)
  for (const { id, transform } of slots) {
    const o = id * stride
    buf[o] = id
    buf[o + 1] = transform.position.x
    buf[o + 2] = transform.position.y
    buf[o + 3] = transform.position.z
    buf[o + 4] = transform.rotation.x
    buf[o + 5] = transform.rotation.y
    buf[o + 6] = transform.rotation.z
    buf[o + 7] = transform.rotation.w
    buf[o + 8] = transform.velocity.x
    buf[o + 9] = transform.velocity.y
    buf[o + 10] = transform.velocity.z
    buf[o + 11] = transform.angularVelocity.x
    buf[o + 12] = transform.angularVelocity.y
    buf[o + 13] = transform.angularVelocity.z
    buf[o + 14] = transform.active ? 1 : 0
  }
  return buf
}

/**
 * Create a Float32Array view over WASM heap memory for the transform buffer.
 * Re-call when `wasmMemory.buffer` is replaced after heap growth.
 */
export function createTransformBufferView(
  heap: Float32Array,
  ptrBytes: number,
  slotCount: number,
  stride = TRANSFORM_STRIDE,
): Float32Array {
  const start = ptrBytes >> 2
  const end = start + slotCount * stride
  return heap.subarray(start, end)
}
