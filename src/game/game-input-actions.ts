/**
 * Game Input Actions — Flipper, plunger, and nudge input handlers.
 */

import type * as RAPIER from '@dimforge/rapier3d-compat'
import type { PhysicsSystem } from '../game-elements/physics'
import type { GameObjects } from '../objects'
import type { HapticManager } from '../game-elements/haptics'
import type { SoundSystem } from '../game-elements/sound-system'
import type { EffectsSystem } from '../effects'
import type { GameStateManager } from './game-state'
import { GameConfig } from '../config'
import type { AccessibilityConfig } from '../game-elements'

const FlipperPhysics = {
  restAngleRad: Math.PI / 4,
  activeAngleRad: Math.PI / 6,
} as const

export interface InputActionsHost {
  readonly physics: PhysicsSystem
  readonly gameObjects: GameObjects | null
  readonly hapticManager: HapticManager | null
  readonly soundSystem: SoundSystem
  readonly effects: EffectsSystem | null
  readonly stateManager: GameStateManager
  readonly accessibility: AccessibilityConfig

  plungerChargeLevel: number
  tiltActive: boolean
}

export class GameInputActions {
  private readonly host: InputActionsHost

  constructor(host: InputActionsHost) {
    this.host = host
  }

  handleFlipperLeft(pressed: boolean): void {
    const { stateManager, gameObjects, hapticManager, soundSystem, effects, tiltActive } = this.host
    if (!stateManager.isPlaying()) return
    if (tiltActive && pressed) {
      effects?.playBeep(220)
      hapticManager?.tiltWarning()
      return
    }
    const joint = gameObjects?.getFlipperJoints().left
    if (joint) {
      const stiffness = GameConfig.table.flipperStrength
      const damping = GameConfig.flipper.damping
      const angle = pressed ? -FlipperPhysics.activeAngleRad : FlipperPhysics.restAngleRad
      ;(joint as RAPIER.RevoluteImpulseJoint).configureMotorPosition(angle, stiffness, damping)
    }
    if (pressed) {
      hapticManager?.flipper()
      soundSystem.playSample('flipper')
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
    const joint = gameObjects?.getFlipperJoints().right
    if (joint) {
      const stiffness = GameConfig.table.flipperStrength
      const damping = GameConfig.flipper.damping
      const angle = pressed ? FlipperPhysics.activeAngleRad : -FlipperPhysics.restAngleRad
      ;(joint as RAPIER.RevoluteImpulseJoint).configureMotorPosition(angle, stiffness, damping)
    }
    if (pressed) {
      hapticManager?.flipper()
      soundSystem.playSample('flipper')
    }
  }

  handlePlunger(): void {
    const rapier = this.host.physics.getRapier()
    const ballBody = (this.host as any).ballManager?.getBallBody?.()
    if (!ballBody || !rapier) return

    const pos = ballBody.translation()
    if (pos.x > 8 && pos.z < -4) {
      const chargeRatio = this.host.plungerChargeLevel
      const impulseMagnitude = GameConfig.plunger.minImpulse +
        (GameConfig.plunger.maxImpulse - GameConfig.plunger.minImpulse) * chargeRatio

      ballBody.applyImpulse(new rapier.Vector3(0, 0, impulseMagnitude), true)

      const hapticIntensity = 30 + Math.floor(chargeRatio * 40)
      this.host.hapticManager?.trigger([hapticIntensity, 10, Math.floor(hapticIntensity / 2)])

      if (!this.host.accessibility.reducedMotion && this.host.effects) {
        const shakeIntensity = 0.02 + chargeRatio * 0.04
        this.host.effects.addCameraShake(shakeIntensity)
      }

      this.host.soundSystem.playSample('launch')
      this.host.plungerChargeLevel = 0
    }
  }

  startPlungerCharge(): void {
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

  updatePlungerVisual(scene: import('@babylonjs/core').Scene | null, chargeLevel: number): void {
    if (!scene) return
    const shooterRod = scene.getMeshByName('shooterRod')
    const plungerKnob = scene.getMeshByName('plungerKnob')
    if (shooterRod && plungerKnob) {
      const maxPullback = GameConfig.plunger.maxPullbackDistance
      const pullback = chargeLevel * maxPullback
      const rodBaseZ = -10
      const knobBaseZ = -13
      shooterRod.position.z = rodBaseZ - pullback
      plungerKnob.position.z = knobBaseZ - pullback
    }
  }
}
