import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TransientField } from '../src/effects/transient-field'
import { getTransientUnlitMaterial } from '../src/materials/material-transient'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Scene } from '@babylonjs/core/scene'
import type { Camera } from '@babylonjs/core/Cameras/camera'
import { bufferOf, fakeThinMesh } from './helpers/fake-thin-mesh'

const IDENTITY_Q = [0, 0, 0, 1] as const

function makeField(capacity = 4) {
  const scene = new (Scene as unknown as new () => never)()
  const fake = fakeThinMesh()
  const createGeometry = vi.fn(() => fake.mesh)
  const field = new TransientField(scene, createGeometry, capacity)
  return { field, raw: fake.raw, state: fake.state, scene, fake, createGeometry }
}

/** One frame with a single instance, which is what builds the field's mesh. */
function showOne(field: TransientField): void {
  field.begin()
  field.push(0, 0, 0, ...IDENTITY_Q, 1, 1, 1, 1, 1, 1, 1)
  field.end()
}

beforeEach(() => {
  vi.mocked(StandardMaterial).mockClear()
})

describe('TransientField', () => {
  it('builds the shared material at construction but the mesh only when first shown', () => {
    const { field, createGeometry, scene } = makeField(4)

    // The material exists before any burst; the mesh does not (an idle scene mesh is not free).
    expect(vi.mocked(StandardMaterial)).toHaveBeenCalledTimes(1)
    expect(createGeometry).not.toHaveBeenCalled()
    expect(field.mesh).toBeNull()

    // Empty frames never build it.
    field.begin()
    field.end()
    expect(createGeometry).not.toHaveBeenCalled()

    showOne(field)
    expect(createGeometry).toHaveBeenCalledTimes(1)
    expect(field.mesh?.material).toBe(getTransientUnlitMaterial(scene))

    // Built once: later frames, empty or not, reuse it, and no second material appears.
    showOne(field)
    field.begin()
    field.end()
    showOne(field)
    expect(createGeometry).toHaveBeenCalledTimes(1)
    expect(vi.mocked(StandardMaterial)).toHaveBeenCalledTimes(1)
  })

  it('takes the geometry over: dynamic buffers, not pickable, always selected', () => {
    const { field, raw, fake } = makeField(4)
    showOne(field)

    expect(raw.isPickable).toBe(false)
    expect(raw.alwaysSelectAsActiveMesh).toBe(true)
    // matrix: 16 floats per instance, color: 4, both dynamic (staticBuffer = false)
    expect(raw.thinInstanceSetBuffer).toHaveBeenCalledWith('matrix', expect.any(Float32Array), 16, false)
    expect(raw.thinInstanceSetBuffer).toHaveBeenCalledWith('color', expect.any(Float32Array), 4, false)
    expect(bufferOf(fake, 'matrix').length).toBe(4 * 16)
    expect(bufferOf(fake, 'color').length).toBe(4 * 4)
    expect(field.capacity).toBe(4)
  })

  it('every field in a scene shares one material', () => {
    const scene = new (Scene as unknown as new () => never)()
    const a = fakeThinMesh()
    const b = fakeThinMesh()
    const fa = new TransientField(scene, () => a.mesh, 2)
    const fb = new TransientField(scene, () => b.mesh, 2)
    showOne(fa)
    showOne(fb)
    expect(a.raw.material).toBe(b.raw.material)
    expect(vi.mocked(StandardMaterial)).toHaveBeenCalledTimes(1)
  })

  it('writes row-major TRS matrices and uploads only what was pushed', () => {
    const { field, raw, fake } = makeField(4)
    showOne(field)
    const matrices = bufferOf(fake, 'matrix')

    field.begin()
    field.push(1, 2, 3, ...IDENTITY_Q, 2, 3, 4, 0.5, 0.25, 1, 1)
    field.end()

    expect(raw.thinInstanceCount).toBe(1)
    expect(raw.thinInstanceBufferUpdated).toHaveBeenCalledWith('matrix')
    expect(raw.thinInstanceBufferUpdated).toHaveBeenCalledWith('color')
    // identity rotation: the diagonal is the scale, translation sits in 12..14
    expect(Array.from(matrices.slice(0, 16))).toEqual([2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 1, 2, 3, 1])
  })

  it('rotates by the quaternion (90° about Y sends +X to -Z) and scales row-wise', () => {
    const { field, fake } = makeField(2)
    showOne(field)
    const matrices = bufferOf(fake, 'matrix')
    const s = Math.SQRT1_2
    field.begin()
    field.push(0, 0, 0, 0, s, 0, s, 2, 2, 2, 1, 1, 1, 1)
    field.end()
    // Row-vector convention (Babylon): row 0 is where the local X axis ends up.
    expect(matrices[0]).toBeCloseTo(0, 6)
    expect(matrices[2]).toBeCloseTo(-2, 6)
    expect(matrices[8]).toBeCloseTo(2, 6)
    expect(matrices[10]).toBeCloseTo(0, 6)
  })

  it('stores tint and fade clamped to 0..1 (the LDR result of the old emissive material)', () => {
    const { field, fake } = makeField(2)
    showOne(field)
    const colors = bufferOf(fake, 'color')
    field.begin()
    field.push(0, 0, 0, ...IDENTITY_Q, 1, 1, 1, 1.5, 1.2, -0.3, 0.7)
    field.end()
    expect(Array.from(colors.slice(0, 4)).map((v) => +v.toFixed(5))).toEqual([1, 1, 0, 0.7])
  })

  it('shows the mesh only while something is alive, and does not toggle it needlessly', () => {
    const { field, raw, state } = makeField(4)

    // Nothing has been shown yet: no mesh to hide.
    field.begin()
    field.end()
    expect(raw.setEnabled).not.toHaveBeenCalled()

    // First use builds the mesh, which a MeshBuilder mesh already starts enabled.
    showOne(field)
    expect(state.enabled).toBe(true)
    expect(state.count).toBe(1)
    expect(raw.setEnabled).not.toHaveBeenCalled()

    // still alive next frame: no toggle
    showOne(field)
    expect(raw.setEnabled).not.toHaveBeenCalled()

    // last one died: a thin-instanced mesh with zero instances draws ONE ordinary mesh, so hide it
    field.begin()
    field.end()
    expect(state.enabled).toBe(false)
    expect(state.count).toBe(0)
    expect(raw.setEnabled).toHaveBeenCalledTimes(1)

    // empty again while hidden: nothing to do
    field.begin()
    field.end()
    expect(raw.setEnabled).toHaveBeenCalledTimes(1)

    // and shown again
    showOne(field)
    expect(state.enabled).toBe(true)
    expect(raw.setEnabled).toHaveBeenCalledTimes(2)
  })

  it('drops pushes beyond capacity instead of writing out of bounds', () => {
    const { field, raw } = makeField(2)
    field.begin()
    for (let i = 0; i < 5; i++) field.push(i, 0, 0, ...IDENTITY_Q, 1, 1, 1, 1, 1, 1, 1)
    field.end()
    expect(raw.thinInstanceCount).toBe(2)
    expect(field.size).toBe(2)
  })

  it('billboards with the transpose of the view rotation (what BILLBOARDMODE_ALL applies) and uniform scale', () => {
    const { field, fake } = makeField(2)
    showOne(field)
    const matrices = bufferOf(fake, 'matrix')
    // A view rotation with distinguishable elements: row 0 = (0,1,0), row 1 = (-1,0,0), row 2 = (0,0,1)
    const view = new Float32Array(16)
    view.set([0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 5, 6, 7, 1])
    const camera = { getViewMatrix: () => ({ m: view }) } as unknown as Camera

    field.begin()
    field.setBillboardCamera(camera)
    field.pushBillboard(1, 2, 3, 2, 1, 1, 1, 1)
    field.end()

    // transpose, times 2: row 0 = (view[0], view[4], view[8]) * 2 = (0, -2, 0); row 1 = (view[1], view[5], view[9]) * 2 = (2, 0, 0)
    expect(Array.from(matrices.slice(0, 3))).toEqual([0, -2, 0])
    expect(Array.from(matrices.slice(4, 7))).toEqual([2, 0, 0])
    expect(Array.from(matrices.slice(8, 11))).toEqual([0, 0, 2])
    // the camera's own translation never leaks in: the instance sits where it was put
    expect(Array.from(matrices.slice(12, 16))).toEqual([1, 2, 3, 1])
  })

  it('dispose releases the mesh, and is safe before it was ever built', () => {
    const unused = makeField(2)
    expect(() => unused.field.dispose()).not.toThrow()
    expect(unused.createGeometry).not.toHaveBeenCalled()

    const { field, raw } = makeField(2)
    showOne(field)
    field.dispose()
    expect(raw.dispose).toHaveBeenCalled()
    expect(field.mesh).toBeNull()
  })
})
