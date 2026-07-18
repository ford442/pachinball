/**
 * Game Lifecycle — State transitions, camera mode, start/pause/reset, jackpot.
 */

import { Scene } from '@babylonjs/core'
import {
  GameState,
  DisplayState,
  BallType,
  SettingsManager,
  detectAccessibility,
  QualityTier,
  getScoringBreakdownManager,
  type GameSettings,
} from '../game-elements'
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
import { getMaterialLibrary } from '../materials'

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
  readonly tableCam: import('@babylonjs/core').TargetCamera | null
  qualityTier: QualityTier
  accessibility: import('../game-elements').AccessibilityConfig

  startScreen: HTMLElement | null
  menuOverlay: HTMLElement | null
  pauseOverlay: HTMLElement | null
  gameOverScreen: HTMLElement | null
  finalScoreElement: HTMLElement | null
  scoreElement: HTMLElement | null

  score: number
  bestScore: number
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
  private readonly scoringBreakdown = getScoringBreakdownManager()

  constructor(host: LifecycleHost) {
    this.host = host
    this.host.uiManager?.setPauseButtonHandler(() => this.togglePause())
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
        this.focusGameplayCanvas()
        this.host.uiManager?.hidePauseMenu()
        if (this.host.effects?.getAudioContext()?.state === 'suspended') {
          this.host.effects.getAudioContext()?.resume().catch(() => {})
        }
        break
      case GameState.PAUSED:
        if (menuOverlay) menuOverlay.classList.add('hidden')
        if (pauseOverlay) pauseOverlay.classList.remove('hidden')
        this.host.uiManager?.showPauseMenu(this.buildPauseMenuSettings(), {
          onResume: () => this.togglePause(),
          onRestart: () => { void this.startGame() },
          onSettingsChange: (next) => this.applyPauseSettings(next),
        })
        if (this.host.effects?.getAudioContext()?.state === 'running') {
          this.host.effects.getAudioContext()?.suspend().catch(() => {})
        }
        break
      case GameState.GAME_OVER:
        {
          const previousBest = this.host.bestScore
          const isNewBest = this.host.score > previousBest
          if (isNewBest) {
            this.host.bestScore = this.host.score
            try {
              localStorage.setItem('pachinball.best', String(this.host.bestScore))
            } catch {
              // Ignore localStorage errors
            }
          }
          this.host.uiManager?.showScoringBreakdown(this.scoringBreakdown.getSnapshot(), {
            finalScore: this.host.score,
            bestScore: this.host.bestScore,
            bestDelta: isNewBest ? this.host.score - previousBest : 0,
          })
        }
        if (gameOverScreen) gameOverScreen.classList.remove('hidden')
        if (finalScoreElement) finalScoreElement.textContent = this.host.score.toString()
        this.host.updateHUD()
        this.host.handleGameOverLeaderboard()
        break
    }
  }

  private focusGameplayCanvas(): void {
    const canvas = this.host.scene?.getEngine().getRenderingCanvas()
    if (!canvas) return
    if (!canvas.hasAttribute('tabindex')) {
      canvas.setAttribute('tabindex', '0')
    }
    canvas.focus({ preventScroll: true })
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
    this.scoringBreakdown.reset()
    this.host.uiManager?.hideScoringBreakdown()
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

    // Fire audio init in background — never block game start on it.
    // AudioContext.resume() can hang in headless/automated contexts
    // where the browser doesn't recognise the click as a trusted gesture.
    void this.initAudioInBackground()

    // Leaderboard context is set by the caller (Game)
    this.host.setGameState(GameState.PLAYING)
  }

  private async initAudioInBackground(): Promise<void> {
    try {
      await Promise.race([
        this.host.soundSystem.init(),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error('Audio init timeout')), 5000)
        ),
      ])
      const savedSettings = SettingsManager.load()
      this.host.soundSystem.setAudioSource(savedSettings.audioSource)
      this.host.soundSystem.setMasterVolume(savedSettings.masterVolume)
      this.host.soundSystem.setMusicVolume(savedSettings.musicVolume)
      this.host.soundSystem.setSfxVolume(savedSettings.sfxVolume)
      if (savedSettings.muted !== this.host.soundSystem.getVolumeSettings().muted) {
        this.host.soundSystem.toggleMute()
      }
      // Resume may need a user gesture; if it fails we still have synth sounds ready
      try {
        await this.host.soundSystem.resume()
      } catch (resumeErr) {
        console.warn('[GameLifecycle] Audio resume failed (needs user gesture):', resumeErr)
      }
      if (this.host.soundSystem.getAudioSource() === 'samples') {
        await this.host.soundSystem.waitForSampleBank()
      }
      void this.host.soundSystem.playMusicStem('attract')
    } catch (err) {
      console.warn('[GameLifecycle] Audio init failed or timed out, continuing without sound:', err)
    }
  }

  togglePause(): void {
    const { stateManager } = this.host
    stateManager.togglePause()
    this.setGameState(stateManager.getState())
  }

  private buildPauseMenuSettings(): {
    masterVolume: number
    shakeEnabled: boolean
    scanlinesEnabled: boolean
    qualityPreset: 'low' | 'medium' | 'high'
    reducedMotion: boolean
    photosensitiveMode: boolean
  } {
    const settings = SettingsManager.load()
    return {
      masterVolume: settings.masterVolume,
      shakeEnabled: settings.shakeIntensity > 0.001,
      scanlinesEnabled: settings.scanlineEnabled,
      qualityPreset: settings.qualityPreset,
      reducedMotion: settings.reducedMotion,
      photosensitiveMode: settings.photosensitiveMode,
    }
  }

  private applyPauseSettings(next: {
    masterVolume: number
    shakeEnabled: boolean
    scanlinesEnabled: boolean
    qualityPreset: 'low' | 'medium' | 'high'
    reducedMotion: boolean
    photosensitiveMode: boolean
  }): void {
    const current = SettingsManager.load()
    const updated: GameSettings = {
      ...current,
      masterVolume: Math.max(0, Math.min(1, next.masterVolume)),
      shakeIntensity: next.shakeEnabled ? Math.max(0.01, current.shakeIntensity || 0.08) : 0,
      scanlineEnabled: next.scanlinesEnabled,
      qualityPreset: next.qualityPreset,
      reducedMotion: next.reducedMotion,
      photosensitiveMode: next.photosensitiveMode,
    }

    SettingsManager.save(updated)
    SettingsManager.applyToConfig(updated)

    this.host.accessibility = detectAccessibility({
      reducedMotion: updated.reducedMotion,
      photosensitiveMode: updated.photosensitiveMode,
    })

    this.host.effects?.registerAccessibility(this.host.accessibility)
    this.host.display?.setAccessibility(this.host.accessibility)
    this.host.adventureMode?.setAccessibilityConfig(this.host.accessibility)
    this.host.display?.setPlayerScanlineEnabled(updated.scanlineEnabled)
    this.host.mapManager?.getLCDTableState().setPhotosensitiveMode(updated.photosensitiveMode)

    this.host.soundSystem.setMasterVolume(updated.masterVolume)
    this.host.soundSystem.setMusicVolume(updated.musicVolume)
    this.host.soundSystem.setSfxVolume(updated.sfxVolume)
    if (updated.muted !== this.host.soundSystem.getVolumeSettings().muted) {
      this.host.soundSystem.toggleMute()
    }

    if (this.host.scene) {
      this.host.scene.fogMode = updated.reducedMotion ? Scene.FOGMODE_NONE : Scene.FOGMODE_EXP2
    }

    const targetTier =
      updated.qualityPreset === 'low'
        ? QualityTier.LOW
        : updated.qualityPreset === 'high'
          ? QualityTier.HIGH
          : QualityTier.MEDIUM
    this.host.qualityTier = targetTier
    this.host.effects?.setQualityTier(targetTier)
    if (this.host.scene) {
      getMaterialLibrary(this.host.scene).qualityTier = targetTier
    }
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
    // Make bumpers visually explode with energy for the whole sequence
    this.host.gameObjects?.setBumperState('JACKPOT')

    if (!this.host.accessibility.reducedMotion) {
      const mapColor = TABLE_MAPS[this.host.mapManager?.getCurrentMap() || 'neon-helix']?.baseColor || '#ff00ff'
      this.host.effects?.triggerCabinetShake('jackpot', mapColor)
    }

    const scoreMultiplier = this.host.ballManager?.getChainStats().scoreMultiplier ?? 1
    const awardedJackpot = Math.round(GAME_TUNING.scoring.jackpotBonus * scoreMultiplier)
    this.host.score += awardedJackpot
    this.scoringBreakdown.recordScore(awardedJackpot, 'jackpot')
    if (scoreMultiplier > 1) {
      this.host.eventBus.emit('score:multiplier', {
        basePoints: GAME_TUNING.scoring.jackpotBonus,
        awardedPoints: awardedJackpot,
        multiplier: scoreMultiplier,
        source: 'jackpot',
      })
    }
    this.host.updateHUD()
    const pos = this.host.getBallPosition()
    if (pos) this.host.effects?.spawnFloatingNumber(awardedJackpot, pos)
  }
}
