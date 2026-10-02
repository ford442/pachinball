/**
 * Display Video Layer
 *
 * Handles video playback with NULL FIX for safe disposal.
 * Extracted from display.ts for modularity.
 */

import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { VideoTexture } from '@babylonjs/core/Materials/Textures/videoTexture'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { Scene } from '@babylonjs/core/scene'
import { DisplayState, type DisplayConfig } from './display-types'
import { DISPLAY_LAYER_Z } from './display-layer-depth'

export interface VideoLoadOptions {
  /** First frame decoded and bound to the plane. */
  onReady?: () => void
  /** Load error or timeout; the plane is kept for later loads. */
  onError?: () => void
}

export class DisplayVideoLayer {
  private scene: Scene
  private videoTexture: VideoTexture | null = null
  private videoElement: HTMLVideoElement | null = null
  private loaded = false
  private mesh: Mesh | null = null
  private material: StandardMaterial | null = null
  private loadToken = 0
  private loadTimer: ReturnType<typeof setTimeout> | null = null
  private readonly loadTimeoutMs: number

  constructor(
    scene: Scene,
    config: DisplayConfig
  ) {
    this.scene = scene
    this.loadTimeoutMs = config.videoSettings?.loadTimeout ?? 5000
  }

  createLayer(parent: TransformNode, config: DisplayConfig): void {
    this.mesh = MeshBuilder.CreatePlane(
      'displayVideo',
      { width: config.width ?? 20, height: config.height ?? 12 },
      this.scene
    )
    this.mesh.parent = parent
    this.mesh.rotation.y = Math.PI
    this.mesh.position.z = DISPLAY_LAYER_Z.MAIN_VIDEO
  }

  /**
   * Load a video from URL. A failed or timed-out load releases only the video
   * resources — the plane stays so the next load can bind to it. Callbacks fire
   * only for the most recent load.
   */
  loadVideo(url: string, options: VideoLoadOptions = {}): void {
    this.disposeVideo()
    const token = ++this.loadToken

    try {
      const video = document.createElement('video')
      this.videoElement = video
      video.src = url
      video.loop = true
      video.muted = true
      video.playsInline = true
      video.crossOrigin = 'anonymous'
      video.preload = 'auto'
      video.style.display = 'none'
      document.body.appendChild(video)

      video.onloadeddata = () => {
        if (token !== this.loadToken) return
        this.clearLoadTimer()
        this.loaded = true
        this.videoTexture = new VideoTexture(
          'displayVideo',
          video,
          this.scene,
          true,
          true,
          Texture.TRILINEAR_SAMPLINGMODE,
          { autoPlay: false, autoUpdateTexture: true }
        )
        video.play().catch(() => {
          console.warn('[DisplayVideo] Autoplay blocked')
        })

        if (this.mesh) {
          if (!this.material) {
            this.material = new StandardMaterial('videoMat', this.scene)
            this.material.emissiveColor = Color3.White()
            this.material.disableLighting = true
          }
          this.material.diffuseTexture = this.videoTexture
          this.mesh.material = this.material
        }
        options.onReady?.()
      }

      const fail = (reason: string) => {
        if (token !== this.loadToken) return
        console.warn(`[DisplayVideo] ${reason}:`, url)
        this.disposeVideo()
        options.onError?.()
      }

      video.onerror = () => fail('Failed to load')
      this.loadTimer = setTimeout(() => {
        if (!this.loaded) fail('Load timeout')
      }, this.loadTimeoutMs)
    } catch (err) {
      console.warn('[DisplayVideo] Error creating video:', err)
      this.disposeVideo()
      options.onError?.()
    }
  }

  updateParallax(time: number): void {
    if (this.mesh) {
      // Period 3.0 s, amplitude 0.04, phase 3π/4
      this.mesh.position.z = DISPLAY_LAYER_Z.MAIN_VIDEO + Math.sin(time * (2 * Math.PI / 3.0) + (3 * Math.PI) / 4) * 0.04
    }
  }

  update(): void {
    // Video updates automatically via VideoTexture
  }

  onStateChange(
     
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

  setOpacity(opacity: number): void {
    if (this.mesh?.material) {
      (this.mesh.material as StandardMaterial).alpha = opacity
    }
  }

  /**
   * NULL FIX - Safe disposal of video resources only
   * Preserves the display mesh for layer reuse
   */
  private clearLoadTimer(): void {
    if (this.loadTimer !== null) {
      clearTimeout(this.loadTimer)
      this.loadTimer = null
    }
  }

  private disposeVideo(): void {
    this.loadToken++
    this.clearLoadTimer()
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
      if (this.material) {
        this.material.diffuseTexture = null
      }
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
      this.material?.dispose()
      this.mesh?.dispose()
    } catch (err) {
      console.warn('[DisplayVideo] Error during cleanup:', err)
    } finally {
      this.material = null
      this.mesh = null
    }
  }
}
