/**
 * Adventure Mode — cinematic follow-camera concerns.
 *
 * Owns the ArcRotateCamera used while adventure mode is active, the smoothed
 * ball-tracking update, and zone-to-zone camera preset transitions.
 */

import {
  ArcRotateCamera,
  type Camera,
  Vector3,
  Scalar,
} from '@babylonjs/core'
import type * as RAPIER from '@dimforge/rapier3d-compat'
import { TrackBuilder } from './track-builder'
import { CameraEasing } from './camera-easing'
import { CAMERA_PRESETS } from './camera-presets'
import type { CameraPreset } from './adventure-types'
import type { AccessibilityConfig } from '../game-elements/accessibility-config'

export abstract class AdventureCameraMixin extends TrackBuilder {
  /** Current camera preset for active track */
  protected currentCameraPreset: CameraPreset | null = CAMERA_PRESETS.DEFAULT

  /** Camera management */
  protected tableCamera: Camera | null = null
  protected followCamera: ArcRotateCamera | null = null

  /** Camera transition state for cinematic polish */
  protected cameraTransitionTime = 0
  protected cameraTransitionDuration = 0.8 // seconds for smooth entry
  protected zoneCameraTransition:
    | {
        elapsed: number
        duration: number
        from: { alpha: number; beta: number; radius: number; fov: number }
        to: { alpha: number; beta: number; radius: number; fov: number }
      }
    | null = null

  protected accessibility: AccessibilityConfig = {
    reducedMotion: false,
    cameraShakeEnabled: true,
    flashFrequencyMax: 2,
    scanlineIntensity: 0.25,
    effectIntensity: 1,
    maxCameraShakeIntensity: 0.08,
    hapticsEnabled: true,
    hapticIntensity: 1,
  }

  getFollowCamera(): ArcRotateCamera | null {
    return this.followCamera
  }

  setAccessibilityConfig(config: AccessibilityConfig): void {
    this.accessibility = config
  }

  protected updateCinematicCamera(ballBody: RAPIER.RigidBody, dt: number): void {
    if (!this.followCamera || !this.currentCameraPreset) return

    const preset = this.currentCameraPreset
    const ballPos = ballBody.translation()
    const velocity = ballBody.linvel()
    const speed = Math.sqrt(velocity.x ** 2 + velocity.y ** 2 + velocity.z ** 2)

    // Speed-based radius
    const speedFactor = Math.min(speed / 30, 1)
    const targetRadius = preset.radius + (speedFactor * preset.speedRadiusFactor * 30)

    // Look-ahead targeting
    const horizontalSpeed = Math.sqrt(velocity.x ** 2 + velocity.z ** 2)
    const lookAheadDist = horizontalSpeed * preset.lookAheadTime

    let velocityDir = { x: 0, z: 0 }
    if (horizontalSpeed > 0.1) {
      velocityDir = {
        x: velocity.x / horizontalSpeed,
        z: velocity.z / horizontalSpeed
      }
    }

    const lookAheadPos = new Vector3(
      ballPos.x + velocityDir.x * lookAheadDist,
      ballPos.y,
      ballPos.z + velocityDir.z * lookAheadDist
    )

    // Blend between ball position and look-ahead
    const lookAheadBlend = Math.min(speed / 10, 0.5)
    const targetPosition = new Vector3(
      ballPos.x + (lookAheadPos.x - ballPos.x) * lookAheadBlend,
      ballPos.y + (lookAheadPos.y - ballPos.y) * lookAheadBlend * 0.3,
      ballPos.z + (lookAheadPos.z - ballPos.z) * lookAheadBlend
    )

    // Update transition time for cinematic entry
    if (this.cameraTransitionTime < this.cameraTransitionDuration) {
      this.cameraTransitionTime += dt
    }

    // Apply smoothing with easing during transition
    const baseSmoothing = preset.trackingSmoothing * dt
    const transitionAlpha = Math.min(1, this.cameraTransitionTime / this.cameraTransitionDuration)
    const easeInFactor = CameraEasing.easeOutCubic(transitionAlpha)
    const smoothing = baseSmoothing * (0.5 + easeInFactor * 0.5) // Start at 50% smoothing, reach 100%

    this.followCamera.target = new Vector3(
      this.followCamera.target.x + (targetPosition.x - this.followCamera.target.x) * smoothing,
      this.followCamera.target.y + (targetPosition.y - this.followCamera.target.y) * smoothing,
      this.followCamera.target.z + (targetPosition.z - this.followCamera.target.z) * smoothing
    )

    // Eased radius transition with responsive tracking
    const radiusDelta = (targetRadius - this.followCamera.radius) * (preset.trackingSmoothing * 0.4 * dt)
    this.followCamera.radius = Scalar.Clamp(
      this.followCamera.radius + radiusDelta,
      preset.minRadius,
      Math.min(preset.maxRadius, preset.radius + preset.maxRadiusExtension)
    )

    // Smooth FOV transitions with easing
    const targetFOV = preset.fov + (speedFactor * preset.speedFOVFactor * 30)
    const fovDelta = (targetFOV - this.followCamera.fov) * (preset.trackingSmoothing * 0.3 * dt)
    this.followCamera.fov = Scalar.Clamp(
      this.followCamera.fov + fovDelta,
      preset.fov - 0.3,
      preset.fov + 0.3
    )

    this.followCamera.beta = Scalar.Clamp(this.followCamera.beta, preset.minBeta, preset.maxBeta)
    this.updateZoneCameraTransition(dt)
  }

  private updateZoneCameraTransition(dt: number): void {
    if (!this.followCamera || !this.zoneCameraTransition) return

    const transition = this.zoneCameraTransition
    transition.elapsed += dt
    const progress = Math.min(1, transition.elapsed / transition.duration)
    const eased = CameraEasing.easeOutCubic(progress)

    this.followCamera.alpha = Scalar.Lerp(transition.from.alpha, transition.to.alpha, eased)
    this.followCamera.beta = Scalar.Lerp(transition.from.beta, transition.to.beta, eased)
    this.followCamera.radius = Scalar.Lerp(transition.from.radius, transition.to.radius, eased)
    this.followCamera.fov = Scalar.Lerp(transition.from.fov, transition.to.fov, eased)

    if (progress >= 1) {
      this.zoneCameraTransition = null
    }
  }

  protected applyCameraPresetTransition(preset: CameraPreset, duration = 0.7): void {
    if (!this.followCamera) return

    const shouldCutInstantly =
      this.accessibility.reducedMotion || this.accessibility.maxCameraShakeIntensity <= 0

    this.followCamera.lowerRadiusLimit = preset.minRadius
    this.followCamera.upperRadiusLimit = preset.maxRadius
    this.followCamera.lowerBetaLimit = preset.minBeta
    this.followCamera.upperBetaLimit = preset.maxBeta

    if (shouldCutInstantly) {
      this.zoneCameraTransition = null
      this.followCamera.alpha = preset.alpha
      this.followCamera.beta = preset.beta
      this.followCamera.radius = preset.radius
      this.followCamera.fov = preset.fov
      return
    }

    this.zoneCameraTransition = {
      elapsed: 0,
      duration,
      from: {
        alpha: this.followCamera.alpha,
        beta: this.followCamera.beta,
        radius: this.followCamera.radius,
        fov: this.followCamera.fov,
      },
      to: {
        alpha: preset.alpha,
        beta: preset.beta,
        radius: preset.radius,
        fov: preset.fov,
      },
    }
  }
}
