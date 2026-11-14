/**
 * Per-fixed-step gameplay: what runs once per physics tick, after the engine step.
 *
 * Feeders and their captures, caught balls, stuck detection, combo / tilt / power-up windows,
 * adventure obstacles, gates / traps / launchers and the jackpot phase clock. These ran per step on the
 * branch the golden tapes were recorded on; the render-frame `sim` phase never runs under the headless
 * verifier (`stepFixed` only), so anything that moves the ball or the score belongs here (#519 A1).
 * Split out of `physics-controller.ts`; `runTick` calls the three entry points in this order:
 * `tickJackpot`, `tickStepMechanisms`, `stepGameplay`.
 */

import type { PhysicsHost } from './types'
import type { NudgeTilt } from './nudge-tilt'
import type { ScoringBridge } from './scoring-bridge'
import type { PhysicsBody } from '../../core/physics-api'
import type { GameSimClock } from '../../core/sim-clock'
import { DisplayState } from '../../display/display-types'

/** Shared empty list for "no ball manager", so the fallback allocates nothing. Never mutated. */
const NO_BODIES: PhysicsBody[] = []
const NO_STUCK_BODIES: readonly PhysicsBody[] = []

/**
 * Leave the JACKPOT display state once the sequence is over. The display
 * state gates hologram catches and fever (`handleBumperCollision`), so this
 * is gameplay and runs on the step the sequence ends; the render-frame call
 * (`updateSim`) only catches a sequence that ended outside a tick.
 */
export function finishJackpotIfDone(host: PhysicsHost): void {
  const effects = host.effects
  if (!effects || effects.isJackpotActive || host.display?.getDisplayState() !== DisplayState.JACKPOT) return
  host.eventBus.emit('jackpot:end')
  host.eventBus.emit('display:set', DisplayState.IDLE)
  effects.setAtmosphereState('IDLE')
  // Restore bumpers to normal lighting after sequence
  host.gameObjects?.setBumperState('IDLE')
}

export class StepGameplay {
  private readonly onCaughtBallBeep = (): void => {
    this.host.effects?.playBeep(440)
  }

  constructor(
    private readonly host: PhysicsHost,
    private readonly simClock: GameSimClock,
    private readonly scoringBridge: ScoringBridge,
    private readonly nudgeTilt: NudgeTilt,
    /** A stuck ball was removed: the handle caches no longer match the world. */
    private readonly rebuildHandleCaches: () => void,
  ) {}

  /**
   * Gameplay that reads or moves the ball, once per fixed step after the engine step: feeders and
   * their captures, caught balls, stuck detection, combo / tilt / power-up windows, adventure
   * obstacles (#519 A1). These ran per step on the branch the golden tapes were recorded on; the
   * merge that brought in the frame scheduler (#488 §4) put them in the render-frame `sim` phase,
   * which the headless verifier (`stepFixed` only) never runs — so a MagSpin capture happened
   * live and never on verification, and any run with one was rejected.
   */
  stepGameplay(dt: number): void {
    const ballManager = this.host.ballManager
    const currentBallBodies = ballManager?.getBallBodies() ?? NO_BODIES
    this.host.adventureMode?.update(dt, currentBallBodies)

    this.host.gameObjects?.updateTargets(dt)

    this.host.magSpinFeeder?.update(dt, currentBallBodies)
    this.host.nanoLoomFeeder?.update(dt, currentBallBodies)
    this.host.prismCoreFeeder?.update(dt, currentBallBodies)
    this.host.gaussCannon?.update(dt, currentBallBodies)
    this.host.quantumTunnel?.update(dt, currentBallBodies)

    ballManager?.updateCaughtBalls(dt, this.onCaughtBallBeep)

    const stuckBalls = ballManager?.updateStuckDetection(dt) ?? NO_STUCK_BODIES
    for (const stuckBall of stuckBalls) {
      if (stuckBall === ballManager?.getBallBody()) {
        ballManager?.resetBall()
      } else {
        ballManager?.removeBall(stuckBall)
      }
    }
    if (stuckBalls.length > 0) {
      this.rebuildHandleCaches()
    }

    // Small gold ball lifetimes (cleanup expired)
    ballManager?.updateSmallGoldBallLifetimes(dt)

    this.scoringBridge.updateCombo(dt)
    this.nudgeTilt.tickTilt(dt)

    if (this.host.powerupActive) {
      this.host.powerupTimer -= dt
      if (this.host.powerupTimer <= 0) this.host.powerupActive = false
    }
  }

  /** Gates, traps, launchers and adventure clocks: once per physics tick, at that tick's dt. */
  tickStepMechanisms(dt: number): void {
    const { host } = this
    for (const state of host.trapStates) host.ballTrapBuilder?.updateTrap(state, dt)
    for (const state of host.launcherStates) host.launcherBuilder?.updateLauncher(state, dt)
    for (const state of host.gateStates) host.movingGateBuilder?.updateGate(state, dt)
    host.stepAdventureProgression?.(dt)
  }

  /**
   * Advance the jackpot phase clock by this tick. It runs here, once per fixed
   * step, so a phase change (and the end of the sequence) lands on its own sim
   * step on every client — not on whichever render frame happens to follow it.
   */
  tickJackpot(): void {
    const effects = this.host.effects
    if (!effects) return
    if (effects.isJackpotActive) effects.advanceJackpotToStep(this.simClock.liveSteps())
    // Also catches a JACKPOT display state raised with no sequence behind it
    // (the solid-gold pulse): it ends on the tick that raised it.
    finishJackpotIfDone(this.host)
  }
}
