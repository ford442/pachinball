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
import type { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation'
import type { EngineInstrumentation } from '@babylonjs/core/Instrumentation/engineInstrumentation'
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
import { freshNudgeState, type NudgeState } from './physics/types'
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
import { GameHUD } from './game-hud'
import { GameMapCabinet } from './game-map-cabinet'
import { CheckpointDebugController } from './checkpoint-debug'
import { FreeMapTestMode } from './free-map-test-mode'
import { LevelLoader } from './level-loader'
import type { LeaderboardSystem } from '../game-elements/leaderboard-system'
import type { NameEntryDialog } from '../game-elements/name-entry-dialog'
import type { LevelSelectScreen } from '../game-elements/level-select-screen'

export abstract class GameFields {
  /**
   * One controller per Game. Every window/document/canvas listener the Game (or a
   * system it owns) adds passes `{ signal }`, so dispose() is a single abort() and
   * a second Game in the same page starts from the page's own listener count (#441).
   */
  readonly abort = new AbortController()
  get signal(): AbortSignal { return this.abort.signal }

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
  magSpinFeeder: MagSpinFeeder | null = null
  nanoLoomFeeder: NanoLoomFeeder | null = null
  prismCoreFeeder: PrismCoreFeeder | null = null
  gaussCannon: GaussCannonFeeder | null = null
  quantumTunnel: QuantumTunnelFeeder | null = null
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
        this.lazySingletonResets.push(lb.resetLeaderboardSystem, ne.resetNameEntryDialog)
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

  /**
   * `reset*` hooks for module singletons that are loaded lazily (and so cannot be
   * imported statically by the disposer without defeating code splitting).
   */
  protected lazySingletonResets: Array<() => void> = []

  disposeOverlaySystems(): void {
    this._leaderboardSystem?.stop()
    // Resets (and so disposes) the leaderboard singleton too, not just this Game's
    // reference: getLeaderboardSystem() would otherwise hand a disposed instance
    // to the next Game.
    for (const reset of this.lazySingletonResets) reset()
    this.lazySingletonResets = []
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
  sceneInstrumentation: SceneInstrumentation | null = null
  engineInstrumentation: EngineInstrumentation | null = null
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
  nudgeState: NudgeState = freshNudgeState()
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
  cabinetBuilder: GameCabinetBuilder | null = null
  sceneBuilder: GameSceneBuilder | null = null
  protected systemsInitializer!: GameSystemsInitializer
  physicsController: GamePhysicsController | null = null
  inputActions: GameInputActions | null = null
  scenarioManager: GameScenario | null = null
  slotAdventure: GameSlotAdventure | null = null
  settingsUI: GameSettingsUI | null = null
  debugHelper: GameDebug | null = null
  lifecycle: GameLifecycle | null = null
  hud: GameHUD | null = null
  mapCabinet: GameMapCabinet | null = null
  freeMapTestMode: FreeMapTestMode | null = null
  checkpointDebug = new CheckpointDebugController({ signal: this.abort.signal })
  cosmeticSceneBuilt = false
  ghostBallRenderer: GhostBallRenderer | null = null
}
