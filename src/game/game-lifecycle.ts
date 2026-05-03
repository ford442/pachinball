/**
 * Game Lifecycle — State transitions, camera mode, start/pause/reset, jackpot.
 */

import type { Scene } from '@babylonjs/core'
import { GameState, DisplayState, BallType } from '../game-elements'
import type { EffectsSystem } from '../effects'
import type { DisplaySystem } from '../display'
import type { BallManager } from '../game-elements/ball-manager'
import type { BallStackVisual } from '../game-elements/ball-stack-visual'
import type { GameObjects } from '../objects'
import type { SoundSystem } from '../game-elements/sound-system'
import type { HapticManager } from '../game-elements/haptics'
import type { GameStateManager } from './game-state'
import type { EventBus } from './event-bus'
import type { AdventureMode } from '../adventure'
import { CameraController, CameraMode } from '../game-elements/camera-controller'
import type { TableMapManager } from './game-maps'
import type { GameUIManager } from './game-ui'
import { GAME_TUNING } from '../config'
import { TABLE_MAPS } from '../shaders/lcd-table'

export interface LifecycleHost {
  readonly stateManager: GameStateManager
  readonly effects: EffectsSystem | null
  readonly display: DisplaySystem | null
  readonly ballManager: BallManager | null
  readonly ballStackVisual: BallStackVisual | null
  readonly gameObjects: GameObjects | null
  readonly soundSystem: SoundSystem
  readonly hapticManager: HapticManager | null
  readonly eventBus: EventBus
  readonly adventureMode: AdventureMode | null
  readonly cameraController: CameraController | null
  readonly mapManager: TableMapManager | null
  readonly uiManager: GameUIManager | null
  readonly scene: Scene | null
  readonly tableCam: import('@babylonjs/core').ArcRotateCamera | null
  readonly accessibility: import('../game-elements').AccessibilityConfig

  startScreen: HTMLElement | null
  menuOverlay: HTMLElement | null
  pauseOverlay: HTMLElement | null
  gameOverScreen: HTMLElement | null
  finalScoreElement: HTMLElement | null
  scoreElement: HTMLElement | null

  score: number
  lives: number
  comboCount: number
  comboTimer: number
  goldBallStack: Array<{ type: BallType; timestamp: number }>
  sessionGoldBalls: number
  powerupActive: boolean
  powerupTimer: number

  updateHUD(): void
  resetBall(): void
  setGameState(state: GameState): void
  handleGameOverLeaderboard(): Promise<void>
  getBallPosition(): import('@babylonjs/core').Vector3 | null
}

export class GameLifecycle {
  private readonly host: LifecycleHost

  constructor(host: LifecycleHost) {
    this.host = host
  }

  setGameState(newState: GameState): void {
    const { stateManager, startScreen, menuOverlay, pauseOverlay, gameOverScreen, finalScoreElement } = this.host
    stateManager.setState(newState)

    if (menuOverlay) menuOverlay.classList.remove('hidden')
    if (pauseOverlay) pauseOverlay.classList.add('hidden')
    if (startScreen) startScreen.classList.add('hidden')
    if (gameOverScreen) gameOverScreen.classList.add('hidden')

    switch (newState) {
      case GameState.MENU:
        if (startScreen) startScreen.classList.remove('hidden')
        break
      case GameState.PLAYING:
        if (menuOverlay) menuOverlay.classList.add('hidden')
        if (pauseOverlay) pauseOverlay.classList.add('hidden')
        if (this.host.effects?.getAudioContext()?.state === 'suspended') {
          this.host.effects.getAudioContext()?.resume().catch(() => {})
        }
        break
      case GameState.PAUSED:
        if (menuOverlay) menuOverlay.classList.add('hidden')
        if (pauseOverlay) pauseOverlay.classList.remove('hidden')
        if (this.host.effects?.getAudioContext()?.state === 'running') {
          this.host.effects.getAudioContext()?.suspend().catch(() => {})
        }
        break
      case GameState.GAME_OVER:
        if (gameOverScreen) gameOverScreen.classList.remove('hidden')
        if (finalScoreElement) finalScoreElement.textContent = this.host.score.toString()
        if (this.host.score > this.host.bestScore) {
          this.host.bestScore = this.host.score
          try {
            localStorage.setItem('pachinball.best', String(this.host.bestScore))
          } catch {
            // Ignore localStorage errors
          }
        }
        this.host.updateHUD()
        this.host.handleGameOverLeaderboard()
        break
    }
  }

  getCameraMode(): CameraMode {
    if (this.host.adventureMode?.isActive()) {
      return CameraMode.ADVENTURE
    }
    if (this.host.effects?.isJackpotActive) {
      return CameraMode.JACKPOT
    }
    const ballCount = this.host.ballManager?.getBallBodies().length || 0
    if (ballCount > 1) {
      return CameraMode.MULTIBALL
    }
    const ballBody = this.host.ballManager?.getBallBody()
    if (!ballBody) {
      return CameraMode.IDLE
    }
    const ballPos = ballBody.translation()
    if (ballPos.z < -8) {
      return CameraMode.UPPER_PLAY
    }
    if (ballPos.z > 5 || Math.abs(ballPos.x) > 8) {
      return CameraMode.FLIPPER_READY
    }
    return CameraMode.IDLE
  }

  async startGame(): Promise<void> {
    this.host.score = 0
    this.host.lives = 3
    this.host.comboCount = 0
    this.host.comboTimer = 0
    this.host.goldBallStack = []
    this.host.ballStackVisual?.clear()
    this.host.gameObjects?.resetTargets()
    this.host.powerupActive = false
    this.host.powerupTimer = 0
    this.host.ballManager?.removeExtraBalls()
    this.host.updateHUD()
    this.host.resetBall()

    await this.host.soundSystem.init()
    await this.host.soundSystem.resume()
    this.host.soundSystem.playMapMusic('1')

    // Leaderboard context is set by the caller (Game)
    this.host.setGameState(GameState.PLAYING)
  }

  togglePause(): void {
    const { stateManager } = this.host
    stateManager.togglePause()
    this.setGameState(stateManager.getState())
  }

  resetBall(): void {
    this.host.ballManager?.resetBall()
    // applyEquippedRewards is called by Game wrapper
    this.host.updateHUD()
  }

  triggerJackpot(): void {
    if (!this.host.stateManager.isPlaying()) return
    console.log('JACKPOT TRIGGERED!')

    this.host.effects?.startJackpotSequence()
    this.host.effects?.setAtmosphereState('JACKPOT')
    this.host.eventBus.emit('jackpot:start')
    this.host.eventBus.emit('display:set', DisplayState.JACKPOT)
    this.host.soundSystem.triggerJackpotAudio()

    if (!this.host.accessibility.reducedMotion) {
      const mapColor = TABLE_MAPS[this.host.mapManager?.getCurrentMap() || 'neon-helix']?.baseColor || '#ff00ff'
      this.host.effects?.triggerCabinetShake('jackpot', mapColor)
    }

    this.host.score += GAME_TUNING.scoring.jackpotBonus
    this.host.updateHUD()
    const pos = this.host.getBallPosition()
    if (pos) this.host.effects?.spawnFloatingNumber(GAME_TUNING.scoring.jackpotBonus, pos)
  }
}
