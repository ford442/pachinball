/**
 * Ghost Ball Renderer — Visual ghost ball mesh for spectating replays & live challenges.
 *
 * Renders a glowing semi-transparent sphere mesh with emissive material.
 */

import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { Scene } from '@babylonjs/core/scene'
import { PALETTE, INTENSITY, emissive } from '../game-elements/visual-language'

export class GhostBallRenderer {
  private scene: Scene
  private mesh: Mesh | null = null
  private material: StandardMaterial | null = null
  private visible = false

  constructor(scene: Scene) {
    this.scene = scene
    this.createGhostMesh()
  }

  private createGhostMesh(): void {
    const mesh = MeshBuilder.CreateSphere('ghostBallMesh', { diameter: 0.24, segments: 16 }, this.scene)
    const mat = new StandardMaterial('ghostBallMat', this.scene)

    mat.diffuseColor = Color3.FromHexString(PALETTE.CYAN)
    mat.emissiveColor = emissive(PALETTE.CYAN, INTENSITY.HIGH)
    mat.alpha = 0.55
    mat.disableLighting = true

    mesh.material = mat
    mesh.isPickable = false
    mesh.setEnabled(false)

    this.mesh = mesh
    this.material = mat
  }

  show(): void {
    if (this.mesh) {
      this.mesh.setEnabled(true)
      this.visible = true
    }
  }

  hide(): void {
    if (this.mesh) {
      this.mesh.setEnabled(false)
      this.visible = false
    }
  }

  isVisible(): boolean {
    return this.visible
  }

  updatePosition(pos: { x: number; y: number; z: number }): void {
    if (this.mesh) {
      this.mesh.position.set(pos.x, pos.y, pos.z)
    }
  }

  setGhostColor(hexColor: string, alpha = 0.55): void {
    if (this.material) {
      this.material.diffuseColor = Color3.FromHexString(hexColor)
      this.material.emissiveColor = emissive(hexColor, INTENSITY.HIGH)
      this.material.alpha = alpha
    }
  }

  dispose(): void {
    if (this.mesh) {
      this.mesh.dispose()
      this.mesh = null
    }
    if (this.material) {
      this.material.dispose()
      this.material = null
    }
    this.visible = false
  }
}
