/**
 * Combo Multiplier System — Pure logic for rolling combo window and score multiplier.
 *
 * Consecutive scoring hits within a time window increment a combo counter.
 * The combo counter drives a live score multiplier (1x → 2x → 3x …, capped).
 * Resets on idle (window expiry), drain, or explicit reset.
 */

export interface ComboMultiplierConfig {
  /** Seconds before the combo window expires without a hit. */
  windowSeconds: number
  /** Number of hits required to advance the multiplier by 1. */
  hitsPerMultiplier: number
  /** Maximum multiplier cap. */
  maxMultiplier: number
}

export class ComboMultiplierSystem {
  private comboCount = 0
  private windowRemaining = 0
  private peakCombo = 0
  private currentMultiplier = 1

  constructor(private readonly config: ComboMultiplierConfig) {}

  /**
   * Register a scoring hit. Refreshes the combo window and increments the counter.
   * Returns the new state and whether the multiplier level changed.
   */
  registerHit(): {
    comboCount: number
    multiplier: number
    changed: boolean
    peakCombo: number
  } {
    const wasInactive = this.windowRemaining <= 0
    if (wasInactive) {
      this.comboCount = 1
    } else {
      this.comboCount++
    }
    this.windowRemaining = this.config.windowSeconds
    if (this.comboCount > this.peakCombo) {
      this.peakCombo = this.comboCount
    }
    const newMultiplier = this.calculateMultiplier()
    const changed = newMultiplier !== this.currentMultiplier
    this.currentMultiplier = newMultiplier
    return {
      comboCount: this.comboCount,
      multiplier: newMultiplier,
      changed,
      peakCombo: this.peakCombo,
    }
  }

  /**
   * Advance time. If the window expires, returns the expiry state and resets internally.
   */
  update(dtSeconds: number): { expired: boolean; peakCombo: number; comboCount: number } | null {
    if (this.windowRemaining <= 0) return null
    this.windowRemaining = Math.max(0, this.windowRemaining - dtSeconds)
    if (this.windowRemaining > 0) return null
    const result = { expired: true, peakCombo: this.peakCombo, comboCount: this.comboCount }
    this.resetInternal()
    return result
  }

  /**
   * Force-reset the combo (e.g. on drain). Returns the peak and final count.
   */
  reset(): { peakCombo: number; comboCount: number } {
    const result = { peakCombo: this.peakCombo, comboCount: this.comboCount }
    this.resetInternal()
    return result
  }

  /** Clear the peak counter (e.g. after bonus tally). */
  clearPeak(): void {
    this.peakCombo = 0
  }

  getState(): {
    comboCount: number
    multiplier: number
    windowRemaining: number
    peakCombo: number
  } {
    return {
      comboCount: this.comboCount,
      multiplier: this.currentMultiplier,
      windowRemaining: this.windowRemaining,
      peakCombo: this.peakCombo,
    }
  }

  private calculateMultiplier(): number {
    return Math.min(
      Math.floor(this.comboCount / this.config.hitsPerMultiplier) + 1,
      this.config.maxMultiplier,
    )
  }

  private resetInternal(): void {
    this.comboCount = 0
    this.windowRemaining = 0
    this.currentMultiplier = 1
  }
}
