import { Vector3 } from '@babylonjs/core'
import { PALETTE } from '../game-elements/visual-language'

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
  random?: () => number
  scheduleTimeout?: (callback: () => void, delayMs: number) => unknown
}

export class JackpotSequenceController {
  jackpotTimer = 0
  isJackpotActive = false
  jackpotPhase = 0 // 0=Idle, 1=Breach, 2=Error, 3=Meltdown

  private isSolidGoldPulseActive = false
  private solidGoldPulseTimer = 0
  private readonly SOLID_GOLD_PULSE_DURATION = 1.5

  private readonly random: () => number
  private readonly scheduleTimeout: (callback: () => void, delayMs: number) => unknown

  constructor(private readonly callbacks: JackpotSequenceCallbacks) {
    this.random = callbacks.random ?? Math.random
    this.scheduleTimeout = callbacks.scheduleTimeout ?? ((callback, delayMs) => setTimeout(callback, delayMs))
  }

  get pulseActive(): boolean {
    return this.isSolidGoldPulseActive
  }

  get pulseTimer(): number {
    return this.solidGoldPulseTimer
  }

  startJackpotSequence(): void {
    this.isJackpotActive = true
    this.jackpotTimer = 0
    this.jackpotPhase = 1
    this.callbacks.emitJackpotPhase(1)
  }

  /**
   * Advance the 10s Cyber-Shock jackpot sequence with real dt.
   * Phases:
   *   1: Breach     (0-2s)  - alarm, cracks, red pulse
   *   2: Critical   (2-5s)  - rising turbine, countdown glitch, white reveal, white/gold strobe
   *   3: Meltdown   (5-10s) - explosion, chrome JACKPOT, shockwaves, rainbow, bumper flash
   */
  updateJackpotSequence(dt: number): void {
    if (!this.isJackpotActive) return

    this.jackpotTimer += dt

    // Phase 1: Breach (0-2s)
    if (this.jackpotTimer < 2.0) {
      if (this.jackpotPhase !== 1) {
        this.jackpotPhase = 1
        this.callbacks.emitJackpotPhase(1)
      }
    }
    // Phase 2: Critical Error (2-5s)
    else if (this.jackpotTimer < 5.0) {
      if (this.jackpotPhase !== 2) {
        this.jackpotPhase = 2
        this.callbacks.emitJackpotPhase(2)
        // Digital "countdown" beeps (lightweight proxy)
        this.scheduleTimeout(() => this.callbacks.playBeep(880), 300)
        this.scheduleTimeout(() => this.callbacks.playBeep(880), 900)
        this.scheduleTimeout(() => this.callbacks.playBeep(660), 1500)
      }
    }
    // Phase 3: Meltdown (5-10s)
    else if (this.jackpotTimer < 10.0) {
      if (this.jackpotPhase !== 3) {
        this.jackpotPhase = 3
        this.callbacks.emitJackpotPhase(3)
        // Gold particle bursts
        this.callbacks.spawnJackpotBurst(new Vector3(0, 5, 6))
        this.callbacks.spawnJackpotBurst(new Vector3(-2, 4, 3))
        this.callbacks.spawnJackpotBurst(new Vector3(3, 7, 1))
      } else if (this.random() < 0.08) {
        // Occasional extra bursts during meltdown
        this.callbacks.spawnJackpotBurst(
          new Vector3((this.random() - 0.5) * 8, 3 + this.random() * 5, 2 + this.random() * 6)
        )
      }
    }
    // End
    else {
      this.isJackpotActive = false
      this.jackpotPhase = 0
      this.callbacks.setLightingMode('normal')
    }
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
