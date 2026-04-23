import { GameState, DisplayState } from '../game-elements/types'
import type { EffectsSystem } from '../effects'
import type { DisplaySystem } from '../display'

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
  // private effects: EffectsSystem | null = null // UNUSED
  private display: DisplaySystem | null = null

  constructor(config: StateManagerConfig = {}) {
    this.config = config
  }

  setSystems(_effects: EffectsSystem | null, display: DisplaySystem | null): void {
    // this.effects = effects // UNUSED
    this.display = display
  }

  setDisplaySystem(display: DisplaySystem | null): void {
    this.display = display
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
        this.display?.setDisplayState(DisplayState.IDLE)
        this.config.onMenuEnter?.()
        break

      case GameState.PLAYING:
        if (oldState === GameState.MENU) {
          this.config.onGameStart?.()
        } else if (oldState === GameState.PAUSED) {
          this.config.onResume?.()
        }
        break

      case GameState.PAUSED:
        this.config.onPause?.()
        break

      case GameState.GAME_OVER:
        this.display?.setDisplayState(DisplayState.IDLE)
        this.config.onGameOver?.()
        break
    }
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
