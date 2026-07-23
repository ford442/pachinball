import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@babylonjs/core', () => {
  class Vector3 {
    x: number; y: number; z: number
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z }
    set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; return this }
    copyFrom(v: Vector3) { this.x = v.x; this.y = v.y; this.z = v.z; return this }
    clone() { return new Vector3(this.x, this.y, this.z) }
    static LerpToRef(a: Vector3, b: Vector3, t: number, out: Vector3) {
      out.x = a.x + (b.x - a.x) * t
      out.y = a.y + (b.y - a.y) * t
      out.z = a.z + (b.z - a.z) * t
      return out
    }
  }
  class Quaternion {
    x: number; y: number; z: number; w: number
    constructor(x = 0, y = 0, z = 0, w = 1) { this.x = x; this.y = y; this.z = z; this.w = w }
    set(x: number, y: number, z: number, w: number) { this.x = x; this.y = y; this.z = z; this.w = w; return this }
    copyFrom(q: Quaternion) { this.x = q.x; this.y = q.y; this.z = q.z; this.w = q.w; return this }
    clone() { return new Quaternion(this.x, this.y, this.z, this.w) }
    static SlerpToRef(a: Quaternion, _b: Quaternion, _t: number, out: Quaternion) {
      out.copyFrom(a)
      return out
    }
  }
  class Matrix {
    static ComposeToRef() {}
  }
  const TmpVectors = {
    Matrix: [{}, {}, {}],
    Vector3: [new Vector3(), new Vector3(), new Vector3()],
  }
  return { Vector3, Quaternion, Matrix, TmpVectors, TransformNode: class {} }
})

describe('MeshInterpolationSystem invalid-body guard', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('does not call isFixed on invalid bodies (prevents Rapier WASM unreachable)', async () => {
    const { MeshInterpolationSystem } = await import('../src/game/physics/mesh-interpolation')
    const system = new MeshInterpolationSystem()
    const isFixed = vi.fn(() => false)
    const body = {
      isValid: () => false,
      isFixed,
      translation: vi.fn(),
      rotation: vi.fn(),
      isSleeping: vi.fn(),
    }
    const mesh = {
      isDisposed: () => false,
      parent: null,
      position: { copyFrom: vi.fn() },
      rotationQuaternion: null,
      scaling: { set: vi.fn(), x: 1, y: 1, z: 1 },
    }

    expect(() => {
      system.syncMeshes(1, [{ rigidBody: body as never, mesh: mesh as never }])
    }).not.toThrow()
    expect(isFixed).not.toHaveBeenCalled()
    system.dispose()
  })
})
