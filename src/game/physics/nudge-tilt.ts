/**
 * Nudge and tilt: the player's table shove, its cooldown, the tilt warnings and the tilt penalty.
 *
 * Every time here is on the gameplay sim clock (`GameSimClock`, #441), never wall time: a replay must
 * lock and release the flippers on the same step the live run did. Split out of
 * `physics-controller.ts`; the controller still exposes `applyNudge` / `triggerTilt` and calls
 * `tickTilt` once per fixed step.
 */

import type { PhysicsHost } from './types'
import type { GameSimClock } from '../../core/sim-clock'
import type { TimerScope } from '../../core/timers'
import { GAME_TUNING, GameConfig } from '../../config'
import { getPhysicsTuningValue } from '../../game-elements/physics-tuning'

export class NudgeTilt {
  constructor(
    private readonly host: PhysicsHost,
    private readonly simClock: GameSimClock,
    private readonly timers: TimerScope,
  ) {}

  applyNudge(direction: { x: number; y: number; z: number }): void {
    if (this.host.nudgeState.tiltActive) {
      this.host.hapticManager?.tiltWarning()
      return
    }
    const ballBody = this.host.ballManager?.getBallBody()
    if (!ballBody) return

    const now = this.simClock.liveMs()
    if (now - this.host.nudgeState.lastNudgeTime < GAME_TUNING.timing.nudgeCooldownMs) {
      this.host.nudgeState.tiltWarnings++
      if (this.host.nudgeState.tiltWarnings >= GameConfig.nudge.maxTiltWarnings) {
        this.triggerTilt()
        return
      }
    }
    this.host.nudgeState.lastNudgeTime = now

    const impulse = {
      x: direction.x * getPhysicsTuningValue('nudgeForce'),
      y: getPhysicsTuningValue('nudgeVerticalBoost'),
      z: direction.z * getPhysicsTuningValue('nudgeForce'),
    }
    ballBody.applyImpulse(impulse, true)

    const nudgeDirection = direction.x > 0 ? 'right' : direction.x < 0 ? 'left' : 'up'
    this.host.hapticManager?.nudge(nudgeDirection)

    if (!this.host.accessibility.reducedMotion) {
      this.host.effects?.addCameraShake(0.03)
    }
  }

  triggerTilt(): void {
    this.host.nudgeState.tiltActive = true
    this.host.nudgeState.tiltWarningActive = false
    // The penalty ends on the sim clock (`tickTilt`), never a timer: a replay
    // must lock and release the flippers on the same step the live run did.
    this.host.nudgeState.tiltPenaltyUntilMs = this.simClock.liveMs() + GameConfig.nudge.tiltPenaltyTime
    this.host.tiltActive = true
    this.host.effects?.setBloomEnergy(3.0)
    // Cosmetic only — the bloom pulse may stay on wall time.
    this.timers.setTimeout(() => this.host.effects?.setBloomEnergy(1.0), GAME_TUNING.timing.tiltBloomResetMs)
    this.host.effects?.playBeep(150)
    this.host.hapticManager?.tiltWarning()
  }

  /**
   * Per-frame tilt bookkeeping on the sim clock: release the tilt penalty once
   * it has run, and bleed off warnings (one per sim second) after
   * `tiltDecayTime` without a nudge.
   */
  tickTilt(simDt: number): void {
    const state = this.host.nudgeState
    const now = this.simClock.liveMs()
    if (state.tiltActive && now >= state.tiltPenaltyUntilMs) {
      state.tiltActive = false
      state.tiltWarnings = 0
      this.host.tiltActive = false
    }
    if (now - state.lastNudgeTime > GameConfig.nudge.tiltDecayTime && state.tiltWarnings > 0) {
      state.tiltWarnings = Math.max(0, state.tiltWarnings - simDt)
    }
  }
}
