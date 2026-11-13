import { Vector3, Quaternion, Matrix, TmpVectors } from '@babylonjs/core/Maths/math.vector'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { PhysicsBody } from '../../core/physics-api'

export interface InterpolationBinding {
  rigidBody?: PhysicsBody
  mesh?: TransformNode
}

interface StoredPose {
  pos: Vector3
  rot: Quaternion
  seen: number
}

/**
 * Interpolates dynamic-body meshes between their pre-step and current physics
 * poses using the fixed-step alpha (`stepAccumulator / FIXED_TIMESTEP`).
 *
 * The stored pose is the pose from *before the last physics tick*. It is written
 * only by `capturePreStep`, which the controller calls at the start of every tick,
 * and never by `syncMeshes`: a render frame that runs no tick keeps blending
 * `lerp(stored, current, alpha)` with a growing alpha, so the mesh keeps moving
 * between steps instead of freezing and then popping backward. A frame that runs
 * several ticks ends with the pose before the last one.
 */
export class MeshInterpolationSystem {
  private readonly prevPoses: Map<PhysicsBody, StoredPose> = new Map()
  /**
   * Bumped every `syncMeshes`; a pose whose `seen` lags it was not synced this call. Replaces
   * a `new Set` of live bodies per frame (V8 also reallocates a Set's table on `clear()`) (#488 §5).
   */
  private syncPass = 0
  /** Bound once; deleting the current entry inside Map.forEach is safe. */
  private readonly dropUnseenPose = (prev: { seen: number }, body: PhysicsBody): void => {
    if (prev.seen !== this.syncPass) this.prevPoses.delete(body)
  }
  private readonly scratchCurrPos = new Vector3()
  private readonly scratchCurrRot = new Quaternion()
  private readonly scratchInterpPos = new Vector3()
  private readonly scratchInterpRot = new Quaternion()
  private readonly scratchScale = new Vector3(1, 1, 1)

  /**
   * Snapshot every dynamic bound body's current pose as "the pose before this tick". Called
   * before each physics tick; a later tick in the same frame overwrites it.
   */
  capturePreStep(bindings: InterpolationBinding[]): void {
    for (const binding of bindings) {
      const body = this.interpolableBody(binding)
      if (!body || !this.readPose(body)) continue
      const stored = this.prevPoses.get(body)
      if (stored) {
        stored.pos.copyFrom(this.scratchCurrPos)
        stored.rot.copyFrom(this.scratchCurrRot)
      } else {
        // Seen for the first time at a tick boundary; `seen` is refreshed by the next syncMeshes.
        this.prevPoses.set(body, { pos: this.scratchCurrPos.clone(), rot: this.scratchCurrRot.clone(), seen: this.syncPass })
      }
    }
  }

  /**
   * Position of `body` as its mesh is drawn: `lerp(stored, current, alpha)`, written into `out`.
   * Falls back to the live position for a body that is asleep, unknown, or not interpolated.
   */
  getInterpolatedPosition(body: PhysicsBody, alpha: number, out: Vector3): Vector3 {
    const t = body.translation()
    const stored = this.prevPoses.get(body)
    if (!stored || alpha >= 1 || body.isSleeping()) return out.set(t.x, t.y, t.z)
    out.x = stored.pos.x + (t.x - stored.pos.x) * alpha
    out.y = stored.pos.y + (t.y - stored.pos.y) * alpha
    out.z = stored.pos.z + (t.z - stored.pos.z) * alpha
    return out
  }

  /**
   * Draw every bound dynamic mesh at `lerp(stored, current, alpha)`. `snap` also makes the stored
   * pose the current one — for frames where no step runs and the world may have been repositioned
   * (MENU, before the first tick), so the next blend does not start from a stale pose.
   */
  syncMeshes(alpha: number, bindings: InterpolationBinding[], snap = false): void {
    const pass = ++this.syncPass

    for (const binding of bindings) {
      const body = this.interpolableBody(binding)
      const mesh = binding.mesh
      if (!body || !mesh || !this.readPose(body)) continue

      let prev = this.prevPoses.get(body)
      if (!prev) {
        // First sight with no tick yet: nothing to blend from, so start at the live pose.
        prev = { pos: this.scratchCurrPos.clone(), rot: this.scratchCurrRot.clone(), seen: pass }
        this.prevPoses.set(body, prev)
      }
      prev.seen = pass

      if (!snap && alpha < 1 && !body.isSleeping()) {
        const interpPos = Vector3.LerpToRef(prev.pos, this.scratchCurrPos, alpha, this.scratchInterpPos)
        Quaternion.SlerpToRef(prev.rot, this.scratchCurrRot, alpha, this.scratchInterpRot)
        this.applyBindingPose(mesh, interpPos, this.scratchInterpRot)
      } else {
        this.applyBindingPose(mesh, this.scratchCurrPos, this.scratchCurrRot)
      }

      if (snap) {
        prev.pos.copyFrom(this.scratchCurrPos)
        prev.rot.copyFrom(this.scratchCurrRot)
      }
    }

    // Drop poses for bodies no longer bound to a mesh (e.g. collected/drained balls).
    this.prevPoses.forEach(this.dropUnseenPose)
  }

  /** The binding's body when it is a live, non-fixed body with a live mesh; otherwise null. */
  private interpolableBody(binding: InterpolationBinding): PhysicsBody | null {
    const body = binding.rigidBody
    const mesh = binding.mesh
    if (!body || !mesh) return null
    // Removed bodies stay in a stale shared binding list if arrays diverge;
    // calling isFixed()/translation() on them traps in Rapier WASM.
    if (typeof body.isValid === 'function' && !body.isValid()) return null
    if (mesh.isDisposed?.()) return null
    if (body.isFixed()) return null
    return body
  }

  /** Read the body's live pose into the scratch current pose; false when it is not finite / in range. */
  private readPose(body: PhysicsBody): boolean {
    const pos = body.translation()
    const rot = body.rotation()
    if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y) || !Number.isFinite(pos.z)) return false
    if (Math.abs(pos.x) > 100 || Math.abs(pos.y) > 100 || Math.abs(pos.z) > 100) return false
    this.scratchCurrPos.set(pos.x, pos.y, pos.z)
    this.scratchCurrRot.set(rot.x, rot.y, rot.z, rot.w)
    return true
  }

  /** Apply a physics-world pose to a bound mesh, respecting playfield parenting. */
  applyBindingPose(mesh: TransformNode, pos: Vector3, rot: Quaternion): void {
    if (!mesh.parent) {
      mesh.position.copyFrom(pos)
      if (!mesh.rotationQuaternion) {
        mesh.rotationQuaternion = rot.clone()
      } else {
        mesh.rotationQuaternion.copyFrom(rot)
      }
      return
    }

    const parentWorld = mesh.parent.computeWorldMatrix(true)
    parentWorld.invertToRef(TmpVectors.Matrix[0])
    // Physics-driven roots are authored at unit scale. Never feed mesh.scaling
    // back into Compose→decompose — float drift can shrink flippers to invisible.
    this.scratchScale.set(1, 1, 1)
    Matrix.ComposeToRef(this.scratchScale, rot, pos, TmpVectors.Matrix[1])
    TmpVectors.Matrix[1].multiplyToRef(TmpVectors.Matrix[0], TmpVectors.Matrix[2])
    if (!mesh.rotationQuaternion) {
      mesh.rotationQuaternion = new Quaternion()
    }
    TmpVectors.Matrix[2].decompose(this.scratchScale, mesh.rotationQuaternion, mesh.position)
    mesh.scaling.set(1, 1, 1)
  }

  dispose(): void {
    this.prevPoses.clear()
  }
}
