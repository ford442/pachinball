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

  it('drops the previous pose of a body that left the bindings, so it restarts from its new pose', async () => {
    const { MeshInterpolationSystem } = await import('../src/game/physics/mesh-interpolation')
    const system = new MeshInterpolationSystem()
    let x = 0
    const body = {
      isValid: () => true,
      isFixed: () => false,
      translation: () => ({ x, y: 0, z: 0 }),
      rotation: () => ({ x: 0, y: 0, z: 0, w: 1 }),
      isSleeping: () => false,
    }
    const positions: number[] = []
    const mesh = {
      isDisposed: () => false,
      parent: null,
      position: { copyFrom: (v: { x: number }) => positions.push(v.x) },
      rotationQuaternion: { copyFrom: vi.fn() },
      scaling: { set: vi.fn(), x: 1, y: 1, z: 1 },
    }
    const bound = [{ rigidBody: body as never, mesh: mesh as never }]

    system.syncMeshes(0.5, bound) // first sight: prev = current = 0
    x = 10
    system.syncMeshes(0.5, bound) // halfway from 0 to 10
    system.syncMeshes(0.5, []) // body unbound: its previous pose is dropped
    x = 20
    system.syncMeshes(0.5, bound) // back: starts fresh at 20 instead of lerping from 10
    expect(positions).toEqual([0, 5, 20])
    system.dispose()
  })
})

describe('MeshInterpolationSystem pre-step snapshot', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  function setup() {
    const state = { x: 0 }
    const body = {
      isValid: () => true,
      isFixed: () => false,
      translation: () => ({ x: state.x, y: 0, z: 0 }),
      rotation: () => ({ x: 0, y: 0, z: 0, w: 1 }),
      isSleeping: () => false,
    }
    const drawn: number[] = []
    const mesh = {
      isDisposed: () => false,
      parent: null,
      position: { copyFrom: (v: { x: number }) => drawn.push(v.x) },
      rotationQuaternion: { copyFrom: vi.fn() },
      scaling: { set: vi.fn(), x: 1, y: 1, z: 1 },
    }
    const bound = [{ rigidBody: body as never, mesh: mesh as never }]
    return { state, body, drawn, bound }
  }

  it('keeps blending on frames that run no tick instead of freezing on the live pose', async () => {
    const { MeshInterpolationSystem } = await import('../src/game/physics/mesh-interpolation')
    const system = new MeshInterpolationSystem()
    const { state, drawn, bound } = setup()

    system.capturePreStep(bound) // the tick's pre-step pose: x = 0
    state.x = 10 // the tick moves the body
    system.syncMeshes(0.1, bound) // the stepping frame
    system.syncMeshes(0.4, bound) // no tick
    system.syncMeshes(0.7, bound) // no tick

    expect(drawn.map((x) => Math.round(x * 100) / 100)).toEqual([1, 4, 7])
    system.dispose()
  })

  it('never draws a pose behind the pre-step snapshot', async () => {
    const { MeshInterpolationSystem } = await import('../src/game/physics/mesh-interpolation')
    const system = new MeshInterpolationSystem()
    const { state, drawn, bound } = setup()

    system.capturePreStep(bound)
    state.x = 10
    for (const alpha of [0, 0.25, 0.5, 0.75, 0.99]) system.syncMeshes(alpha, bound)
    for (let i = 1; i < drawn.length; i++) expect(drawn[i]).toBeGreaterThanOrEqual(drawn[i - 1]!)
    expect(Math.min(...drawn)).toBeGreaterThanOrEqual(0)
    system.dispose()
  })

  it('uses the pose before the last tick when one frame runs several ticks', async () => {
    const { MeshInterpolationSystem } = await import('../src/game/physics/mesh-interpolation')
    const system = new MeshInterpolationSystem()
    const { state, drawn, bound } = setup()

    system.syncMeshes(1, bound) // first sight at 0
    system.capturePreStep(bound) // tick 1 starts at 0
    state.x = 10
    system.capturePreStep(bound) // tick 2 starts at 10
    state.x = 20
    system.syncMeshes(0.5, bound)

    expect(drawn[1]).toBe(15)
    system.dispose()
  })

  it('snap makes the stored pose the live one, so a repositioned body does not blend from a stale pose', async () => {
    const { MeshInterpolationSystem } = await import('../src/game/physics/mesh-interpolation')
    const system = new MeshInterpolationSystem()
    const { state, drawn, bound } = setup()

    system.syncMeshes(1, bound, true)
    state.x = 50 // repositioned while no tick runs
    system.syncMeshes(1, bound, true)
    system.syncMeshes(0.5, bound) // the next frame, still no tick yet

    expect(drawn).toEqual([0, 50, 50])
    system.dispose()
  })

  it('writes the interpolated body position into the caller-owned vector without allocating', async () => {
    const { MeshInterpolationSystem } = await import('../src/game/physics/mesh-interpolation')
    const { Vector3 } = await import('@babylonjs/core')
    const system = new MeshInterpolationSystem()
    const { state, body, bound } = setup()

    system.capturePreStep(bound)
    state.x = 10
    system.syncMeshes(0.5, bound)
    const out = new Vector3()
    const result = system.getInterpolatedPosition(body as never, 0.5, out)

    expect(result).toBe(out)
    expect(out.x).toBe(5)
    system.dispose()
  })
})
