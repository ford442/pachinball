/**
 * Dynamic resolution (#488 §3): a hysteresis controller over the render scale. Feed it one frame
 * time per frame; it steps the scale down after 30 consecutive frames over budget and up after 120
 * under, and waits longer before probing up again after a step up that did not hold.
 *
 * Pure (no Babylon), and lazily loaded with `render-resolution.ts`: boot only needs
 * `resolution-policy.ts`.
 */

import { MIN_RENDER_SCALE } from './resolution-policy'

export interface DynamicResolutionOptions {
  /** Frame-time budget (ms) the controller defends. */
  budgetMs: number
  /** Highest scale (from `resolveRenderScale`). The controller starts here. */
  maxScale: number
  /** Lowest scale; default `max(MIN_RENDER_SCALE, maxScale / 2)`. */
  minScale?: number
  /** Scale change per step. Default 0.125. */
  step?: number
  /** Consecutive over-budget frames before stepping down. Default 30. */
  overFrames?: number
  /** Consecutive under-budget frames before stepping up. Default 120. */
  underFrames?: number
  /** A frame is "under" when it takes less than `budget × underRatio`. Default 0.8. */
  underRatio?: number
  /**
   * After a step up is followed by a step down (the scale bounced off the budget), the next step
   * up needs this many times more under-budget frames, up to `maxUnderFrames`. Default 2.
   */
  backoff?: number
  /** Default 960 (16 s at 60 Hz). */
  maxUnderFrames?: number
}

/**
 * Hysteresis controller: feed it one frame time per frame; it returns the new scale on the frame it
 * changes, else null.
 */
export class DynamicResolutionController {
  private readonly budgetMs: number
  private readonly step: number
  private readonly overFrames: number
  private readonly baseUnderFrames: number
  private readonly underRatio: number
  private readonly backoff: number
  private readonly maxUnderFrames: number
  private maxScale: number
  private minScale: number
  private scale: number
  private over = 0
  private under = 0
  private underNeeded: number
  private lastMove: 'up' | 'down' | null = null

  constructor(options: DynamicResolutionOptions) {
    this.budgetMs = options.budgetMs
    this.step = options.step ?? 0.125
    this.overFrames = options.overFrames ?? 30
    this.baseUnderFrames = options.underFrames ?? 120
    this.underRatio = options.underRatio ?? 0.8
    this.backoff = options.backoff ?? 2
    this.maxUnderFrames = options.maxUnderFrames ?? 960
    this.underNeeded = this.baseUnderFrames
    this.maxScale = options.maxScale
    this.minScale = Math.min(options.maxScale, options.minScale ?? Math.max(MIN_RENDER_SCALE, options.maxScale / 2))
    this.scale = options.maxScale
  }

  get currentScale(): number {
    return this.scale
  }

  get range(): { min: number; max: number } {
    return { min: this.minScale, max: this.maxScale }
  }

  /**
   * New ceiling (DPR or tier changed). The current scale is clamped into the new range — and jumps
   * to the new maximum when that is lower, or when `resetToMax` is set.
   */
  setMaxScale(maxScale: number, resetToMax = false): number {
    this.maxScale = maxScale
    this.minScale = Math.min(maxScale, Math.max(MIN_RENDER_SCALE, maxScale / 2))
    this.scale = resetToMax ? maxScale : Math.min(maxScale, Math.max(this.minScale, this.scale))
    this.over = 0
    this.under = 0
    return this.scale
  }

  /** One frame's time (ms). Returns the new scale when this frame changed it, else null. */
  sample(frameMs: number): number | null {
    if (!Number.isFinite(frameMs) || frameMs <= 0) return null
    if (frameMs > this.budgetMs) {
      this.under = 0
      if (++this.over >= this.overFrames) {
        this.over = 0
        return this.move(-this.step)
      }
    } else if (frameMs < this.budgetMs * this.underRatio) {
      this.over = 0
      if (++this.under >= this.underNeeded) {
        this.under = 0
        return this.move(this.step)
      }
    } else {
      // In the dead band: neither direction accumulates.
      this.over = 0
      this.under = 0
    }
    return null
  }

  private move(delta: number): number | null {
    const next = Math.min(this.maxScale, Math.max(this.minScale, this.scale + delta))
    if (Math.abs(next - this.scale) < 1e-6) return null
    const dir = delta > 0 ? 'up' : 'down'
    if (dir === 'down' && this.lastMove === 'up') {
      // The last step up did not hold: wait longer before probing again.
      this.underNeeded = Math.min(this.maxUnderFrames, Math.round(this.underNeeded * this.backoff))
    }
    this.lastMove = dir
    this.scale = next
    return next
  }
}
