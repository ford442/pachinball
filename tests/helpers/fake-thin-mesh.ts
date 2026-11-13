import { vi } from 'vitest'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'

/**
 * The slice of a thin-instanced `Mesh` that `TransientField` drives, for Node tests where the
 * Babylon module is a stub. `state` is what the GPU would see: instance count and enabled flag.
 */
export function fakeThinMesh() {
  const state = { enabled: true, count: 0 }
  const raw = {
    name: 'fake',
    material: null as unknown,
    isPickable: true,
    doNotSyncBoundingInfo: false,
    alwaysSelectAsActiveMesh: false,
    get thinInstanceCount() {
      return state.count
    },
    set thinInstanceCount(n: number) {
      state.count = n
    },
    thinInstanceSetBuffer: vi.fn(),
    thinInstanceBufferUpdated: vi.fn(),
    setEnabled: vi.fn((on: boolean) => {
      state.enabled = on
    }),
    isEnabled: vi.fn(() => state.enabled),
    dispose: vi.fn(),
  }
  return { mesh: raw as unknown as Mesh, raw, state }
}

export type FakeThinMesh = ReturnType<typeof fakeThinMesh>

/** The matrix / colour `Float32Array` a field handed to `thinInstanceSetBuffer`. */
export function bufferOf(fake: FakeThinMesh, kind: 'matrix' | 'color'): Float32Array {
  const call = fake.raw.thinInstanceSetBuffer.mock.calls.find((c) => c[0] === kind)
  if (!call) throw new Error(`no ${kind} buffer was set`)
  return call[1] as Float32Array
}
