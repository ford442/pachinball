import { ArcRotateCamera, Vector3, Scalar } from '@babylonjs/core'

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
  private tableCam: ArcRotateCamera
  private currentTarget = new Vector3(0, 0, 2)
  private currentMode = CameraMode.IDLE
  private softFollowConfig: SoftFollowConfig
  private lastBallPos: Vector3 | null = null
  private velocityEstimate = new Vector3(0, 0, 0)

  constructor(
    tableCam: ArcRotateCamera,
    softFollowConfig: Partial<SoftFollowConfig> = {}
  ) {
    this.tableCam = tableCam
    this.softFollowConfig = { ...DEFAULT_SOFT_FOLLOW, ...softFollowConfig }
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
  update(dt: number, ballPos: Vector3, ballVel: Vector3, mode: CameraMode): void {
    this.currentMode = mode

    // Estimate velocity for smoother prediction when physics jitters
    this.updateVelocityEstimate(ballPos, dt)

    // Calculate target based on mode and ball position
    const target = this.calculateDynamicTarget(ballPos, ballVel, mode)

    // Smooth interpolation (safety first - keep it slow)
    // Clamp dt to prevent large jumps on frame drops
    const clampedDt = Math.min(dt, 1 / 30)
    const t = 2.0 * clampedDt  // Conservative lerp speed
    this.currentTarget = Vector3.Lerp(this.currentTarget, target, t)

    // Safety clamp: ensure target stays within reasonable bounds
    this.currentTarget.x = Scalar.Clamp(this.currentTarget.x, -8, 8)
    this.currentTarget.y = 0  // Keep y at table level
    this.currentTarget.z = Scalar.Clamp(this.currentTarget.z, -15, 10)

    this.tableCam.target = this.currentTarget.clone()

    this.lastBallPos = ballPos.clone()
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
    const baseTarget = this.getZoneTarget(ballPos)

    // Apply mode-specific framing adjustments
    const modeTarget = this.getModeTarget(mode, ballPos)

    // Blend zone target with mode target
    let target = Vector3.Lerp(baseTarget, modeTarget, 0.5)

    // Apply soft follow with dead zone
    target = this.applySoftFollow(target, ballPos, ballVel)

    return target
  }

  /**
   * Get base target based on which zone the ball is in
   */
  private getZoneTarget(ballPos: Vector3): Vector3 {
    // Default center target
    let target = new Vector3(0, 0, 2)
    let totalWeight = 0

    // Calculate weighted target based on ball proximity to zones
    const zones = [
      { zone: FRAMING_ZONES.UPPER_ZONE, zThreshold: -8 },
      { zone: FRAMING_ZONES.PLAYFIELD_ZONE, zThreshold: 2 },
      { zone: FRAMING_ZONES.FLIPPER_ZONE, zThreshold: 8 },
    ]

    for (const { zone, zThreshold } of zones) {
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
        target = Vector3.Lerp(target, FRAMING_ZONES.LEFT_FLIPPER.target, 0.3)
      } else if (ballPos.x > 2) {
        // Ball near right flipper
        target = Vector3.Lerp(target, FRAMING_ZONES.RIGHT_FLIPPER.target, 0.3)
      }
    }

    return target
  }

  /**
   * Get target adjustment for specific camera mode
   */
  private getModeTarget(mode: CameraMode, ballPos: Vector3): Vector3 {
    switch (mode) {
      case CameraMode.IDLE:
        // Default framing, slight emphasis on center
        return new Vector3(0, 0, 0)

      case CameraMode.FLIPPER_READY:
        // Emphasize flipper area when waiting for launch
        return new Vector3(ballPos.x * 0.3, 0, 5)

      case CameraMode.MULTIBALL:
        // Center view for wider playfield coverage during multiball
        return new Vector3(0, 0, -2)

      case CameraMode.UPPER_PLAY:
        // Focus on upper playfield
        return new Vector3(ballPos.x * 0.2, 0, -10)

      case CameraMode.JACKPOT:
        // Focus on jackpot area (typically center upper)
        return new Vector3(0, 0, -8)

      case CameraMode.ADVENTURE:
        // Follow ball more closely in adventure mode
        return new Vector3(ballPos.x * 0.5, 0, ballPos.z * 0.3)

      default:
        return new Vector3(0, 0, 2)
    }
  }

  /**
   * Apply soft follow with dead zone
   */
  private applySoftFollow(
    baseTarget: Vector3,
    ballPos: Vector3,
    ballVel: Vector3
  ): Vector3 {
    // ballVel is available for direct use; we currently use smoothed velocityEstimate
    void ballVel
    const config = this.softFollowConfig
    const target = baseTarget.clone()

    // Calculate offset from target to ball (ignoring y for 2D dead zone)
    const offset = new Vector3(
      ballPos.x - target.x,
      0,
      ballPos.z - target.z
    )
    const distance = offset.length()

    // Only follow if ball is outside dead zone
    if (distance > config.deadZoneRadius) {
      // Use estimated velocity for smoother prediction
      const predictedPos = ballPos.add(
        this.velocityEstimate.scale(config.velocityPrediction)
      )
      const predictedOffset = new Vector3(
        predictedPos.x - target.x,
        0,
        predictedPos.z - target.z
      )

      // Calculate how much to follow (0 to 1 based on distance beyond dead zone)
      const excessDistance = distance - config.deadZoneRadius
      const followIntensity = Math.min(1, excessDistance / config.deadZoneRadius)

      // Calculate follow offset with max offset clamping
      let followOffset = predictedOffset.scale(config.followSpeed * followIntensity)

      // Clamp to max offset
      if (followOffset.length() > config.maxOffset) {
        followOffset = followOffset.normalize().scale(config.maxOffset)
      }

      target.addInPlace(followOffset)
    }

    return target
  }

  /**
   * Update velocity estimate with smoothing to reduce physics jitter
   */
  private updateVelocityEstimate(ballPos: Vector3, dt: number): void {
    if (this.lastBallPos && dt > 0) {
      const instantVel = ballPos.subtract(this.lastBallPos).scale(1 / dt)
      // Smooth velocity estimate
      this.velocityEstimate = Vector3.Lerp(
        this.velocityEstimate,
        instantVel,
        0.1  // Low pass filter factor
      )
    }
  }

  /**
   * Reset camera target to default position
   */
  reset(): void {
    this.currentTarget = new Vector3(0, 0, 2)
    this.currentMode = CameraMode.IDLE
    this.velocityEstimate = new Vector3(0, 0, 0)
    this.lastBallPos = null
  }
}
