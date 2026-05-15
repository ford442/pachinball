/**
 * Adventure Cinematic System
 * Manages cinematic camera sequences and dramatic effects for major game moments
 */

import { ArcRotateCamera, Color3 } from '@babylonjs/core'

export type CinematicEventType = 'track-start' | 'goal-complete' | 'all-goals-complete' | 'jackpot' | 'special-moment'

export interface CinematicSequence {
  type: CinematicEventType
  duration: number
  cameraPath: {
    startAlpha: number
    startBeta: number
    startRadius: number
    endAlpha: number
    endBeta: number
    endRadius: number
  }
  effects: {
    slowMotion?: number // 0-1, default 1.0
    bloomIntensity?: number // 0-1
    colorFlash?: Color3
    flashDuration?: number
    screenShake?: number // 0-1
  }
  audio?: {
    soundKey?: string
    musicIntensity?: number
  }
  ui?: {
    titleText?: string
    subtitleText?: string
    showDuration?: number
  }
  easing: (t: number) => number
}

export class AdventureCinematicSystem {
  private camera: ArcRotateCamera | null = null
  private activeSequence: CinematicSequence | null = null
  private sequenceProgress: number = 0
  private isActive: boolean = false
  private startCameraState: {
    alpha: number
    beta: number
    radius: number
    fov: number
  } | null = null

  private cinematicCallbacks: {
    onStart?: (eventType: CinematicEventType) => void
    onComplete?: (eventType: CinematicEventType) => void
    onEffect?: (effectName: string, value: unknown) => void
  } = {}

  /**
   * Set the camera to control
   */
  setCamera(camera: ArcRotateCamera): void {
    this.camera = camera
  }

  /**
   * Register callback for cinematic events
   */
  onStart(callback: (eventType: CinematicEventType) => void): void {
    this.cinematicCallbacks.onStart = callback
  }

  /**
   * Register callback for cinematic completion
   */
  onComplete(callback: (eventType: CinematicEventType) => void): void {
    this.cinematicCallbacks.onComplete = callback
  }

  /**
   * Register callback for effect triggers
   */
  onEffect(callback: (effectName: string, value: unknown) => void): void {
    this.cinematicCallbacks.onEffect = callback
  }

  /**
   * Play a cinematic sequence
   */
  playSequence(sequence: CinematicSequence): void {
    if (this.isActive) return

    if (!this.camera) return

    this.activeSequence = sequence
    this.sequenceProgress = 0
    this.isActive = true

    // Save current camera state
    this.startCameraState = {
      alpha: this.camera.alpha,
      beta: this.camera.beta,
      radius: this.camera.radius,
      fov: this.camera.fov
    }

    // Fire start callback
    this.cinematicCallbacks.onStart?.(sequence.type)
  }

  /**
   * Play track start cinematic
   */
  playTrackStart(trackName: string): void {
    this.playSequence({
      type: 'track-start',
      duration: 2.0,
      cameraPath: {
        startAlpha: -Math.PI / 1.8,
        startBeta: 0.8,
        startRadius: 12,
        endAlpha: -Math.PI / 2,
        endBeta: 1.0,
        endRadius: 16
      },
      effects: {
        bloomIntensity: 0.3,
        colorFlash: Color3.FromHexString('#00ffff'),
        flashDuration: 0.5
      },
      ui: {
        titleText: trackName,
        subtitleText: 'Challenge begins!',
        showDuration: 1.5
      },
      easing: this.easeInOutCubic
    })
  }

  /**
   * Play goal completion cinematic
   */
  playGoalComplete(goalTitle: string): void {
    this.playSequence({
      type: 'goal-complete',
      duration: 1.5,
      cameraPath: {
        startAlpha: -Math.PI / 2,
        startBeta: 1.0,
        startRadius: 16,
        endAlpha: -Math.PI / 2,
        endBeta: 0.85,
        endRadius: 12
      },
      effects: {
        bloomIntensity: 0.6,
        colorFlash: Color3.FromHexString('#ffff00'),
        flashDuration: 0.4,
        screenShake: 0.15
      },
      ui: {
        titleText: 'GOAL COMPLETE!',
        subtitleText: goalTitle,
        showDuration: 1.0
      },
      audio: {
        musicIntensity: 1.2
      },
      easing: this.easeOutCubic
    })
  }

  /**
   * Play all goals complete cinematic
   */
  playTrackComplete(trackName: string): void {
    this.playSequence({
      type: 'all-goals-complete',
      duration: 2.5,
      cameraPath: {
        startAlpha: -Math.PI / 2,
        startBeta: 1.0,
        startRadius: 16,
        endAlpha: -Math.PI / 2.2,
        endBeta: 0.7,
        endRadius: 8
      },
      effects: {
        slowMotion: 0.7,
        bloomIntensity: 1.0,
        colorFlash: Color3.FromHexString('#ff00ff'),
        flashDuration: 0.6,
        screenShake: 0.3
      },
      ui: {
        titleText: 'TRACK COMPLETE!',
        subtitleText: `${trackName} Mastered`,
        showDuration: 2.0
      },
      audio: {
        musicIntensity: 1.5
      },
      easing: this.easeInOutCubic
    })
  }

  /**
   * Play jackpot cinematic
   */
  playJackpot(points: number): void {
    this.playSequence({
      type: 'jackpot',
      duration: 1.2,
      cameraPath: {
        startAlpha: -Math.PI / 2,
        startBeta: 1.0,
        startRadius: 16,
        endAlpha: -Math.PI / 2,
        endBeta: 1.0,
        endRadius: 10
      },
      effects: {
        slowMotion: 0.5,
        bloomIntensity: 0.8,
        colorFlash: Color3.FromHexString('#ff0000'),
        flashDuration: 0.3,
        screenShake: 0.4
      },
      ui: {
        titleText: 'JACKPOT!',
        subtitleText: `+${points} Points`,
        showDuration: 1.0
      },
      audio: {
        musicIntensity: 1.3
      },
      easing: this.easeOutQuad
    })
  }

  /**
   * Update cinematic (call from game loop)
   */
  update(deltaTime: number): void {
    if (!this.activeSequence || !this.camera || !this.startCameraState) {
      return
    }

    this.sequenceProgress += deltaTime / this.activeSequence.duration
    if (this.sequenceProgress >= 1.0) {
      this.sequenceProgress = 1.0
      this.isActive = false
      const completedType = this.activeSequence.type
      this.activeSequence = null
      this.cinematicCallbacks.onComplete?.(completedType)
      return
    }

    const t = this.activeSequence.easing(this.sequenceProgress)

    // Update camera path
    const path = this.activeSequence.cameraPath
    this.camera.alpha = this.lerp(path.startAlpha, path.endAlpha, t)
    this.camera.beta = this.lerp(path.startBeta, path.endBeta, t)
    this.camera.radius = this.lerp(path.startRadius, path.endRadius, t)

    // Trigger effects at appropriate times
    if (this.activeSequence.effects) {
      if (this.activeSequence.effects.colorFlash && this.sequenceProgress < (this.activeSequence.effects.flashDuration ?? 0) / this.activeSequence.duration) {
        this.cinematicCallbacks.onEffect?.('color-flash', {
          color: this.activeSequence.effects.colorFlash,
          intensity: 1.0 - (this.sequenceProgress / ((this.activeSequence.effects.flashDuration ?? 0) / this.activeSequence.duration))
        })
      }

      if (this.activeSequence.effects.bloomIntensity) {
        this.cinematicCallbacks.onEffect?.('bloom', {
          intensity: this.activeSequence.effects.bloomIntensity * (1.0 - Math.abs(t - 0.5) * 2)
        })
      }

      if (this.activeSequence.effects.screenShake) {
        const shakeAmount = this.activeSequence.effects.screenShake * Math.sin(t * Math.PI * 8)
        this.cinematicCallbacks.onEffect?.('screen-shake', { amount: shakeAmount })
      }

      if (this.activeSequence.effects.slowMotion) {
        this.cinematicCallbacks.onEffect?.('slow-motion', {
          timeScale: this.activeSequence.effects.slowMotion
        })
      }
    }
  }

  /**
   * Check if cinematic is playing
   */
  isPlaying(): boolean {
    return this.isActive
  }

  /**
   * Get progress (0-1)
   */
  getProgress(): number {
    return this.sequenceProgress
  }

  /**
   * Skip to end of current cinematic
   */
  skipCinematic(): void {
    this.sequenceProgress = 1.0
  }

  /**
   * Easing functions
   */
  private easeOutQuad(t: number): number {
    return 1 - (1 - t) * (1 - t)
  }

  private easeInOutCubic(t: number): number {
    return t < 0.5
      ? 4 * t * t * t
      : 1 - Math.pow(-2 * t + 2, 3) / 2
  }

  private easeOutCubic(t: number): number {
    const t1 = t - 1
    return t1 * t1 * t1 + 1
  }

  /**
   * Linear interpolation helper
   */
  private lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t
  }

  /**
   * Clean up camera reference and callbacks
   */
  dispose(): void {
    this.camera = null
    this.activeSequence = null
    this.startCameraState = null
    this.cinematicCallbacks = {}
    this.isActive = false
    this.sequenceProgress = 0
  }
}
