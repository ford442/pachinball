import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { simClockLiveSteps } from '../core/sim-clock'
import { PALETTE } from '../game-elements/visual-language'
import {
  JackpotPhaseClock,
  type JackpotClockHandlers,
  type JackpotPhaseLogEntry,
} from './jackpot-phase-clock'

type LightingMode = 'normal' | 'hit' | 'fever' | 'reach'

interface JackpotSequenceCallbacks {
  emitJackpotPhase: (phase: number) => void
  spawnJackpotBurst: (position: Vector3) => void
  playBeep: (freq: number) => void
  setLightingMode: (mode: LightingMode) => void
  flashVignette: (colorHex: string, durationMs: number) => void
  addCameraShake: (intensity: number) => void
  isReducedMotion: () => boolean
  setBloomEnergy: (value: number) => void
  /** Cosmetic randomness only (burst positions); never gameplay. */
  random?: () => number
  /** The sim step a sequence starts on; the installed `GameSimClock`'s live count by default. */
  currentStep?: () => number
}

/**
 * The Cyber-Shock jackpot sequence (docs/PLAN.md §8): Breach 0–2 s, Critical
 * 2–5 s, Meltdown 5–10 s. The phase is a pure function of the sim steps since
 * it started (`JackpotPhaseClock`); this class turns the clock's transitions
 * into the `jackpot:phase` event, the burst particles and the countdown beeps.
 * Audio stays on the one `AudioEngine` (`playBeep`, and the `jackpot:phase`
 * listener in `sound-event-bindings.ts`); score and bumper awards stay in
 * `scoring-bridge.ts`.
 */
export class JackpotSequenceController {
  private readonly clock = new JackpotPhaseClock()

  private isSolidGoldPulseActive = false
  private solidGoldPulseTimer = 0
  private readonly SOLID_GOLD_PULSE_DURATION = 1.5

  private readonly random: () => number
  private readonly currentStep: () => number

  constructor(private readonly callbacks: JackpotSequenceCallbacks) {
    this.random = callbacks.random ?? Math.random
    this.currentStep = callbacks.currentStep ?? simClockLiveSteps
  }

  get isJackpotActive(): boolean {
    return this.clock.active
  }

  /** 0=Idle, 1=Breach, 2=Critical, 3=Meltdown */
  get jackpotPhase(): number {
    return this.clock.phase
  }

  /** Sim seconds since the sequence started; 0 when idle. */
  get jackpotTimer(): number {
    return this.clock.elapsedSeconds(this.currentStep())
  }

  /** Every phase change as `{ step, phase }`, for tape replay checks. */
  get phaseLog(): readonly JackpotPhaseLogEntry[] {
    return this.clock.log
  }

  get pulseActive(): boolean {
    return this.isSolidGoldPulseActive
  }

  get pulseTimer(): number {
    return this.solidGoldPulseTimer
  }

  startJackpotSequence(): void {
    this.clock.start(this.currentStep(), this.handlers)
  }

  /**
   * Advance the sequence to sim step `step` — once per fixed physics tick, so
   * each phase change lands on its own step. Returns true when the sequence
   * ended during this call.
   */
  advanceToStep(step: number): boolean {
    const wasActive = this.clock.active
    this.clock.advanceTo(step, this.handlers)
    return wasActive && !this.clock.active
  }

  /**
   * Per render frame: the extra meltdown bursts. Cosmetic and display-rate
   * dependent by design — it never changes the sequence's state.
   */
  updateJackpotSequence(_dt: number): void {
    if (this.clock.phase === 3 && this.random() < 0.08) {
      this.callbacks.spawnJackpotBurst(
        new Vector3((this.random() - 0.5) * 8, 3 + this.random() * 5, 2 + this.random() * 6)
      )
    }
  }

  private readonly handlers: JackpotClockHandlers = {
    onPhase: (phase) => {
      if (phase === 0) {
        this.callbacks.setLightingMode('normal')
        return
      }
      this.callbacks.emitJackpotPhase(phase)
      if (phase === 3) {
        // Gold particle bursts
        this.callbacks.spawnJackpotBurst(new Vector3(0, 5, 6))
        this.callbacks.spawnJackpotBurst(new Vector3(-2, 4, 3))
        this.callbacks.spawnJackpotBurst(new Vector3(3, 7, 1))
      }
    },
    // Digital "countdown" beeps (lightweight proxy)
    onCue: (cue) => this.callbacks.playBeep(cue.freq),
  }

  startSolidGoldPulse(): void {
    this.isSolidGoldPulseActive = true
    this.solidGoldPulseTimer = 0
    this.callbacks.setBloomEnergy(2.5)
    this.callbacks.playBeep(1200)

    // Vignette flash (smooth, not strobe — safe for photosensitive users)
    this.callbacks.flashVignette(PALETTE.GOLD, 600)

    // Camera shake (respect reduced motion)
    if (!this.callbacks.isReducedMotion()) {
      this.callbacks.addCameraShake(0.04)
    }
  }

  updateSolidGoldPulse(dt: number): void {
    if (!this.isSolidGoldPulseActive) return

    this.solidGoldPulseTimer += dt
    this.callbacks.setBloomEnergy(Math.max(0, 2.5 * (1 - this.solidGoldPulseTimer / this.SOLID_GOLD_PULSE_DURATION)))

    if (this.solidGoldPulseTimer >= this.SOLID_GOLD_PULSE_DURATION) {
      this.isSolidGoldPulseActive = false
      this.solidGoldPulseTimer = 0
    }
  }
}
