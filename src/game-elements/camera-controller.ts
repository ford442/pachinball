import { TargetCamera } from '@babylonjs/core/Cameras/targetCamera'
import { Scalar } from '@babylonjs/core/Maths/math.scalar'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { QualityTier } from './visual-language'

/**
 * Camera modes for different gameplay situations
 */
export enum CameraMode {
  IDLE,
  FLIPPER_READY,
  MULTIBALL,
  UPPER_PLAY,
  JACKPOT,
  ADVENTURE,
  BALL_FOLLOW,
}

/**
 * Framing zone definition for rule-of-thirds camera targeting
 */
export interface FramingZone {
  target: Vector3
  weight: number
}

/**
 * Predefined framing zones for different gameplay areas
 * These targets are designed to create visually pleasing compositions
 * using rule-of-thirds principles adapted for vertical pinball playfield
 */
export const FRAMING_ZONES = {
  /** Focus on flipper area where most action occurs */
  FLIPPER_ZONE: { target: new Vector3(0, 0, 4), weight: 0.4 },
  /** Center of main playfield */
  PLAYFIELD_ZONE: { target: new Vector3(0, 0, -5), weight: 0.3 },
  /** Upper playfield with bumpers and targets */
  UPPER_ZONE: { target: new Vector3(0, 0, -12), weight: 0.2 },
  /** Left flipper emphasis for ball tracking */
  LEFT_FLIPPER: { target: new Vector3(-3, 0, 4), weight: 0.1 },
  /** Right flipper emphasis for ball tracking */
  RIGHT_FLIPPER: { target: new Vector3(3, 0, 4), weight: 0.1 },
}

/** Zones blended by getZoneTarget, with the ball z each one peaks at (hoisted: no per-frame array). */
const ZONE_INFLUENCES = [
  { zone: FRAMING_ZONES.UPPER_ZONE, zThreshold: -8 },
  { zone: FRAMING_ZONES.PLAYFIELD_ZONE, zThreshold: 2 },
  { zone: FRAMING_ZONES.FLIPPER_ZONE, zThreshold: 8 },
] as const

/**
 * Configuration for soft ball following with dead zone
 */
export interface SoftFollowConfig {
  /** Radius of dead zone where camera doesn't follow ball */
  deadZoneRadius: number
  /** Maximum camera offset from base target */
  maxOffset: number
  /** Speed of camera follow (lerp factor) */
  followSpeed: number
  /** Seconds to predict ahead for velocity-based framing */
  velocityPrediction: number
}

export interface CameraRuntimePolicy {
  reducedMotion: boolean
  photosensitiveMode: boolean
  qualityTier: QualityTier
}

/**
 * Default soft follow configuration
 * Conservative values for smooth, safe camera movement
 */
export const DEFAULT_SOFT_FOLLOW: SoftFollowConfig = {
  deadZoneRadius: 3.0,
  maxOffset: 4.0,
  followSpeed: 0.03,
  velocityPrediction: 0.1,
}

/**
 * CameraController implements rule-of-thirds-aware dynamic camera targeting
 * 
 * Features:
 * - Framing zones for different gameplay areas
 * - Soft ball tracking with configurable dead zone
 * - State-based target shifting (flipper emphasis, upper playfield, multiball)
 * - Smooth interpolation with safety limits
 * - Velocity prediction for leading the ball
 */
export class CameraController {
  private tableCam: TargetCamera
  private currentTarget = new Vector3(0, 0, 2)
  private currentMode = CameraMode.IDLE
  private softFollowConfig: SoftFollowConfig
  private readonly lastBallPos = new Vector3(0, 0, 0)
  private hasLastBallPos = false
  private readonly velocityEstimate = new Vector3(0, 0, 0)
  // Per-frame scratch (#505 §D): update() allocates no Vector3.
  private readonly zoneTarget = new Vector3(0, 0, 0)
  private readonly modeTarget = new Vector3(0, 0, 0)
  private readonly dynamicTarget = new Vector3(0, 0, 0)
  private readonly followOffset = new Vector3(0, 0, 0)
  private readonly instantVel = new Vector3(0, 0, 0)
  private readonly baseFov: number
  private dynamicFovBias = 0
  private speedTargetBiasZ = 0
  private impactTargetBias = new Vector3(0, 0, 0)
  private impactCooldownRemaining = 0
  private dynamicAllowed = true

  private static readonly SPEED_RESPONSE_THRESHOLD = 7
  private static readonly SPEED_RESPONSE_MAX = 28
  private static readonly MAX_DYNAMIC_FOV_BIAS = 0.14
  private static readonly MAX_SPEED_TARGET_BIAS_Z = 1.2
  private static readonly IMPACT_COOLDOWN_SECONDS = 0.22
  private static readonly MAX_IMPACT_TARGET_BIAS = 1.0
  private static readonly IMPACT_DECAY_PER_SECOND = 5.5

  constructor(
    tableCam: TargetCamera,
    softFollowConfig: Partial<SoftFollowConfig> = {}
  ) {
    this.tableCam = tableCam
    this.softFollowConfig = { ...DEFAULT_SOFT_FOLLOW, ...softFollowConfig }
    this.baseFov = tableCam.fov
    // Initialize current target to camera's initial target
    this.currentTarget = tableCam.target.clone()
  }

  /**
   * Main update called every frame
   * @param dt Delta time in seconds
   * @param ballPos Current ball position
   * @param ballVel Current ball velocity
   * @param mode Current camera mode
   */
  update(
    dt: number,
    ballPos: Vector3,
    ballVel: Vector3,
    mode: CameraMode,
    runtimePolicy?: CameraRuntimePolicy
  ): void {
    this.currentMode = mode

    this.updateRuntimePolicy(runtimePolicy, mode)

    // Estimate velocity for smoother prediction when physics jitters
    this.updateVelocityEstimate(ballPos, dt)

    // Calculate target based on mode and ball position
    const target = this.calculateDynamicTarget(ballPos, ballVel, mode)
    this.applyDynamicSpeedResponse(ballVel, dt)
    target.z -= this.speedTargetBiasZ
    target.addInPlace(this.impactTargetBias)

    // Smooth interpolation (safety first - keep it slow)
    // Clamp dt to prevent large jumps on frame drops
    const clampedDt = Math.min(dt, 1 / 30)
    const t = 2.0 * clampedDt  // Conservative lerp speed
    Vector3.LerpToRef(this.currentTarget, target, t, this.currentTarget)

    // Safety clamp: ensure target stays within reasonable bounds
    this.currentTarget.x = Scalar.Clamp(this.currentTarget.x, -8, 8)
    this.currentTarget.y = 0  // Keep y at table level
    this.currentTarget.z = Scalar.Clamp(this.currentTarget.z, -15, 10)

    // TargetCamera's setter derives the view from the vector without keeping it.
    this.tableCam.target = this.currentTarget
    this.tableCam.fov = this.baseFov + this.dynamicFovBias

    this.lastBallPos.copyFrom(ballPos)
    this.hasLastBallPos = true
  }

  notifyImpact(impactPos: Vector3, intensity: number): void {
    if (!this.dynamicAllowed || this.impactCooldownRemaining > 0) return

    const strength = Scalar.Clamp(intensity, 0, 1)
    if (strength <= 0.05) return

    const towardImpact = new Vector3(
      impactPos.x - this.currentTarget.x,
      0,
      impactPos.z - this.currentTarget.z
    )
    const length = towardImpact.length()
    if (length < 0.001) return

    const bias = towardImpact.scale((0.4 * strength) / length)
    this.impactTargetBias.addInPlace(bias)
    if (this.impactTargetBias.length() > CameraController.MAX_IMPACT_TARGET_BIAS) {
      this.impactTargetBias.normalize().scaleInPlace(CameraController.MAX_IMPACT_TARGET_BIAS)
    }

    this.impactCooldownRemaining = CameraController.IMPACT_COOLDOWN_SECONDS
  }

  /**
   * Set a new camera mode (triggers immediate target recalculation on next update)
   */
  setMode(mode: CameraMode): void {
    this.currentMode = mode
  }

  /**
   * Get current camera mode
   */
  getMode(): CameraMode {
    return this.currentMode
  }

  /**
   * Update soft follow configuration at runtime
   */
  setSoftFollowConfig(config: Partial<SoftFollowConfig>): void {
    this.softFollowConfig = { ...this.softFollowConfig, ...config }
  }

  /**
   * Get current camera target position
   */
  getCurrentTarget(): Vector3 {
    return this.currentTarget.clone()
  }

  /**
   * Calculate dynamic camera target based on ball position, velocity, and game mode
   */
  private calculateDynamicTarget(
    ballPos: Vector3,
    ballVel: Vector3,
    mode: CameraMode
  ): Vector3 {
    // Start with base target based on ball position zone
    const baseTarget = this.getZoneTarget(ballPos, this.zoneTarget)

    // Apply mode-specific framing adjustments
    const modeTarget = this.getModeTarget(mode, ballPos, this.modeTarget)

    // Blend zone target with mode target
    const target = Vector3.LerpToRef(baseTarget, modeTarget, 0.5, this.dynamicTarget)

    // Apply soft follow with dead zone
    this.applySoftFollow(target, ballPos, ballVel)

    return target
  }

  /**
   * Base target from which zone the ball is in, written into `out`.
   */
  private getZoneTarget(ballPos: Vector3, out: Vector3): Vector3 {
    // Default center target
    const target = out.set(0, 0, 2)
    let totalWeight = 0

    // Calculate weighted target based on ball proximity to zones
    for (const { zone, zThreshold } of ZONE_INFLUENCES) {
      // Calculate influence based on distance to threshold
      const distance = Math.abs(ballPos.z - zThreshold)
      const influence = Math.max(0, 1 - distance / 10)

      if (influence > 0) {
        target.x += zone.target.x * zone.weight * influence
        target.z += zone.target.z * zone.weight * influence
        totalWeight += zone.weight * influence
      }
    }

    // Normalize by total weight if we have any influence
    if (totalWeight > 0) {
      target.x /= totalWeight
      target.z /= totalWeight
    }

    // Add lateral bias when ball is near flippers
    if (ballPos.z > 2) {
      if (ballPos.x < -2) {
        // Ball near left flipper
        Vector3.LerpToRef(target, FRAMING_ZONES.LEFT_FLIPPER.target, 0.3, target)
      } else if (ballPos.x > 2) {
        // Ball near right flipper
        Vector3.LerpToRef(target, FRAMING_ZONES.RIGHT_FLIPPER.target, 0.3, target)
      }
    }

    return target
  }

  /**
   * Target adjustment for a camera mode, written into `out`.
   */
  private getModeTarget(mode: CameraMode, ballPos: Vector3, out: Vector3): Vector3 {
    switch (mode) {
      case CameraMode.IDLE:
        // Default framing, slight emphasis on center
        return out.set(0, 0, 0)

      case CameraMode.FLIPPER_READY:
        // Emphasize flipper area when waiting for launch
        return out.set(ballPos.x * 0.3, 0, 5)

      case CameraMode.MULTIBALL:
        // Center view for wider playfield coverage during multiball
        return out.set(0, 0, -2)

      case CameraMode.UPPER_PLAY:
        // Focus on upper playfield
        return out.set(ballPos.x * 0.2, 0, -10)

      case CameraMode.JACKPOT:
        // Focus on jackpot area (typically center upper)
        return out.set(0, 0, -8)

      case CameraMode.ADVENTURE:
        // Follow ball more closely in adventure mode
        return out.set(ballPos.x * 0.5, 0, ballPos.z * 0.3)

      case CameraMode.BALL_FOLLOW:
        // Chase cam: close ball follow with slight lead
        return out.set(ballPos.x * 0.7, 0, ballPos.z * 0.6)

      default:
        return out.set(0, 0, 2)
    }
  }

  /**
   * Apply soft follow with dead zone, in place on `target`.
   */
  private applySoftFollow(
    target: Vector3,
    ballPos: Vector3,
    ballVel: Vector3
  ): void {
    // ballVel is available for direct use; we currently use smoothed velocityEstimate
    void ballVel
    const config = this.softFollowConfig

    // Offset from target to ball (ignoring y for 2D dead zone)
    const offsetX = ballPos.x - target.x
    const offsetZ = ballPos.z - target.z
    const distance = Math.sqrt(offsetX * offsetX + offsetZ * offsetZ)

    // Only follow if ball is outside dead zone
    if (distance > config.deadZoneRadius) {
      // Use estimated velocity for smoother prediction
      const predictedX = ballPos.x + this.velocityEstimate.x * config.velocityPrediction
      const predictedZ = ballPos.z + this.velocityEstimate.z * config.velocityPrediction

      // Calculate how much to follow (0 to 1 based on distance beyond dead zone)
      const excessDistance = distance - config.deadZoneRadius
      const followIntensity = Math.min(1, excessDistance / config.deadZoneRadius)

      // Follow offset with max offset clamping
      const followOffset = this.followOffset.set(predictedX - target.x, 0, predictedZ - target.z)
      followOffset.scaleInPlace(config.followSpeed * followIntensity)

      // Clamp to max offset
      const followLength = followOffset.length()
      if (followLength > config.maxOffset) {
        followOffset.scaleInPlace(1 / followLength).scaleInPlace(config.maxOffset)
      }

      target.addInPlace(followOffset)
    }
  }

  /**
   * Update velocity estimate with smoothing to reduce physics jitter
   */
  private updateVelocityEstimate(ballPos: Vector3, dt: number): void {
    if (this.hasLastBallPos && dt > 0) {
      const instantVel = this.instantVel.set(
        ballPos.x - this.lastBallPos.x,
        ballPos.y - this.lastBallPos.y,
        ballPos.z - this.lastBallPos.z,
      ).scaleInPlace(1 / dt)
      // Smooth velocity estimate (low pass filter factor 0.1)
      Vector3.LerpToRef(this.velocityEstimate, instantVel, 0.1, this.velocityEstimate)
    }
  }

  /**
   * Reset camera target to default position
   */
  reset(): void {
    this.currentTarget.set(0, 0, 2)
    this.currentMode = CameraMode.IDLE
    this.velocityEstimate.set(0, 0, 0)
    this.hasLastBallPos = false
    this.resetDynamicState()
  }

  resetDynamicState(): void {
    this.dynamicFovBias = 0
    this.speedTargetBiasZ = 0
    this.impactTargetBias.set(0, 0, 0)
    this.impactCooldownRemaining = 0
    this.tableCam.fov = this.baseFov
  }

  private updateRuntimePolicy(runtimePolicy: CameraRuntimePolicy | undefined, mode: CameraMode): void {
    if (!runtimePolicy) {
      this.dynamicAllowed = mode !== CameraMode.ADVENTURE
      return
    }

    this.dynamicAllowed =
      mode !== CameraMode.ADVENTURE &&
      !runtimePolicy.reducedMotion &&
      !runtimePolicy.photosensitiveMode &&
      runtimePolicy.qualityTier !== QualityTier.LOW
  }

  private applyDynamicSpeedResponse(ballVel: Vector3, dt: number): void {
    const clampedDt = Math.min(dt, 1 / 20)
    this.impactCooldownRemaining = Math.max(0, this.impactCooldownRemaining - clampedDt)

    if (!this.dynamicAllowed) {
      this.resetDynamicState()
      return
    }

    const speed = ballVel.length()
    const normalized = Scalar.Clamp(
      (speed - CameraController.SPEED_RESPONSE_THRESHOLD) /
        (CameraController.SPEED_RESPONSE_MAX - CameraController.SPEED_RESPONSE_THRESHOLD),
      0,
      1
    )

    const targetFovBias = normalized * CameraController.MAX_DYNAMIC_FOV_BIAS
    const targetZBias = normalized * CameraController.MAX_SPEED_TARGET_BIAS_Z
    const response = Math.min(1, clampedDt * 3.2)
    this.dynamicFovBias = Scalar.Lerp(this.dynamicFovBias, targetFovBias, response)
    this.speedTargetBiasZ = Scalar.Lerp(this.speedTargetBiasZ, targetZBias, response)

    const impactDecay = Math.max(0, 1 - (CameraController.IMPACT_DECAY_PER_SECOND * clampedDt))
    this.impactTargetBias.scaleInPlace(impactDecay)
  }
}
