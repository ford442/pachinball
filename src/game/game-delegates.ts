import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import type * as RAPIER from '@dimforge/rapier3d-compat'

import { GameState, GhostBallRenderer, CameraMode, detectAccessibility, getDailyCascadeState, type FeederKey } from '../game-elements'
import type { CabinetType } from '../cabinet'

import { TABLE_MAPS } from '../shaders/lcd-table'

import { PhysicsTuningPanel } from '../game-elements/physics-tuning-panel'
import { FreeMapTestMode } from './free-map-test-mode'
import { LevelLoader } from './level-loader'
import type { LevelSelectScreen } from '../game-elements/level-select-screen'
import { GameFields } from './game-fields'

export abstract class GameDelegates extends GameFields {
  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  startGame(): Promise<void> { return this.lifecycle.startGame() }

  applyDailyCascadeOnStart(): void {
    const state = getDailyCascadeState()
    const mode = state.getMode()

    if (mode === 'vanilla') {
      if (state.wasMutatorApplied()) {
        this.gameObjects?.rebuildMutableToys(null)
        this.applyFeederGameplayFlags(null)
        this.physicsController?.rebuildHandleCaches()
        state.markMutatorApplied(false)
      }
      return
    }

    const layout = state.ensureLayout()
    if (!layout || !this.gameObjects) return
    this.gameObjects.rebuildMutableToys(layout)
    this.applyFeederGameplayFlags(layout.feedersEnabled)
    this.physicsController?.rebuildHandleCaches()
    state.markMutatorApplied(true)
  }

  private applyFeederGameplayFlags(flags: Record<FeederKey, boolean> | null): void {
    const allOn = flags === null
    this.magSpinFeeder?.setGameplayEnabled(allOn || !!flags?.magSpin)
    this.nanoLoomFeeder?.setGameplayEnabled(allOn || !!flags?.nanoLoom)
    this.prismCoreFeeder?.setGameplayEnabled(allOn || !!flags?.prismCore)
    this.gaussCannon?.setGameplayEnabled(allOn || !!flags?.gaussCannon)
    this.quantumTunnel?.setGameplayEnabled(allOn || !!flags?.quantumTunnel)
  }

  switchTableMap(mapName: string): void { this.mapCabinet.switchTableMap(mapName) }
  loadCabinetPreset(type: CabinetType): Promise<void> { return this.mapCabinet.loadCabinetPreset(type) }
  cycleCabinetPreset(): Promise<void> { return this.mapCabinet.cycleCabinetPreset() }
  cycleTableMap(): void { this.mapCabinet.cycleTableMap() }
  switchScenario(scenarioId: string): void { this.scenarioManager.switchScenario(scenarioId) }
  cycleScenario(direction: 1 | -1 = 1): void { this.scenarioManager.cycleScenario(direction) }

  // SettingsUIHost scanline API
  scanlineEnabled = true
  setScanlineEnabled(enabled: boolean): void {
    this.scanlineEnabled = enabled
    this.display?.setPlayerScanlineEnabled(enabled)
  }
  setScanlineIntensityMultiplier(multiplier: number): void {
    this.display?.setScanlineIntensityMultiplier(multiplier)
  }

  // --------------------------------------------------------------------------
  // Wrapper methods (called by helpers)
  // --------------------------------------------------------------------------

  bestScore = 0

  setGameState(state: GameState): void { this.lifecycle.setGameState(state) }
  getCameraMode(): CameraMode { return this.lifecycle.getCameraMode() }
  togglePause(): void { this.lifecycle.togglePause() }
  /**
   * Reset the current run to a clean launch-ready state without changing the active mode/track.
   * This clears transient plunger input/animation state, collapses multiball back to one ball,
   * then respawns a fresh ball in the shooter lane and reapplies mode rewards.
   */
  resetBall(): void {
    this.inputManager?.cancelPlungerCharge()
    this.inputActions.resetPlungerState()
    this.ballManager?.removeExtraBalls()
    this.ballManager?.resetBall()
    this.applyEquippedRewards()
    this.updateHUD()
  }
  handlePrimaryBallDrain(): boolean {
    if (this.freeMapTestMode?.isActive()) {
      return this.freeMapTestMode.advanceAfterDrain()
    }
    return false
  }
  triggerJackpot(): void { this.lifecycle.triggerJackpot() }
  updateHUD(): void { this.hud.updateHUD() }
  updateGoldBallDisplay(): void { this.hud.updateGoldBallDisplay() }
  showMessage(msg: string, duration: number): void { this.uiManager?.showMessage(msg, duration) }
  handleGameOverLeaderboard(): Promise<void> { return this.hud.handleGameOverLeaderboard() }
  getBallPosition(): Vector3 | null { return this.physicsController.getBallPosition() }
  endAdventureMode(): void { this.slotAdventure.endAdventureMode() }
  tryActivateSlotMachine(): void { this.slotAdventure.tryActivateSlotMachine() }
  forceSlotSpin(): void { this.slotAdventure.forceSlotSpin() }
  rebuildHandleCaches(): void { this.physicsController.rebuildHandleCaches() }
  handleDebugHUDVisibilityChange(visible: boolean): void {
    this.debugHelper.handleDebugHUDVisibilityChange(
      visible,
      () => {
        this.eventBusLog.wire(this.eventBus)
        this.eventBusLog.setEnabled(true)
        this.performanceMonitor.setEnabled(true)
      },
      () => {
        this.eventBusLog.setEnabled(false)
        this.eventBusLog.clear()
      },
    )
  }
  ensurePhysicsTuningPanel(): PhysicsTuningPanel {
    if (!this.physicsTuningPanel) {
      this.physicsTuningPanel = new PhysicsTuningPanel()
    }
    return this.physicsTuningPanel
  }
  applyAccessibilitySettings(reducedMotion: boolean, photosensitiveMode: boolean): void {
    this.accessibility = detectAccessibility({ reducedMotion, photosensitiveMode })
    this.effects?.registerAccessibility(this.accessibility)
    this.adventureMode?.setAccessibilityConfig(this.accessibility)
    this.display?.setAccessibility(this.accessibility)
    this.mapManager?.getLCDTableState().setPhotosensitiveMode(photosensitiveMode)
  }
  isDebugHUDAvailable(): boolean { return this.debugHelper.isDebugHUDAvailable() }
  isDebugHUDKeyboardEnabled(): boolean { return this.debugHelper.isDebugHUDKeyboardEnabled() }
  initializeDynamicZones(mapName: string, mapConfig: typeof TABLE_MAPS[string]): void { this.scenarioManager.initializeDynamicZones(mapName, mapConfig) }
  updateCabinetLightingForMap(): void { this.cabinetBuilder.updateCabinetLightingForMap() }

  // --------------------------------------------------------------------------
  // Input / Gameplay delegates
  // --------------------------------------------------------------------------

  handleFlipperLeft(pressed: boolean): void { this.inputActions.handleFlipperLeft(pressed) }
  handleFlipperRight(pressed: boolean): void { this.inputActions.handleFlipperRight(pressed) }
  handlePlunger(): void {
    this.inputActions.handlePlunger()
  }
  startPlungerCharge(): void { this.inputActions.startPlungerCharge() }
  updatePlungerCharge(chargeLevel: number): void { this.inputActions.updatePlungerCharge(chargeLevel) }
  releasePlungerCharge(chargeLevel: number): void { this.inputActions.releasePlungerCharge(chargeLevel) }
  applyNudge(direction: { x: number; y: number; z: number }): void { this.physicsController.applyNudge(direction) }
  applyOwnedBallImpulse(body: RAPIER.RigidBody, ix: number, iy: number, iz: number): void {
    this.physicsController.applyOwnedBallImpulse(body, ix, iy, iz)
  }

  // --------------------------------------------------------------------------
  // Adventure / Mode delegates
  // --------------------------------------------------------------------------

  toggleAdventure(): void {
    if (this.adventureMode?.isActive()) {
      this.slotAdventure.endAdventureMode()
    } else {
      this.slotAdventure.startAdventureMode()
    }
  }

  toggleLevelSelect(): void {
    void this.ensureLevelSelectScreen().then((screen) => screen.toggle())
  }

  private async ensureLevelSelectScreen(): Promise<LevelSelectScreen> {
    if (this.levelSelectScreen) return this.levelSelectScreen
    const { getLevelSelectScreen } = await import('../game-elements/level-select-screen')
    this.levelSelectScreen = getLevelSelectScreen(
      {
        onLevelSelect: (level, mapType) => {
          this.mapCabinet.switchTableMap(mapType)
          this.adventureState.startLevel(level.id)
        },
        onClose: () => {},
      },
      this.adventureState,
    )
    return this.levelSelectScreen
  }

  toggleCameraMode(): void { this.isCameraFollowMode = !this.isCameraFollowMode }

  togglePerformanceMonitor(): void {
    const enabled = !this.performanceMonitor.isEnabled()
    this.performanceMonitor.setEnabled(enabled)
    console.log(`[PerfMonitor] ${enabled ? 'Enabled' : 'Disabled'}`)
  }

  toggleFreeMapTestMode(): void {
    if (!this.levelLoader) {
      this.levelLoader = this.createLevelLoader()
    }
    if (!this.freeMapTestMode) {
      this.freeMapTestMode = new FreeMapTestMode(
        {
          adventureMode: this.adventureMode,
          ballManager: this.ballManager,
          ensureAdventureActive: () => this.slotAdventure.startAdventureMode(),
          resetBall: () => this.resetBall(),
          rebuildHandleCaches: () => this.rebuildHandleCaches(),
          mapManager: this.mapManager,
          setGameMode: (mode) => { this.gameMode = mode },
        },
        {
          onMessage: (msg) => this.showMessage(msg, 3000),
        }
      )
    }
    this.freeMapTestMode.toggle()
  }

  createLevelLoader(): LevelLoader {
    return new LevelLoader({
      adventureMode: this.adventureMode,
      ballManager: this.ballManager,
      ensureAdventureActive: () => this.slotAdventure.startAdventureMode(),
      resetBall: () => this.resetBall(),
      rebuildHandleCaches: () => this.rebuildHandleCaches(),
      mapManager: this.mapManager,
      setGameMode: (mode) => { this.gameMode = mode },
    })
  }

  cycleAdventureTrack(direction: number): void { this.slotAdventure.cycleAdventureTrack(direction) }
  startAdventureMode(): void { this.slotAdventure.startAdventureMode() }

  async startSpectateReplay(replayId: string): Promise<boolean> {
    try {
      const { apiFetch } = await import('../config')
      const payload = await apiFetch<import('../game-elements').ReplayPayload>(`/replays/${replayId}`)
      if (!payload) {
        this.showMessage('Replay payload not found', 3000)
        return false
      }

      if (!this.ghostBallRenderer && this.scene) {
        this.ghostBallRenderer = new GhostBallRenderer(this.scene)
      }

      this.replayRunner.load(payload)
      this.ghostBallRenderer?.show()
      this.uiManager?.showMessage(`Watching Replay: ${payload.mapId} (Score: ${payload.finalScore.toLocaleString()})`, 4000)
      await this.lifecycle.startGame()
      return true
    } catch (err) {
      console.warn('[Game] Failed to spectate replay:', err)
      this.showMessage('Failed to load replay payload', 3000)
      return false
    }
  }

  // --------------------------------------------------------------------------
  // Misc
  // --------------------------------------------------------------------------

  private applyEquippedRewards(): void {
    const ballTrailReward = this.adventureState.getEquippedReward('ball-trail')
    const skinReward = this.adventureState.getEquippedReward('skin')
    if (ballTrailReward) this.ballManager?.applyBallTrail(ballTrailReward.id)
    if (skinReward) this.ballManager?.applyBallSkin(skinReward.id)
  }
}
