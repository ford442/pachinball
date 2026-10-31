import { Vector3 } from '@babylonjs/core/Maths/math.vector'

import { GameState, GhostBallRenderer, ReplayRecorder, CameraMode, detectAccessibility, type ReplayPayload } from '../game-elements'
import { getDailyCascadeState } from '../cascade/daily-cascade-state'
import type { FeederKey, TableLayout } from '../cascade/daily-cascade-layout'
import type { StartMachine } from '../cascade/start-machine'
import type { CabinetType } from '../cabinet'

import { TABLE_MAPS } from '../config/table-maps'

import type { PhysicsTuningPanel } from '../game-elements/physics-tuning-panel'
import { LevelLoader } from './level-loader'
import type { CampaignMapScreen } from '../adventure/ui/campaign-map'
import { refreshDailyCascadeUI } from './daily-cascade-ui'
import { GameFields } from './game-fields'

export abstract class GameDelegates extends GameFields {
  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  startGame(): Promise<void> { return this.lifecycle?.startGame() ?? Promise.resolve() }

  /**
   * Rebuild the mutable toys (bumpers, pachinko field) and arm the feeders for
   * the machine this game starts on. Runs from `startGame`, after the session
   * RNG is seeded and before the first physics step, so the C++ world is
   * re-exported before the frame-0 fingerprint.
   */
  applyDailyCascadeOnStart(machine: StartMachine): void {
    const state = getDailyCascadeState()

    if (machine.kind === 'vanilla') {
      state.clearWeekly()
      if (state.wasMutatorApplied()) {
        this.gameObjects?.rebuildMutableToys(null)
        this.applyFeederGameplayFlags(null)
        this.physicsController?.rebuildHandleCaches()
        state.markMutatorApplied(false)
      }
      return
    }

    let layout: TableLayout | null
    if (machine.kind === 'weekly') {
      layout = state.weeklyLayout(machine.seed)
    } else {
      state.clearWeekly()
      layout = state.ensureLayout()
    }
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

  switchTableMap(mapName: string): void { this.mapCabinet?.switchTableMap(mapName) }
  /** The table map in play: what a replay records and its leaderboard board is keyed by (#444). */
  get currentMapId(): string | null { return this.mapManager?.getCurrentMap() ?? null }
  loadCabinetPreset(type: CabinetType): Promise<void> { return this.mapCabinet?.loadCabinetPreset(type) ?? Promise.resolve() }
  cycleCabinetPreset(): Promise<void> { return this.mapCabinet?.cycleCabinetPreset() ?? Promise.resolve() }
  cycleTableMap(): void { this.mapCabinet?.cycleTableMap() }
  switchScenario(scenarioId: string): void { this.scenarioManager?.switchScenario(scenarioId) }
  cycleScenario(direction: 1 | -1 = 1): void { this.scenarioManager?.cycleScenario(direction) }

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

  setGameState(state: GameState): void { this.lifecycle?.setGameState(state) }
  getCameraMode(): CameraMode { return this.lifecycle?.getCameraMode() ?? CameraMode.IDLE }
  togglePause(): void { this.lifecycle?.togglePause() }
  /**
   * Reset the current run to a clean launch-ready state without changing the active mode/track.
   * This clears transient plunger input/animation state, collapses multiball back to one ball,
   * then respawns a fresh ball in the shooter lane and reapplies mode rewards.
   */
  resetBall(): void {
    this.inputManager?.cancelPlungerCharge()
    this.inputActions?.resetPlungerState()
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
  triggerJackpot(): void { this.lifecycle?.triggerJackpot() }
  updateHUD(): void { this.hud?.updateHUD() }
  updateGoldBallDisplay(): void { this.hud?.updateGoldBallDisplay() }
  showMessage(msg: string, duration: number): void { this.uiManager?.showMessage(msg, duration) }
  handleGameOverLeaderboard(): Promise<void> { return this.hud?.handleGameOverLeaderboard() ?? Promise.resolve() }
  getBallPosition(): Vector3 | null { return this.physicsController?.getBallPosition() ?? null }
  endAdventureMode(): void { this.slotAdventure?.endAdventureMode() }
  tryActivateSlotMachine(): void { this.slotAdventure?.tryActivateSlotMachine() }
  forceSlotSpin(): void { this.slotAdventure?.forceSlotSpin() }
  rebuildHandleCaches(): void { this.physicsController?.rebuildHandleCaches() }
  handleDebugHUDVisibilityChange(visible: boolean): void {
    this.debugHelper?.handleDebugHUDVisibilityChange(
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
  /** `null` when the Game was disposed while the panel chunk was loading. */
  async ensurePhysicsTuningPanel(): Promise<PhysicsTuningPanel | null> {
    if (this.physicsTuningPanel) return this.physicsTuningPanel
    const { PhysicsTuningPanel } = await import('../game-elements/physics-tuning-panel')
    if (this.signal.aborted) return null
    // A concurrent caller may have created it while we awaited.
    this.physicsTuningPanel ??= new PhysicsTuningPanel()
    return this.physicsTuningPanel
  }
  applyAccessibilitySettings(reducedMotion: boolean, photosensitiveMode: boolean): void {
    this.accessibility = detectAccessibility({ reducedMotion, photosensitiveMode })
    this.effects?.registerAccessibility(this.accessibility)
    this.adventureMode?.setAccessibilityConfig(this.accessibility)
    this.display?.setAccessibility(this.accessibility)
    this.renderer?.syncAccessibility()
    this.mapManager?.getLCDTableState().setPhotosensitiveMode(photosensitiveMode)
  }
  /** DEV builds, or `?debug=1`. Cheap and synchronous so callers never need the lazy GameDebug chunk. */
  isDebugHUDAvailable(): boolean { return import.meta.env.DEV || this.debugHUDQueryEnabled }
  isDebugHUDKeyboardEnabled(): boolean { return this.isDebugHUDAvailable() }
  updateDeveloperSettingsVisibility(): void {
    document.getElementById('developer-settings')?.classList.toggle('hidden', !this.isDebugHUDAvailable())
  }
  initializeDynamicZones(mapName: string, mapConfig: typeof TABLE_MAPS[string]): void { this.scenarioManager?.initializeDynamicZones(mapName, mapConfig) }
  updateCabinetLightingForMap(): void { this.cabinetBuilder?.updateCabinetLightingForMap() }

  // --------------------------------------------------------------------------
  // Input / Gameplay delegates
  // --------------------------------------------------------------------------

  handleFlipperLeft(pressed: boolean): void { this.inputActions?.handleFlipperLeft(pressed) }
  handleFlipperRight(pressed: boolean): void { this.inputActions?.handleFlipperRight(pressed) }
  handlePlunger(): void {
    this.inputActions?.handlePlunger()
  }
  startPlungerCharge(): void { this.inputActions?.startPlungerCharge() }
  updatePlungerCharge(chargeLevel: number): void { this.inputActions?.updatePlungerCharge(chargeLevel) }
  releasePlungerCharge(chargeLevel: number): void { this.inputActions?.releasePlungerCharge(chargeLevel) }
  applyNudge(direction: { x: number; y: number; z: number }): void { this.physicsController?.applyNudge(direction) }

  // --------------------------------------------------------------------------
  // Adventure / Mode delegates
  // --------------------------------------------------------------------------

  /** H: leave the holo-deck, or enter the campaign at its current stage. */
  toggleAdventure(): void {
    if (this.adventureMode?.isActive()) {
      this.slotAdventure?.endAdventureMode()
    } else {
      this.slotAdventure?.enterCampaignStage()
    }
  }

  /** Start the campaign at AdventureTrackProgression's current stage (LifecycleHost). */
  enterCampaignStage(): void { this.slotAdventure?.enterCampaignStage() }

  /**
   * Campaign front door: play `trackId` (a reached stage), or the current one. From the
   * menu or game-over screen this starts a game in Campaign mode; mid-game it moves the
   * live ball into that stage. The stage is recorded as progression's current track,
   * which is persisted, so Play Again and the next session resume there.
   */
  async startCampaign(trackId?: string): Promise<void> {
    const progression = this.adventureTrackProgression
    if (trackId && progression) {
      if (!progression.isTrackUnlocked(trackId)) return
      progression.setCurrentTrack(trackId)
    }
    // Same as picking Campaign in the mode select: it rides the vanilla table.
    this.campaignStartSelected = true
    getDailyCascadeState().setMode('vanilla')
    refreshDailyCascadeUI()
    if (this.stateManager.isPlaying()) {
      this.enterCampaignStage()
      return
    }
    await this.lifecycle?.startGame()
  }

  /** L / Levels / Stage Map: the campaign stage map (loaded on first use). */
  async toggleCampaignMap(): Promise<void> {
    const map = await this.ensureCampaignMap()
    map?.toggle()
  }

  /** `null` when the Game was disposed while the chunk was loading. */
  private async ensureCampaignMap(): Promise<CampaignMapScreen | null> {
    if (this.campaignMap) return this.campaignMap
    const { CampaignMapScreen } = await import('../adventure/ui/campaign-map')
    if (this.signal.aborted) return null
    // A concurrent caller may have created it while we awaited.
    this.campaignMap ??= new CampaignMapScreen({
      signal: this.signal,
      getProgress: () => this.adventureTrackProgression,
      onStageSelect: (trackId) => { void this.startCampaign(trackId) },
    })
    return this.campaignMap
  }

  toggleCameraMode(): void { this.isCameraFollowMode = !this.isCameraFollowMode }

  togglePerformanceMonitor(): void {
    const enabled = !this.performanceMonitor.isEnabled()
    this.performanceMonitor.setEnabled(enabled)
    console.log(`[PerfMonitor] ${enabled ? 'Enabled' : 'Disabled'}`)
  }

  /**
   * Loads the dev-only test mode on first use (own chunk), then toggles it. Resolves once the
   * toggle has been applied, so callers that need `freeMapTestMode` afterwards can await it.
   */
  async toggleFreeMapTestMode(): Promise<void> {
    if (!this.levelLoader) {
      this.levelLoader = this.createLevelLoader()
    }
    if (!this.freeMapTestMode) {
      const { FreeMapTestMode } = await import('./free-map-test-mode')
      // dispose() ran while the chunk loaded, or a concurrent toggle already created it.
      if (this.signal.aborted) return
      this.freeMapTestMode ??= new FreeMapTestMode(
        {
          adventureMode: this.adventureMode,
          ballManager: this.ballManager,
          ensureAdventureActive: () => this.slotAdventure?.startAdventureMode(),
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
      ensureAdventureActive: () => this.slotAdventure?.startAdventureMode(),
      resetBall: () => this.resetBall(),
      rebuildHandleCaches: () => this.rebuildHandleCaches(),
      mapManager: this.mapManager,
      setGameMode: (mode) => { this.gameMode = mode },
    })
  }

  cycleAdventureTrack(direction: number): void { this.slotAdventure?.cycleAdventureTrack(direction) }
  startAdventureMode(): void { this.slotAdventure?.startAdventureMode() }

  async startSpectateReplay(replayId: string): Promise<boolean> {
    try {
      const { fetchReplay } = await import('../arcade/arcade-api')
      const raw = await fetchReplay(replayId)
      if (!raw) {
        this.showMessage('Replay payload not found', 3000)
        return false
      }
      await this.playReplay(raw)
      return true
    } catch (err) {
      console.warn('[Game] Failed to spectate replay:', err)
      this.showMessage('Failed to load replay payload', 3000)
      return false
    }
  }

  /**
   * Arm a stored / uploaded replay and start a game on its table: the ghost
   * is shown and every fixed step from here plays one tape frame. Spectate
   * and `scripts/verify-replay.mjs` both enter here, and live spectate with a
   * `streaming` tape that grows as the run is played (#444 Slice E).
   */
  async playReplay(raw: string | object, streaming = false): Promise<ReplayPayload> {
    // Uploads are compressed (`frames: []` + `compressedFrames`); decode the
    // tape, or spectate would play zero frames.
    const payload = ReplayRecorder.fromJSON(raw)
    if (!this.ghostBallRenderer && this.scene) {
      this.ghostBallRenderer = new GhostBallRenderer(this.scene)
    }

    this.replayRunner.load(payload, streaming)
    this.ghostBallRenderer?.show()
    if (!streaming) this.uiManager?.showMessage(`Watching Replay: ${payload.mapId} (Score: ${payload.finalScore.toLocaleString()})`, 4000)
    await this.lifecycle?.startGame()
    return payload
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
