/**
 * Pin lattices as thin instances (#443 A4).
 *
 * A pin lattice is ONE mesh whose instances are a static `Float32Array` of world matrices, built
 * from `resolvePinField(spec)` — the same resolver that places the colliders, so the visuals sit
 * on exactly the pins that collide. Replaces one `InstancedMesh` per pin: each of those is a
 * scene node that is culled, LOD-selected and re-uploaded every frame.
 *
 * Rules the builders rely on:
 *  - the buffer is static (`thinInstanceSetBuffer`'s default); never `thinInstanceSetMatrixAt` on
 *    it (a no-op on a static buffer). A lattice that changes is rebuilt: new array, set again.
 *  - one rotation per lattice. Thin instances share one draw call, and Babylon picks the face
 *    winding for the whole call from the mesh, so a mirrored instance in the same buffer would
 *    render inside-out. `assertUniformPinLattice` enforces it.
 *  - the lattice mesh is never cloned, so no `makeGeometryUnique()`; clone one and you must call
 *    it before `thinInstanceSetBuffer`, or the clone shares (and overwrites) the vertex buffers.
 *  - `isPickable = false` and `isVisible = true`: thin instances are the mesh's own, so a hidden
 *    mesh draws nothing (unlike the hidden source of an `InstancedMesh`).
 */

import type { Mesh } from '@babylonjs/core/Meshes/mesh'
// Babylon 9 ships `Mesh.prototype.thinInstance*` as no-op stubs until this side-effect module
// runs. Without it every lattice silently got 0 instances: invisible pins over live colliders.
import '@babylonjs/core/Meshes/thinInstanceMesh'
import type { PinFieldQuat, PinFieldVec3 } from '../core/pin-field'

const IDENTITY: PinFieldQuat = { x: 0, y: 0, z: 0, w: 1 }
const FLOATS_PER_MATRIX = 16
/** Two rotation blocks closer than this (per element) count as the same rotation. */
const ROTATION_EPSILON = 1e-5

/**
 * One world matrix per position, all with `rotation`, in Babylon's row-major layout (translation
 * in elements 12..14). Matches `Quaternion.toRotationMatrix` + a translation.
 */
export function pinLatticeMatrices(
  positions: readonly PinFieldVec3[],
  rotation: PinFieldQuat = IDENTITY,
): Float32Array {
  const len = Math.hypot(rotation.x, rotation.y, rotation.z, rotation.w)
  const s = len > 1e-12 ? 1 / len : 0
  const x = len > 1e-12 ? rotation.x * s : 0
  const y = len > 1e-12 ? rotation.y * s : 0
  const z = len > 1e-12 ? rotation.z * s : 0
  const w = len > 1e-12 ? rotation.w * s : 1

  const xx = x * x
  const yy = y * y
  const zz = z * z
  const xy = x * y
  const zw = z * w
  const zx = z * x
  const yw = y * w
  const yz = y * z
  const xw = x * w

  // Rows 0..2 of the matrix (the fourth column of each stays 0), shared by every instance.
  const block = [
    1 - 2 * (yy + zz), 2 * (xy + zw), 2 * (zx - yw), 0,
    2 * (xy - zw), 1 - 2 * (zz + xx), 2 * (yz + xw), 0,
    2 * (zx + yw), 2 * (yz - xw), 1 - 2 * (yy + xx), 0,
  ]

  const out = new Float32Array(positions.length * FLOATS_PER_MATRIX)
  positions.forEach((p, i) => {
    const o = i * FLOATS_PER_MATRIX
    out.set(block, o)
    out[o + 12] = p.x
    out[o + 13] = p.y
    out[o + 14] = p.z
    out[o + 15] = 1
  })
  return out
}

/** Determinant of the upper-left 3x3 of the matrix starting at `offset`. */
function determinant3(m: Float32Array, offset: number): number {
  const a = m[offset]
  const b = m[offset + 1]
  const c = m[offset + 2]
  const d = m[offset + 4]
  const e = m[offset + 5]
  const f = m[offset + 6]
  const g = m[offset + 8]
  const h = m[offset + 9]
  const i = m[offset + 10]
  return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g)
}

/**
 * Throws unless every matrix has the same rotation/scale block and a non-degenerate determinant of
 * one sign. `label` names the lattice in the error.
 */
export function assertUniformPinLattice(matrices: Float32Array, label: string): void {
  if (matrices.length % FLOATS_PER_MATRIX !== 0) {
    throw new Error(`${label}: instance buffer length ${matrices.length} is not a multiple of 16`)
  }
  const count = matrices.length / FLOATS_PER_MATRIX
  if (count === 0) return

  const firstDet = determinant3(matrices, 0)
  if (!(Math.abs(firstDet) > 1e-9)) {
    throw new Error(`${label}: instance 0 has a degenerate rotation (determinant ${firstDet})`)
  }
  const ROTATION_SLOTS = [0, 1, 2, 4, 5, 6, 8, 9, 10] as const

  for (let i = 1; i < count; i++) {
    const o = i * FLOATS_PER_MATRIX
    const det = determinant3(matrices, o)
    if (Math.sign(det) !== Math.sign(firstDet)) {
      throw new Error(
        `${label}: mixed-determinant instances (instance 0 ${firstDet.toFixed(3)}, instance ${i} ${det.toFixed(3)}) ` +
          'would render with the wrong face winding in one draw call',
      )
    }
    for (const slot of ROTATION_SLOTS) {
      if (Math.abs(matrices[o + slot] - matrices[slot]) > ROTATION_EPSILON) {
        throw new Error(`${label}: a pin lattice takes one rotation per lattice (instance ${i} differs from instance 0)`)
      }
    }
  }
}

/**
 * Turn `mesh` into the lattice: one static thin-instance buffer from `positions`. The mesh stays
 * unpickable and visible. Thin-instance bounds are refreshed by `thinInstanceSetBuffer` itself
 * (it calls `thinInstanceRefreshBoundingInfo` unless `doNotSyncBoundingInfo`), so the lattice is
 * culled as one box around all its pins.
 */
export function setPinLatticeInstances(
  mesh: Mesh,
  positions: readonly PinFieldVec3[],
  rotation: PinFieldQuat | undefined,
  label: string,
): void {
  const matrices = pinLatticeMatrices(positions, rotation)
  // One rotation per lattice holds by construction (`pinLatticeMatrices` writes one block for all
  // of them); the check is a development guard against a future builder that mixes buffers, and
  // production builds drop it (and `assertUniformPinLattice` with it).
  if (import.meta.env.DEV) assertUniformPinLattice(matrices, label)
  mesh.isPickable = false
  mesh.isVisible = true
  mesh.thinInstanceSetBuffer('matrix', matrices, FLOATS_PER_MATRIX, true)
}
