/**
 * Duck-typed views of the packed transform / contact buffers the in-process and worker WASM engines
 * already maintain. Split from `wasm-debug-geometry.ts` so the per-frame owner path does not pull the
 * debug-draw geometry into the entry chunk.
 */

import { CONTACT_STRIDE } from '../wasm/contact-buffer'
import { TRANSFORM_STRIDE } from '../wasm/transform-buffer'
import type { WasmSimEngine } from '../wasm/wasm-sim-engine'

export interface PackedViews {
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
