/**
 * Bonus Tally System — Pure logic for end-of-ball bonus accumulation.
 *
 * Accumulates per-ball bonuses (combo peaks, obstacle bonuses, gold-ball collects)
 * into a bucket. On a genuine drain, the bucket is swept: its total is added to
 * the running score and the bucket is cleared.
 */

export interface BonusTallyConfig {
  /** Points awarded per peak combo hit at drain time. */
  comboPeakBase: number
}

export class BonusTallySystem {
  private bucket = new Map<string, number>()
  private peakCombo = 0

  constructor(private readonly config: BonusTallyConfig) {}

  /** Record a scoring event into the bonus bucket. */
  recordScore(source: string, points: number): void {
    this.bucket.set(source, (this.bucket.get(source) || 0) + points)
  }

  /** Update the peak combo reached during the current ball. */
  recordComboPeak(comboCount: number): void {
    if (comboCount > this.peakCombo) {
      this.peakCombo = comboCount
    }
  }

  /** Total bonus currently in the bucket (including projected peak combo bonus). */
  getTotalBonus(): number {
    let total = 0
    for (const points of this.bucket.values()) {
      total += points
    }
    total += this.peakCombo * this.config.comboPeakBase
    return total
  }

  /** Breakdown of bonus sources. */
  getBreakdown(): Record<string, number> {
    const result: Record<string, number> = {}
    for (const [source, points] of this.bucket.entries()) {
      result[source] = points
    }
    if (this.peakCombo > 0) {
      result['combo-peak'] = this.peakCombo * this.config.comboPeakBase
    }
    return result
  }

  /**
   * Sweep the bucket: return the total and breakdown, then clear.
   * Call this on a genuine drain after the ball-save check.
   */
  sweep(): { total: number; breakdown: Record<string, number>; peakCombo: number } {
    const total = this.getTotalBonus()
    const breakdown = this.getBreakdown()
    const peak = this.peakCombo
    this.bucket.clear()
    this.peakCombo = 0
    return { total, breakdown, peakCombo: peak }
  }

  /** Hard reset (e.g. game over). */
  reset(): void {
    this.bucket.clear()
    this.peakCombo = 0
  }
}
