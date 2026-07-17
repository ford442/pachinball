import {
  TargetCamera,
  Color3,
  HemisphericLight,
  Mesh,
  Scene,
  Vector3,
  MirrorTexture,
  RenderTargetTexture,
  DirectionalLight,
  PointLight,
  ShadowGenerator,
  TransformNode,
} from '@babylonjs/core'
import { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline'
import { SceneOptimizer } from '@babylonjs/core/Misc/sceneOptimizer'
import type { Engine } from '@babylonjs/core/Engines/engine'
import type { Nullable } from '@babylonjs/core/types'
import type { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine'
import type * as RAPIER from '@dimforge/rapier3d-compat'

import {
  GameState,
  PhysicsSystem,
  DisplaySystem,
  EffectsSystem,
  GameObjects,
  type CabinetType,
  BallManager,
  BallAnimator,
  AdventureMode,
  MagSpinFeeder,
  NanoLoomFeeder,
  PrismCoreFeeder,
  GaussCannonFeeder,
  QuantumTunnelFeeder,
  CameraController,
  CameraMode,
  QualityTier,
  SettingsManager,
  SURFACES,
  color,
  detectAccessibility,
  HapticManager,
  getSoundSystem,
  SoundSystem,
  getMapSystem,
  getLeaderboardSystem,
  getNameEntryDialog,
  getAdventureState,
  getLevelSelectScreen,
  ZoneTriggerSystem,
  getDynamicWorld,
  DebugHUD,
  EventBusLog,
  PerformanceMonitor,
  type AccessibilityConfig,
  AdventureGoalTracker,
  AdventureCinematicSystem,
  AdventureCinematicTriggers,
  AdventureUIStateManager,
  AdventureTrackProgression,
  AdventureProgressionSupervisor,
} from './game-elements'
import {
  SpinnerBumperBuilder,
  type SpinnerBumperVisual,
  BallTrapBuilder,
  type BallTrapState,
  LauncherBuilder,
  type LauncherState,
  MovingGateBuilder,
  type MovingGateState,
} from './objects'
import { BallStackVisual } from './game-elements/ball-stack-visual'
import { CabinetLighting } from './effects/cabinet-lighting'
import { CelebrationSequencer } from './effects/celebration-sequencer'
import { GameStateManager } from './game/game-state'
import { EventBus } from './game/event-bus'
import { GameInputManager } from './game/game-input'
import { TableMapManager } from './game/game-maps'
import { CabinetManager } from './game/game-cabinet'
import { GameUIManager } from './game/game-ui'
import { AdventureManager } from './game/game-adventure'
import { GameConfig, GAME_TUNING, BallType } from './config'

import { TABLE_MAPS } from './shaders/lcd-table'

import { GameRenderer, type RendererHost } from './game/game-renderer'
import { GameCabinetBuilder, type CabinetBuilderHost } from './game/game-cabinet-builder'
import { GameSceneBuilder, type SceneBuilderHost } from './game/game-scene-builder'
import { GamePhysicsController, type PhysicsHost } from './game/game-physics-controller'
import { GameInputActions, type InputActionsHost } from './game/game-input-actions'
import { GameScenario, type ScenarioHost } from './game/game-scenario'
import { GameSlotAdventure, type SlotAdventureHost } from './game/game-slot-adventure'
import { GameSettingsUI, type SettingsUIHost } from './game/game-settings-ui'
import { PhysicsTuningPanel, isPhysicsTuningQueryEnabled } from './game-elements/physics-tuning-panel'
import { GameDebug, type DebugHost } from './game/game-debug'
import { GameLifecycle, type LifecycleHost } from './game/game-lifecycle'
import { GameSystemsInitializer } from './game/game-systems-init'
import { GameDisposer } from './game/game-disposer'
import { GameHUD, type HUDHost } from './game/game-hud'
import { GameMapCabinet, type MapCabinetHost } from './game/game-map-cabinet'
import { CheckpointDebugController, type DebugStageKey } from './game/checkpoint-debug'
import { FreeMapTestMode } from './game/free-map-test-mode'
import { LevelLoader } from './game/level-loader'

export class Game {
  readonly engine: Engine | WebGPUEngine
  scene: Nullable<Scene> = null

  // Game Systems
  physics: PhysicsSystem
  display: DisplaySystem | null = null
  effects: EffectsSystem | null = null
  cabinetLighting: CabinetLighting | null = null
  celebrationSequencer: CelebrationSequencer | null = null
  gameObjects: GameObjects | null = null
  ballManager: BallManager | null = null
  ballAnimator: BallAnimator | null = null
  adventureMode: AdventureMode | null = null
  zoneTriggerSystem: ZoneTriggerSystem | null = null
  private magSpinFeeder: MagSpinFeeder | null = null
  private nanoLoomFeeder: NanoLoomFeeder | null = null
  private prismCoreFeeder: PrismCoreFeeder | null = null
  private gaussCannon: GaussCannonFeeder | null = null
  private quantumTunnel: QuantumTunnelFeeder | null = null
  inputManager: GameInputManager | null = null
  cameraController: CameraController | null = null
  mapManager: TableMapManager | null = null
  levelLoader: LevelLoader | null = null
  cabinetManager: CabinetManager | null = null
  uiManager: GameUIManager | null = null
  adventureManager: AdventureManager | null = null
  debugHUD: DebugHUD | null = null
  eventBusLog = new EventBusLog()
  physicsTuningPanel: PhysicsTuningPanel | null = null
  performanceMonitor = new PerformanceMonitor()
  hapticManager: HapticManager | null = null
  soundSystem!: SoundSystem
  leaderboardSystem = getLeaderboardSystem()
  nameEntryDialog = getNameEntryDialog()

  // New obstacle builders
  spinnerBuilder: SpinnerBumperBuilder | null = null
  ballTrapBuilder: BallTrapBuilder | null = null
  launcherBuilder: LauncherBuilder | null = null
  movingGateBuilder: MovingGateBuilder | null = null
  spinnerVisuals: SpinnerBumperVisual[] = []
  trapStates: BallTrapState[] = []
  launcherStates: LauncherState[] = []
  gateStates: MovingGateState[] = []

  // New adventure systems
  adventureGoalTracker: AdventureGoalTracker | null = null
  adventureCinematicSystem: AdventureCinematicSystem | null = null
  adventureCinematicTriggers: AdventureCinematicTriggers | null = null
  adventureUIStateManager: AdventureUIStateManager | null = null
  adventureTrackProgression: AdventureTrackProgression | null = null
  adventureProgressionSupervisor: AdventureProgressionSupervisor | null = null

  // Rendering
  bloomPipeline: DefaultRenderingPipeline | null = null
  postProcessDegraded = false
  sceneOptimizer: SceneOptimizer | null = null
  mirrorTexture: MirrorTexture | null = null
  tableRenderTarget: RenderTargetTexture | null = null
  headRenderTarget: RenderTargetTexture | null = null
  shadowGenerator: ShadowGenerator | null = null
  playfieldGroup: TransformNode | null = null

  // Scene lights
  keyLight: DirectionalLight | null = null
  rimLight: DirectionalLight | null = null
  bounceLight: PointLight | null = null
  tableCam: TargetCamera | null = null

  // Game State
  ready = false
  stateManager!: GameStateManager
  eventBus!: EventBus
  score = 0
  lives = 3
  comboCount = 0
  comboTimer = 0
  comboMultiplier = 1
  goldBallStack: Array<{ type: BallType; timestamp: number }> = []
  sessionGoldBalls = 0
  powerupActive = false
  powerupTimer = 0
  plungerChargeLevel = 0
  tiltActive = false
  nudgeState = { tiltWarnings: 0, lastNudgeTime: 0, tiltActive: false, tiltWarningActive: false }
  isCameraFollowMode = false
  cameraFollowTransition = 0
  readonly cameraFollowTransitionSpeed = GameConfig.visuals.cameraFollowTransitionSpeed

  // UI References
  scoreElement: HTMLElement | null = null
  menuOverlay: HTMLElement | null = null
  startScreen: HTMLElement | null = null
  gameOverScreen: HTMLElement | null = null
  pauseOverlay: HTMLElement | null = null
  finalScoreElement: HTMLElement | null = null

  // Quality tier
  qualityTier: QualityTier = QualityTier.MEDIUM

  // Map / Adventure
  mapSystem = getMapSystem()
  // Legacy level-select + cosmetic rewards; campaign truth is adventureTrackProgression.
  adventureState = getAdventureState()
  levelSelectScreen: ReturnType<typeof getLevelSelectScreen> | null = null
  dynamicWorld: ReturnType<typeof getDynamicWorld> | null = null
  ballStackVisual: BallStackVisual | null = null

  // Room
  roomMeshes: Mesh[] = []
  cabinetNeonLights: PointLight[] = []
  ambientRoomLight: HemisphericLight | null = null

  // Debug
  showDebugUI = false
  readonly debugHUDQueryEnabled = window.location.search.includes('debug=1')
  debugHUDEnabledInSettings = false
  physicsTuningEnabledInSettings = false
  adventureModeStartMs: number | null = null

  // Accessibility
  accessibility: AccessibilityConfig = detectAccessibility()

  // Game mode
  gameMode: 'fixed' | 'dynamic' = 'fixed'

  // Helpers
  renderer!: GameRenderer
  cabinetBuilder!: GameCabinetBuilder
  sceneBuilder!: GameSceneBuilder
  private systemsInitializer!: GameSystemsInitializer
  disposer!: GameDisposer
  physicsController!: GamePhysicsController
  inputActions!: GameInputActions
  scenarioManager!: GameScenario
  slotAdventure!: GameSlotAdventure
  settingsUI!: GameSettingsUI
  debugHelper!: GameDebug
  lifecycle!: GameLifecycle
  hud!: GameHUD
  mapCabinet!: GameMapCabinet
  freeMapTestMode: FreeMapTestMode | null = null
  checkpointDebug = new CheckpointDebugController()
  cosmeticSceneBuilt = false

  constructor(engine: Engine | WebGPUEngine, preloadedRapier?: typeof RAPIER) {
    this.engine = engine
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
        enabled: this.accessibility.hapticsEnabled,
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
    })

    await this.runCheckpointStage('core_helpers', () => {
      this.cabinetBuilder = new GameCabinetBuilder(this as unknown as CabinetBuilderHost)
      this.sceneBuilder = new GameSceneBuilder(this as unknown as SceneBuilderHost)
      this.inputActions = new GameInputActions(this as unknown as InputActionsHost)
      this.scenarioManager = new GameScenario(this as unknown as ScenarioHost)
      this.slotAdventure = new GameSlotAdventure(this as unknown as SlotAdventureHost)
      this.settingsUI = new GameSettingsUI(this as unknown as SettingsUIHost)
      this.physicsTuningPanel = new PhysicsTuningPanel()
      if (isPhysicsTuningQueryEnabled() || this.physicsTuningEnabledInSettings) {
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
      await this.settingsUI.setupMapSelector()

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
        onCabinetCycle: () => this.cabinetManager?.cycleCabinetPreset(),
        onCameraToggle: () => { this.isCameraFollowMode = !this.isCameraFollowMode },
        onLevelSelectToggle: () => this.toggleLevelSelect(),
        onLeaderboardToggle: () => this.leaderboardSystem.toggle(),
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

      scene.onBeforeRenderObservable.add(() => {
        this.performanceMonitor.frameStart()
        this.performanceMonitor.physicsStart()
        this.physicsController.stepPhysics(this.inputManager, this.inputActions)
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

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  startGame(): Promise<void> { return this.lifecycle.startGame() }
  switchTableMap(mapName: string): void { this.mapCabinet.switchTableMap(mapName) }
  loadCabinetPreset(type: CabinetType): void { this.mapCabinet.loadCabinetPreset(type) }
  cycleCabinetPreset(): void { this.mapCabinet.cycleCabinetPreset() }
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
        this.eventBusLog.setEnabled(true)
        this.performanceMonitor.setEnabled(true)
      },
      () => {
        this.eventBusLog.setEnabled(false)
        this.eventBusLog.clear()
      },
    )
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
    if (!this.levelSelectScreen) {
      this.levelSelectScreen = getLevelSelectScreen(
        {
          onLevelSelect: (level, mapType) => {
            this.mapCabinet.switchTableMap(mapType)
            this.adventureState.startLevel(level.id)
          },
          onClose: () => {},
        },
        this.adventureState
      )
    }
    this.levelSelectScreen.toggle()
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
