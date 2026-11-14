/**
 * Game Input Actions — Flipper, plunger, and nudge input handlers.
 */

import type { PhysicsBody, PhysicsRevoluteJoint } from '../core/physics-api'
import type { PhysicsSystem } from '../game-elements/physics'
import type { GameObjects } from '../objects'
import type { HapticManager } from '../game-elements/haptics'
import type { BallManager } from '../game-elements/ball-manager'
import type { SoundSystem } from '../audio/sound-system'
import type { EffectsSystem } from '../effects'
import type { GameStateManager } from './game-state'
import { GameConfig, PhysicsConfig } from '../config'
import { applyPlungerChargeCurve, getPhysicsTuningValue } from '../game-elements/physics-tuning'
import type { AccessibilityConfig } from '../game-elements'
import { INTENSITY } from '../game-elements/visual-palette'
import { simClockMs } from '../core/sim-clock'
import type { Color3 } from '@babylonjs/core/Maths/math.color'

/** The one property these effects touch; Babylon types `Mesh.material` as the base Material. */
export type EmissiveMaterial = { emissiveColor?: Color3 }

export interface InputActionsHost {
  readonly physics: Pick<PhysicsSystem, 'isWasmOwnerMode'>
  /** The flipper joints and the plunger: `GameObjects`, or the headless replay table (#528). */
  readonly gameObjects: (Pick<GameObjects, 'getFlipperJoints' | 'getPlungerBody' | 'getPlungerRestZ'> & {
    getAllFlippers(): ReadonlyMap<string, { body: PhysicsBody }>
  }) | null
  readonly hapticManager: HapticManager | null
  readonly soundSystem: Pick<SoundSystem, 'playSample'>
  readonly effects: EffectsSystem | null
  readonly stateManager: GameStateManager
  readonly accessibility: AccessibilityConfig

  /** Only `getBallBody` is used here — the plunger launches the main ball. */
  readonly ballManager: Pick<BallManager, 'getBallBody'> | null

  plungerChargeLevel: number
  tiltActive: boolean
}

export class GameInputActions {
  private readonly host: InputActionsHost
  private flipperLeftHoldTime = 0
  private flipperRightHoldTime = 0
  private lastFrameTime = 0
  /** Impulse magnitude of the most recent launch (0 before any) — for determinism tests. */
  lastLaunchImpulse = 0
  private scene: import('@babylonjs/core/scene').Scene | null = null
  /**
   * Writes the shooter rod's charge glow (`level` = emissive intensity). The game passes it with the
   * scene; the headless replay runner (#528) has neither, and this file imports no Babylon.
   */
  private rodGlow: ((mat: EmissiveMaterial, level: number) => void) | null = null

  // ── Plunger spatial constants ──────────────────────────────────────────────
  /** X position of both the kinematic plunger body and its visual meshes. */
  private static readonly PLUNGER_X = 10.5
  /** Y position of the kinematic plunger body. */
  private static readonly PLUNGER_Y = 0.5
  /** Rest Z position of the shooterRod mesh (world space). */
  private static readonly ROD_BASE_Z = -10
  /** Rest Z position of the plungerKnob mesh (world space). */
  private static readonly KNOB_BASE_Z = -13

  /** State machine driving the per-frame plunger spring animation. */
  private readonly plungerLaunchState = {
    phase: 'idle' as 'idle' | 'launching' | 'returning',
    progress: 0,
    /** Kinematic body Z at the moment of launch (pulled-back position). */
    startZ: 0,
    /** Kinematic body Z at max forward overshoot (strike position). */
    strikeZ: 0,
  }

  constructor(host: InputActionsHost) {
    this.host = host
    this.lastFrameTime = simClockMs()
  }

  /** Provide the BabylonJS scene (and the rod glow writer) so per-frame visual updates can find meshes. */
  setScene(
    scene: import('@babylonjs/core/scene').Scene | null,
    rodGlow: ((mat: EmissiveMaterial, level: number) => void) | null = null,
  ): void {
    this.scene = scene
    this.rodGlow = rodGlow
  }

  handleFlipperLeft(pressed: boolean): void {
    const { stateManager, gameObjects, hapticManager, soundSystem, effects, tiltActive } = this.host
    if (!stateManager.isPlaying()) return
    if (tiltActive && pressed) {
      effects?.playBeep(220)
      hapticManager?.tiltWarning()
      return
    }

    // Hold time ramps motor stiffness (Rapier path): gameplay clock, not wall time.
    const now = simClockMs()
    const dt = Math.max(0, now - this.lastFrameTime) / 1000
    this.lastFrameTime = now

    if (pressed) {
      this.flipperLeftHoldTime += dt
    } else {
      this.flipperLeftHoldTime = 0
    }

    const joint = gameObjects?.getFlipperJoints().left
    if (this.host.physics.isWasmOwnerMode()) {
      if (pressed) {
        hapticManager?.flipper()
        soundSystem.playSample('flipper')
      }
    } else if (joint) {
      const holdFactor = Math.min(this.flipperLeftHoldTime / 0.3, 1.0)
      const stiffnessMultiplier = pressed ? (1.0 + holdFactor * 0.3) : 0.8
      const dampingMultiplier = pressed ? (0.9 + holdFactor * 0.1) : 1.1

      const stiffness = getPhysicsTuningValue('flipperStiffness') * stiffnessMultiplier
      const damping = getPhysicsTuningValue('flipperDamping') * dampingMultiplier
      const angle = pressed ? -PhysicsConfig.flipper.activeAngleRad : PhysicsConfig.flipper.restAngleRad
      ;(joint as PhysicsRevoluteJoint).configureMotorPosition(angle, stiffness, damping)
      // Ensure the body is awake so the motor takes effect this step and visual sync sees the pose
      const fl = gameObjects?.getAllFlippers?.().get('left')
      fl?.body?.wakeUp()

      if (pressed) {
        hapticManager?.flipper()
        soundSystem.playSample('flipper')
      }
    }
  }

  handleFlipperRight(pressed: boolean): void {
    const { stateManager, gameObjects, hapticManager, soundSystem, effects, tiltActive } = this.host
    if (!stateManager.isPlaying()) return
    if (tiltActive && pressed) {
      effects?.playBeep(220)
      hapticManager?.tiltWarning()
      return
    }

    // Hold time ramps motor stiffness (Rapier path): gameplay clock, not wall time.
    const now = simClockMs()
    const dt = Math.max(0, now - this.lastFrameTime) / 1000
    this.lastFrameTime = now

    if (pressed) {
      this.flipperRightHoldTime += dt
    } else {
      this.flipperRightHoldTime = 0
    }

    const joint = gameObjects?.getFlipperJoints().right
    if (this.host.physics.isWasmOwnerMode()) {
      if (pressed) {
        hapticManager?.flipper()
        soundSystem.playSample('flipper')
      }
    } else if (joint) {
      const holdFactor = Math.min(this.flipperRightHoldTime / 0.3, 1.0)
      const stiffnessMultiplier = pressed ? (1.0 + holdFactor * 0.3) : 0.8
      const dampingMultiplier = pressed ? (0.9 + holdFactor * 0.1) : 1.1

      const stiffness = getPhysicsTuningValue('flipperStiffness') * stiffnessMultiplier
      const damping = getPhysicsTuningValue('flipperDamping') * dampingMultiplier
      const angle = pressed ? PhysicsConfig.flipper.activeAngleRad : -PhysicsConfig.flipper.restAngleRad
      ;(joint as PhysicsRevoluteJoint).configureMotorPosition(angle, stiffness, damping)
      // Ensure the body is awake so the motor takes effect this step and visual sync sees the pose
      const fr = gameObjects?.getAllFlippers?.().get('right')
      fr?.body?.wakeUp()

      if (pressed) {
        hapticManager?.flipper()
        soundSystem.playSample('flipper')
      }
    }
  }

  /**
   * Fire the plunger at `charge` (0–1). The game loop always passes the charge
   * carried by the input frame — live or taped — so replay never reads the
   * spectator's own `plungerChargeLevel` (#441). The host value is the
   * fallback for direct callers only (debug hooks, tests).
   */
  handlePlunger(charge?: number | null): boolean {
    const ballBody = this.host.ballManager?.getBallBody()
    if (!ballBody) return false

    const pos = ballBody.translation()
    if (pos.x > 8 && pos.z < -4) {
      const chargeRatio = applyPlungerChargeCurve(charge ?? this.host.plungerChargeLevel)
      const minImpulse = getPhysicsTuningValue('plungerMinImpulse')
      const maxImpulse = getPhysicsTuningValue('plungerMaxImpulse')
      const impulseMagnitude = minImpulse + (maxImpulse - minImpulse) * chargeRatio

      // Start the per-frame kinematic spring-forward animation
      const gameObjects = this.host.gameObjects
      const restZ = gameObjects?.getPlungerRestZ() ?? -9.8
      const pullback = chargeRatio * GameConfig.plunger.maxPullbackDistance
      const overshoot = GameConfig.plunger.launchForwardDistance * Math.max(0.25, chargeRatio)
      this.plungerLaunchState.phase = 'launching'
      this.plungerLaunchState.progress = 0
      this.plungerLaunchState.startZ = restZ - pullback
      this.plungerLaunchState.strikeZ = restZ + overshoot

      // Direct impulse for reliable launch (primary mechanism)
      ballBody.applyImpulse({ x: 0, y: 0, z: impulseMagnitude }, true)
      this.lastLaunchImpulse = impulseMagnitude

      const hapticIntensity = 30 + Math.floor(chargeRatio * 40)
      this.host.hapticManager?.trigger([hapticIntensity, 10, Math.floor(hapticIntensity / 2)])

      if (!this.host.accessibility.reducedMotion && this.host.effects) {
        const shakeIntensity = 0.02 + chargeRatio * 0.04
        this.host.effects.addCameraShake(shakeIntensity)
      }

      this.host.soundSystem.playSample('launch')
      this.host.plungerChargeLevel = 0
      return true
    }
    return false
  }

  startPlungerCharge(): void {
    // Cancel any in-progress launch animation so charge pull-back can take over immediately
    this.plungerLaunchState.phase = 'idle'
    this.plungerLaunchState.progress = 0
    this.host.plungerChargeLevel = 0
    this.host.hapticManager?.trigger([20, 5])
  }

  updatePlungerCharge(chargeLevel: number): void {
    this.host.plungerChargeLevel = chargeLevel
    if (chargeLevel > 0.25 && chargeLevel < 0.3) {
      this.host.hapticManager?.trigger([15])
    } else if (chargeLevel > 0.5 && chargeLevel < 0.55) {
      this.host.hapticManager?.trigger([25])
    } else if (chargeLevel > 0.75 && chargeLevel < 0.8) {
      this.host.hapticManager?.trigger([35])
    } else if (chargeLevel >= 1.0 && Math.floor(performance.now() / 100) % 10 === 0) {
      this.host.hapticManager?.trigger([40, 5])
    }
  }

  releasePlungerCharge(chargeLevel: number): void {
    this.host.plungerChargeLevel = chargeLevel
  }

  updatePlungerVisual(scene: import('@babylonjs/core/scene').Scene | null, chargeLevel: number): void {
    if (!scene) return

    // Skip visual update while the launch animation is playing (state machine owns positions)
    if (this.plungerLaunchState.phase !== 'idle') return

    const shooterRod = scene.getMeshByName('shooterRod')
    const plungerKnob = scene.getMeshByName('plungerKnob')
    if (shooterRod && plungerKnob) {
      const maxPullback = GameConfig.plunger.maxPullbackDistance
      const pullback = chargeLevel * maxPullback
      shooterRod.position.z = GameInputActions.ROD_BASE_Z - pullback
      plungerKnob.position.z = GameInputActions.KNOB_BASE_Z - pullback

      // Emissive glow on the rod gives visual charge-level feedback (cyan → bright at full charge)
      const mat = shooterRod.material as EmissiveMaterial | null
      if (mat && mat.emissiveColor) {
        this.rodGlow?.(mat, chargeLevel * INTENSITY.ACTIVE)
      }
    }

    // Sync kinematic plunger body position during charge
    const gameObjects = this.host.gameObjects
    const plungerBody = gameObjects?.getPlungerBody?.()
    if (plungerBody) {
      const restZ = gameObjects!.getPlungerRestZ()
      const maxPullback = GameConfig.plunger.maxPullbackDistance
      const pullback = chargeLevel * maxPullback
      plungerBody.setNextKinematicTranslation(
        { x: GameInputActions.PLUNGER_X, y: GameInputActions.PLUNGER_Y, z: restZ - pullback }
      )
    }
  }

  /**
   * Per-frame plunger spring animation driver.  Must be called once per physics step while
   * the game is playing.  Smoothly advances the kinematic plunger body and its visual meshes
   * through the "launch → overshoot → return-to-rest" motion so the release never teleports.
   *
   * @param dt - elapsed time in seconds since last step (clamped by callers to ≤ 1/30 s)
   */
  updatePlungerFrame(dt: number): void {
    const { phase } = this.plungerLaunchState
    if (phase === 'idle') return

    const scene = this.scene
    const shooterRod = scene?.getMeshByName('shooterRod')
    const plungerKnob = scene?.getMeshByName('plungerKnob')

    const gameObjects = this.host.gameObjects
    const plungerBody = gameObjects?.getPlungerBody?.()
    const restZ = gameObjects?.getPlungerRestZ() ?? -9.8

    const setPositions = (bodyZ: number): void => {
      const visualOffset = bodyZ - restZ
      if (shooterRod) shooterRod.position.z = GameInputActions.ROD_BASE_Z + visualOffset
      if (plungerKnob) plungerKnob.position.z = GameInputActions.KNOB_BASE_Z + visualOffset
      if (plungerBody) {
        plungerBody.setNextKinematicTranslation(
          { x: GameInputActions.PLUNGER_X, y: GameInputActions.PLUNGER_Y, z: bodyZ }
        )
      }
    }

    if (phase === 'launching') {
      const newProgress = Math.min(
        this.plungerLaunchState.progress + dt / GameConfig.plunger.launchAnimDuration,
        1
      )
      this.plungerLaunchState.progress = newProgress

      // Ease-out: fast snap then slow finish (spring forward feel)
      const t = 1 - Math.pow(1 - newProgress, 2)
      const { startZ, strikeZ } = this.plungerLaunchState
      setPositions(startZ + (strikeZ - startZ) * t)

      if (newProgress >= 1) {
        this.plungerLaunchState.phase = 'returning'
        this.plungerLaunchState.progress = 0
      }

    } else if (phase === 'returning') {
      const newProgress = Math.min(
        this.plungerLaunchState.progress + dt / GameConfig.plunger.returnAnimDuration,
        1
      )
      this.plungerLaunchState.progress = newProgress

      // Ease-in: slow start, fast finish (spring returning)
      const t = newProgress * newProgress
      const { strikeZ } = this.plungerLaunchState
      setPositions(strikeZ + (restZ - strikeZ) * t)

      if (newProgress >= 1) {
        this.plungerLaunchState.phase = 'idle'
        // Snap to exact rest and clear emissive glow
        setPositions(restZ)
        const mat = shooterRod?.material as EmissiveMaterial | null
        if (mat && mat.emissiveColor) {
          this.rodGlow?.(mat, 0)
        }
      }
    }
  }

  /**
   * Reset the plunger charge/animation state to an exact launch-ready rest position.
   */
  resetPlungerState(): void {
    this.plungerLaunchState.phase = 'idle'
    this.plungerLaunchState.progress = 0
    this.plungerLaunchState.startZ = 0
    this.plungerLaunchState.strikeZ = 0
    this.host.plungerChargeLevel = 0

    const scene = this.scene
    const shooterRod = scene?.getMeshByName('shooterRod')
    const plungerKnob = scene?.getMeshByName('plungerKnob')
    const gameObjects = this.host.gameObjects
    const plungerBody = gameObjects?.getPlungerBody?.()
    const restZ = gameObjects?.getPlungerRestZ() ?? -9.8

    if (shooterRod) shooterRod.position.z = GameInputActions.ROD_BASE_Z
    if (plungerKnob) plungerKnob.position.z = GameInputActions.KNOB_BASE_Z
    if (plungerBody) {
      plungerBody.setNextKinematicTranslation(
        { x: GameInputActions.PLUNGER_X, y: GameInputActions.PLUNGER_Y, z: restZ }
      )
    }
    const mat = shooterRod?.material as EmissiveMaterial | null
    if (mat && mat.emissiveColor) {
      this.rodGlow?.(mat, 0)
    }
  }

  /**
   * Reset the plunger to a launch-ready rest position.
   */
  resetPlungerVisual(scene: import('@babylonjs/core/scene').Scene | null): void {
    if (scene) {
      this.scene = scene
    }
    this.resetPlungerState()
  }
}
