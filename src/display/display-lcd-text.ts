/**
 * Transient LCD text (Layer 3): the drain / ball-lost flash mode, the temporary text line (combo
 * multiplier, ball save) and the bonus-tally count-up.
 *
 * Split out of `display-core.ts`. It only decides *what* the LCD overlay shows and for how long; the
 * overlay layer draws it. `DisplaySystem` calls `update(dt)` once per frame, after the layers.
 */

import type { EventBus } from '../core/event-bus'
import type { DisplayLcdOverlayLayer } from './display-lcd-overlay'

/** The slice of the LCD overlay layer this module drives. */
export type LcdTextSink = Pick<DisplayLcdOverlayLayer, 'setDrainMode' | 'setTemporaryText'>

export class LcdTransientText {
  // Drain / ball-lost flash mode state machine
  private displayMode: 'normal' | 'drain' = 'normal'
  private drainTimer = 0
  private flashCycleTime = 0
  private currentSplashIndex = 0

  // Temporary text overlay (combo multiplier, ball save, bonus tally)
  private temporaryText = ''
  private temporaryTextTimer = 0

  // Bonus tally count-up animation
  private bonusTallyTarget = 0
  private bonusTallyDisplay = 0
  private bonusTallyAnimating = false

  constructor(
    private readonly lcd: LcdTextSink,
    /** True when reduced motion or a low flash-frequency cap is requested (read live). */
    private readonly isPhotosafeMode: () => boolean,
  ) {}

  /**
   * Trigger the "Drain / Ball Lost" display reaction.
   * Call this from the physics loop when a ball enters the drain zone.
   */
  triggerDrainReaction(): void {
    this.displayMode = 'drain'
    this.drainTimer = 2.0
    this.flashCycleTime = 0
    this.currentSplashIndex = 0
    this.lcd.setDrainMode(true, this.flashCycleTime, this.currentSplashIndex)
  }

  /**
   * Returns true while the drain/ball-lost animated overlay is active.
   * Useful for callers that need to suppress other UI updates during the sequence.
   */
  isDrainReactionActive(): boolean {
    return this.displayMode === 'drain'
  }

  update(dt: number): void {
    if (this.displayMode === 'drain') {
      this.drainTimer -= dt
      this.flashCycleTime += dt
      const newIndex = Math.floor(this.flashCycleTime / 0.3) % 2
      if (!this.isPhotosafeMode() || newIndex !== this.currentSplashIndex) {
        this.currentSplashIndex = newIndex
        this.lcd.setDrainMode(true, this.flashCycleTime, this.currentSplashIndex)
      }
      if (this.drainTimer <= 0) {
        this.displayMode = 'normal'
        this.drainTimer = 0
        this.flashCycleTime = 0
        this.lcd.setDrainMode(false)
      }
    }

    if (this.temporaryTextTimer > 0) {
      this.temporaryTextTimer -= dt
      if (this.temporaryTextTimer <= 0 && !this.bonusTallyAnimating) {
        this.temporaryText = ''
        this.lcd.setTemporaryText('')
      }
    }

    if (this.bonusTallyAnimating) {
      const animDurationS = 1.5
      const step = Math.max(1, Math.ceil(this.bonusTallyTarget * dt / animDurationS))
      this.bonusTallyDisplay = Math.min(this.bonusTallyTarget, this.bonusTallyDisplay + step)
      this.temporaryText = `BONUS ${Math.round(this.bonusTallyDisplay)}`
      this.lcd.setTemporaryText(this.temporaryText)
      if (this.bonusTallyDisplay >= this.bonusTallyTarget) {
        this.bonusTallyAnimating = false
        this.temporaryTextTimer = 2.0
      }
    }
  }

  /** The combo, ball-save and bonus-tally events that put text on the LCD. */
  subscribeToEvents(bus: EventBus): void {
    bus.on('combo:multiplier:changed', (data) => {
      if (data.multiplier > 1) {
        this.temporaryText = `MULTIPLIER x${data.multiplier}`
        this.temporaryTextTimer = 1.5
        this.lcd.setTemporaryText(this.temporaryText)
      }
    })

    bus.on('ball:save:triggered', () => {
      this.temporaryText = 'BALL SAVED'
      this.temporaryTextTimer = 2.0
      this.lcd.setTemporaryText(this.temporaryText)
    })

    bus.on('bonus:tally:start', (data) => {
      this.bonusTallyTarget = data.totalBonus
      this.bonusTallyDisplay = 0
      this.bonusTallyAnimating = true
    })

    bus.on('bonus:tally:complete', () => {
      this.bonusTallyAnimating = false
      this.temporaryTextTimer = 2.0
    })
  }
}
