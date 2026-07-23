import { Vector3, Quaternion, TransformNode, Matrix, TmpVectors } from '@babylonjs/core'
import type * as RAPIER from '@dimforge/rapier3d-compat'

export interface InterpolationBinding {
  rigidBody?: RAPIER.RigidBody
  mesh?: TransformNode
}

/**
 * Interpolates dynamic-body meshes between their previous and current physics
 * poses using the fixed-step alpha returned by `PhysicsSystem.step()`.
 */
export class MeshInterpolationSystem {
  /** Pose at the end of the previous physics step, per rigid body — used to
   *  interpolate mesh transforms toward the current pose by the step's alpha. */
  private readonly prevPoses: Map<RAPIER.RigidBody, { pos: Vector3; rot: Quaternion }> = new Map()
  private readonly scratchCurrPos = new Vector3()
  private readonly scratchCurrRot = new Quaternion()
  private readonly scratchInterpPos = new Vector3()
  private readonly scratchInterpRot = new Quaternion()
  private readonly scratchScale = new Vector3(1, 1, 1)

  syncMeshes(alpha: number, bindings: InterpolationBinding[]): void {
    const liveBodies = new Set<RAPIER.RigidBody>()

    for (const binding of bindings) {
      const body = binding.rigidBody
      const mesh = binding.mesh
      if (!body || !mesh) continue
      // Removed bodies stay in a stale shared binding list if arrays diverge;
      // calling isFixed()/translation() on them traps in Rapier WASM.
      if (typeof body.isValid === 'function' && !body.isValid()) continue
      if (mesh.isDisposed?.()) continue
      if (body.isFixed()) continue

      const pos = body.translation()
      const rot = body.rotation()
      if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y) || !Number.isFinite(pos.z)) continue
      if (Math.abs(pos.x) > 100 || Math.abs(pos.y) > 100 || Math.abs(pos.z) > 100) continue

      liveBodies.add(body)
      this.scratchCurrPos.set(pos.x, pos.y, pos.z)
      this.scratchCurrRot.set(rot.x, rot.y, rot.z, rot.w)

      let prev = this.prevPoses.get(body)
      if (!prev) {
        prev = { pos: this.scratchCurrPos.clone(), rot: this.scratchCurrRot.clone() }
        this.prevPoses.set(body, prev)
      }

      if (alpha < 1 && !body.isSleeping()) {
        const interpPos = Vector3.LerpToRef(prev.pos, this.scratchCurrPos, alpha, this.scratchInterpPos)
        Quaternion.SlerpToRef(prev.rot, this.scratchCurrRot, alpha, this.scratchInterpRot)
        this.applyBindingPose(mesh, interpPos, this.scratchInterpRot)
      } else {
        this.applyBindingPose(mesh, this.scratchCurrPos, this.scratchCurrRot)
      }

      prev.pos.copyFrom(this.scratchCurrPos)
      prev.rot.copyFrom(this.scratchCurrRot)
    }

    // Drop poses for bodies no longer bound to a mesh (e.g. collected/drained balls).
    for (const body of this.prevPoses.keys()) {
      if (!liveBodies.has(body)) this.prevPoses.delete(body)
    }
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
