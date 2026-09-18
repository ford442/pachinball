import { TargetCamera } from '@babylonjs/core/Cameras/targetCamera'
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight'
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight'
import { PointLight } from '@babylonjs/core/Lights/pointLight'
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator'
import { MirrorTexture } from '@babylonjs/core/Materials/Textures/mirrorTexture'
import { RenderTargetTexture } from '@babylonjs/core/Materials/Textures/renderTargetTexture'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { Scene } from '@babylonjs/core/scene'
import { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline'
import { SceneOptimizer } from '@babylonjs/core/Misc/sceneOptimizer'
import type { Engine } from '@babylonjs/core/Engines/engine'
import type { Nullable } from '@babylonjs/core/types'
import type { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine'

import { PhysicsSystem, BallManager, ReplayRecorder, ReplayRunner, GhostBallRenderer, BallAnimator, CameraController, QualityTier, detectAccessibility, HapticManager, SoundSystem, getMapSystem, ZoneTriggerSystem, getDynamicWorld, DebugHUD, EventBusLog, PerformanceMonitor, type AccessibilityConfig } from '../game-elements'
import { MagSpinFeeder, NanoLoomFeeder, PrismCoreFeeder, GaussCannonFeeder, QuantumTunnelFeeder } from '../objects/feeders'
import { getAdventureState } from '../adventure/adventure-state'
import { AdventureGoalTracker } from '../adventure/adventure-goal-tracker'
import { AdventureCinematicSystem } from '../adventure/adventure-cinematic-system'
import { AdventureCinematicTriggers } from '../adventure/adventure-cinematic-triggers'
import { AdventureUIStateManager } from '../adventure/adventure-ui-state'
import { AdventureTrackProgression } from '../adventure/adventure-track-progression'
import { AdventureProgressionSupervisor } from '../adventure/adventure-progression-supervisor'
import { DisplaySystem } from '../display'
import { EffectsSystem } from '../effects'
import { GameObjects } from '../objects'
import { AdventureMode } from '../adventure'
import { SpinnerBumperBuilder, type SpinnerBumperVisual, BallTrapBuilder, type BallTrapState, LauncherBuilder, type LauncherState, MovingGateBuilder, type MovingGateState } from '../objects'
import { BallStackVisual } from '../game-elements/ball-stack-visual'
import { CabinetLighting } from '../effects/cabinet-lighting'
import { CelebrationSequencer } from '../effects/celebration-sequencer'
import { GameStateManager } from './game-state'
import { EventBus } from '../core/event-bus'
import { GameInputManager } from './game-input'
import { TableMapManager } from './game-maps'
import { CabinetManager } from './game-cabinet'
import { GameUIManager } from './game-ui'
import { AdventureManager } from './game-adventure'
import { GameConfig, BallType } from '../config'


import { GameRenderer } from './game-renderer'
import { GameCabinetBuilder } from './game-cabinet-builder'
import { GameSceneBuilder } from './game-scene-builder'
import { GamePhysicsController } from './game-physics-controller'
import { GameInputActions } from './game-input-actions'
import { GameScenario } from './game-scenario'
import { GameSlotAdventure } from './game-slot-adventure'
import { GameSettingsUI } from './game-settings-ui'
import { PhysicsTuningPanel } from '../game-elements/physics-tuning-panel'
import { GameDebug } from './game-debug'
import { GameLifecycle } from './game-lifecycle'
import { GameSystemsInitializer } from './game-systems-init'
import { GameDisposer } from './game-disposer'
import { GameHUD } from './game-hud'
import { GameMapCabinet } from './game-map-cabinet'
import { CheckpointDebugController } from './checkpoint-debug'
import { FreeMapTestMode } from './free-map-test-mode'
import { LevelLoader } from './level-loader'
import type { LeaderboardSystem } from '../game-elements/leaderboard-system'
import type { NameEntryDialog } from '../game-elements/name-entry-dialog'
import type { LevelSelectScreen } from '../game-elements/level-select-screen'

export abstract class GameFields {
  readonly engine: Engine | WebGPUEngine
  scene: Nullable<Scene> = null

  constructor(engine: Engine | WebGPUEngine) {
    this.engine = engine
  }

  // Game Systems
  physics!: PhysicsSystem
  display: DisplaySystem | null = null
  effects: EffectsSystem | null = null
  cabinetLighting: CabinetLighting | null = null
  celebrationSequencer: CelebrationSequencer | null = null
  gameObjects: GameObjects | null = null
  ballManager: BallManager | null = null
  ballAnimator: BallAnimator | null = null
  adventureMode: AdventureMode | null = null
  zoneTriggerSystem: ZoneTriggerSystem | null = null
  protected magSpinFeeder: MagSpinFeeder | null = null
  protected nanoLoomFeeder: NanoLoomFeeder | null = null
  protected prismCoreFeeder: PrismCoreFeeder | null = null
  protected gaussCannon: GaussCannonFeeder | null = null
  protected quantumTunnel: QuantumTunnelFeeder | null = null
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
  private _leaderboardSystem: LeaderboardSystem | null = null
  private _nameEntryDialog: NameEntryDialog | null = null
  private _overlaySystemsReady: Promise<void> | null = null
  readonly replayRecorder = new ReplayRecorder()
  readonly replayRunner = new ReplayRunner()

  abstract startSpectateReplay(replayId: string): Promise<boolean>

  async ensureOverlaySystems(): Promise<void> {
    if (this._leaderboardSystem && this._nameEntryDialog) return
    if (!this._overlaySystemsReady) {
      this._overlaySystemsReady = Promise.all([
        import('../game-elements/leaderboard-system'),
        import('../game-elements/name-entry-dialog'),
      ]).then(([lb, ne]) => {
        this._leaderboardSystem = lb.getLeaderboardSystem()
        this._nameEntryDialog = ne.getNameEntryDialog()
        this._leaderboardSystem.setOnSpectateCallback((replayId) => {
          void this.startSpectateReplay(replayId)
        })
      }).catch((err: unknown) => {
        this._overlaySystemsReady = null
        throw err
      })
    }
    await this._overlaySystemsReady
  }

  get leaderboardSystem(): LeaderboardSystem {
    if (!this._leaderboardSystem) {
      throw new Error('LeaderboardSystem not loaded — call ensureOverlaySystems() first')
    }
    return this._leaderboardSystem
  }

  get nameEntryDialog(): NameEntryDialog {
    if (!this._nameEntryDialog) {
      throw new Error('NameEntryDialog not loaded — call ensureOverlaySystems() first')
    }
    return this._nameEntryDialog
  }

  disposeOverlaySystems(): void {
    this._leaderboardSystem?.stop()
    this._leaderboardSystem?.dispose()
    this._leaderboardSystem = null
    this._nameEntryDialog = null
    this._overlaySystemsReady = null
  }

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
  levelSelectScreen: LevelSelectScreen | null = null
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
  protected systemsInitializer!: GameSystemsInitializer
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
  ghostBallRenderer: GhostBallRenderer | null = null
}
