/**
 * Display Image Layer
 *
 * Handles static image display on the backbox.
 */

import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { Scene } from '@babylonjs/core/scene'
import type { DisplayConfig } from './display-types'
import { DISPLAY_LAYER_Z } from './display-layer-depth'

export interface ImageLoadOptions {
  opacity?: number
  /** Use the image's alpha channel (character posters). */
  hasAlpha?: boolean
  onLoad?: () => void
  onError?: () => void
}

export class DisplayImageLayer {
  private scene: Scene
  private mesh: Mesh | null = null
  private material: StandardMaterial | null = null
  private texture: Texture | null = null
  private loadToken = 0
  private tint: Color3 | null = null

  constructor(
    scene: Scene,
     
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
    this.mesh.position.z = DISPLAY_LAYER_Z.MAIN_IMAGE
  }

  updateParallax(time: number): void {
    if (this.mesh) {
      // Period 2.0 s, amplitude 0.05, phase π
      this.mesh.position.z = DISPLAY_LAYER_Z.MAIN_IMAGE + Math.sin(time * (2 * Math.PI / 2.0) + Math.PI) * 0.05
    }
  }

  /**
   * Load an image onto the layer. Returns a load token; `onLoad` / `onError`
   * fire only for the most recent load, so a slow stale texture can never
   * report success for a newer state.
   */
  loadImage(path: string, options: ImageLoadOptions = {}): number {
    const token = ++this.loadToken
    // Clean up existing resources first
    if (this.texture) {
      this.texture.dispose()
      this.texture = null
    }
    if (this.material) {
      this.material.dispose()
      this.material = null
    }

    this.texture = new Texture(path, this.scene, {
      onLoad: () => {
        if (token === this.loadToken) options.onLoad?.()
      },
      onError: (message?: string) => {
        if (token !== this.loadToken) return
        console.warn('[DisplayImage] Failed to load:', path, message ?? '')
        options.onError?.()
      },
    })

    const mat = new StandardMaterial('imageMat', this.scene)
    mat.diffuseTexture = this.texture
    mat.alpha = options.opacity ?? 1.0

    if (options.hasAlpha) {
      // Composite the poster's own alpha over the reels/video behind it.
      this.texture.hasAlpha = true
      mat.useAlphaFromDiffuseTexture = true
    }

    // Unlit: with lighting disabled only emissive reaches the texture, so the
    // emissive colour is the image's brightness (and its tint).
    mat.disableLighting = true
    mat.emissiveColor = this.tint ? this.tint.clone() : Color3.White()

    this.material = mat

    if (this.mesh) {
      this.mesh.material = mat
    }
    return token
  }

  /** Multiply tint for the current and future images; null restores white. */
  setTint(hex: string | null): void {
    this.tint = hex ? Color3.FromHexString(hex) : null
    if (this.material) {
      this.material.emissiveColor = this.tint ? this.tint.clone() : Color3.White()
    }
  }

  setOpacity(opacity: number): void {
    if (this.material) {
      this.material.alpha = opacity
    }
  }

  setVisible(visible: boolean): void {
    if (this.mesh) {
      this.mesh.isVisible = visible
    }
  }

  dispose(): void {
    this.loadToken++
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
