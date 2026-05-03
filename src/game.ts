import {
  ArcRotateCamera,
  Color3,
  HemisphericLight,
  MeshBuilder,
  Mesh,
  Scene,
  Vector3,
  MirrorTexture,
  Plane,
  StandardMaterial,
  PostProcess,
  Texture,
  RenderTargetTexture,
  DirectionalLight,
  PointLight,
  ShadowGenerator,
} from '@babylonjs/core'
import { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline'
import { SceneOptimizer } from '@babylonjs/core/Misc/sceneOptimizer'
import type { Engine } from '@babylonjs/core/Engines/engine'
import type { Nullable } from '@babylonjs/core/types'
import type { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine'
import type * as RAPIER from '@dimforge/rapier3d-compat'

import {
  GameState,
  DisplayState,
  PhysicsSystem,
  DisplaySystem,
  EffectsSystem,
  GameObjects,
  type CabinetType,
  BallManager,
  BallAnimator,
  AdventureMode,
  AdventureTrackType,
  MagSpinFeeder,
  NanoLoomFeeder,
  PrismCoreFeeder,
  GaussCannonFeeder,
  QuantumTunnelFeeder,
  CameraController,
  CameraMode,
  getMaterialLibrary,
  resetMaterialLibrary,
  QualityTier,
  SettingsManager,
  PALETTE,
  SURFACES,
  INTENSITY,
  color,
  emissive,
  detectAccessibility,
  HapticManager,
  getSoundSystem,
  getMapSystem,
  getLeaderboardSystem,
  getNameEntryDialog,
  getAdventureState,
  getLevelSelectScreen,
  ZoneTriggerSystem,
  getDynamicWorld,
  DebugHUD,
  type AccessibilityConfig,
} from './game-elements'
import { BallStackVisual } from './game-elements/ball-stack-visual'
import { GameStateManager } from './game/game-state'
import { EventBus } from './game/event-bus'
import { GameInputManager } from './game/game-input'
import { TableMapManager } from './game/game-maps'
import { CabinetManager } from './game/game-cabinet'
import { GameUIManager } from './game/game-ui'
import { AdventureManager } from './game/game-adventure'
import { GameConfig, GAME_TUNING, API_BASE, BallType } from './config'
import { adaptLegacyConfig, type DisplayConfig } from './game-elements/display-config'
import { TABLE_MAPS } from './shaders/lcd-table'

import { GameRenderer, type RendererHost } from './game/game-renderer'
import { GameCabinetBuilder, type CabinetBuilderHost } from './game/game-cabinet-builder'
import { GameSceneBuilder, type SceneBuilderHost } from './game/game-scene-builder'
import { GamePhysicsController, type PhysicsHost } from './game/game-physics-controller'
import { GameInputActions, type InputActionsHost } from './game/game-input-actions'
import { GameScenario, type ScenarioHost } from './game/game-scenario'
import { GameSlotAdventure, type SlotAdventureHost } from './game/game-slot-adventure'
import { GameSettingsUI, type SettingsUIHost } from './game/game-settings-ui'
import { GameDebug, type DebugHost } from './game/game-debug'
import { GameLifecycle, type LifecycleHost } from './game/game-lifecycle'
import { GameHUD, type HUDHost } from './game/game-hud'
import { GameMapCabinet, type MapCabinetHost } from './game/game-map-cabinet'
import { hexToColor3 } from './game/game-utils'

export class Game {
  private readonly engine: Engine | WebGPUEngine
  private scene: Nullable<Scene> = null

  // Game Systems
  private physics: PhysicsSystem
  private display: DisplaySystem | null = null
  private effects: EffectsSystem | null = null
  private gameObjects: GameObjects | null = null
  private ballManager: BallManager | null = null
  private ballAnimator: BallAnimator | null = null
  private adventureMode: AdventureMode | null = null
  zoneTriggerSystem: ZoneTriggerSystem | null = null
  private magSpinFeeder: MagSpinFeeder | null = null
  private nanoLoomFeeder: NanoLoomFeeder | null = null
  private prismCoreFeeder: PrismCoreFeeder | null = null
  private gaussCannon: GaussCannonFeeder | null = null
  private quantumTunnel: QuantumTunnelFeeder | null = null
  private inputManager: GameInputManager | null = null
  cameraController: CameraController | null = null
  mapManager: TableMapManager | null = null
  cabinetManager: CabinetManager | null = null
  uiManager: GameUIManager | null = null
  adventureManager: AdventureManager | null = null
  debugHUD: DebugHUD | null = null
  hapticManager: HapticManager | null = null
  soundSystem = getSoundSystem()
  leaderboardSystem = getLeaderboardSystem()
  nameEntryDialog = getNameEntryDialog()

  // Rendering
  private bloomPipeline: DefaultRenderingPipeline | null = null
  private sceneOptimizer: SceneOptimizer | null = null
  private mirrorTexture: MirrorTexture | null = null
  private tableRenderTarget: RenderTargetTexture | null = null
  private headRenderTarget: RenderTargetTexture | null = null
  private shadowGenerator: ShadowGenerator | null = null

  // Scene lights
  private keyLight: DirectionalLight | null = null
  private rimLight: DirectionalLight | null = null
  private bounceLight: PointLight | null = null
  private tableCam: ArcRotateCamera | null = null

  // Game State
  ready = false
  private stateManager!: GameStateManager
  eventBus!: EventBus
  score = 0
  lives = 3
  comboCount = 0
  comboTimer = 0
  goldBallStack: Array<{ type: BallType; timestamp: number }> = []
  sessionGoldBalls = 0
  powerupActive = false
  powerupTimer = 0
  plungerChargeLevel = 0
  tiltActive = false
  nudgeState = { tiltWarnings: 0, lastNudgeTime: 0, tiltActive: false, tiltWarningActive: false }
  isCameraFollowMode = false
  cameraFollowTransition = 0
  readonly cameraFollowTransitionSpeed = 3.0

  // UI References
  scoreElement: HTMLElement | null = null
  menuOverlay: HTMLElement | null = null
  startScreen: HTMLElement | null = null
  gameOverScreen: HTMLElement | null = null
  pauseOverlay: HTMLElement | null = null
  finalScoreElement: HTMLElement | null = null

  // LCD Table
  private lcdTablePostProcess: PostProcess | null = null

  // Quality tier
  private qualityTier: QualityTier = QualityTier.MEDIUM

  // Map / Adventure
  mapSystem = getMapSystem(API_BASE)
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
  adventureModeStartMs: number | null = null

  // Scanline
  scanlineIntensity = 0.12

  // Accessibility
  accessibility: AccessibilityConfig = detectAccessibility()

  // Game mode
  gameMode: 'fixed' | 'dynamic' = 'fixed'

  // Helpers
  private renderer!: GameRenderer
  private cabinetBuilder!: GameCabinetBuilder
  private sceneBuilder!: GameSceneBuilder
  private physicsController!: GamePhysicsController
  private inputActions!: GameInputActions
  private scenarioManager!: GameScenario
  private slotAdventure!: GameSlotAdventure
  private settingsUI!: GameSettingsUI
  private debugHelper!: GameDebug
  private lifecycle!: GameLifecycle
  private hud!: GameHUD
  private mapCabinet!: GameMapCabinet

  constructor(engine: Engine | WebGPUEngine, preloadedRapier?: typeof RAPIER) {
    this.engine = engine
    this.physics = new PhysicsSystem(preloadedRapier)
  }

  async init(): Promise<void> {
    if ('initAsync' in this.engine) {
      await this.engine.initAsync()
    }

    this.scene = new Scene(this.engine)
    this.scene.clearColor = color(SURFACES.VOID).toColor4(1)

    if (!this.accessibility?.reducedMotion) {
      this.scene.fogMode = Scene.FOGMODE_EXP2
      this.scene.fogColor = Color3.FromHexString('#050510')
      this.scene.fogDensity = 0.015
    } else {
      this.scene.fogMode = Scene.FOGMODE_NONE
    }

    // UI Bindings
    this.scoreElement = document.getElementById('score')
    this.menuOverlay = document.getElementById('menu-overlay')
    this.pauseOverlay = document.getElementById('pause-overlay')
    this.uiManager = new GameUIManager(this.scene)
    this.startScreen = document.getElementById('start-screen')
    this.gameOverScreen = document.getElementById('game-over-screen')
    this.finalScoreElement = document.getElementById('final-score')

    document.getElementById('start-btn')?.addEventListener('click', () => this.startGame())
    document.getElementById('restart-btn')?.addEventListener('click', () => this.startGame())

    try {
      const v = localStorage.getItem('pachinball.best')
      if (v) this.bestScore = Math.max(0, parseInt(v, 10) || 0)
    } catch {
      // Ignore localStorage errors
    }
    this.updateHUD()

    const settings = SettingsManager.load()
    this.debugHUDEnabledInSettings = settings.enableDebugHUD
    SettingsManager.applyToConfig(settings)
    this.accessibility = detectAccessibility()
    console.log('[Accessibility] Settings loaded:', settings, 'Accessibility:', this.accessibility)

    this.hapticManager = new HapticManager({
      enabled: this.accessibility.hapticsEnabled,
      intensity: this.accessibility.hapticIntensity,
    })

    // Initialize helpers
    this.renderer = new GameRenderer(this as unknown as RendererHost)
    this.renderer.setupCamera()
    this.renderer.setupPostProcessing()
    this.renderer.setupLighting()
    this.renderer.createRoomEnvironment()
    this.renderer.setupResizeObserver()
    this.renderer.setupDPRHandling()
    this.renderer.setupSceneOptimizer()

    this.cabinetBuilder = new GameCabinetBuilder(this as unknown as CabinetBuilderHost)
    this.sceneBuilder = new GameSceneBuilder(this as unknown as SceneBuilderHost)
    this.inputActions = new GameInputActions(this as unknown as InputActionsHost)
    this.scenarioManager = new GameScenario(this as unknown as ScenarioHost)
    this.slotAdventure = new GameSlotAdventure(this as unknown as SlotAdventureHost)
    this.settingsUI = new GameSettingsUI(this as unknown as SettingsUIHost)
    this.debugHelper = new GameDebug(this as unknown as DebugHost)
    this.lifecycle = new GameLifecycle(this as unknown as LifecycleHost)
    this.hud = new GameHUD(this as unknown as HUDHost)
    this.mapCabinet = new GameMapCabinet(this as unknown as MapCabinetHost)
    this.physicsController = new GamePhysicsController(this as unknown as PhysicsHost)

    this.settingsUI.setupSettingsUI()
    this.debugHelper.updateDeveloperSettingsVisibility()
    await this.settingsUI.setupMapSelector()

    // Event Bus and State Manager
    this.eventBus = new EventBus()
    this.stateManager = new GameStateManager({
      onStateChange: (oldState, newState) => {
        console.log(`[Game] State changed: ${GameState[oldState]} -> ${GameState[newState]}`)
      },
    })
    this.stateManager.setEventBus(this.eventBus)

    await this.physics.init()
    await this.buildSceneStaged()

    this.ballAnimator = new BallAnimator(this.scene)

    this.inputManager = new GameInputManager(this.scene, this.physics, {
      onFlipperLeft: (pressed) => this.inputActions.handleFlipperLeft(pressed),
      onFlipperRight: (pressed) => this.inputActions.handleFlipperRight(pressed),
      onPlunger: () => this.inputActions.handlePlunger(),
      onPlungerChargeStart: () => this.inputActions.startPlungerCharge(),
      onPlungerChargeRelease: (chargeLevel) => this.inputActions.releasePlungerCharge(chargeLevel),
      onPlungerChargeUpdate: (chargeLevel) => {
        this.inputActions.updatePlungerCharge(chargeLevel)
        this.inputActions.updatePlungerVisual(this.scene, chargeLevel)
      },
      onNudge: (direction) => this.physicsController.applyNudge(direction),
      onPause: () => this.lifecycle.togglePause(),
      onReset: () => this.lifecycle.resetBall(),
      onStart: () => this.lifecycle.startGame(),
      onAdventureToggle: () => this.toggleAdventure(),
      onTrackNext: () => this.slotAdventure.cycleAdventureTrack(1),
      onTrackPrev: () => this.slotAdventure.cycleAdventureTrack(-1),
      onJackpotTrigger: () => this.lifecycle.triggerJackpot(),
      onDebugHUD: () => {
        if (!this.debugHelper.isDebugHUDKeyboardEnabled()) return
        this.debugHUD?.toggle()
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
      getState: () => this.stateManager.getState(),
      getTiltActive: () => this.tiltActive,
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

    this.scene.onBeforeRenderObservable.add(() => {
      this.physicsController.stepPhysics(this.inputManager, this.inputActions)
    })

    this.engine.runRenderLoop(() => {
      this.settingsUI.updateLatencyDisplay(this.inputManager || undefined)
      this.scene?.render()
    })

    this.showDebugUI = new URLSearchParams(window.location.search).has('debug')
    if (this.showDebugUI) {
      this.inputManager?.enableLatencyTracking(true)
      this.settingsUI.setupLatencyOverlay()
    }

    this.ready = true
    this.stateManager.setSystems(this.effects, this.display)

    // Initialize adventure manager
    this.adventureManager = new AdventureManager(
      this.scene!,
      this.physics,
      this.stateManager,
      this.uiManager!,
      {
        effects: this.effects,
        display: this.display,
        ballManager: this.ballManager,
        soundSystem: this.soundSystem,
      },
      {
        onZoneEnter: (_zone, config, isMajor) => {
          this.effects?.updateEnvironmentColor?.(config.primaryColor)
          if (isMajor && this.hapticManager) {
            this.hapticManager.jackpot()
          }
        },
        onScoreAward: (points, reason) => {
          this.score += points
          this.updateHUD()
          this.uiManager?.showMessage(`${reason}: +${points}`, 1000)
          const pos = this.physicsController.getBallPosition()
          if (pos) this.effects?.spawnFloatingNumber(points, pos)
        },
        onAdventureEnd: () => {
          this.score += GAME_TUNING.scoring.adventureEndBonus
          this.updateHUD()
          this.effects?.startJackpotSequence()
          const pos = this.physicsController.getBallPosition()
          if (pos) this.effects?.spawnFloatingNumber(GAME_TUNING.scoring.adventureEndBonus, pos)
        },
      }
    )

    this.mapManager = new TableMapManager(this.scene!, {
      onMapChange: (_type, config) => {
        this.ballManager?.updateBallMaterialColor(config.baseColor)
        const matLib = getMaterialLibrary(this.scene!)
        matLib.updateFlipperMaterialEmissive(config.baseColor)
        matLib.updatePinMaterialEmissive(config.baseColor)
        matLib.updateBrushedMetalMaterialEmissive(config.baseColor)
        matLib.updateChromeMaterialEmissive(config.baseColor)
        this.gameObjects?.updateBumperColors(config.baseColor)
        this.effects?.setCabinetColor(config.baseColor)
        this.cabinetBuilder.updateCabinetLightingForMap()
      },
      onPopupShow: (name, color) => this.mapCabinet.showMapNamePopup(name, color),
      onMapSelectorUpdate: () => this.settingsUI.updateMapSelectorUI(),
    })
    this.mapManager.setBloomPipeline()

    this.cabinetManager = new CabinetManager(this.scene!, {
      onPopupShow: (name) => this.mapCabinet.showCabinetPopup(name),
      onUISelect: () => this.mapCabinet.updateCabinetSelectorUI(),
    })

    this.stateManager.setState(GameState.MENU)
  }

  private async buildSceneStaged(): Promise<void> {
    if (!this.scene) throw new Error('Scene not ready')
    const world = this.physics.getWorld()
    const rapier = this.physics.getRapier()
    if (!world || !rapier) throw new Error('Physics not ready')

    this.uiManager?.showLoadingState(true)

    const skybox = MeshBuilder.CreateBox('skybox', { size: 200.0 }, this.scene)
    const skyboxMaterial = new StandardMaterial('skyBox', this.scene)
    skyboxMaterial.backFaceCulling = false
    skyboxMaterial.diffuseColor = Color3.Black()
    skyboxMaterial.specularColor = Color3.Black()
    skyboxMaterial.emissiveColor = emissive(PALETTE.AMBIENT, INTENSITY.AMBIENT)
    skybox.material = skyboxMaterial

    const mirrorSize = this.qualityTier === QualityTier.HIGH ? 2048 : 1024
    this.mirrorTexture = new MirrorTexture('mirror', mirrorSize, this.scene, true)
    this.mirrorTexture.mirrorPlane = new Plane(0, -1, 0, -1.01)
    this.mirrorTexture.level = 0.6

    this.effects = new EffectsSystem(this.scene, this.bloomPipeline, this.accessibility)
    if (this.keyLight && this.rimLight && this.bounceLight) {
      this.effects.registerSceneLights(this.keyLight, this.rimLight, this.bounceLight)
    }
    const displayConfig: DisplayConfig = adaptLegacyConfig(GameConfig.backbox)
    this.display = new DisplaySystem(this.scene, this.engine, displayConfig)
    this.display.subscribeToEvents(this.eventBus)
    this.stateManager.setDisplaySystem(this.display)

    this.debugHUD = new DebugHUD({
      onVisibilityChange: (visible) => this.debugHelper.handleDebugHUDVisibilityChange(visible),
    })
    this.debugHUD.setUpdateCadenceHz(4)
    if (this.debugHUDEnabledInSettings && this.debugHelper.isDebugHUDAvailable()) {
      this.debugHUD.show()
    }

    this.dynamicWorld = getDynamicWorld(this.scene, this.tableCam!, this.display, this.soundSystem)
    this.ballStackVisual = new BallStackVisual(this.scene)

    this.adventureState.setDisplay(this.display)
    this.adventureState.onLevelCompleteCallback((level) => {
      console.log(`[Game] Level complete: ${level.name}`)
      if (level.rewards.unlockMap) {
        setTimeout(() => { this.mapCabinet.switchTableMap(level.rewards.unlockMap!) }, GAME_TUNING.timing.storyVideoWaitMs)
      }
    })
    this.adventureState.onGoalUpdateCallback((goals) => {
      const goalText = goals.map(g => `${g.description}: ${g.current}/${g.target}`).join('\n')
      this.display?.setStoryText(goalText)
    })

    this.slotAdventure.setupSlotMachineCallbacks()
    this.setupFeederEventHandlers()

    this.gameObjects = new GameObjects(this.scene, world, rapier, GameConfig)
    this.ballManager = new BallManager(this.scene, world, rapier, this.gameObjects.getBindings())
    this.ballManager.setOnGoldBallCollected((type, points) => {
      console.log(`[Game] Gold ball collected: ${type}, points: ${points}`)
    })
    this.adventureMode = new AdventureMode(this.scene, world, rapier)

    this.adventureMode.setEventListener((event, data) => {
      console.log(`Adventure Event: ${event}`)
      switch (event) {
        case 'START': {
          const trackType = data as AdventureTrackType | undefined
          this.adventureManager?.startAdventure(trackType)
          this.eventBus.emit('adventure:start')
          this.eventBus.emit('display:set', DisplayState.ADVENTURE)
          const trackName = trackType ? this.slotAdventure.getTrackDisplayName(trackType) : 'UNKNOWN SECTOR'
          this.display?.setTrackInfo(trackName)
          this.display?.setStoryText(`ENTERING: ${trackName}`)
          this.effects?.setLightingMode('reach', 0.5)
          this.effects?.setAtmosphereState('ADVENTURE')
          break
        }
        case 'END':
          this.adventureManager?.endAdventure()
          this.eventBus.emit('adventure:end')
          this.eventBus.emit('display:set', DisplayState.IDLE)
          this.effects?.setLightingMode('normal', 1.0)
          this.effects?.setAtmosphereState('IDLE')
          this.effects?.playBeep(440)
          break
        case 'ZONE_ENTER': {
          const zoneData = data as {
            zone: AdventureTrackType
            previousZone: AdventureTrackType | null
            isMajor: boolean
            ballPosition?: Vector3
          }
          this.scenarioManager.handleZoneTransition(zoneData.zone, zoneData.previousZone, zoneData.isMajor)
          break
        }
      }
    })

    this.sceneBuilder.buildCriticalScene()
    this.initLCDTablePostProcess()
    this.ready = true
    this.uiManager?.showLoadingState(false, 'gameplay')

    await this.sceneBuilder.yieldFrame()
    this.sceneBuilder.buildGameplayScene()
    this.physicsController.rebuildHandleCaches()
    this.uiManager?.showLoadingState(false, 'cosmetic')

    if ('requestIdleCallback' in window) {
      requestIdleCallback(() => this.sceneBuilder.buildCosmeticScene(), { timeout: 500 })
    } else {
      setTimeout(() => this.sceneBuilder.buildCosmeticScene(), 100)
    }
  }

  private setupFeederEventHandlers(): void {
    if (!this.effects || !this.ballManager || !this.scene) return
    this.magSpinFeeder = new MagSpinFeeder(this.scene, this.physics.getWorld()!, this.physics.getRapier()!, GameConfig.magSpin)
    this.nanoLoomFeeder = new NanoLoomFeeder(this.scene, this.physics.getWorld()!, this.physics.getRapier()!, GameConfig.nanoLoom)
    this.prismCoreFeeder = new PrismCoreFeeder(this.scene, this.physics.getWorld()!, this.physics.getRapier()!, GameConfig.prismCore)
    this.gaussCannon = new GaussCannonFeeder(this.scene, this.physics.getWorld()!, this.physics.getRapier()!, GameConfig.gaussCannon)
    this.quantumTunnel = new QuantumTunnelFeeder(this.scene, this.physics.getWorld()!, this.physics.getRapier()!, GameConfig.quantumTunnel)
    this.adventureManager?.setFeeders({
      magSpin: this.magSpinFeeder,
      nanoLoom: this.nanoLoomFeeder,
      prismCore: this.prismCoreFeeder,
      gaussCannon: this.gaussCannon,
      quantumTunnel: this.quantumTunnel,
    })
    this.adventureManager?.updateSystems({
      effects: this.effects,
      display: this.display,
      ballManager: this.ballManager,
      soundSystem: this.soundSystem,
    })
    this.adventureManager?.setupFeederEventHandlers()
  }

  private initLCDTablePostProcess(): void {
    if (!this.scene || !this.tableCam) return
    this.lcdTablePostProcess = new PostProcess(
      'lcdTable',
      'lcdTable',
      [
        'uBaseColor', 'uAccentColor', 'uScanlineIntensity', 'uPixelGridIntensity',
        'uSubpixelIntensity', 'uGlowIntensity', 'uMapBlend', 'uTime',
        'uFlashIntensity', 'uRippleIntensity', 'uRippleTime',
      ],
      null,
      1.0,
      this.tableCam,
      Texture.BILINEAR_SAMPLINGMODE,
      this.engine
    )
    this.lcdTablePostProcess.onApply = (effect) => {
      const config = this.mapManager?.getLCDTableState().getCurrentConfig()
      if (!config) return
      const baseColor = hexToColor3(config.baseColor)
      const accentColor = hexToColor3(config.accentColor)
      effect.setColor3('uBaseColor', baseColor)
      effect.setColor3('uAccentColor', accentColor)
      effect.setFloat('uScanlineIntensity', config.scanlineIntensity)
      effect.setFloat('uPixelGridIntensity', config.pixelGridIntensity)
      effect.setFloat('uSubpixelIntensity', config.subpixelIntensity)
      effect.setFloat('uGlowIntensity', config.glowIntensity)
      effect.setFloat('uMapBlend', 0.5)
      effect.setFloat('uTime', performance.now() * 0.001)
      effect.setFloat('uFlashIntensity', this.mapManager?.getLCDTableState().flashIntensity || 0)
      effect.setFloat('uRippleIntensity', this.mapManager?.getLCDTableState().rippleIntensity || 0)
      effect.setFloat('uRippleTime', performance.now() * 0.001)
    }
    console.log('[Game] LCD table post-process initialized')
  }

  dispose(): void {
    this.sceneOptimizer?.dispose()
    this.sceneOptimizer = null
    this.inputManager?.dispose()
    this.debugHUD?.dispose()
    this.debugHUD = null
    this.uiManager?.dispose()
    this.adventureManager?.dispose()
    this.renderer?.dispose()
    this.cabinetBuilder = null as any
    this.sceneBuilder = null as any
    this.physicsController = null as any
    this.inputActions = null as any
    this.scenarioManager = null as any
    this.slotAdventure = null as any
    this.settingsUI = null as any
    this.debugHelper = null as any
    this.lifecycle = null as any
    this.hud = null as any
    this.mapCabinet = null as any
    this.leaderboardSystem.stop()
    this.leaderboardSystem.dispose()
    this.bloomPipeline?.dispose()
    this.bloomPipeline = null
    this.mirrorTexture?.dispose()
    this.mirrorTexture = null
    this.tableRenderTarget?.dispose()
    this.tableRenderTarget = null
    this.headRenderTarget?.dispose()
    this.headRenderTarget = null
    this.shadowGenerator?.dispose()
    this.shadowGenerator = null
    this.ballAnimator?.dispose()
    this.ballAnimator = null
    this.ballStackVisual?.dispose()
    this.ballStackVisual = null
    this.effects?.dispose()
    this.effects = null
    resetMaterialLibrary()
    this.scene?.dispose()
    this.scene = null
    this.physics.dispose()
    this.ready = false
    console.log('[Game] Disposed all resources')
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

  // --------------------------------------------------------------------------
  // Wrapper methods (called by helpers)
  // --------------------------------------------------------------------------

  bestScore = 0

  setGameState(state: GameState): void { this.lifecycle.setGameState(state) }
  getCameraMode(): CameraMode { return this.lifecycle.getCameraMode() }
  togglePause(): void { this.lifecycle.togglePause() }
  resetBall(): void { this.ballManager?.resetBall(); this.applyEquippedRewards(); this.updateHUD() }
  triggerJackpot(): void { this.lifecycle.triggerJackpot() }
  updateHUD(): void { this.hud.updateHUD() }
  updateGoldBallDisplay(): void { this.hud.updateGoldBallDisplay() }
  showMessage(msg: string, duration: number): void { this.uiManager?.showMessage(msg, duration) }
  getBallPosition(): Vector3 | null { return this.physicsController.getBallPosition() }
  endAdventureMode(): void { this.slotAdventure.endAdventureMode() }
  tryActivateSlotMachine(): void { this.slotAdventure.tryActivateSlotMachine() }
  rebuildHandleCaches(): void { this.physicsController.rebuildHandleCaches() }
  handleDebugHUDVisibilityChange(visible: boolean): void { this.debugHelper.handleDebugHUDVisibilityChange(visible) }
  isDebugHUDAvailable(): boolean { return this.debugHelper.isDebugHUDAvailable() }
  isDebugHUDKeyboardEnabled(): boolean { return this.debugHelper.isDebugHUDKeyboardEnabled() }
  initializeDynamicZones(mapName: string, mapConfig: typeof TABLE_MAPS[string]): void { this.scenarioManager.initializeDynamicZones(mapName, mapConfig) }
  updateCabinetLightingForMap(): void { this.cabinetBuilder.updateCabinetLightingForMap() }

  // --------------------------------------------------------------------------
  // Input / Gameplay delegates
  // --------------------------------------------------------------------------

  handleFlipperLeft(pressed: boolean): void { this.inputActions.handleFlipperLeft(pressed) }
  handleFlipperRight(pressed: boolean): void { this.inputActions.handleFlipperRight(pressed) }
  handlePlunger(): void { this.inputActions.handlePlunger() }
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
