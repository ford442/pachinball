/**
 * TransientField — a pool of short-lived instances drawn as ONE thin-instanced mesh (#524).
 *
 * Shard bursts, ripple / impact rings and fever-trail quads used to be one mesh + one
 * `StandardMaterial` each, created on spawn and disposed on expiry. A field is built once, around
 * one geometry and the shared transient material (`getTransientUnlitMaterial`, which exists from
 * boot); a live particle is just 16 + 4 floats in two `Float32Array`s:
 *
 *   matrix  world matrix (row-major, translation in 12..14), composed here from TRS
 *   color   RGBA multiplied into the white material: rgb = tint (clamped to 0..1, the LDR result
 *           the old emissive material produced), a = fade
 *
 * Usage per frame: `begin()`, `push…()` once per live particle, `end()`. `end()` uploads the
 * buffers, sets the instance count, and enables the mesh only while something is alive: a
 * thin-instanced mesh with zero instances would draw ONE ordinary mesh at its own transform.
 * Enabling / disabling is seen by the static-scene gate (`RenderStateWatcher`), exactly as
 * adding / disposing a mesh was.
 *
 * Nothing here allocates per frame; the buffers are sized for `capacity` at construction. A push
 * beyond capacity is dropped (the caller's effect cap is below it).
 *
 * The MESH is built the first time something is shown, not at construction: every scene mesh costs
 * Babylon a little work per frame even while disabled (light-dirty marking), so four idle meshes per
 * table would raise the idle allocation for effects most frames never draw. It is built once; the
 * material is not part of that, so a burst never creates one.
 */

import type { Camera } from '@babylonjs/core/Cameras/camera'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
// Babylon 9 ships `Mesh.prototype.thinInstance*` as no-op stubs until this side-effect module
// runs (see pin-lattice.ts): without it a field would silently draw nothing.
import '@babylonjs/core/Meshes/thinInstanceMesh'
import type { Scene } from '@babylonjs/core/scene'
import { getTransientUnlitMaterial } from '../materials/material-transient'

const MATRIX_FLOATS = 16
const COLOR_FLOATS = 4

export class TransientField {
  readonly capacity: number
  private readonly scene: Scene
  private readonly createGeometry: () => Mesh
  private _mesh: Mesh | null = null
  private readonly matrices: Float32Array
  private readonly colors: Float32Array
  private count = 0
  /** Rows of the camera-facing rotation (inverse of the view rotation), from `setBillboardCamera`. */
  private readonly billboard = new Float32Array(9)

  /**
   * @param createGeometry Makes the field's mesh with `MeshBuilder`; called once, the first time
   *   something is shown. The field takes the mesh over (shared transient material, thin instances).
   */
  constructor(scene: Scene, createGeometry: () => Mesh, capacity: number) {
    this.scene = scene
    this.createGeometry = createGeometry
    this.capacity = capacity
    this.matrices = new Float32Array(capacity * MATRIX_FLOATS)
    this.colors = new Float32Array(capacity * COLOR_FLOATS)
    this.billboard[0] = 1
    this.billboard[4] = 1
    this.billboard[8] = 1
    // The one material exists before any burst, whether or not the mesh does yet.
    getTransientUnlitMaterial(scene)
  }

  /** The field's mesh: null until something has been shown. */
  get mesh(): Mesh | null {
    return this._mesh
  }

  private buildMesh(): Mesh {
    const mesh = this.createGeometry()
    mesh.material = getTransientUnlitMaterial(this.scene)
    mesh.isPickable = false
    // The buffers move every frame and the base mesh's own bounds mean nothing for them.
    mesh.doNotSyncBoundingInfo = true
    mesh.alwaysSelectAsActiveMesh = true
    mesh.thinInstanceSetBuffer('matrix', this.matrices, MATRIX_FLOATS, false)
    mesh.thinInstanceSetBuffer('color', this.colors, COLOR_FLOATS, false)
    mesh.thinInstanceCount = 0
    this._mesh = mesh
    return mesh
  }

  /** Live instances written since the last `begin()`. */
  get size(): number {
    return this.count
  }

  begin(): void {
    this.count = 0
  }

  /**
   * One instance from translation / rotation quaternion / scale / colour. Row i of the rotation
   * block is scaled by `s_i`, which is `Matrix.Compose(scale, rotation, translation)`.
   */
  push(
    px: number, py: number, pz: number,
    qx: number, qy: number, qz: number, qw: number,
    sx: number, sy: number, sz: number,
    r: number, g: number, b: number, a: number,
  ): void {
    if (this.count >= this.capacity) return
    const m = this.matrices
    const o = this.count * MATRIX_FLOATS

    const xx = qx * qx
    const yy = qy * qy
    const zz = qz * qz
    const xy = qx * qy
    const zw = qz * qw
    const zx = qz * qx
    const yw = qy * qw
    const yz = qy * qz
    const xw = qx * qw

    m[o] = (1 - 2 * (yy + zz)) * sx
    m[o + 1] = 2 * (xy + zw) * sx
    m[o + 2] = 2 * (zx - yw) * sx
    m[o + 3] = 0
    m[o + 4] = 2 * (xy - zw) * sy
    m[o + 5] = (1 - 2 * (zz + xx)) * sy
    m[o + 6] = 2 * (yz + xw) * sy
    m[o + 7] = 0
    m[o + 8] = 2 * (zx + yw) * sz
    m[o + 9] = 2 * (yz - xw) * sz
    m[o + 10] = (1 - 2 * (yy + xx)) * sz
    m[o + 11] = 0
    m[o + 12] = px
    m[o + 13] = py
    m[o + 14] = pz
    m[o + 15] = 1

    this.writeColor(this.count, r, g, b, a)
    this.count++
  }

  /**
   * Take the camera's facing for the `pushBillboard` calls of this frame. This is the rotation
   * Babylon's `BILLBOARDMODE_ALL` applies: the inverse of the view matrix's rotation, i.e. its
   * transpose. Call it once per frame, before the first `pushBillboard`.
   */
  setBillboardCamera(camera: Camera | null): void {
    if (!camera) return
    const v = camera.getViewMatrix().m
    const b = this.billboard
    // out[row 4i + j] = view[row 4j + i]
    b[0] = v[0]!; b[1] = v[4]!; b[2] = v[8]!
    b[3] = v[1]!; b[4] = v[5]!; b[5] = v[9]!
    b[6] = v[2]!; b[7] = v[6]!; b[8] = v[10]!
  }

  /** A camera-facing, uniformly scaled instance (a trail quad). */
  pushBillboard(
    px: number, py: number, pz: number,
    s: number,
    r: number, g: number, b: number, a: number,
  ): void {
    if (this.count >= this.capacity) return
    const m = this.matrices
    const o = this.count * MATRIX_FLOATS
    const f = this.billboard
    m[o] = f[0]! * s
    m[o + 1] = f[1]! * s
    m[o + 2] = f[2]! * s
    m[o + 3] = 0
    m[o + 4] = f[3]! * s
    m[o + 5] = f[4]! * s
    m[o + 6] = f[5]! * s
    m[o + 7] = 0
    m[o + 8] = f[6]! * s
    m[o + 9] = f[7]! * s
    m[o + 10] = f[8]! * s
    m[o + 11] = 0
    m[o + 12] = px
    m[o + 13] = py
    m[o + 14] = pz
    m[o + 15] = 1

    this.writeColor(this.count, r, g, b, a)
    this.count++
  }

  /** Upload what was pushed since `begin()` and show / hide the mesh to match. */
  end(): void {
    const n = this.count
    if (n === 0) {
      const idle = this._mesh
      if (idle?.isEnabled(false)) {
        idle.thinInstanceCount = 0
        idle.setEnabled(false)
      }
      return
    }
    const mesh = this._mesh ?? this.buildMesh()
    mesh.thinInstanceCount = n
    mesh.thinInstanceBufferUpdated('matrix')
    mesh.thinInstanceBufferUpdated('color')
    if (!mesh.isEnabled(false)) mesh.setEnabled(true)
  }

  dispose(): void {
    this.count = 0
    this._mesh?.dispose()
    this._mesh = null
  }

  private writeColor(index: number, r: number, g: number, b: number, a: number): void {
    const c = this.colors
    const o = index * COLOR_FLOATS
    c[o] = r < 0 ? 0 : r > 1 ? 1 : r
    c[o + 1] = g < 0 ? 0 : g > 1 ? 1 : g
    c[o + 2] = b < 0 ? 0 : b > 1 ? 1 : b
    c[o + 3] = a < 0 ? 0 : a > 1 ? 1 : a
  }
}
