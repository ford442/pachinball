import { describe, it, expect } from 'vitest'
import {
  TRANSFORM_STRIDE,
  decodeTransformSlot,
  encodeTransformBuffer,
  createTransformBufferView,
} from '../src/wasm/transform-buffer'

describe('transform-buffer', () => {
  it('decodes a packed slot by public body id', () => {
    const buf = encodeTransformBuffer([{
      id: 3,
      transform: {
        id: 3,
        position: { x: 1, y: 2, z: 3 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        velocity: { x: 4, y: 5, z: 6 },
        angularVelocity: { x: 0.1, y: 0.2, z: 0.3 },
        active: true,
      },
    }])

    const decoded = decodeTransformSlot(buf, 3)
    expect(decoded).not.toBeNull()
    expect(decoded?.position).toEqual({ x: 1, y: 2, z: 3 })
    expect(decoded?.velocity).toEqual({ x: 4, y: 5, z: 6 })
    expect(decoded?.angularVelocity.x).toBeCloseTo(0.1, 5)
    expect(decoded?.angularVelocity.y).toBeCloseTo(0.2, 5)
    expect(decoded?.angularVelocity.z).toBeCloseTo(0.3, 5)
    expect(decoded?.active).toBe(true)
  })

  it('returns null for empty or removed slots', () => {
    const buf = new Float32Array(TRANSFORM_STRIDE * 2)
    expect(decodeTransformSlot(buf, 1)).toBeNull()
  })

  it('rebinds view after wasm heap growth (buffer detach)', () => {
    const heap1 = new Float32Array(64)
    heap1[0] = 0
    heap1[1] = 9
    heap1[2] = 8
    heap1[3] = 7

    const view1 = createTransformBufferView(heap1, 0, 1)
    expect(decodeTransformSlot(view1, 0)?.position.y).toBe(8)

    const heap2 = new Float32Array(64)
    heap2[0] = 0
    heap2[1] = 1
    heap2[2] = 2
    heap2[3] = 3
    const view2 = createTransformBufferView(heap2, 0, 1)
    expect(decodeTransformSlot(view2, 0)?.position).toEqual({ x: 1, y: 2, z: 3 })
  })
})
