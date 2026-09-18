import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Scene } from '@babylonjs/core/scene'
import type { Engine } from '@babylonjs/core/Engines/engine'
import type { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine'
import type * as RAPIER from '@dimforge/rapier3d-compat'

import { GameState, PhysicsSystem, BallAnimator, SettingsManager, SURFACES, color, detectAccessibility, HapticManager, getSoundSystem } from './game-elements'
import { MagSpinFeeder, NanoLoomFeeder, PrismCoreFeeder, GaussCannonFeeder, QuantumTunnelFeeder } from './objects/feeders'
import { GameStateManager } from './game/game-state'
import { EventBus } from './core/event-bus'
import { GameInputManager } from './game/game-input'
import { GameUIManager } from './game/game-ui'
import { GameConfig, GAME_TUNING } from './config'


import { GameRenderer, type RendererHost } from './game/game-renderer'
import { GameCabinetBuilder, type CabinetBuilderHost } from './game/game-cabinet-builder'
import { GameSceneBuilder, type SceneBuilderHost } from './game/game-scene-builder'
import { GamePhysicsController, type PhysicsHost } from './game/game-physics-controller'
import { GameInputActions, type InputActionsHost } from './game/game-input-actions'
import { GameScenario, type ScenarioHost } from './game/game-scenario'
import { GameSlotAdventure, type SlotAdventureHost } from './game/game-slot-adventure'
import { GameSettingsUI, type SettingsUIHost } from './game/game-settings-ui'
import { PhysicsTuningPanel, isPhysicsTuningEnabled } from './game-elements/physics-tuning-panel'
import { GameDebug, type DebugHost } from './game/game-debug'
import { GameLifecycle, type LifecycleHost } from './game/game-lifecycle'
import { GameSystemsInitializer } from './game/game-systems-init'
import { GameDisposer } from './game/game-disposer'
import { GameHUD, type HUDHost } from './game/game-hud'
import { GameMapCabinet, type MapCabinetHost } from './game/game-map-cabinet'
import { CheckpointDebugController, type DebugStageKey } from './game/checkpoint-debug'
import { GameDelegates } from './game/game-delegates'

export class Game extends GameDelegates {
  constructor(engine: Engine | WebGPUEngine, preloadedRapier?: typeof RAPIER) {
    super(engine)
    this.physics = new PhysicsSystem(preloadedRapier)
  }

  async init(): Promise<void> {
    if ('initAsync' in this.engine) {
      await this.engine.initAsync()
    }

    const scene = new Scene(this.engine)
    this.scene = scene
    scene.clearColor = color(SURFACES.VOID).toColor4(1)

    if (!this.accessibility?.reducedMotion) {
      scene.fogMode = Scene.FOGMODE_EXP2
      scene.fogColor = Color3.FromHexString('#050510')
      scene.fogDensity = GameConfig.visuals.fogDensity
    } else {
      scene.fogMode = Scene.FOGMODE_NONE
    }

    this.checkpointDebug = new CheckpointDebugController()

    await this.runCheckpointStage('settings_ui', async () => {
      this.scoreElement = document.getElementById('score')
      this.menuOverlay = document.getElementById('menu-overlay')
      this.pauseOverlay = document.getElementById('pause-overlay')
      this.uiManager = new GameUIManager(scene)
      this.startScreen = document.getElementById('start-screen')
      this.gameOverScreen = document.getElementById('game-over-screen')
      this.finalScoreElement = document.getElementById('final-score')

      document.getElementById('start-btn')?.addEventListener('click', () => { void this.lifecycle?.startGame() })
      document.getElementById('restart-btn')?.addEventListener('click', () => { void this.lifecycle?.startGame() })
      this.uiManager?.setStartButtonEnabled(false)
      const { bindDailyCascadeUI } = await import('./game/daily-cascade-ui')
      bindDailyCascadeUI({
        getCampaignStageName: () =>
          this.adventureTrackProgression?.getCurrentTrackInfo()?.name ?? 'Neon Helix',
      })

      try {
        const v = localStorage.getItem('pachinball.best')
        if (v) this.bestScore = Math.max(0, parseInt(v, 10) || 0)
      } catch {
        // Ignore localStorage errors
      }

      const settings = SettingsManager.load()
      this.debugHUDEnabledInSettings = settings.enableDebugHUD
      this.physicsTuningEnabledInSettings = settings.enablePhysicsTuning
      this.scanlineEnabled = settings.scanlineEnabled
      SettingsManager.applyToConfig(settings)
      this.accessibility = detectAccessibility({
        reducedMotion: settings.reducedMotion,
        photosensitiveMode: settings.photosensitiveMode,
      })
      console.log('[Accessibility] Settings loaded:', settings, 'Accessibility:', this.accessibility)

      this.hapticManager = new HapticManager({
        enabled: settings.hapticsEnabled && this.accessibility.hapticsEnabled,
        intensity: this.accessibility.hapticIntensity,
      })
    })

    await this.runCheckpointStage('render_bootstrap', () => {
      this.renderer = new GameRenderer(this as unknown as RendererHost)
      this.renderer.setupCamera()
      this.renderer.setupPostProcessing()
      this.renderer.setupLighting()
      this.renderer.createRoomEnvironment()
      this.renderer.setupResizeObserver()
      this.renderer.setupDPRHandling()
      this.renderer.setupSceneOptimizer()

      // One-shot auto quality drop when avg frame time stays >22ms for 2s (#300)
      this.performanceMonitor.setOnSustainedJank(() => {
        const before = this.qualityTier
        const after = this.renderer.dropQualityTierOnce()
        if (after !== before) {
          this.uiManager?.showMessage('Graphics reduced for performance', 3000)
          console.warn(`[Perf] Auto quality drop: ${before} → ${after}`)
        }
      })
    })

    await this.runCheckpointStage('core_helpers', () => {
      this.cabinetBuilder = new GameCabinetBuilder(this as unknown as CabinetBuilderHost)
      this.sceneBuilder = new GameSceneBuilder(this as unknown as SceneBuilderHost)
      this.inputActions = new GameInputActions(this as unknown as InputActionsHost)
      this.scenarioManager = new GameScenario(this as unknown as ScenarioHost)
      this.slotAdventure = new GameSlotAdventure(this as unknown as SlotAdventureHost)
      this.settingsUI = new GameSettingsUI(this as unknown as SettingsUIHost)
      if (isPhysicsTuningEnabled(this.physicsTuningEnabledInSettings)) {
        this.physicsTuningPanel = new PhysicsTuningPanel()
        this.physicsTuningPanel.show()
      }
      this.debugHelper = new GameDebug(this as unknown as DebugHost)
      this.lifecycle = new GameLifecycle(this as unknown as LifecycleHost)
      this.hud = new GameHUD(this as unknown as HUDHost)
      this.mapCabinet = new GameMapCabinet(this as unknown as MapCabinetHost)
      this.updateHUD()

      this.settingsUI.setupSettingsUI()
      this.debugHelper.updateDeveloperSettingsVisibility()
    })

    await this.runCheckpointStage('state_setup', async () => {
      this.soundSystem = getSoundSystem()
      this.settingsUI.setupMapSelector()

      this.eventBus = new EventBus()
      getSoundSystem(this.eventBus)
      this.stateManager = new GameStateManager({
        onStateChange: (oldState, newState) => {
          console.log(`[Game] State changed: ${GameState[oldState]} -> ${GameState[newState]}`)
        },
      })
      this.stateManager.setEventBus(this.eventBus)
      this.physicsController = new GamePhysicsController(this as unknown as PhysicsHost)
    })

    await this.runCheckpointStage('physics', () => this.physics.init())
    this.systemsInitializer = new GameSystemsInitializer(this)
    this.disposer = new GameDisposer(this)
    await this.systemsInitializer.initAll()

    this.ballAnimator = new BallAnimator(scene)

    await this.runCheckpointStage('input_runtime', () => {
      // Provide scene reference so the per-frame plunger animation can find meshes by name
      this.inputActions.setScene(scene)
      this.inputManager = new GameInputManager(scene, this.physics, {
        onFlipperLeft: (pressed) => this.inputActions.handleFlipperLeft(pressed),
        onFlipperRight: (pressed) => this.inputActions.handleFlipperRight(pressed),
        onPlunger: () => {
          const didLaunch = this.inputActions.handlePlunger()
          if (didLaunch) {
            this.eventBus?.emit('ball:launched')
            this.ballManager?.startBallSaveGraceWindow()
          }
        },
        onPlungerChargeStart: () => this.inputActions.startPlungerCharge(),
        onPlungerChargeRelease: (chargeLevel) => this.inputActions.releasePlungerCharge(chargeLevel),
        onPlungerChargeUpdate: (chargeLevel) => {
          this.inputActions.updatePlungerCharge(chargeLevel)
          this.inputActions.updatePlungerVisual(scene, chargeLevel)
        },
        onNudge: (direction) => this.physicsController.applyNudge(direction),
        onPause: () => this.lifecycle.togglePause(),
        onReset: () => this.resetBall(),
        onStart: () => this.lifecycle.startGame(),
        onAdventureToggle: () => this.toggleAdventure(),
        onTrackNext: () => this.slotAdventure.cycleAdventureTrack(1),
        onTrackPrev: () => this.slotAdventure.cycleAdventureTrack(-1),
        onJackpotTrigger: () => this.lifecycle.triggerJackpot(),
        onDebugHUD: () => {
          if (!this.debugHelper.isDebugHUDKeyboardEnabled()) return
          this.debugHUD?.toggle()
        },
        onForceSlotSpin: () => {
          if (!this.debugHelper.isDebugHUDAvailable()) return
          this.slotAdventure.forceSlotSpin()
        },
        onMapSwitch: (index) => {
          const maps = this.mapManager?.getMapSystem().getMapIds() || []
          if (index >= 0 && index < maps.length) {
            this.mapManager?.switchTableMap(maps[index])
          }
        },
        onMapCycle: () => this.mapManager?.cycleTableMap(),
        onCabinetCycle: () => { void this.cabinetManager?.cycleCabinetPreset() },
        onCameraToggle: () => { this.isCameraFollowMode = !this.isCameraFollowMode },
        onLevelSelectToggle: () => this.toggleLevelSelect(),
        onLeaderboardToggle: () => {
          void this.ensureOverlaySystems().then(() => this.leaderboardSystem.toggle())
        },
        onDynamicModeToggle: () => this.scenarioManager.toggleDynamicMode(),
        onScenarioCycle: () => this.scenarioManager.cycleScenario(),
        onPerfMonitorToggle: () => this.togglePerformanceMonitor(),
        onFreeMapTestToggle: () => this.toggleFreeMapTestMode(),
        getState: () => this.stateManager.getState(),
        getTiltActive: () => this.tiltActive,
        getAdventureActive: () => this.adventureMode?.isActive() ?? false,
      })

      this.inputManager.configurePlungerCharge({
        maxChargeTime: GameConfig.plunger.maxChargeTime,
        minImpulse: GameConfig.plunger.minImpulse,
        maxImpulse: GameConfig.plunger.maxImpulse,
      })

      this.inputManager.setupGamepad({
        deadZone: 0.15,
        vibrationEnabled: !this.accessibility.reducedMotion,
      })

      const touchLeftBtn = document.getElementById('touch-left')
      const touchRightBtn = document.getElementById('touch-right')
      const touchPlungerBtn = document.getElementById('touch-plunger')
      const touchNudgeBtn = document.getElementById('touch-nudge')
      this.inputManager.setupTouchControls(touchLeftBtn, touchRightBtn, touchPlungerBtn, touchNudgeBtn)

      const urlParams = new URLSearchParams(window.location.search)
      const replayParam = urlParams.get('replay')
      if (replayParam) {
        void this.startSpectateReplay(replayParam)
      }

      scene.onBeforeRenderObservable.add(() => {
        this.performanceMonitor.frameStart()
        this.performanceMonitor.physicsStart()
        this.physicsController.stepPhysics(this.inputManager, this.inputActions, this.replayRunner, this.replayRecorder)
        this.performanceMonitor.physicsEnd()
        this.settingsUI.updatePhysicsDebugRenderer()
      })

      this.engine.runRenderLoop(() => this.renderFrame())

      this.showDebugUI = new URLSearchParams(window.location.search).has('debug')
      if (this.showDebugUI) {
        this.inputManager?.enableLatencyTracking(true)
        this.settingsUI.setupLatencyOverlay()
      }
    })

    this.ready = true
    this.stateManager.setSystems(this.effects, this.display)

    await this.systemsInitializer.postInitManagers()

    this.lifecycle.setGameState(GameState.MENU)
  }

  /** Per-frame render loop body — also used by VisibilityManager on tab resume. */
  renderFrame(): void {
    this.settingsUI.updateLatencyDisplay(this.inputManager || undefined)
    this.scene?.render()
    const dt = this.engine.getDeltaTime() / 1000
    this.cabinetLighting?.update(dt)

    for (const visual of this.spinnerVisuals) {
      this.spinnerBuilder?.updateSpinner(visual, dt)
    }
    for (const state of this.trapStates) {
      this.ballTrapBuilder?.updateTrap(state, dt)
    }
    for (const state of this.launcherStates) {
      this.launcherBuilder?.updateLauncher(state, dt)
    }
    for (const state of this.gateStates) {
      this.movingGateBuilder?.updateGate(state, dt)
    }

    this.adventureCinematicSystem?.update(dt)
    this.adventureCinematicTriggers?.update()
    this.adventureUIStateManager?.updateAnimations(dt)
    this.adventureGoalTracker?.update(dt)
    this.adventureProgressionSupervisor?.update(dt, this.score)
    if (this.adventureMode?.isActive() && this.adventureGoalTracker && this.adventureProgressionSupervisor) {
      this.adventureGoalTracker.syncTrackScore(
        this.adventureProgressionSupervisor.getScoreDelta(this.score),
      )
      this.updateHUD()
    }

    if (this.adventureProgressionSupervisor && this.adventureProgressionSupervisor.getTimeRemaining() > 0) {
      const trackInfo = this.adventureTrackProgression?.getCurrentTrackInfo()
      if (trackInfo) {
        this.uiManager?.updateCountdownTimer(
          this.adventureProgressionSupervisor.getTimeRemaining(),
          trackInfo.timeLimitSeconds,
        )
      }
    }

    const drawCallsCounter = (this.engine as unknown as { _drawCalls?: { current?: number } })._drawCalls
    this.performanceMonitor.updateEngineMetrics(
      drawCallsCounter?.current ?? 0,
      this.physics.getActiveBodyCount(),
    )
    this.performanceMonitor.setParticleCount(this.effects?.getActiveParticleCount() ?? 0)
    this.performanceMonitor.setGoldBallCount(this.ballManager?.getGoldBallCount() ?? 0)
    this.performanceMonitor.frameEnd()

    if (this.debugHUD?.isHUDVisible()) {
      this.debugHUD.update(this.debugHelper.buildDebugSnapshot(dt, this.lives))
      this.debugHUD.updatePanel('EventBus', this.eventBusLog.getPanelData())
    }

    const perfMetrics = this.performanceMonitor.getMetrics()
    if (perfMetrics.suggestedFallback && this.effects?.getRuntimePerformanceTier() === 'high') {
      this.effects.forcePerformanceTierReview()
    }
  }


  public async runCheckpointStage(
    stage: DebugStageKey,
    init: () => void | Promise<void>,
    optional = false,
  ): Promise<boolean> {
    if (!this.checkpointDebug.isStageEnabled(stage)) {
      this.checkpointDebug.markStageSkipped(stage)
      return false
    }
    try {
      await this.checkpointDebug.runStage(stage, init)
      return true
    } catch (error) {
      if (optional) {
        console.warn(`[Game] Optional stage "${stage}" failed; continuing`, error)
        return false
      }
      throw error
    }
  }

  public scheduleCosmeticSceneBuild(): void {
    if (!this.checkpointDebug.isStageEnabled('scene_cosmetic')) {
      this.checkpointDebug.markStageSkipped('scene_cosmetic')
      return
    }
    if (this.cosmeticSceneBuilt) {
      return
    }
    const buildCosmetic = () => {
      if (this.cosmeticSceneBuilt) return
      void this.runCheckpointStage('scene_cosmetic', () => {
        this.sceneBuilder.buildCosmeticScene()
        this.cosmeticSceneBuilt = true
      }, true)
    }
    if ('requestIdleCallback' in window) {
      requestIdleCallback(buildCosmetic, { timeout: GAME_TUNING.timing.idleCallbackTimeoutMs })
    } else {
      setTimeout(buildCosmetic, GAME_TUNING.timing.cosmeticFallbackDelayMs)
    }
  }

  public setupFeederEventHandlers(): void {
    if (!this.effects || !this.ballManager || !this.scene) return
    this.magSpinFeeder = new MagSpinFeeder(this.scene, this.physics.getWorld()!, this.physics.getRapier()!, GameConfig.magSpin)
    this.nanoLoomFeeder = new NanoLoomFeeder(this.scene, this.physics.getWorld()!, this.physics.getRapier()!, GameConfig.nanoLoom)
    this.prismCoreFeeder = new PrismCoreFeeder(this.scene, this.physics.getWorld()!, this.physics.getRapier()!, GameConfig.prismCore)
    void this.magSpinFeeder.loadInsertGltf(this.qualityTier)
    void this.nanoLoomFeeder.loadInsertGltf(this.qualityTier)
    void this.prismCoreFeeder.loadInsertGltf(this.qualityTier)
    this.gaussCannon = new GaussCannonFeeder(this.scene, this.physics.getWorld()!, this.physics.getRapier()!, GameConfig.gaussCannon)
    this.quantumTunnel = new QuantumTunnelFeeder(this.scene, this.physics.getWorld()!, this.physics.getRapier()!, GameConfig.quantumTunnel)
  }

  /** Wire feeder callbacks after AdventureManager is ready (postInitManagers). */
  public wireFeederEventHandlers(): void {
    this.adventureManager?.setFeeders({
      ...(this.magSpinFeeder ? { magSpin: this.magSpinFeeder } : {}),
      ...(this.nanoLoomFeeder ? { nanoLoom: this.nanoLoomFeeder } : {}),
      ...(this.prismCoreFeeder ? { prismCore: this.prismCoreFeeder } : {}),
      ...(this.gaussCannon ? { gaussCannon: this.gaussCannon } : {}),
      ...(this.quantumTunnel ? { quantumTunnel: this.quantumTunnel } : {}),
    })
    this.adventureManager?.updateSystems({
      effects: this.effects,
      display: this.display,
      ballManager: this.ballManager,
      soundSystem: this.soundSystem,
    })
    this.adventureManager?.setupFeederEventHandlers()
  }

  dispose(): void {
    this.disposer.disposeAll()
  }
}
