import { describe, expect, it } from 'vitest'
import {
  appendOrientedBoxEdges,
  buildWasmDebugLineBuffers,
} from '../src/game-elements/wasm-debug-geometry'
import { encodeTransformBuffer, TRANSFORM_STRIDE } from '../src/wasm/transform-buffer'
import { encodeContactBuffer, ContactPhase } from '../src/wasm/contact-buffer'

describe('wasm debug geometry', () => {
  it('emits 12 box edges (24 vertices)', () => {
    const positions: number[] = []
    const colors: number[] = []
    appendOrientedBoxEdges(
      positions,
      colors,
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 1, z: 1 },
      { x: 0, y: 0, z: 0, w: 1 },
    )
    expect(positions.length / 3).toBe(24)
  })

  it('decodes packed transform slots for sphere wireframes', () => {
    const buf = encodeTransformBuffer([
      {
        id: 1,
        transform: {
          id: 1,
          position: { x: 2, y: 3, z: 4 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          velocity: { x: 0, y: 0, z: 0 },
          angularVelocity: { x: 0, y: 0, z: 0 },
          active: true,
        },
      },
    ])
    const engine = {
      transformView: buf,
      isReady: true,
    }
    const { positions } = buildWasmDebugLineBuffers(engine as never, [
      { kind: 'sphere', center: { x: 0, y: 0, z: 0 }, radius: 0.25, bodyId: 1 },
    ])
    expect(positions.length).toBeGreaterThan(0)
    expect(positions.length % 3).toBe(0)
    expect(buf.length).toBeGreaterThanOrEqual(2 * TRANSFORM_STRIDE)
  })

  it('draws contact ticks from packed contact buffers when the engine exposes a world', () => {
    const packed = encodeContactBuffer([
      {
        bodyId1: 1,
        bodyId2: 2,
        normal: { x: 0, y: 1, z: 0 },
        point: { x: 1, y: 2, z: 3 },
        impulse: 1,
        phase: ContactPhase.Enter,
      },
    ])
    const heap = new Float32Array(packed.length + 4)
    heap.set(packed, 4)
    const engine = {
      module: { HEAPF32: heap },
      world: {
        getContactBufferPtr: () => 16,
        getContactCount: () => 1,
      },
    }
    const { colors } = buildWasmDebugLineBuffers(engine as never, [])
    expect(colors.length).toBeGreaterThan(0)
  })
})
