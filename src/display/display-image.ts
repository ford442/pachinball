/**
 * Display Image Layer
 *
 * Handles static image display on the backbox.
 */

import { MeshBuilder, StandardMaterial, Color3, Texture } from '@babylonjs/core'
import type { Scene, Mesh, TransformNode } from '@babylonjs/core'
import type { DisplayConfig, ImageBlendMode } from './display-types'

export class DisplayImageLayer {
  private scene: Scene
  private mesh: Mesh | null = null
  private material: StandardMaterial | null = null
  private texture: Texture | null = null

  constructor(
    scene: Scene,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _config: DisplayConfig
  ) {
    this.scene = scene
  }

  createLayer(parent: TransformNode, config: DisplayConfig): void {
    this.mesh = MeshBuilder.CreatePlane(
      'displayImage',
      { width: config.width ?? 20, height: config.height ?? 12 },
      this.scene
    )
    this.mesh.parent = parent
    this.mesh.rotation.y = Math.PI
    this.mesh.position.z = 0.15
  }

  loadImage(path: string, opacity?: number, blendMode?: ImageBlendMode): void {
    // Clean up existing resources first
    if (this.texture) {
      this.texture.dispose()
      this.texture = null
    }
    if (this.material) {
      this.material.dispose()
      this.material = null
    }

    this.texture = new Texture(path, this.scene)

    const mat = new StandardMaterial('imageMat', this.scene)
    mat.diffuseTexture = this.texture
    mat.alpha = opacity ?? 1.0

    if (blendMode === 'additive') {
      mat.emissiveColor = Color3.White()
    }

    mat.disableLighting = true

    this.material = mat

    if (this.mesh) {
      this.mesh.material = mat
    }
  }

  setVisible(visible: boolean): void {
    if (this.mesh) {
      this.mesh.isVisible = visible
    }
  }

  dispose(): void {
    try {
      this.texture?.dispose()
      this.material?.dispose()
      this.mesh?.dispose()
    } catch (err) {
      console.warn('[DisplayImage] Error during cleanup:', err)
    } finally {
      this.texture = null
      this.material = null
      this.mesh = null
    }
  }
}
