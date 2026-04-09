/**
 * Display Video Layer
 * 
 * Handles video playback with NULL FIX for safe disposal.
 * Extracted from display.ts for modularity.
 */

import { VideoTexture, Texture } from '@babylonjs/core'
import type { Scene } from '@babylonjs/core'
import { DisplayState, type DisplayConfig } from './display-types'

export class DisplayVideoLayer {
  private scene: Scene
  private videoTexture: VideoTexture | null = null
  private videoElement: HTMLVideoElement | null = null
  private loaded = false

  constructor(
    scene: Scene,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _config: DisplayConfig
  ) {
    this.scene = scene
  }

  /**
   * Load a video from URL
   * NULL FIX: Properly handles cleanup before loading new video
   */
  loadVideo(url: string): void {
    // NULL FIX: Clean up any existing video first
    this.dispose()

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

  /**
   * NULL FIX - Safe disposal with proper null checks
   * Prevents errors during cleanup by checking element existence
   */
  dispose(): void {
    try {
      // NULL FIX: Check element exists before removing listeners
      if (this.videoElement) {
        // Safe pause - use optional chaining
        this.videoElement.pause?.()
        this.videoElement.src = ''
        this.videoElement.load?.()

        // Remove from DOM safely
        try {
          this.videoElement.remove?.()
        } catch {
          // Ignore removal errors
        }
      }

      // Dispose texture
      this.videoTexture?.dispose()
    } catch (err) {
      console.warn('[DisplayVideo] Error during cleanup:', err)
    } finally {
      // ALWAYS null out references to prevent memory leaks
      this.videoTexture = null
      this.videoElement = null
      this.loaded = false
    }
  }
}
