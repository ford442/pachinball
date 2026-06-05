/**
 * Ball Save System — Pure logic for the post-launch grace window.
 *
 * For the first N milliseconds after a ball is launched, an early drain
 * re-spawns the ball without decrementing ball count or resetting score.
 */

export interface BallSaveConfig {
  graceMs: number
}

export class BallSaveSystem {
  private launchTimeMs = 0
  private graceActive = false

  constructor(private readonly config: BallSaveConfig) {}

  /** Start the grace window. Called when the ball is physically launched. */
  onBallLaunched(nowMs: number): void {
    this.launchTimeMs = nowMs
    this.graceActive = true
  }

  /** Returns true if the ball is still within the grace window. */
  canSave(nowMs: number): boolean {
    if (!this.graceActive) return false
    return nowMs - this.launchTimeMs <= this.config.graceMs
  }

  /** Mark the one-time save as consumed. */
  consumeSave(): void {
    this.graceActive = false
  }

  /** Force-expire the grace window (e.g. on genuine drain or game over). */
  expire(): void {
    this.graceActive = false
  }

  /** Milliseconds remaining in the grace window (0 if inactive). */
  getRemainingMs(nowMs: number): number {
    if (!this.graceActive) return 0
    return Math.max(0, this.config.graceMs - (nowMs - this.launchTimeMs))
  }

  /** Whether the grace window is currently active. */
  isActive(): boolean {
    return this.graceActive
  }
}
