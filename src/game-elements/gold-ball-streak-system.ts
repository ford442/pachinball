/**
 * Gold Ball Streak System — Pure logic for consecutive gold-ball collection bonuses.
 *
 * When the player collects gold balls in quick succession (within `windowSeconds`),
 * each subsequent ball earns a growing multiplier applied on top of its base points.
 * The streak resets when more than `windowSeconds` elapses between collections or on
 * an explicit reset (drain, game-over).
 *
 * All tunables live in GoldBallStreakConfig, which is exposed via GAME_TUNING.goldBall.
 */

export interface GoldBallStreakConfig {
  /** Maximum seconds between two collections for the streak to continue. */
  windowSeconds: number
  /** Multiplier bonus added for each ball in the streak beyond the first. */
  perBallBonus: number
  /** Hard cap on the streak multiplier (e.g. 4 = 4× max). */
  maxMultiplier: number
}

export interface GoldBallStreakResult {
  /** Running count of consecutive balls in this streak (1 = no streak yet). */
  streakCount: number
  /** Multiplier to apply to this ball's base points. */
  multiplier: number
  /** True when this is the second or later ball in an active streak. */
  isStreak: boolean
}

export class GoldBallStreakSystem {
  private streakCount = 0
  private lastCollectSeconds = -Infinity

  constructor(private readonly config: GoldBallStreakConfig) {}

  /**
   * Register a gold ball collection at `nowSeconds`.
   * Returns the streak state to apply to this ball's reward.
   */
  registerCollect(nowSeconds: number): GoldBallStreakResult {
    const withinWindow = nowSeconds - this.lastCollectSeconds <= this.config.windowSeconds
    this.streakCount = withinWindow ? this.streakCount + 1 : 1
    this.lastCollectSeconds = nowSeconds

    const multiplier = Math.min(
      1 + (this.streakCount - 1) * this.config.perBallBonus,
      this.config.maxMultiplier,
    )
    return {
      streakCount: this.streakCount,
      multiplier,
      isStreak: this.streakCount > 1,
    }
  }

  getStreakCount(): number {
    return this.streakCount
  }

  /** Hard-reset the streak (drain, game-over, adventure track switch). */
  reset(): void {
    this.streakCount = 0
    this.lastCollectSeconds = -Infinity
  }
}
