import { GameState, DisplayState } from '../game-elements/types'
import type { EffectsSystem } from '../effects'
import type { DisplaySystem } from '../display'
import { EventBus } from './event-bus'

export interface StateManagerConfig {
  onStateChange?: (oldState: GameState, newState: GameState) => void
  onMenuEnter?: () => void
  onMenuExit?: () => void
  onGameStart?: () => void
  onGameOver?: () => void
  onPause?: () => void
  onResume?: () => void
}

export class GameStateManager {
  private state: GameState = GameState.MENU
  private previousState: GameState = GameState.MENU
  private config: StateManagerConfig
  private eventBus: EventBus | null = null

  constructor(config: StateManagerConfig = {}) {
    this.config = config
  }

  setEventBus(eventBus: EventBus): void {
    this.eventBus = eventBus
  }

  /** @deprecated Systems now subscribe via EventBus; kept for backward compat */
  setSystems(_effects: EffectsSystem | null, _display: DisplaySystem | null): void {
    // no-op: DisplaySystem now self-manages via EventBus subscription
  }

  /** @deprecated Use EventBus subscription instead; kept for backward compat */
  setDisplaySystem(_display: DisplaySystem | null): void {
    // no-op: DisplaySystem now self-manages via EventBus subscription
  }

  getState(): GameState {
    return this.state
  }

  getPreviousState(): GameState {
    return this.previousState
  }

  isPlaying(): boolean {
    return this.state === GameState.PLAYING
  }

  isPaused(): boolean {
    return this.state === GameState.PAUSED
  }

  isMenu(): boolean {
    return this.state === GameState.MENU
  }

  setState(newState: GameState): void {
    if (this.state === newState) return

    const oldState = this.state
    this.previousState = oldState
    this.state = newState

    // Handle state transitions
    this.handleStateTransition(oldState, newState)

    // Notify callback
    this.config.onStateChange?.(oldState, newState)
  }

  private handleStateTransition(oldState: GameState, newState: GameState): void {
    switch (newState) {
      case GameState.MENU:
        this.eventBus?.emit('menu:enter')
        this.eventBus?.emit('display:set', DisplayState.IDLE)
        this.config.onMenuEnter?.()
        break

      case GameState.PLAYING:
        if (oldState === GameState.MENU) {
          this.eventBus?.emit('game:start')
          this.config.onGameStart?.()
        } else if (oldState === GameState.PAUSED) {
          this.eventBus?.emit('game:resume')
          this.config.onResume?.()
        }
        break

      case GameState.PAUSED:
        this.eventBus?.emit('game:pause')
        this.config.onPause?.()
        break

      case GameState.GAME_OVER:
        this.eventBus?.emit('game:over')
        this.eventBus?.emit('display:set', DisplayState.IDLE)
        this.config.onGameOver?.()
        break
    }

    // Emit generic state change event for instrumentation / logging
    this.eventBus?.emit('state:change', { oldState, newState })
  }

  togglePause(): void {
    if (this.state === GameState.PLAYING) {
      this.setState(GameState.PAUSED)
    } else if (this.state === GameState.PAUSED) {
      this.setState(GameState.PLAYING)
    }
  }

  returnToMenu(): void {
    this.setState(GameState.MENU)
  }

  startGame(): void {
    this.setState(GameState.PLAYING)
  }

  gameOver(): void {
    this.setState(GameState.GAME_OVER)
  }
}
