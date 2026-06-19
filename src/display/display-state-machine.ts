/**
 * Context-aware display state machine (PLAN.md §2).
 * Manages smooth cross-fades between Idle, Reach, Fever, and Jackpot states.
 */

import { DisplayState } from '../game-elements/display-config'

export type DisplayLightingMode = 'idle' | 'reach' | 'fever' | 'jackpot'

export interface DisplayTransitionSnapshot {
  current: DisplayState
  previous: DisplayState | null
  progress: number
  isTransitioning: boolean
  /** 0–1 blend toward the new state's media */
  blend: number
  lightingMode: DisplayLightingMode
}

const STATE_LIGHTING: Partial<Record<DisplayState, DisplayLightingMode>> = {
  [DisplayState.IDLE]: 'idle',
  [DisplayState.REACH]: 'reach',
  [DisplayState.FEVER]: 'fever',
  [DisplayState.JACKPOT]: 'jackpot',
  [DisplayState.ADVENTURE]: 'idle',
  [DisplayState.PORTAL_OPEN]: 'reach',
  [DisplayState.ESCAPE]: 'reach',
}

export class DisplayStateMachine {
  private current: DisplayState = DisplayState.IDLE
  private previous: DisplayState | null = null
  private transitionTimer = 0
  private fadeDuration: number

  constructor(fadeDuration = 0.35) {
    this.fadeDuration = fadeDuration
  }

  setFadeDuration(seconds: number): void {
    this.fadeDuration = Math.max(0.05, seconds)
  }

  getCurrentState(): DisplayState {
    return this.current
  }

  /** Request a state change. Returns true when the state actually changed. */
  requestState(state: DisplayState): boolean {
    if (state === this.current && this.transitionTimer <= 0) return false
    if (state === this.current) return false

    this.previous = this.current
    this.current = state
    this.transitionTimer = this.fadeDuration
    return true
  }

  update(dt: number): DisplayTransitionSnapshot {
    const wasTransitioning = this.transitionTimer > 0
    if (wasTransitioning) {
      this.transitionTimer = Math.max(0, this.transitionTimer - dt)
    }

    const progress = this.fadeDuration > 0
      ? 1 - this.transitionTimer / this.fadeDuration
      : 1

    return {
      current: this.current,
      previous: this.previous,
      progress: wasTransitioning || this.transitionTimer > 0 ? progress : 1,
      isTransitioning: this.transitionTimer > 0,
      blend: progress,
      lightingMode: STATE_LIGHTING[this.current] ?? 'idle',
    }
  }
}
