/**
 * Display Video Layer
 *
 * Handles video playback with NULL FIX for safe disposal.
 * Extracted from display.ts for modularity.
 */

import {
  VideoTexture,
  Texture,
  MeshBuilder,
  StandardMaterial,
  Color3,
  TransformNode,
} from '@babylonjs/core'
import type { Scene, Mesh } from '@babylonjs/core'
import { DisplayState, type DisplayConfig } from './display-types'

export class DisplayVideoLayer {
  private scene: Scene
  private videoTexture: VideoTexture | null = null
  private videoElement: HTMLVideoElement | null = null
  private loaded = false
  private mesh: Mesh | null = null

  constructor(
    scene: Scene,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _config: DisplayConfig
  ) {
    this.scene = scene
  }

  createLayer(parent: TransformNode, config: DisplayConfig): void {
    this.mesh = MeshBuilder.CreatePlane(
      'displayVideo',
      { width: config.width ?? 20, height: config.height ?? 12 },
      this.scene
    )
    this.mesh.parent = parent
    this.mesh.rotation.y = Math.PI
    this.mesh.position.z = 0.1 // slightly in front of shader background
  }

  /**
   * Load a video from URL
   * NULL FIX: Properly handles cleanup before loading new video
   */
  loadVideo(url: string): void {
    // NULL FIX: Clean up any existing video first
    this.disposeVideo()

    try {
      this.videoElement = document.createElement('video')
      this.videoElement.src = url
      this.videoElement.loop = true
      this.videoElement.muted = true
      this.videoElement.playsInline = true
      this.videoElement.crossOrigin = 'anonymous'
      this.videoElement.preload = 'auto'
      this.videoElement.style.display = 'none'
      document.body.appendChild(this.videoElement)

      // Event handlers
      this.videoElement.onloadeddata = () => {
        this.loaded = true
        this.videoTexture = new VideoTexture(
          'displayVideo',
          this.videoElement!,
          this.scene,
          true,
          true,
          Texture.TRILINEAR_SAMPLINGMODE,
          { autoPlay: false, autoUpdateTexture: true }
        )
        this.videoElement?.play().catch(() => {
          console.warn('[DisplayVideo] Autoplay blocked')
        })

        if (this.mesh) {
          const mat = new StandardMaterial('videoMat', this.scene)
          mat.diffuseTexture = this.videoTexture
          mat.emissiveColor = Color3.White()
          mat.disableLighting = true
          this.mesh.material = mat
        }
      }

      this.videoElement.onerror = () => {
        console.warn('[DisplayVideo] Failed to load:', url)
        this.dispose()
      }

      // Timeout fallback
      setTimeout(() => {
        if (!this.loaded && this.videoElement) {
          console.warn('[DisplayVideo] Load timeout')
          this.dispose()
        }
      }, 5000)
    } catch (err) {
      console.warn('[DisplayVideo] Error creating video:', err)
      this.dispose()
    }
  }

  update(): void {
    // Video updates automatically via VideoTexture
  }

  onStateChange(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _state: DisplayState
  ): void {
    // Pause/play based on state if needed
  }

  isLoaded(): boolean {
    return this.loaded
  }

  getVideoTexture(): VideoTexture | null {
    return this.videoTexture
  }

  setVisible(visible: boolean): void {
    if (this.mesh) {
      this.mesh.isVisible = visible
    }
  }

  /**
   * NULL FIX - Safe disposal of video resources only
   * Preserves the display mesh for layer reuse
   */
  private disposeVideo(): void {
    try {
      if (this.videoElement) {
        this.videoElement.pause?.()
        this.videoElement.src = ''
        this.videoElement.load?.()
        try {
          this.videoElement.remove?.()
        } catch {
          // Ignore removal errors
        }
      }
      this.videoTexture?.dispose()
      // Clear mesh material so it doesn't reference disposed texture
      if (this.mesh) {
        this.mesh.material = null
      }
    } catch (err) {
      console.warn('[DisplayVideo] Error during video cleanup:', err)
    } finally {
      this.videoTexture = null
      this.videoElement = null
      this.loaded = false
    }
  }

  /**
   * NULL FIX - Safe disposal with proper null checks
   * Prevents errors during cleanup by checking element existence
   */
  dispose(): void {
    this.disposeVideo()
    try {
      if (this.mesh) {
        this.mesh.material?.dispose()
        this.mesh.dispose()
      }
    } catch (err) {
      console.warn('[DisplayVideo] Error during cleanup:', err)
    } finally {
      this.mesh = null
    }
  }
}
