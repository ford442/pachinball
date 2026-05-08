/**
 * Adventure Camera System
 * Manages camera transitions and presets for different adventure tracks
 */

import { ArcRotateCamera, Scalar } from '@babylonjs/core'

export interface CameraTransition {
  duration: number
  easing: (t: number) => number
  targetAlpha: number
  targetBeta: number
  targetRadius: number
  targetFOV: number
}

export interface CameraPreset {
  alpha: number
  beta: number
  radius: number
  fov: number
  label: string
}

export class AdventureCameraSystem {
  private camera: ArcRotateCamera | null = null
  private activeTransition: CameraTransition | null = null
  private transitionProgress: number = 0
  private startValues: {
    alpha: number
    beta: number
    radius: number
    fov: number
  } | null = null

  private readonly PRESETS: Record<string, CameraPreset> = {
    NEON_HELIX: {
      alpha: -Math.PI / 2,
      beta: 0.96,
      radius: 16,
      fov: 0.75,
      label: 'Neon Helix View'
    },
    CYBER_CORE: {
      alpha: -Math.PI / 2,
      beta: 1.13,
      radius: 14,
      fov: 0.8,
      label: 'Cyber Core View'
    },
    QUANTUM_GRID: {
      alpha: -Math.PI / 2,
      beta: 1.22,
      radius: 18,
      fov: 0.85,
      label: 'Quantum Grid View'
    },
    PACHINKO_SPIRE: {
      alpha: -Math.PI / 2.5,
      beta: 1.0,
      radius: 15,
      fov: 0.78,
      label: 'Pachinko Spire View'
    },
    SINGULARITY_WELL: {
      alpha: -Math.PI / 2,
      beta: 1.4,
      radius: 12,
      fov: 0.9,
      label: 'Singularity Well View'
    }
  }

  /**
   * Initialize camera system with an ArcRotateCamera
   */
  setCamera(camera: ArcRotateCamera): void {
    this.camera = camera
  }

  /**
   * Get preset camera values for a track
   */
  getPreset(trackId: string): CameraPreset | null {
    return this.PRESETS[trackId] ?? null
  }

  /**
   * Transition to a track's preset camera with smooth animation
   */
  transitionToTrack(trackId: string, duration: number = 1.0): void {
    if (!this.camera) return

    const preset = this.getPreset(trackId)
    if (!preset) return

    this.startTransition({
      duration,
      easing: this.easeInOutCubic,
      targetAlpha: preset.alpha,
      targetBeta: preset.beta,
      targetRadius: preset.radius,
      targetFOV: preset.fov
    })
  }

  /**
   * Start a custom camera transition
   */
  startTransition(transition: CameraTransition): void {
    if (!this.camera) return

    this.activeTransition = transition
    this.transitionProgress = 0
    this.startValues = {
      alpha: this.camera.alpha,
      beta: this.camera.beta,
      radius: this.camera.radius,
      fov: this.camera.fov
    }
  }

  /**
   * Update camera transition (call from game loop)
   */
  update(deltaTime: number): void {
    if (!this.activeTransition || !this.camera || !this.startValues) {
      return
    }

    this.transitionProgress += deltaTime / this.activeTransition.duration
    if (this.transitionProgress >= 1.0) {
      this.transitionProgress = 1.0
      this.activeTransition = null
      this.startValues = null
      return
    }

    const t = this.activeTransition.easing(this.transitionProgress)

    // Interpolate camera properties
    this.camera.alpha = Scalar.Lerp(
      this.startValues.alpha,
      this.activeTransition.targetAlpha,
      t
    )

    this.camera.beta = Scalar.Lerp(
      this.startValues.beta,
      this.activeTransition.targetBeta,
      t
    )

    this.camera.radius = Scalar.Lerp(
      this.startValues.radius,
      this.activeTransition.targetRadius,
      t
    )

    this.camera.fov = Scalar.Lerp(
      this.startValues.fov,
      this.activeTransition.targetFOV,
      t
    )
  }

  /**
   * Check if camera is currently transitioning
   */
  isTransitioning(): boolean {
    return this.activeTransition !== null
  }

  /**
   * Get transition progress (0-1)
   */
  getTransitionProgress(): number {
    return this.transitionProgress
  }

  /**
   * Cancel current transition
   */
  cancelTransition(): void {
    this.activeTransition = null
  }

  /**
   * Default easing function (ease in-out cubic)
   */
  private easeInOutCubic(t: number): number {
    return t < 0.5
      ? 4 * t * t * t
      : 1 - Math.pow(-2 * t + 2, 3) / 2
  }

  /**
   * Get all available presets
   */
  getAllPresets(): Record<string, CameraPreset> {
    return { ...this.PRESETS }
  }

  /**
   * Reset to a preset immediately (no transition)
   */
  jumpToPreset(trackId: string): void {
    if (!this.camera) return

    const preset = this.getPreset(trackId)
    if (!preset) return

    this.camera.alpha = preset.alpha
    this.camera.beta = preset.beta
    this.camera.radius = preset.radius
    this.camera.fov = preset.fov
    this.activeTransition = null
  }
}
