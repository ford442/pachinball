import {
  ArcRotateCamera,
  Color3,
  Color4,
  HemisphericLight,
  MeshBuilder,
  Mesh,
  Scene,
  Vector3,
  MirrorTexture,
  Plane,
  StandardMaterial,
  Quaternion,
  PostProcess,
  Effect,
  Texture,
  Viewport,
  RenderTargetTexture,
  DirectionalLight,
  PointLight,
  ShadowGenerator,
} from '@babylonjs/core'
import { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline'
import { DepthOfFieldEffectBlurLevel } from '@babylonjs/core/PostProcesses/depthOfFieldEffect'
import { SSAO2RenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline'
import { SSRRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssrRenderingPipeline'
import { MotionBlurPostProcess } from '@babylonjs/core/PostProcesses/motionBlurPostProcess'
import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation'
import { EngineInstrumentation } from '@babylonjs/core/Instrumentation/engineInstrumentation'
import { SceneOptimizer, SceneOptimizerOptions } from '@babylonjs/core/Misc/sceneOptimizer'
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
  getCabinetBuilder,
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
  detectQualityTier,
  QualityTier,
  SettingsManager,
  PALETTE,
  SURFACES,
  INTENSITY,
  LIGHTING,
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
  getZoneConfig,
  ZoneTriggerSystem,
  getScenario,
  getDynamicWorld,
  DebugHUD,
  type DebugSnapshot,
  type AccessibilityConfig,
  type InputFrame,
  type DynamicScenario,
  type ScenarioZone,
} from './game-elements'
import { ASSET_BASE } from './config'

/**
 * Helper to resolve video URLs against ASSET_BASE
 * If the URL is already absolute (starts with http), returns as-is
 * Otherwise, prepends ASSET_BASE to make it a full URL
 */
function resolveVideoUrl(videoPath: string | undefined): string | undefined {
  if (!videoPath) return undefined
  if (videoPath.startsWith('http')) return videoPath
  const cleanPath = videoPath.startsWith('/') ? videoPath.slice(1) : videoPath
  return `${ASSET_BASE}/${cleanPath}`
}

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
import { scanlinePixelShader } from './shaders/scanline'
import { lcdTablePixelShader, TABLE_MAPS, registerMap } from './shaders/lcd-table'

// Register the shaders
Effect.ShadersStore["scanlineFragmentShader"] = scanlinePixelShader.fragment
Effect.ShadersStore["scanlinePixelShader"] = scanlinePixelShader.fragment
Effect.ShadersStore["lcdTableFragmentShader"] = lcdTablePixelShader.fragment
Effect.ShadersStore["lcdTablePixelShader"] = lcdTablePixelShader.fragment

const FlipperPhysics = {
  restAngleRad: Math.PI / 4,    // rad - resting (up) position
  activeAngleRad: Math.PI / 6,  // rad - fired (down) position
} as const

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
  private zoneTriggerSystem: ZoneTriggerSystem | null = null
  private magSpinFeeder: MagSpinFeeder | null = null
  private nanoLoomFeeder: NanoLoomFeeder | null = null
  private prismCoreFeeder: PrismCoreFeeder | null = null
  private gaussCannon: GaussCannonFeeder | null = null
  private quantumTunnel: QuantumTunnelFeeder | null = null
  private inputManager: GameInputManager | null = null
  private cameraController: CameraController | null = null
  private mapManager: TableMapManager | null = null
  private cabinetManager: CabinetManager | null = null
  private uiManager: GameUIManager | null = null
  private adventureManager: AdventureManager | null = null
  private debugHUD: DebugHUD | null = null
  private hapticManager: HapticManager | null = null
  private soundSystem = getSoundSystem()
  private leaderboardSystem = getLeaderboardSystem()
  private nameEntryDialog = getNameEntryDialog()

  // Rendering
  private bloomPipeline: DefaultRenderingPipeline | null = null
  private sceneOptimizer: SceneOptimizer | null = null
  private mirrorTexture: MirrorTexture | null = null
  private tableRenderTarget: RenderTargetTexture | null = null
  private headRenderTarget: RenderTargetTexture | null = null
  private shadowGenerator: ShadowGenerator | null = null

  // Scene lights (stored for state-based animation)
  private keyLight: DirectionalLight | null = null
  private rimLight: DirectionalLight | null = null
  private bounceLight: PointLight | null = null
  private tableCam: ArcRotateCamera | null = null
  
  // Mouse tracking handler for cleanup
  private _mouseMoveHandler: ((e: MouseEvent) => void) | null = null
  private _resizeObserver: ResizeObserver | null = null

  // Camera follow mode (LAYOUT-01)
  private isCameraFollowMode = false
  private cameraFollowTransition = 0
  private cameraFollowTransitionSpeed = 3.0

  // Game State
  private ready = false
  private stateManager!: GameStateManager
  private eventBus!: EventBus
  private score = 0
  private lives = 3
  private bestScore = 0
  private comboCount = 0
  private comboTimer = 0
  private goldBallStack: Array<{ type: BallType; timestamp: number }> = []
  private sessionGoldBalls = 0
  // private maxStackDisplay = 10 // UNUSED
  private powerupActive = false
  private powerupTimer = 0
  private tiltActive = false

  // Plunger Charge State
  private plungerChargeLevel = 0

  // Nudge State
  private nudgeState = {
    tiltWarnings: 0,
    lastNudgeTime: 0,
    tiltActive: false,
    tiltWarningActive: false
  }

  // UI References
  private scoreElement: HTMLElement | null = null
  // private _livesElement: HTMLElement | null = null // UNUSED - re-enable when HUD needs these
  // private _comboElement: HTMLElement | null = null // UNUSED
  // private _bestHudElement: HTMLElement | null = null // UNUSED
  private menuOverlay: HTMLElement | null = null
  private startScreen: HTMLElement | null = null
  private gameOverScreen: HTMLElement | null = null
  private pauseOverlay: HTMLElement | null = null
  private finalScoreElement: HTMLElement | null = null

  // LCD Table State (managed by TableMapManager)
  private lcdTablePostProcess: PostProcess | null = null

  // Quality tier for rendering decisions
  private qualityTier: QualityTier = QualityTier.MEDIUM

  // Map System (dynamic backend maps)
  private mapSystem = getMapSystem(API_BASE)

  // Adventure Mode State (level goals, progression)
  private adventureState = getAdventureState()

  // Level Select Screen
  private levelSelectScreen: ReturnType<typeof getLevelSelectScreen> | null = null

  // Dynamic World (scrolling adventure mode)
  private dynamicWorld: ReturnType<typeof getDynamicWorld> | null = null

  // Ball Stack Visual
  private ballStackVisual: BallStackVisual | null = null

  // Room Environment
  private roomMeshes: Mesh[] = []
  private cabinetNeonLights: PointLight[] = []
  private ambientRoomLight: HemisphericLight | null = null

  // Debug UI
  private inputLatencyOverlay: HTMLElement | null = null
  private showDebugUI = false
  private readonly debugHUDQueryEnabled = window.location.search.includes('debug=1')
  private sceneInstrumentation: SceneInstrumentation | null = null
  private engineInstrumentation: EngineInstrumentation | null = null
  private debugHUDEnabledInSettings = false
  private adventureModeStartMs: number | null = null

  // Frame time monitoring - DISABLED
  // private frameTimeHistory: number[] = []
  // private lastFrameTime = 0
  // private hudUpdatePending = false

  // Scanline intensity
  private scanlineIntensity = 0.12

  // Accessibility Configuration (CRITICAL SAFETY)
  private accessibility: AccessibilityConfig = detectAccessibility()

  // Dynamic Adventure Mode State
  private gameMode: 'fixed' | 'dynamic' = 'fixed'

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

    // === CAMERA ENHANCEMENT: Atmospheric Depth ===
    // Exponential fog for upper playfield separation - subtle depth layering
    // Disabled for users with reduced motion preference (accessibility)
    if (!this.accessibility?.reducedMotion) {
      this.scene.fogMode = Scene.FOGMODE_EXP2
      this.scene.fogColor = Color3.FromHexString('#050510')  // Match void color for seamless blending
      this.scene.fogDensity = 0.015
    } else {
      // Disable fog for reduced motion preference
      this.scene.fogMode = Scene.FOGMODE_NONE
    }

    // UI Bindings
    this.scoreElement = document.getElementById('score')
    // this._livesElement = document.getElementById('lives') // UNUSED
    this.menuOverlay = document.getElementById('menu-overlay')
    this.pauseOverlay = document.getElementById('pause-overlay')
    // this._comboElement = document.getElementById('combo') // UNUSED
    // this._bestHudElement = document.getElementById('best') // UNUSED

    // Initialize UI Manager
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

    // Load and apply settings
    const settings = SettingsManager.load()
    this.debugHUDEnabledInSettings = settings.enableDebugHUD
    SettingsManager.applyToConfig(settings)

    // CRITICAL SAFETY: Initialize accessibility with system detection
    this.accessibility = detectAccessibility()
    console.log('[Accessibility] Settings loaded:', settings, 'Accessibility:', this.accessibility)

    // Initialize haptic manager
    this.hapticManager = new HapticManager({
      enabled: this.accessibility.hapticsEnabled,
      intensity: this.accessibility.hapticIntensity
    })

    // Setup settings UI
    this.setupSettingsUI()
    this.updateDeveloperSettingsVisibility()

    // Setup on-screen map selector (async: fetches dynamic maps from backend)
    await this.setupMapSelector()

    // -----------------------------------------------------------------
    // 2️⃣ IMMERSIVE 3D CAMERA - Full cabinet view with mouse head-tracking
    // -----------------------------------------------------------------
    
    // Create room environment (floor and back wall)
    this.createRoomEnvironment()
    
    // ---- IMMERSIVE CABINET CAMERA --------------------
    // Shows the entire machine from a player's eye position
    // with smooth mouse tracking like Noah's dice roller
    const canvas = this.engine.getRenderingCanvas()
    
    // Default "player's eye" position - frames the whole machine nicely
    // Positioned slightly above and angled down to see full cabinet
    const immersiveCam = new ArcRotateCamera(
      'immersiveCam',
      -Math.PI / 2,               // alpha: front-facing (will be adjusted by mouse)
      Math.PI / 2.8,              // beta: ~64° tilt - sees cabinet from above
      48,                         // radius: far enough to see full cabinet including plunger
      new Vector3(0, 5, 5),       // target: centered on cabinet middle
      this.scene
    )
    this.tableCam = immersiveCam  // Keep reference for compatibility
    immersiveCam.mode = ArcRotateCamera.PERSPECTIVE_CAMERA
    immersiveCam.fov = 0.65       // Wider FOV to frame the full cabinet width
    
    // Full viewport - single camera shows entire cabinet
    immersiveCam.viewport = new Viewport(0, 0, 1, 1)
    
    // Limits to prevent seeing "behind" the room
    immersiveCam.lowerBetaLimit = Math.PI / 4      // Don't go too low
    immersiveCam.upperBetaLimit = Math.PI / 2.2    // Don't go past top-down
    immersiveCam.lowerRadiusLimit = 36             // Don't zoom too close
    immersiveCam.upperRadiusLimit = 60             // Don't zoom too far
    
    // Store base position for mouse tracking
    const baseAlpha = -Math.PI / 2
    const baseBeta = Math.PI / 2.8
    
    // Mouse tracking state (like dice roller head/eye tracking)
    const mouseState = { x: 0.5, y: 0.5, targetX: 0.5, targetY: 0.5 }
    const smoothSpeed = 0.12  // Lerp factor - smooth but responsive (bumped from 0.08)
    const lookRange = 0.25    // How much the camera can rotate (radians)
    
    // Mouse move handler for smooth head-tracking
    const handleMouseMove = (e: MouseEvent) => {
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      // Normalize mouse position to 0-1 range, centered at 0.5
      mouseState.targetX = (e.clientX - rect.left) / rect.width
      mouseState.targetY = (e.clientY - rect.top) / rect.height
    }
    
    // Add mouse tracking
    canvas?.addEventListener('mousemove', handleMouseMove)
    
    // Store handler for cleanup
    this._mouseMoveHandler = handleMouseMove
    
    // Before render: smooth lerp camera position (like dice roller)
    this.scene.onBeforeRenderObservable.add(() => {
      // Smooth lerp toward target mouse position
      mouseState.x += (mouseState.targetX - mouseState.x) * smoothSpeed
      mouseState.y += (mouseState.targetY - mouseState.y) * smoothSpeed

      // Camera follow mode transition (LAYOUT-01)
      const dt = this.engine.getDeltaTime() / 1000
      if (this.isCameraFollowMode) {
        this.cameraFollowTransition = Math.min(1, this.cameraFollowTransition + dt * this.cameraFollowTransitionSpeed)
      } else {
        this.cameraFollowTransition = Math.max(0, this.cameraFollowTransition - dt * this.cameraFollowTransitionSpeed)
      }

      if (this.cameraFollowTransition > 0 && this.tableCam) {
        const t = this.cameraFollowTransition
        const ease = t * t * (3 - 2 * t) // smoothstep easing

        // Radius: 48 → 30
        this.tableCam.radius = 48 + (30 - 48) * ease
        // Beta: π/2.8 → 0.55 (more top-down)
        this.tableCam.beta = (Math.PI / 2.8) + (0.55 - Math.PI / 2.8) * ease
        // Relax radius limits during transition
        this.tableCam.lowerRadiusLimit = 36 + (22 - 36) * ease

        // In follow mode, suppress mouse influence
        mouseState.targetX = 0.5
        mouseState.targetY = 0.5
      } else if (this.tableCam) {
        // Restore limits when fully in cabinet mode
        this.tableCam.lowerRadiusLimit = 36
        this.tableCam.upperRadiusLimit = 60

        // Normal mouse tracking
        const offsetX = (mouseState.x - 0.5) * lookRange * 2
        const offsetY = (mouseState.y - 0.5) * lookRange * 0.8
        immersiveCam.alpha = baseAlpha + offsetX
        immersiveCam.beta = baseBeta + offsetY
      }
    })
    
    // Single active camera
    this.scene.activeCamera = immersiveCam

    // -----------------------------------------------------------------
    // 3️⃣ POST-PROCESS PIPELINES (bloom + scanlines)
    // -----------------------------------------------------------------

    // Bloom - applied to immersive camera
    this.bloomPipeline = new DefaultRenderingPipeline(
      'pachinbloom',
      true,
      this.scene,
      [immersiveCam]
    )
    if (this.bloomPipeline) {
      // Bloom - richer glow hierarchy
      this.bloomPipeline.bloomEnabled = true
      this.bloomPipeline.bloomKernel = 64           // Wider kernel for atmospheric spread
      this.bloomPipeline.bloomScale = 0.5           // Richer glow
      this.bloomPipeline.bloomWeight = 0.25
      this.bloomPipeline.bloomThreshold = 0.7

      // FXAA - clean edges on thin pins, zero risk
      this.bloomPipeline.fxaaEnabled = true

      // ACES/Hable filmic tone mapping - better highlight preservation
      this.bloomPipeline.imageProcessing.toneMappingEnabled = true
      this.bloomPipeline.imageProcessing.toneMappingType = 3  // Hable/ACES
      this.bloomPipeline.imageProcessing.contrast = 1.1
      this.bloomPipeline.imageProcessing.exposure = 1.0

      // Vignette - natural focus guidance toward center
      this.bloomPipeline.imageProcessing.vignetteEnabled = true
      this.bloomPipeline.imageProcessing.vignetteWeight = 0.4
      this.bloomPipeline.imageProcessing.vignetteColor = new Color4(0, 0, 0, 0)

      // Subtle color temperature shift for cohesive warm mood
      this.bloomPipeline.imageProcessing.colorCurvesEnabled = true
      if (this.bloomPipeline.imageProcessing.colorCurves) {
        this.bloomPipeline.imageProcessing.colorCurves.globalHue = 5
        this.bloomPipeline.imageProcessing.colorCurves.globalSaturation = 15
      }

      // Sharpening - restore edge definition lost to bloom blur
      this.bloomPipeline.sharpenEnabled = true
      this.bloomPipeline.sharpen.edgeAmount = 0.3

      // Bloom quality tiering based on GPU capability
      if (this.qualityTier === QualityTier.LOW) {
        this.bloomPipeline.bloomKernel = 16
        this.bloomPipeline.bloomScale = 0.2
        this.bloomPipeline.bloomWeight = 0.12
        this.bloomPipeline.sharpenEnabled = false
      } else if (this.qualityTier === QualityTier.MEDIUM) {
        this.bloomPipeline.bloomKernel = 32
        this.bloomPipeline.bloomScale = 0.35
        this.bloomPipeline.bloomWeight = 0.18
      }

      // Depth of Field - subtle cinematic depth hierarchy (table camera only)
      if (!GameConfig.camera.reducedMotion) {
        this.bloomPipeline.depthOfFieldEnabled = true
        this.bloomPipeline.depthOfField.focusDistance = 2500
        this.bloomPipeline.depthOfField.fStop = 2.4
        this.bloomPipeline.depthOfFieldBlurLevel =
          this.qualityTier === QualityTier.HIGH
            ? DepthOfFieldEffectBlurLevel.High
            : DepthOfFieldEffectBlurLevel.Low
      }

      // Bloom pipeline stays on default rendering path
      // (SSR and motion blur use standalone post-processes in this Babylon version)
    }

    // SSAO - Screen-Space Ambient Occlusion for contact shadows and depth cues
    if (!GameConfig.camera.reducedMotion) {
      const isHigh = this.qualityTier === QualityTier.HIGH
      const ssao = new SSAO2RenderingPipeline('ssao', this.scene, {
        ssaoRatio: isHigh ? 1.0 : 0.5,
        blurRatio: isHigh ? 1.0 : 0.5,
      })
      ssao.radius = 1.5
      ssao.totalStrength = 0.6
      ssao.base = 0.5
      ssao.samples = isHigh ? 32 : 16
      ssao.maxZ = 50
      ssao.minZAspect = 0.5
      this.scene.postProcessRenderPipelineManager.attachCamerasToRenderPipeline('ssao', [immersiveCam])
    }

    // SSR - Screen Space Reflections for playfield/cabinet chrome on HIGH tier
    if (this.qualityTier === QualityTier.HIGH && !GameConfig.camera.reducedMotion) {
      const ssr = new SSRRenderingPipeline('ssr', this.scene, [immersiveCam])
      ssr.step = 0.5              // Conservative step for neon playfield
      ssr.reflectionSpecularFalloffExponent = 3
      ssr.strength = 0.6          // Subtle reflection boost
      ssr.thickness = 0.1
      ssr.selfCollisionNumSkip = 1
      ssr.enableSmoothReflections = true
      ssr.enableAutomaticThicknessComputation = true
    }

    // Motion blur - very subtle for fast ball motion on HIGH tier
    if (this.qualityTier === QualityTier.HIGH && !GameConfig.camera.reducedMotion) {
      const motionBlur = new MotionBlurPostProcess('motionBlur', this.scene, 1.0, immersiveCam)
      motionBlur.motionStrength = 0.15
      motionBlur.motionBlurSamples = 16
    }

    // Scanline effect - applied to immersive camera
    const scanline = new PostProcess(
        "scanline",
        "scanline",
        ["uTime", "uScanlineIntensity"],
        null,
        1.0,
        immersiveCam,
        Texture.BILINEAR_SAMPLINGMODE,
        this.engine
    )
    this.scanlineIntensity = SettingsManager.load().scanlineIntensity
    scanline.onApply = (effect) => {
        effect.setFloat("uTime", performance.now() * 0.001)
        effect.setFloat("uScanlineIntensity", this.scanlineIntensity)
    }

    // ================================================================
    // DRAMATIC LIGHTING SETUP
    // ================================================================
    // RATIONALE: Creating depth through contrast and shadow
    //
    // 1. KEY LIGHT (Main source, warm, from front-left)
    //    - High intensity for strong highlights on ball/pins
    //    - Enabled shadows for depth cues
    //    - Positioned to create long shadows toward back-right
    //
    // 2. FILL LIGHT (Hemisphere, reduced intensity)
    //    - Lower intensity to maintain contrast
    //    - Dark ground color for richer shadows
    //
    // 3. RIM LIGHT (Back light, cool, high intensity)
    //    - Strong edge definition on objects
    //    - Separates elements from background
    //
    // 4. BOUNCE LIGHT (Subtle fill from below)
    //    - Simulates light reflecting off playfield
    //    - Softens harsh shadows under bumpers

    // Environment lighting for PBR materials
    this.setupEnvironmentLighting()

    // FILL LIGHT (Hemisphere) - Unified cool ambient
    const hemiLight = new HemisphericLight('hemiLight', new Vector3(0.2, 1, 0.1), this.scene)
    hemiLight.intensity = LIGHTING.FILL.intensity
    hemiLight.diffuse = color(LIGHTING.FILL.color)
    hemiLight.groundColor = color(SURFACES.VOID)

    // KEY LIGHT - Main directional with shadows
    const keyLight = new DirectionalLight('keyLight', new Vector3(-0.6, -0.8, 0.2), this.scene)
    keyLight.intensity = LIGHTING.KEY.intensity
    keyLight.diffuse = color(LIGHTING.KEY.color)
    keyLight.position = new Vector3(-15, 25, -15)
    this.keyLight = keyLight

    // Enable shadows for depth perception
    const shadowMapSize = this.qualityTier === QualityTier.HIGH ? 4096 : 2048
    const shadowGenerator = new ShadowGenerator(shadowMapSize, keyLight)
    shadowGenerator.useBlurExponentialShadowMap = true
    shadowGenerator.blurKernel = 28           // Sharper contact shadows
    shadowGenerator.setDarkness(0.3)          // Stronger contrast depth separation
    // Shadow bias tuning - eliminates acne and peter-panning
    shadowGenerator.bias = 0.0005
    shadowGenerator.normalBias = 0.02
    // PCSS high-quality filtering on HIGH tier
    if (this.qualityTier === QualityTier.HIGH) {
      shadowGenerator.usePercentageCloserFiltering = true
      shadowGenerator.filteringQuality = ShadowGenerator.QUALITY_HIGH
    }
    this.shadowGenerator = shadowGenerator

    // RIM LIGHT - Strong back light for edge definition
    const rimLight = new DirectionalLight('rimLight', new Vector3(0.2, -0.3, 0.9), this.scene)
    rimLight.intensity = LIGHTING.RIM.intensity
    rimLight.diffuse = color(LIGHTING.RIM.color)
    rimLight.position = new Vector3(5, 12, -25)
    this.rimLight = rimLight

    // BOUNCE LIGHT - Subtle fill from playfield reflection
    const bounceLight = new PointLight('bounceLight', new Vector3(0, -2, 5), this.scene)
    bounceLight.intensity = LIGHTING.BOUNCE.intensity
    bounceLight.diffuse = color(LIGHTING.BOUNCE.color)
    bounceLight.range = 20
    this.bounceLight = bounceLight

    // Initialize Game Logic and Physics
    await this.physics.init()
    await this.buildSceneStaged()

    // Initialize ball animator for squash-and-stretch effects
    this.ballAnimator = new BallAnimator(this.scene)

    // Initialize input manager with all callbacks
    this.inputManager = new GameInputManager(this.scene, this.physics, {
      onFlipperLeft: (pressed) => this.handleFlipperLeft(pressed),
      onFlipperRight: (pressed) => this.handleFlipperRight(pressed),
      onPlunger: () => this.handlePlunger(),
      onPlungerChargeStart: () => this.startPlungerCharge(),
      onPlungerChargeRelease: (chargeLevel) => this.releasePlungerCharge(chargeLevel),
      onPlungerChargeUpdate: (chargeLevel) => this.updatePlungerCharge(chargeLevel),
      onNudge: (direction) => this.applyNudge(direction),
      onPause: () => this.togglePause(),
      onReset: () => this.resetBall(),
      onStart: () => this.startGame(),
      onAdventureToggle: () => this.toggleAdventure(),
      onTrackNext: () => this.cycleAdventureTrack(1),
      onTrackPrev: () => this.cycleAdventureTrack(-1),
      onJackpotTrigger: () => this.triggerJackpot(),
      onDebugHUD: () => {
        if (!this.isDebugHUDKeyboardEnabled()) return
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
      onCameraToggle: () => this.toggleCameraMode(),
      onLevelSelectToggle: () => this.toggleLevelSelect(),
      onLeaderboardToggle: () => this.leaderboardSystem.toggle(),
      onDynamicModeToggle: () => this.toggleDynamicMode(),
      onScenarioCycle: () => this.cycleScenario(),
      getState: () => this.stateManager.getState(),
      getTiltActive: () => this.tiltActive,
    })

    // Configure plunger charge parameters from GameConfig
    this.inputManager.configurePlungerCharge({
      maxChargeTime: GameConfig.plunger.maxChargeTime,
      minImpulse: GameConfig.plunger.minImpulse,
      maxImpulse: GameConfig.plunger.maxImpulse
    })

    // Initialize gamepad support
    this.inputManager.setupGamepad({
      deadZone: 0.15,
      vibrationEnabled: !this.accessibility.reducedMotion
    })

    const touchLeftBtn = document.getElementById('touch-left')
    const touchRightBtn = document.getElementById('touch-right')
    const touchPlungerBtn = document.getElementById('touch-plunger')
    const touchNudgeBtn = document.getElementById('touch-nudge')
    this.inputManager.setupTouchControls(touchLeftBtn, touchRightBtn, touchPlungerBtn, touchNudgeBtn)

    this.scene.onBeforeRenderObservable.add(() => {
      this.stepPhysics()
    })

    this.engine.runRenderLoop(() => {
      // this.monitorFrameTime() // TODO: Implement or remove
      this.updateLatencyDisplay()
      this.scene?.render()
    })

    // Setup ResizeObserver for canvas resize handling
    this.setupResizeObserver()

    // Fix DPR handling to use rounded value
    this.setupDPRHandling()

    // Adaptive quality optimizer: if the frame-rate drops below 55 fps the
    // optimizer progressively relaxes expensive settings (shadows → SSAO →
    // post-processes → hardware scaling) until the target is met again.
    this.setupSceneOptimizer()

    // Enable latency tracking in dev mode (check URL parameter)
    this.showDebugUI = new URLSearchParams(window.location.search).has('debug')
    if (this.showDebugUI) {
      this.inputManager?.enableLatencyTracking(true)
      this.setupLatencyOverlay()
    }

    this.ready = true
    this.eventBus = new EventBus()
    this.stateManager = new GameStateManager({
      onStateChange: (oldState, newState) => {
        console.log(`[Game] State changed: ${GameState[oldState]} -> ${GameState[newState]}`)
      }
    })
    this.stateManager.setEventBus(this.eventBus)
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
          // Use primary color for environment effects
          void _zone
          this.effects?.updateEnvironmentColor?.(config.primaryColor)
          if (isMajor && this.hapticManager) {
            this.hapticManager.jackpot()
          }
        },
        onScoreAward: (points, reason) => {
          this.score += points
          this.updateHUD()
          this.uiManager?.showMessage(`${reason}: +${points}`, 1000)
        },
        onAdventureEnd: () => {
          this.score += GAME_TUNING.scoring.adventureEndBonus
          this.updateHUD()
          this.effects?.startJackpotSequence()
        },
      }
    )

    // Initialize map manager
    this.mapManager = new TableMapManager(this.scene!, {
      onMapChange: (_type, config) => {
        // Update ball and material colors
        this.ballManager?.updateBallMaterialColor(config.baseColor)
        const matLib = getMaterialLibrary(this.scene!)
        matLib.updateFlipperMaterialEmissive(config.baseColor)
        matLib.updatePinMaterialEmissive(config.baseColor)
        matLib.updateBrushedMetalMaterialEmissive(config.baseColor)
        matLib.updateChromeMaterialEmissive(config.baseColor)
        // Update bumper wireframe ring colors
        this.gameObjects?.updateBumperColors(config.baseColor)
        // Update cabinet lighting
        this.effects?.setCabinetColor(config.baseColor)
        this.updateCabinetLightingForMap()
      },
      onPopupShow: (name, color) => this.showMapNamePopup(name, color),
      onMapSelectorUpdate: () => this.updateMapSelectorUI(),
    })
    this.mapManager.setBloomPipeline()

    // Initialize cabinet manager
    this.cabinetManager = new CabinetManager(this.scene!, {
      onPopupShow: (name) => this.showCabinetPopup(name),
      onUISelect: () => this.updateCabinetSelectorUI(),
    })

    this.stateManager.setState(GameState.MENU)
  }

  private setupEnvironmentLighting(): void {
    // Use MaterialLibrary to load environment texture
    if (!this.scene) return
    const matLib = getMaterialLibrary(this.scene)

    // Detect hardware quality tier and configure material library
    this.qualityTier = detectQualityTier(this.engine)
    matLib.qualityTier = this.qualityTier

    matLib.loadEnvironmentTexture()
  }

  private createEnhancedCabinet(): void {
    if (!this.scene) return
    const matLib = getMaterialLibrary(this.scene)
    const cabinetY = -2.5

    // Use MaterialLibrary for consistent materials
    const cabinetMat = matLib.getCabinetMaterial()
    const sidePanelMat = matLib.getSidePanelMaterial()
    const chromeMat = matLib.getChromeMaterial()
    const accentMat = matLib.getNeonBumperMaterial('#00d9ff')

    // ================================================================
    // LAYER 1: CABINET BASE (Thicker, more substantial foundation)
    // ================================================================

    // Main cabinet body - increased height for more depth perception
    const cab = MeshBuilder.CreateBox("cabinet", { width: 27, height: 4, depth: 38 }, this.scene)
    cab.position.set(0.75, cabinetY - 0.5, 5)
    cab.material = cabinetMat

    // Cabinet feet - raises the machine off the "floor"
    const createFoot = (x: number, z: number) => {
      const foot = MeshBuilder.CreateBox(`foot_${x}_${z}`, { width: 3, height: 1.5, depth: 3 }, this.scene)
      foot.position.set(x, cabinetY - 3.2, z)
      foot.material = chromeMat
      return foot
    }
    createFoot(-10, -10)
    createFoot(11, -10)
    createFoot(-10, 18)
    createFoot(11, 18)

    // ================================================================
    // LAYER 2: SIDEWALLS (Multi-layer for depth)
    // ================================================================

    // Outer side panels - main thickness
    const leftPanel = MeshBuilder.CreateBox("leftPanel", { width: 1.5, height: 5, depth: 40 }, this.scene)
    leftPanel.position.set(-13, cabinetY + 0.5, 5)
    leftPanel.material = sidePanelMat

    const rightPanel = MeshBuilder.CreateBox("rightPanel", { width: 1.5, height: 5, depth: 40 }, this.scene)
    rightPanel.position.set(14, cabinetY + 0.5, 5)
    rightPanel.material = sidePanelMat

    // Inner trim strips - chrome accent that catches light
    const leftTrim = MeshBuilder.CreateBox("leftTrim", { width: 0.3, height: 4.5, depth: 38 }, this.scene)
    leftTrim.position.set(-12.1, cabinetY + 0.5, 5)
    leftTrim.material = chromeMat

    const rightTrim = MeshBuilder.CreateBox("rightTrim", { width: 0.3, height: 4.5, depth: 38 }, this.scene)
    rightTrim.position.set(13.1, cabinetY + 0.5, 5)
    rightTrim.material = chromeMat

    // LED accent strips along side panel tops
    const leftLED = MeshBuilder.CreateBox("leftLED", { width: 0.2, height: 0.1, depth: 36 }, this.scene)
    leftLED.position.set(-13, cabinetY + 3, 5)
    leftLED.material = accentMat

    const rightLED = MeshBuilder.CreateBox("rightLED", { width: 0.2, height: 0.1, depth: 36 }, this.scene)
    rightLED.position.set(14, cabinetY + 3, 5)
    rightLED.material = accentMat

    // ================================================================
    // LAYER 3: FRONT APRON & BEZEL (Depth separation from playfield)
    // ================================================================

    // Front apron - raised area below the glass
    const apron = MeshBuilder.CreateBox("apron", { width: 24, height: 2, depth: 3 }, this.scene)
    apron.position.set(0.75, cabinetY + 0.5, -14)
    apron.material = sidePanelMat

    // Apron top accent strip
    const apronTrim = MeshBuilder.CreateBox("apronTrim", { width: 23, height: 0.2, depth: 0.3 }, this.scene)
    apronTrim.position.set(0.75, cabinetY + 1.6, -12.6)
    apronTrim.material = accentMat

    // Front bezel/glass edge with unified magenta accent
    const bezelMat = new StandardMaterial("bezelMat", this.scene)
    bezelMat.diffuseColor = Color3.Black()
    bezelMat.emissiveColor = emissive(PALETTE.MAGENTA, INTENSITY.AMBIENT)

    const bezel = MeshBuilder.CreateBox("bezel", { width: 26, height: 0.8, depth: 1.2 }, this.scene)
    bezel.position.set(0.75, cabinetY + 2.2, -12.8)
    bezel.material = bezelMat

    // Glass edge highlight (thin chrome strip)
    const glassEdge = MeshBuilder.CreateBox("glassEdge", { width: 25, height: 0.05, depth: 0.8 }, this.scene)
    glassEdge.position.set(0.75, cabinetY + 2.6, -12.8)
    glassEdge.material = chromeMat

    // ================================================================
    // LAYER 4: BACKBOX CONNECTION (Where table meets head)
    // ================================================================

    // Back wall that supports the backbox - creates visual separation
    const backWall = MeshBuilder.CreateBox("backWall", { width: 27, height: 6, depth: 2 }, this.scene)
    backWall.position.set(0.75, cabinetY + 1, 22)
    backWall.material = cabinetMat

    // Hinge/connection detail - metal brackets
    const leftHinge = MeshBuilder.CreateBox("leftHinge", { width: 1, height: 3, depth: 1 }, this.scene)
    leftHinge.position.set(-11, cabinetY + 2, 21.5)
    leftHinge.material = chromeMat

    const rightHinge = MeshBuilder.CreateBox("rightHinge", { width: 1, height: 3, depth: 1 }, this.scene)
    rightHinge.position.set(12.5, cabinetY + 2, 21.5)
    rightHinge.material = chromeMat

    // ================================================================
    // LAYER 5: PLUNGER LANE SIDING (Right side control area)
    // ================================================================

    // Plunger lane outer wall - creates the "control panel" side
    const plungerWall = MeshBuilder.CreateBox("plungerWall", { width: 2, height: 3, depth: 25 }, this.scene)
    plungerWall.position.set(12, cabinetY + 0.5, -2)
    plungerWall.material = sidePanelMat

    // Plunger lane top trim
    const plungerTrim = MeshBuilder.CreateBox("plungerTrim", { width: 1.5, height: 0.2, depth: 24 }, this.scene)
    plungerTrim.position.set(12, cabinetY + 2, -2)
    plungerTrim.material = chromeMat

    // Add to mirror render list if available
    if (this.mirrorTexture?.renderList) {
      this.mirrorTexture.renderList.push(
        cab, leftPanel, rightPanel, leftTrim, rightTrim,
        apron, bezel, glassEdge, backWall, leftHinge, rightHinge,
        plungerWall, plungerTrim, leftLED, rightLED, apronTrim
      )
    }

    // Add all cabinet meshes to shadow casters for depth
    if (this.shadowGenerator) {
      [cab, leftPanel, rightPanel, leftTrim, rightTrim,
       apron, bezel, backWall, plungerWall].forEach(mesh => {
        this.shadowGenerator?.addShadowCaster(mesh)
      })
    }
  }

  // ============================================================================
  // ROOM ENVIRONMENT - Dark arcade atmosphere
  // ============================================================================
  
  private createRoomEnvironment(): void {
    if (!this.scene) return
    
    // === DARK ARCADE FLOOR ===
    // Large floor plane that the cabinet sits on
    const floor = MeshBuilder.CreateGround('arcadeFloor', { width: 120, height: 120 }, this.scene)
    floor.position.y = -5
    const floorMat = new StandardMaterial('arcadeFloorMat', this.scene)
    floorMat.diffuseColor = Color3.FromHexString('#08080c')
    floorMat.specularColor = Color3.FromHexString('#151520')
    floorMat.roughness = 0.9
    floor.material = floorMat
    
    // === BACK WALL ===
    // Dark wall behind the cabinet for depth perception
    const backWall = MeshBuilder.CreatePlane('arcadeBackWall', { width: 100, height: 50 }, this.scene)
    backWall.position.set(0, 12, 40)
    backWall.rotation.x = Math.PI
    const wallMat = new StandardMaterial('arcadeWallMat', this.scene)
    wallMat.diffuseColor = Color3.FromHexString('#050508')
    wallMat.roughness = 1.0
    backWall.material = wallMat
    
    // === AMBIENT ROOM GLOW ===
    // Subtle blue glow behind the machine (like arcade ambiance)
    const ambientGlow = new HemisphericLight('ambientGlow', new Vector3(0, 1, -1), this.scene)
    ambientGlow.intensity = 0.15
    ambientGlow.diffuse = Color3.FromHexString('#1a1a3e')
    ambientGlow.groundColor = Color3.FromHexString('#0a0a12')
    
    console.log('[Game] Room environment created for immersive camera')
  }

  private createDarkRoomEnvironment(): void {
    if (!this.scene) return

    // === DARK FLOOR ===
    // Large floor plane with subtle reflection
    const floor = MeshBuilder.CreateGround('roomFloor', { width: 100, height: 100 }, this.scene)
    floor.position.y = -8
    const floorMat = new StandardMaterial('floorMat', this.scene)
    floorMat.diffuseColor = Color3.FromHexString('#0a0a0a')
    floorMat.specularColor = Color3.FromHexString('#111111')
    floorMat.roughness = 0.8
    floor.material = floorMat
    this.roomMeshes.push(floor)

    // === BACK WALL ===
    // Dark wall behind the cabinet for depth
    const backWall = MeshBuilder.CreatePlane('roomBackWall', { width: 80, height: 40 }, this.scene)
    backWall.position.set(0, 10, 30)
    backWall.rotation.x = Math.PI
    const wallMat = new StandardMaterial('wallMat', this.scene)
    wallMat.diffuseColor = Color3.FromHexString('#050505')
    wallMat.roughness = 1.0
    backWall.material = wallMat
    this.roomMeshes.push(backWall)

    // === SIDE WALLS (subtle, low) ===
    const leftWall = MeshBuilder.CreatePlane('roomLeftWall', { width: 60, height: 30 }, this.scene)
    leftWall.position.set(-50, 5, 0)
    leftWall.rotation.y = Math.PI / 2
    leftWall.material = wallMat
    this.roomMeshes.push(leftWall)

    const rightWall = MeshBuilder.CreatePlane('roomRightWall', { width: 60, height: 30 }, this.scene)
    rightWall.position.set(50, 5, 0)
    rightWall.rotation.y = -Math.PI / 2
    rightWall.material = wallMat
    this.roomMeshes.push(rightWall)

    // === AMBIENT ROOM LIGHTING ===
    // Very dim hemisphere light for base visibility
    this.ambientRoomLight = new HemisphericLight('roomAmbient', new Vector3(0, 1, 0), this.scene)
    this.ambientRoomLight.intensity = 0.1
    this.ambientRoomLight.diffuse = Color3.FromHexString('#1a1a2e')
    this.ambientRoomLight.groundColor = Color3.FromHexString('#050505')

    // === CABINET NEON ACCENT LIGHTS ===
    // These will react to map colors
    this.createCabinetNeonLights()

    console.log('[Game] Dark room environment created')
  }

  private createCabinetNeonLights(): void {
    if (!this.scene) return

    // Side cabinet glow lights
    const leftNeon = new PointLight('leftNeon', new Vector3(-15, 2, 5), this.scene)
    leftNeon.intensity = 0.8
    leftNeon.diffuse = Color3.FromHexString(PALETTE.CYAN)
    leftNeon.range = 15
    this.cabinetNeonLights.push(leftNeon)

    const rightNeon = new PointLight('rightNeon', new Vector3(16, 2, 5), this.scene)
    rightNeon.intensity = 0.8
    rightNeon.diffuse = Color3.FromHexString(PALETTE.MAGENTA)
    rightNeon.range = 15
    this.cabinetNeonLights.push(rightNeon)

    // Back cabinet rim light
    const backNeon = new PointLight('backNeon', new Vector3(0, 5, -15), this.scene)
    backNeon.intensity = 0.5
    backNeon.diffuse = Color3.FromHexString(PALETTE.PURPLE)
    backNeon.range = 20
    this.cabinetNeonLights.push(backNeon)

    // Under-cabinet glow (illuminates floor)
    const underNeon = new PointLight('underNeon', new Vector3(0, -4, 5), this.scene)
    underNeon.intensity = 0.6
    underNeon.diffuse = Color3.FromHexString(PALETTE.CYAN)
    underNeon.range = 12
    this.cabinetNeonLights.push(underNeon)
  }

  /**
   * Update cabinet neon lights based on current map color
   */
  private updateCabinetLightingForMap(): void {
    const config = TABLE_MAPS[this.mapManager?.getCurrentMap() || 'neon-helix']
    if (!config || this.cabinetNeonLights.length === 0) return

    const baseColor = Color3.FromHexString(config.baseColor)
    const accentColor = Color3.FromHexString(config.accentColor)

    // Left side = base color
    if (this.cabinetNeonLights[0]) {
      this.cabinetNeonLights[0].diffuse = baseColor
    }
    // Right side = accent color
    if (this.cabinetNeonLights[1]) {
      this.cabinetNeonLights[1].diffuse = accentColor
    }
    // Back = blend of both
    if (this.cabinetNeonLights[2]) {
      this.cabinetNeonLights[2].diffuse = Color3.Lerp(baseColor, accentColor, 0.5)
    }
    // Under = base color with slight intensity pulse
    if (this.cabinetNeonLights[3]) {
      this.cabinetNeonLights[3].diffuse = baseColor
    }

    // Sync EffectsSystem LED strip base color
    this.effects?.setCabinetColor(config.baseColor)
  }

  /**
   * Setup ResizeObserver to handle canvas size changes
   * Calls engine.resize() when the canvas container changes size
   */
  private setupResizeObserver(): void {
    const canvas = this.engine.getRenderingCanvas()
    if (!canvas) return

    // Use ResizeObserver to detect canvas container size changes
    this._resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        // Only resize if dimensions actually changed
        const { width, height } = entry.contentRect
        if (width > 0 && height > 0) {
          this.engine.resize()
          console.log(`[Game] Canvas resized: ${Math.round(width)}x${Math.round(height)}`)
        }
      }
    })

    this._resizeObserver.observe(canvas)
    console.log('[Game] ResizeObserver initialized')
  }

  /**
   * Setup proper DPR handling with Math.round()
   * Prevents fractional pixel ratios that cause rendering issues
   */
  private setupDPRHandling(): void {
    const canvas = this.engine.getRenderingCanvas()
    if (!canvas) return

    // Get the rounded DPR value
    const dpr = Math.round(window.devicePixelRatio || 1)
    
    // Apply the rounded DPR to the canvas if needed
    if (canvas.width !== canvas.clientWidth * dpr || 
        canvas.height !== canvas.clientHeight * dpr) {
      this.engine.resize()
    }

    // Listen for DPR changes (e.g., moving between monitors with different DPRs)
    const mediaQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
    mediaQuery.addEventListener('change', () => {
      const newDpr = Math.round(window.devicePixelRatio || 1)
      console.log(`[Game] DPR changed: ${newDpr}`)
      this.engine.resize()
    })
  }

  private setupSceneOptimizer(): void {
    if (!this.scene) return

    // Target 55 fps; check every 2 s before degrading.
    // ModerateDegradationAllowed progressively disables: render targets →
    // shadows → particles → post-processes → hardware scaling.
    const options = SceneOptimizerOptions.ModerateDegradationAllowed(55)
    this.sceneOptimizer = new SceneOptimizer(this.scene, options)
    this.sceneOptimizer.onSuccessObservable.add(() => {
      console.log('[SceneOptimizer] Target FPS reached – optimizations applied')
    })
    this.sceneOptimizer.onFailureObservable.add(() => {
      console.warn('[SceneOptimizer] Could not reach target FPS after all optimizations')
    })
    this.sceneOptimizer.start()
    console.log('[SceneOptimizer] Adaptive quality optimizer started (target: 55 fps)')
  }

  dispose(): void {
    this.sceneOptimizer?.dispose()
    this.sceneOptimizer = null
    this.inputManager?.dispose()
    this.debugHUD?.dispose()
    this.debugHUD = null
    this.disposeDebugInstrumentation()
    this.uiManager?.dispose()
    this.adventureManager?.dispose()
    
    // Clean up mouse tracking handler
    if (this._mouseMoveHandler) {
      this.engine.getRenderingCanvas()?.removeEventListener('mousemove', this._mouseMoveHandler)
    }
    
    // Clean up ResizeObserver
    if (this._resizeObserver) {
      this._resizeObserver.disconnect()
      this._resizeObserver = null
    }
    
    // Stop leaderboard auto-refresh
    this.leaderboardSystem.stop()
    this.leaderboardSystem.dispose()

    // === EXPLICIT RENDER TARGET CLEANUP ===
    // Dispose in reverse order of creation to avoid dangling references

    // 1. Post-process pipelines first
    if (this.bloomPipeline) {
      this.bloomPipeline.dispose()
      this.bloomPipeline = null
    }

    // 2. Mirror texture
    if (this.mirrorTexture) {
      this.mirrorTexture.dispose()
      this.mirrorTexture = null
    }

    // 3. Render target textures
    if (this.tableRenderTarget) {
      this.tableRenderTarget.dispose()
      this.tableRenderTarget = null
    }

    if (this.headRenderTarget) {
      this.headRenderTarget.dispose()
      this.headRenderTarget = null
    }

    // 4. Shadow generator
    if (this.shadowGenerator) {
      this.shadowGenerator.dispose()
      this.shadowGenerator = null
    }

    // 5. Ball animator
    this.ballAnimator?.dispose()
    this.ballAnimator = null

    // 5.5. Ball stack visual
    this.ballStackVisual?.dispose()
    this.ballStackVisual = null

    // 6. Effects system
    this.effects?.dispose()
    this.effects = null

    // 7. Now safe to dispose scene
    resetMaterialLibrary()
    this.scene?.dispose()
    this.scene = null

    this.physics.dispose()
    this.ready = false

    console.log('[Game] Disposed all resources')
  }

  private async buildSceneStaged(): Promise<void> {
    if (!this.scene) throw new Error('Scene not ready')
    const world = this.physics.getWorld()
    const rapier = this.physics.getRapier()
    if (!world || !rapier) throw new Error('Physics not ready')

    // Show loading state
    this.showLoadingState(true)

    // Enhanced Skybox with subtle gradient effect
    const skybox = MeshBuilder.CreateBox("skybox", { size: 200.0 }, this.scene)
    const skyboxMaterial = new StandardMaterial("skyBox", this.scene)
    skyboxMaterial.backFaceCulling = false
    skyboxMaterial.diffuseColor = Color3.Black()
    skyboxMaterial.specularColor = Color3.Black()
    // Unified ambient glow using palette
    skyboxMaterial.emissiveColor = emissive(PALETTE.AMBIENT, INTENSITY.AMBIENT)
    skybox.material = skyboxMaterial

    // Mirror texture
    const mirrorSize = this.qualityTier === QualityTier.HIGH ? 2048 : 1024
    this.mirrorTexture = new MirrorTexture("mirror", mirrorSize, this.scene, true)
    this.mirrorTexture.mirrorPlane = new Plane(0, -1, 0, -1.01)
    this.mirrorTexture.level = 0.6

    // Initialize core systems needed for all phases
    // CRITICAL SAFETY: Pass accessibility config to effects system
    this.effects = new EffectsSystem(this.scene, this.bloomPipeline, this.accessibility)
    // Register scene lights for state-based atmosphere animation
    if (this.keyLight && this.rimLight && this.bounceLight) {
      this.effects.registerSceneLights(this.keyLight, this.rimLight, this.bounceLight)
    }
    // Build display config with state-specific media from GameConfig
    const displayConfig: DisplayConfig = adaptLegacyConfig(GameConfig.backbox)
    this.display = new DisplaySystem(this.scene, this.engine, displayConfig)
    this.display.subscribeToEvents(this.eventBus)
    this.stateManager.setDisplaySystem(this.display)

    // Initialize debug HUD
    this.debugHUD = new DebugHUD({
      onVisibilityChange: (visible) => this.handleDebugHUDVisibilityChange(visible),
    })
    this.debugHUD.setUpdateCadenceHz(4)
    if (this.debugHUDEnabledInSettings && this.isDebugHUDAvailable()) {
      this.debugHUD.show()
    }

    // Initialize Dynamic World for scrolling adventure mode
    this.dynamicWorld = getDynamicWorld(this.scene, this.tableCam!, this.display, this.soundSystem)

    // Initialize ball stack visual
    this.ballStackVisual = new BallStackVisual(this.scene)

    // Setup Adventure State with display integration
    this.adventureState.setDisplay(this.display)
    this.adventureState.onLevelCompleteCallback((level) => {
      console.log(`[Game] Level complete: ${level.name}`)
      // Auto-switch to next map if available
      if (level.rewards.unlockMap) {
        setTimeout(() => {
          this.switchTableMap(level.rewards.unlockMap!)
        }, GAME_TUNING.timing.storyVideoWaitMs) // Wait for story video
      }
    })
    this.adventureState.onGoalUpdateCallback((goals) => {
      // Update display with goal progress
      const goalText = goals.map(g => `${g.description}: ${g.current}/${g.target}`).join('\n')
      this.display?.setStoryText(goalText)
    })

    // Setup slot machine event callback
    this.setupSlotMachineCallbacks()

    // const particleTexture = this.effects.createParticleTexture() // UNUSED
    this.gameObjects = new GameObjects(this.scene, world, rapier, GameConfig)
    this.ballManager = new BallManager(this.scene, world, rapier, this.gameObjects.getBindings())
    
    // Set up gold ball collection callback
    this.ballManager.setOnGoldBallCollected((type, points) => {
      console.log(`[Game] Gold ball collected: ${type}, points: ${points}`)
    })
    
    this.adventureMode = new AdventureMode(this.scene, world, rapier)

    // Setup feeder event handlers
    this.setupFeederEventHandlers()

    // [NEW] LINK ADVENTURE EVENTS TO DISPLAY SYSTEM
    this.adventureMode.setEventListener((event, data) => {
      console.log(`Adventure Event: ${event}`)

      switch (event) {
        case 'START': {
          const trackType = data as AdventureTrackType | undefined
          // Delegate to AdventureManager
          this.adventureManager?.startAdventure(trackType)
          
          // Switch display to Mission Mode
          this.eventBus.emit('adventure:start')
          this.eventBus.emit('display:set', DisplayState.ADVENTURE)
          const trackName = trackType ? this.getTrackDisplayName(trackType) : 'UNKNOWN SECTOR'
          this.display?.setTrackInfo(trackName)
          this.display?.setStoryText(`ENTERING: ${trackName}`)
          // Set mood lighting
          this.effects?.setLightingMode('reach', 0.5)
          this.effects?.setAtmosphereState('ADVENTURE')
          break
        }

        case 'END':
          // Delegate to AdventureManager
          this.adventureManager?.endAdventure()
          
          // Return to Pinball Mode
          this.eventBus.emit('adventure:end')
          this.eventBus.emit('display:set', DisplayState.IDLE)
          this.effects?.setLightingMode('normal', 1.0)
          this.effects?.setAtmosphereState('IDLE')
          this.effects?.playBeep(440) // Transition sound
          break
          
        case 'ZONE_ENTER': {
          // Handle zone transition in Dynamic Adventure Mode
          const zoneData = data as { 
            zone: AdventureTrackType
            previousZone: AdventureTrackType | null
            isMajor: boolean 
            ballPosition?: Vector3
          }
          this.handleZoneTransition(zoneData.zone, zoneData.previousZone, zoneData.isMajor)
          break
        }
      }
    })

    // === STAGE 1: CRITICAL (immediate - <50ms) ===
    // Absolute minimum for gameplay - player can start NOW
    this.buildCriticalScene()
    this.ready = true  // Player can start NOW
    this.showLoadingState(false, 'gameplay')

    // === STAGE 2: GAMEPLAY (async - yield between) ===
    // Important but not blocking - yield to allow rendering
    await this.yieldFrame()
    this.buildGameplayScene()
    this.showLoadingState(false, 'cosmetic')

    // === STAGE 3: COSMETIC (idle callback) ===
    // Visual polish - lowest priority, only when browser is idle
    if ('requestIdleCallback' in window) {
      requestIdleCallback(() => this.buildCosmeticScene(), { timeout: 500 })
    } else {
      setTimeout(() => this.buildCosmeticScene(), 100)
    }
  }

  private buildCriticalScene(): void {
    if (!this.gameObjects || !this.ballManager) return

    // Build the full 3D arcade cabinet around the playfield
    if (this.scene) {
      const cabinetBuilder = getCabinetBuilder(this.scene)
      cabinetBuilder.loadCabinetPreset(this.cabinetManager?.getCurrentType() || 'classic')
    }

    // Use LCD table material instead of regular playfield
    this.createLCDPlayfield()

    // Initialize LCD post-process effect
    this.initLCDTablePostProcess()

    // Create walls and other critical elements
    this.gameObjects.createWalls()
    this.gameObjects.createFlippers()
    if (this.mirrorTexture) {
      this.ballManager.setMirrorTexture(this.mirrorTexture)
    }
    this.ballManager.createMainBall()

    // Apply equipped rewards to the ball
    this.applyEquippedRewards()

    // Register camera for screen shake effects (needed for gameplay feedback)
    if (this.tableCam && this.effects) {
      this.effects.registerCamera(this.tableCam)
      this.effects.registerTableCamera(this.tableCam)
    }

    // Initialize camera controller for dynamic framing
    if (this.tableCam) {
      this.cameraController = new CameraController(this.tableCam)
    }
  }

  /**
   * Create the LCD playfield surface - glowing phosphor display
   */
  private createLCDPlayfield(): void {
    if (!this.scene) return

    const matLib = getMaterialLibrary(this.scene)
    const lcdMat = matLib.getLCDTableMaterial()

    // Create the LCD playfield ground
    const ground = MeshBuilder.CreateGround('lcdGround', { width: GameConfig.table.width, height: GameConfig.table.height }, this.scene) as Mesh
    ground.position.set(0, -1, 5)
    ground.material = lcdMat

    // Create physics body for the ground (keep colliders on top)
    const physicsWorld = this.physics.getWorld()
    const rapier = this.physics.getRapier()
    if (physicsWorld && rapier) {
      const groundBody = physicsWorld.createRigidBody(
        rapier.RigidBodyDesc.fixed().setTranslation(0, -1, 5)
      )
      if (groundBody) {
        physicsWorld.createCollider(
          rapier.ColliderDesc.cuboid(GameConfig.table.width/2, 0.1, GameConfig.table.height/2),
          groundBody
        )
      }
    }

    // Register for shadow receiving
    ground.receiveShadows = true

    // Add flipper zone glow enhancement (disabled in reduced motion mode)
    if (!GameConfig.camera.reducedMotion) {
      const flipperGlow = MeshBuilder.CreateGround("flipperGlow", { width: 10, height: 6 }, this.scene)
      flipperGlow.position.set(0, -0.95, -7)
      const glowMat = new StandardMaterial("flipperGlowMat", this.scene)
      glowMat.diffuseColor = Color3.Black()
      glowMat.emissiveColor = Color3.FromHexString("#001133")
      glowMat.alpha = 0.3
      flipperGlow.material = glowMat
    }

    console.log('[Game] LCD playfield created')
  }

  private buildGameplayScene(): void {
    if (!this.gameObjects || !this.ballManager || !this.display || !this.effects) return

    // Important but not blocking - these enhance gameplay but aren't needed immediately
    this.gameObjects.createDeathZone()
    this.gameObjects.createBumpers()
    this.effects?.initBumperSparkPool(12)
    this.gameObjects.createSlingshots()
    this.gameObjects.createPachinkoField()
    this.gameObjects.createFlipperRamps()
    this.gameObjects.createDrainRails()

    // Build handle caches for O(1) collision lookups
    this.rebuildHandleCaches()
  }

  private buildCosmeticScene(): void {
    if (!this.gameObjects || !this.display || !this.effects || !this.scene) return

    // Visual polish - lowest priority
    this.gameObjects.createCabinetDecoration()
    this.createEnhancedCabinet()
    this.createDarkRoomEnvironment()

    this.display.createBackbox(new Vector3(0.75, 15, 30))
    this.effects.createCabinetLighting()

    // Register decorative materials for fever/reach effects
    const matLib = getMaterialLibrary(this.scene)
    const plasticMat = matLib.getNeonBumperMaterial('#FF0055')
    this.effects.registerDecorativeMaterial(plasticMat)

    // Register shadows after all meshes created
    this.registerShadowCasters()

    // Hide loading indicator completely
    this.showLoadingState(false)
  }

  private yieldFrame(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()))
  }

  /**
   * Switch the LCD table to a different map/theme
   * @param mapName - The map to switch to (e.g., 'neon-helix', 'cyber-core')
   */
  public switchTableMap(mapName: string): void {
    const mapConfig = this.mapManager?.getMapSystem().getMap(mapName) || TABLE_MAPS[mapName]
    if (!mapConfig) {
      console.warn(`[Game] Unknown table map: ${mapName}`)
      return
    }

    // Delegate to map manager
    this.mapManager?.switchTableMap(mapName)

    // Handle game-specific logic
    const musicId = (mapConfig as { musicTrackId?: string }).musicTrackId || this.mapManager?.getMapSystem().inferMusicTrackId(mapName) || '1'
    if (musicId) {
      this.soundSystem.playMapMusic(musicId)
    }

    // Update display with map info
    this.display?.setStoryText(`MAP: ${mapConfig.name.toUpperCase()}`)

    // Adventure Mode: Auto-start level for this map
    const levelForMap = this.adventureState.getAllLevels().find(l => l.mapType === mapName)
    if (levelForMap && this.adventureState.isMapUnlocked(mapName)) {
      this.adventureState.startLevel(levelForMap.id)
      if (levelForMap.story?.intro) {
        this.display?.setStoryText(levelForMap.story.intro)
      }
    }

    // Update level select screen progress if visible
    if (this.levelSelectScreen?.isShowing()) {
      this.levelSelectScreen.updateProgress()
    }

    // Configure Dynamic World mode based on map config
    const mapMode = mapConfig.mode || 'fixed'
    this.dynamicWorld?.setMode(mapMode)
    
    if (mapMode === 'dynamic' && mapConfig.worldLength) {
      this.initializeDynamicZones(mapName, mapConfig)
    }
  }

  // ============================================================================
  // ZONE TRANSITIONS - Dynamic Adventure Mode
  // ============================================================================

  /**
   * Handle zone transition in Dynamic Adventure Mode
   * Delegates to AdventureManager
   */
  private handleZoneTransition(
    zone: AdventureTrackType, 
    previousZone: AdventureTrackType | null,
    isMajor: boolean
  ): void {
    this.adventureManager?.handleZoneTransition(zone, previousZone, isMajor)
    
    // Additional game-specific effects for major transitions
    if (isMajor) {
      // Flash the LCD table
      this.mapManager?.getLCDTableState().triggerFeedbackEffect()
      
      // Update material library for zone colors
      const currentZoneConfig = getZoneConfig(zone)
      const matLib = getMaterialLibrary(this.scene!)
      matLib.updateLCDTableEmissive(currentZoneConfig.primaryColor, currentZoneConfig.glowIntensity)
      matLib.updateFlipperMaterialEmissive(currentZoneConfig.primaryColor)
    }
  }
  
  /**
   * Update cabinet lighting for zone colors
   * Delegates to AdventureManager
   */
  // UNUSED - kept for backward compatibility
  // private updateCabinetLightingForZone(): void {
  //   // Set cabinet lights reference if not already set
  //   this.adventureManager?.setCabinetLights(this.cabinetNeonLights)
  //   // The actual lighting update is handled within handleZoneTransition
  // }

  // ============================================================================
  // CABINET PRESETS - Swappable machine shapes
  // ============================================================================

  /**
   * Load a cabinet preset and rebuild the cabinet.
   * @param type - The cabinet preset type ('classic', 'neo', 'vertical', 'wide')
   */
  public loadCabinetPreset(type: CabinetType): void {
    this.cabinetManager?.loadCabinetPreset(type)
  }

  /**
   * Cycle to the next cabinet preset.
   */
  public cycleCabinetPreset(): void {
    this.cabinetManager?.cycleCabinetPreset()
  }

  /**
   * Initialize dynamic zones for scrolling adventure mode
   */
  private initializeDynamicZones(mapName: string, mapConfig: typeof TABLE_MAPS[string]): void {
    if (!this.dynamicWorld) return

    const worldLength = mapConfig.worldLength || 200
    const zones = this.createZonesForMap(mapName, worldLength)
    
    this.dynamicWorld.initialize(zones)
    console.log(`[Game] Initialized dynamic world with ${zones.length} zones`)
  }

  /**
   * Create zone configuration for a map
   */
  private createZonesForMap(mapName: string, worldLength: number): import('./game-elements').WorldZone[] {
    const zoneCount = 4
    const zoneLength = worldLength / zoneCount
    const zones: import('./game-elements').WorldZone[] = []

    for (let i = 0; i < zoneCount; i++) {
      const startZ = i * zoneLength
      const endZ = (i + 1) * zoneLength
      
      // Generate zone colors based on map theme
      const hue = (i * 60) % 360
      const baseColor = `hsl(${hue}, 80%, 50%)`
      
      zones.push({
        id: `${mapName}-zone-${i}`,
        name: `Sector ${String.fromCharCode(65 + i)}`,
        startZ,
        endZ,
        mapType: mapName,
        mapConfig: {
          baseColor,
          accentColor: `hsl(${(hue + 30) % 360}, 80%, 70%)`,
          glowIntensity: 1.0 + i * 0.2,
        },
        storyText: `Entering Sector ${String.fromCharCode(65 + i)}...`,
        spawnMechanics: this.generateZoneMechanics(i, startZ, endZ),
      })
    }

    return zones
  }

  /**
   * Generate mechanics for a zone
   */
  private generateZoneMechanics(zoneIndex: number, startZ: number, endZ: number): import('./game-elements').ZoneMechanic[] {
    const mechanics: import('./game-elements').ZoneMechanic[] = []
    const count = 3 + zoneIndex

    for (let i = 0; i < count; i++) {
      const z = startZ + (endZ - startZ) * ((i + 1) / (count + 1))
      const x = (Math.random() - 0.5) * 8
      
      const types: Array<'bumper' | 'target' | 'collectible'> = ['bumper', 'target', 'collectible']
      mechanics.push({
        type: types[Math.floor(Math.random() * types.length)],
        position: new Vector3(x, 0.5, -z),
      })
    }

    return mechanics
  }

  /**
   * Show a cabinet change popup.
   */
  private showCabinetPopup(name: string): void {
    this.uiManager?.showCabinetPopup(name)
  }

  /**
   * Update the cabinet selector UI to show current preset.
   */
  private updateCabinetSelectorUI(): void {
    const buttons = document.querySelectorAll('.cabinet-btn')
    buttons.forEach(btn => {
      btn.classList.remove('active')
      if (btn.getAttribute('data-cabinet') === this.cabinetManager?.getCurrentType()) {
        btn.classList.add('active')
      }
    })
  }

  /**
   * Show a floating map name popup with CRT distortion effect
   */
  private showMapNamePopup(name: string, color: string): void {
    this.uiManager?.showMapNamePopup(name, color)
  }

  /**
   * Cycle to the next table map
   */
  public cycleTableMap(): void {
    this.mapManager?.cycleTableMap()
  }

  private initLCDTablePostProcess(): void {
    if (!this.scene || !this.tableCam) return

    // Create LCD table post-process effect
    this.lcdTablePostProcess = new PostProcess(
      'lcdTable',
      'lcdTable',
      [
        'uBaseColor',
        'uAccentColor',
        'uScanlineIntensity',
        'uPixelGridIntensity',
        'uSubpixelIntensity',
        'uGlowIntensity',
        'uMapBlend',
        'uTime',
        'uFlashIntensity',
        'uRippleIntensity',
        'uRippleTime'
      ],
      null,
      1.0,
      this.tableCam,
      Texture.BILINEAR_SAMPLINGMODE,
      this.engine
    )

    // Set up uniform updates
    this.lcdTablePostProcess.onApply = (effect) => {
      const config = this.mapManager?.getLCDTableState().getCurrentConfig()
      if (!config) return
      const baseColor = this.hexToColor3(config.baseColor)
      const accentColor = this.hexToColor3(config.accentColor)

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

  private hexToColor3(hex: string): Color3 {
    const clean = hex.replace('#', '')
    const r = parseInt(clean.substring(0, 2), 16) / 255
    const g = parseInt(clean.substring(2, 4), 16) / 255
    const b = parseInt(clean.substring(4, 6), 16) / 255
    return new Color3(r, g, b)
  }

  private showLoadingState(show: boolean, phase?: 'gameplay' | 'cosmetic'): void {
    this.uiManager?.showLoadingState(show, phase)
  }

  private setupFeederEventHandlers(): void {
    if (!this.effects || !this.ballManager) return

    // Create feeder instances
    this.magSpinFeeder = new MagSpinFeeder(this.scene!, this.physics.getWorld()!, this.physics.getRapier()!, GameConfig.magSpin)
    this.nanoLoomFeeder = new NanoLoomFeeder(this.scene!, this.physics.getWorld()!, this.physics.getRapier()!, GameConfig.nanoLoom)
    this.prismCoreFeeder = new PrismCoreFeeder(this.scene!, this.physics.getWorld()!, this.physics.getRapier()!, GameConfig.prismCore)
    this.gaussCannon = new GaussCannonFeeder(this.scene!, this.physics.getWorld()!, this.physics.getRapier()!, GameConfig.gaussCannon)
    this.quantumTunnel = new QuantumTunnelFeeder(this.scene!, this.physics.getWorld()!, this.physics.getRapier()!, GameConfig.quantumTunnel)

    // Set feeders on AdventureManager and let it handle events
    this.adventureManager?.setFeeders({
      magSpin: this.magSpinFeeder,
      nanoLoom: this.nanoLoomFeeder,
      prismCore: this.prismCoreFeeder,
      gaussCannon: this.gaussCannon,
      quantumTunnel: this.quantumTunnel,
    })

    // Update AdventureManager systems reference with current state
    this.adventureManager?.updateSystems({
      effects: this.effects,
      display: this.display,
      ballManager: this.ballManager,
      soundSystem: this.soundSystem,
    })

    // Delegate event handler setup to AdventureManager
    this.adventureManager?.setupFeederEventHandlers()
  }

  /**
   * Register important gameplay meshes for shadow casting/receiving
   * RATIONALE: Shadows provide critical depth cues for:
   * - Ball position relative to playfield
   * - Height of bumpers and obstacles
   * - Cabinet scale and structure
   */
  private registerShadowCasters(): void {
    if (!this.shadowGenerator || !this.gameObjects) return

    // Enhanced shadow quality for better depth cues (disabled in reduced motion mode)
    if (!GameConfig.camera.reducedMotion) {
      // Contact hardening for better depth cues
      this.shadowGenerator.useContactHardeningShadow = true
      this.shadowGenerator.contactHardeningLightSizeUVRatio = 0.05
    }

    // Shadow frustum optimization
    this.shadowGenerator.frustumEdgeFalloff = 1.0

    // PERFORMANCE: Limit shadow casters to prevent GPU overload
    const MAX_SHADOW_CASTERS = 20

    // Get all pinball meshes from GameObjects
    const pinballMeshes = this.gameObjects.getPinballMeshes()

    // Filter and prioritize shadow casters
    const shadowCasters = pinballMeshes
      .filter(mesh => {
        // Skip transparent/emissive-only meshes
        if (mesh.name.includes('holo') || mesh.name.includes('glass')) return false
        // Skip pins (too small, add noise)
        if (mesh.name.includes('pin')) {
          mesh.receiveShadows = true
          return false
        }
        return true
      })
      // Prioritize balls and flippers (most important for gameplay depth cues)
      .sort((a, b) => {
        const aPriority = a.name.includes('ball') ? 2 : a.name.includes('flipper') ? 1 : 0
        const bPriority = b.name.includes('ball') ? 2 : b.name.includes('flipper') ? 1 : 0
        return bPriority - aPriority
      })
      .slice(0, MAX_SHADOW_CASTERS)

    // Register limited shadow casters
    for (const mesh of shadowCasters) {
      this.shadowGenerator.addShadowCaster(mesh, true)
    }

    console.log(`[Performance] Shadow casters limited: ${shadowCasters.length}/${pinballMeshes.length}`)

    // Ground receives shadows but doesn't cast
    if (this.scene) {
      const ground = this.scene.getMeshByName('ground')
      if (ground) {
        ground.receiveShadows = true
      }
    }
  }

  private setGameState(newState: GameState): void {
    this.stateManager.setState(newState)
    
    // UI updates that depend on state
    if (this.menuOverlay) this.menuOverlay.classList.remove('hidden')
    if (this.pauseOverlay) this.pauseOverlay.classList.add('hidden')
    if (this.startScreen) this.startScreen.classList.add('hidden')
    if (this.gameOverScreen) this.gameOverScreen.classList.add('hidden')

    switch (newState) {
      case GameState.MENU:
        if (this.startScreen) this.startScreen.classList.remove('hidden')
        break
      case GameState.PLAYING:
        if (this.menuOverlay) this.menuOverlay.classList.add('hidden')
        if (this.pauseOverlay) this.pauseOverlay.classList.add('hidden')
        if (this.effects?.getAudioContext()?.state === 'suspended') {
          this.effects.getAudioContext()?.resume().catch(() => {})
        }
        break
      case GameState.PAUSED:
        if (this.menuOverlay) this.menuOverlay.classList.add('hidden')
        if (this.pauseOverlay) this.pauseOverlay.classList.remove('hidden')
        if (this.effects?.getAudioContext()?.state === 'running') {
          this.effects.getAudioContext()?.suspend().catch(() => {})
        }
        break
      case GameState.GAME_OVER:
        if (this.gameOverScreen) this.gameOverScreen.classList.remove('hidden')
        if (this.finalScoreElement) this.finalScoreElement.textContent = this.score.toString()
        if (this.score > this.bestScore) {
          this.bestScore = this.score
          try {
            localStorage.setItem('pachinball.best', String(this.bestScore))
          } catch {
            // Ignore localStorage errors
          }
        }
        this.updateHUD()
        
        // Handle leaderboard submission
        this.handleGameOverLeaderboard()
        break
    }
  }

  /**
   * Determine the current camera mode based on game state and ball situation
   */
  private getCameraMode(): CameraMode {
    // Adventure mode takes priority
    if (this.adventureMode?.isActive()) {
      return CameraMode.ADVENTURE
    }

    // Jackpot mode when jackpot is active
    if (this.effects?.isJackpotActive) {
      return CameraMode.JACKPOT
    }

    // Check ball count for multiball
    const ballCount = this.ballManager?.getBallBodies().length || 0
    if (ballCount > 1) {
      return CameraMode.MULTIBALL
    }

    // Get ball position for zone-based modes
    const ballBody = this.ballManager?.getBallBody()
    if (!ballBody) {
      return CameraMode.IDLE
    }

    const ballPos = ballBody.translation()

    // Upper playfield focus
    if (ballPos.z < -8) {
      return CameraMode.UPPER_PLAY
    }

    // Flipper ready mode when ball is near plunger or waiting
    if (ballPos.z > 5 || Math.abs(ballPos.x) > 8) {
      return CameraMode.FLIPPER_READY
    }

    // Default to idle/center framing
    return CameraMode.IDLE
  }

  private async startGame(): Promise<void> {
    this.score = 0
    this.lives = 3
    this.comboCount = 0
    this.comboTimer = 0
    this.goldBallStack = []
    this.ballStackVisual?.clear()
    this.gameObjects?.resetTargets()
    this.powerupActive = false
    this.powerupTimer = 0
    this.ballManager?.removeExtraBalls()
    this.updateHUD()
    this.resetBall()
    
    // Initialize sound system on user interaction
    await this.soundSystem.init()
    await this.soundSystem.resume()
    
    // Play map music (default to map 1)
    this.soundSystem.playMapMusic('1')
    
    // Start leaderboard auto-refresh
    this.leaderboardSystem.setContext(this.mapManager?.getCurrentMap() || 'neon-helix')
    this.leaderboardSystem.start()
    
    this.setGameState(GameState.PLAYING)
  }

  private togglePause(): void {
    if (!this.ready) return
    this.stateManager.togglePause()
    // Apply UI changes based on new state
    this.setGameState(this.stateManager.getState())
  }

  private handleFlipperLeft(pressed: boolean): void {
    if (!this.ready || !this.stateManager.isPlaying()) return
    if (this.tiltActive && pressed) {
      this.effects?.playBeep(220)
      this.hapticManager?.tiltWarning()
      return
    }

    const joint = this.gameObjects?.getFlipperJoints().left
    if (joint) {
      // UPDATED: Use Config values
      const stiffness = GameConfig.table.flipperStrength
      const damping = GameConfig.flipper.damping
      const angle = pressed ? -FlipperPhysics.activeAngleRad : FlipperPhysics.restAngleRad
      ;(joint as RAPIER.RevoluteImpulseJoint).configureMotorPosition(angle, stiffness, damping)
    }

    // Haptic feedback on flipper activation
    if (pressed) {
      this.hapticManager?.flipper()
      // Play flipper sound
      this.soundSystem.playSample('flipper')
    }
  }

  private handleFlipperRight(pressed: boolean): void {
    if (!this.ready || !this.stateManager.isPlaying()) return
    if (this.tiltActive && pressed) {
      this.effects?.playBeep(220)
      this.hapticManager?.tiltWarning()
      return
    }

    const joint = this.gameObjects?.getFlipperJoints().right
    if (joint) {
      // UPDATED: Use Config values
      const stiffness = GameConfig.table.flipperStrength
      const damping = GameConfig.flipper.damping
      const angle = pressed ? FlipperPhysics.activeAngleRad : -FlipperPhysics.restAngleRad
      ;(joint as RAPIER.RevoluteImpulseJoint).configureMotorPosition(angle, stiffness, damping)
    }

    // Haptic feedback on flipper activation
    if (pressed) {
      this.hapticManager?.flipper()
      // Play flipper sound
      this.soundSystem.playSample('flipper')
    }
  }

  private handlePlunger(): void {
    // Plunger is now handled by releasePlungerCharge with charge level
    // This method is kept for backwards compatibility with input frame processing
    const rapier = this.physics.getRapier()
    const ballBody = this.ballManager?.getBallBody()
    if (!ballBody || !rapier) return

    const pos = ballBody.translation()
    if (pos.x > 8 && pos.z < -4) {
      // Calculate impulse based on charge level (fallback to full impulse if no charge)
      const chargeRatio = this.plungerChargeLevel
      const impulseMagnitude = GameConfig.plunger.minImpulse +
        (GameConfig.plunger.maxImpulse - GameConfig.plunger.minImpulse) * chargeRatio

      ballBody.applyImpulse(new rapier.Vector3(0, 0, impulseMagnitude), true)

      // Haptic feedback - stronger for more charge
      const hapticIntensity = 30 + Math.floor(chargeRatio * 40)
      this.hapticManager?.trigger([hapticIntensity, 10, Math.floor(hapticIntensity / 2)])

      // Visual feedback - camera shake based on charge
      if (!this.accessibility.reducedMotion && this.effects) {
        const shakeIntensity = 0.02 + chargeRatio * 0.04
        this.effects.addCameraShake(shakeIntensity)
      }

      // Play launch sound
      this.soundSystem.playSample('launch')
      
      // Reset charge state
      this.plungerChargeLevel = 0
    }
  }

  /**
   * Called when plunger charge starts (button pressed)
   */
  private startPlungerCharge(): void {
    this.plungerChargeLevel = 0

    // Initial haptic feedback to indicate charge started
    this.hapticManager?.trigger([20, 5])
  }

  /**
   * Called each frame while plunger is held to update charge level
   */
  private updatePlungerCharge(chargeLevel: number): void {
    this.plungerChargeLevel = chargeLevel

    // Update visual feedback - animate plunger pullback
    this.updatePlungerVisual(chargeLevel)

    // Progressive haptic feedback as charge builds
    if (chargeLevel > 0.25 && chargeLevel < 0.3) {
      this.hapticManager?.trigger([15])
    } else if (chargeLevel > 0.5 && chargeLevel < 0.55) {
      this.hapticManager?.trigger([25])
    } else if (chargeLevel > 0.75 && chargeLevel < 0.8) {
      this.hapticManager?.trigger([35])
    } else if (chargeLevel >= 1.0 && Math.floor(performance.now() / 100) % 10 === 0) {
      // Pulse at max charge
      this.hapticManager?.trigger([40, 5])
    }
  }

  /**
   * Called when plunger is released
   */
  private releasePlungerCharge(chargeLevel: number): void {
    this.plungerChargeLevel = chargeLevel
    // The actual impulse is applied in handlePlunger() which is called after this
  }

  /**
   * Update plunger visual - pull back the rod and knob based on charge level
   */
  private updatePlungerVisual(chargeLevel: number): void {
    if (!this.scene) return

    // Find plunger meshes
    const shooterRod = this.scene.getMeshByName('shooterRod')
    const plungerKnob = this.scene.getMeshByName('plungerKnob')

    if (shooterRod && plungerKnob) {
      // Pull back based on charge level (max pullback from config)
      const maxPullback = GameConfig.plunger.maxPullbackDistance
      const pullback = chargeLevel * maxPullback

      // Original positions
      const rodBaseZ = -10
      const knobBaseZ = -13

      // Apply pullback (negative Z direction)
      shooterRod.position.z = rodBaseZ - pullback
      plungerKnob.position.z = knobBaseZ - pullback
    }
  }

  private applyNudge(direction: { x: number; y: number; z: number }): void {
    if (this.nudgeState.tiltActive) {
      this.hapticManager?.tiltWarning()
      return
    }

    const rapier = this.physics.getRapier()
    const ballBody = this.ballManager?.getBallBody()
    if (!ballBody || !rapier) return

    // Track tilt warnings - warn if nudging too frequently
    const now = performance.now()
    if (now - this.nudgeState.lastNudgeTime < GAME_TUNING.timing.nudgeCooldownMs) {
      this.nudgeState.tiltWarnings++
      if (this.nudgeState.tiltWarnings >= GameConfig.nudge.maxTiltWarnings) {
        this.triggerTilt()
        return
      }
    }
    this.nudgeState.lastNudgeTime = now

    // Apply impulse with vertical boost for realistic nudge feel
    const impulse = new rapier.Vector3(
      direction.x * GameConfig.nudge.force,
      GameConfig.nudge.verticalBoost,
      direction.z * GameConfig.nudge.force
    )
    ballBody.applyImpulse(impulse, true)

    // Haptic feedback
    const nudgeDirection = direction.x > 0 ? 'right' : direction.x < 0 ? 'left' : 'up'
    this.hapticManager?.nudge(nudgeDirection)

    // Visual feedback (subtle screen shake) - skip if reduced motion
    if (!this.accessibility.reducedMotion) {
      this.effects?.addCameraShake(0.03)
    }
  }

  private triggerTilt(): void {
    this.nudgeState.tiltActive = true
    this.nudgeState.tiltWarningActive = false
    this.tiltActive = true

    // Visual tilt warning - flash bloom
    this.effects?.setBloomEnergy(3.0)
    setTimeout(() => this.effects?.setBloomEnergy(1.0), GAME_TUNING.timing.tiltBloomResetMs)

    // Audio warning
    this.effects?.playBeep(150) // Low warning tone

    // Haptic warning
    this.hapticManager?.tiltWarning()

    // Reset after delay
    setTimeout(() => {
      this.nudgeState.tiltActive = false
      this.nudgeState.tiltWarnings = 0
      this.tiltActive = false
    }, GameConfig.nudge.tiltPenaltyTime)
  }

  /**
   * Reset tilt warnings slowly over time
   * Called from stepPhysics to decay warnings when nudging stops
   */
  private updateTiltDecay(dt: number): void {
    const now = performance.now()
    if (now - this.nudgeState.lastNudgeTime > GameConfig.nudge.tiltDecayTime && this.nudgeState.tiltWarnings > 0) {
      this.nudgeState.tiltWarnings = Math.max(0, this.nudgeState.tiltWarnings - dt)
    }
  }

  private triggerJackpot(): void {
      if (!this.stateManager.isPlaying()) return
      console.log("JACKPOT TRIGGERED!")

      this.effects?.startJackpotSequence()
      this.effects?.setAtmosphereState('JACKPOT')
      this.eventBus.emit('jackpot:start')
      this.eventBus.emit('display:set', DisplayState.JACKPOT)
      
      // Trigger jackpot audio
      this.soundSystem.triggerJackpotAudio()

      // Secret cabinet shake + vignette flash on jackpot
      if (!this.accessibility.reducedMotion) {
        const mapColor = TABLE_MAPS[this.mapManager?.getCurrentMap() || 'neon-helix']?.baseColor || '#ff00ff'
        this.effects?.triggerCabinetShake('jackpot', mapColor)
      }

      // Bonus Score
      this.score += GAME_TUNING.scoring.jackpotBonus
      this.updateHUD()
  }

  private toggleAdventure(): void {
    if (this.adventureMode?.isActive()) {
      this.endAdventureMode()
    } else {
      this.startAdventureMode()
    }
  }

  /**
   * Toggle the level select screen
   */
  private toggleLevelSelect(): void {
    if (!this.levelSelectScreen) {
      this.levelSelectScreen = getLevelSelectScreen(
        {
          onLevelSelect: (level, mapType) => {
            this.switchTableMap(mapType)
            this.adventureState.startLevel(level.id)
          },
          onClose: () => {
            // Screen closed callback
          },
        },
        this.adventureState
      )
    }
    this.levelSelectScreen.toggle()
  }

  /**
   * Toggle between Fixed and Dynamic Adventure Mode
   * Press 'D' key to switch modes
   */
  private toggleDynamicMode(): void {
    const newMode = this.gameMode === 'fixed' ? 'dynamic' : 'fixed'
    this.gameMode = newMode
    
    console.log(`[Game] Switched to ${newMode.toUpperCase()} mode`)
    
    // Show mode switch notification
    this.showModeSwitchPopup(newMode)
    
    if (newMode === 'dynamic') {
      // Enable dynamic mode - initialize with default scenario
      this.startDynamicMode()
    } else {
      // Return to fixed mode
      this.stopDynamicMode()
    }
  }

  /**
   * Toggle between cabinet view and ball-follow chase cam
   * Press 'C' key to switch modes
   */
  private toggleCameraMode(): void {
    this.isCameraFollowMode = !this.isCameraFollowMode
    console.log(`[Camera] Follow mode: ${this.isCameraFollowMode}`)
  }
  
  /**
   * Show mode switch popup notification
   */
  private showModeSwitchPopup(mode: 'fixed' | 'dynamic'): void {
    const existing = document.getElementById('mode-switch-popup')
    if (existing) existing.remove()
    
    const popup = document.createElement('div')
    popup.id = 'mode-switch-popup'
    popup.textContent = mode === 'dynamic' ? '⚡ DYNAMIC MODE' : '📍 FIXED MODE'
    popup.style.cssText = `
      position: absolute;
      top: 20%;
      left: 50%;
      transform: translate(-50%, -50%);
      font-family: 'Orbitron', sans-serif;
      font-size: 2rem;
      font-weight: 900;
      color: ${mode === 'dynamic' ? '#00ff88' : '#00d9ff'};
      text-shadow: 
        0 0 10px currentColor,
        0 0 20px currentColor,
        0 0 40px currentColor;
      pointer-events: none;
      z-index: 1000;
      opacity: 0;
      transition: opacity 0.3s ease;
      letter-spacing: 4px;
    `
    
    document.body.appendChild(popup)
    
    // Animate in
    requestAnimationFrame(() => {
      popup.style.opacity = '1'
    })
    
    // Remove after delay
    setTimeout(() => {
      popup.style.opacity = '0'
      setTimeout(() => popup.remove(), 300)
    }, 2000)
  }
  
  /**
   * Start Dynamic Adventure Mode with specified scenario
   * NOTE: This is a stub - full scenario system not yet implemented
   */
  private startDynamicMode(): void {
    console.log('[Game] Starting Dynamic Mode with Zone System')
    
    // Initialize Zone Trigger System
    this.zoneTriggerSystem = new ZoneTriggerSystem(false)
    
    // Load default scenario (samurai-realm)
    const scenario = getScenario('samurai-realm')
    if (scenario) {
      this.loadScenario(scenario)
    }
    
    // Show zone system active indicator
    this.showZoneSystemPopup('ZONE SYSTEM ACTIVE')
  }
  
  /**
   * Stop Dynamic Mode and return to fixed mode
   */
  private stopDynamicMode(): void {
    console.log('[Game] Stopping Dynamic Mode')
    
    // Dispose zone trigger system
    this.zoneTriggerSystem?.dispose()
    this.zoneTriggerSystem = null
    
    // Reset to default table map
    this.switchTableMap('neon-helix')
  }
  
  /**
   * Load a dynamic scenario with zone support
   */
  private loadScenario(scenario: DynamicScenario): void {
    if (!this.zoneTriggerSystem) return
    
    console.log(`[Game] Loading scenario: ${scenario.name}`)
    
    // Load scenario into zone trigger system
    this.zoneTriggerSystem.loadScenario(scenario)
    
    // Set up zone change callback
    this.zoneTriggerSystem.setCallback({
      onZoneEnter: (zone, fromZone, isMajor) => {
        this.handleScenarioZoneEnter(zone, fromZone, isMajor)
      },
      onZoneExit: () => {
        // Optional: handle zone exit effects
      },
      onZoneProgress: () => {
        // Optional: update progress indicators
      }
    })
    
    // Apply scenario global lighting
    this.applyScenarioLighting(scenario.globalLighting)
    
    // Switch to first zone's map configuration
    if (scenario.zones.length > 0) {
      this.applyZoneMapConfig(scenario.zones[0])
    }
    
    // Show scenario intro (resolve video URL against ASSET_BASE)
    this.display?.showZoneStory(
      scenario.name,
      scenario.description,
      resolveVideoUrl(scenario.zones[0]?.videoUrl),
      true
    )
  }
  
  /**
   * Handle entering a new zone in a scenario
   */
  private handleScenarioZoneEnter(
    zone: ScenarioZone,
    _fromZone: ScenarioZone | null,
    isMajor: boolean
  ): void {
    console.log(`[Game] Entered zone: ${zone.name} (${isMajor ? 'MAJOR' : 'minor'})`)
    
    // Update display with zone story (resolve video URL against ASSET_BASE)
    this.display?.showZoneStory(
      zone.name,
      zone.storyText,
      resolveVideoUrl(zone.videoUrl),
      true
    )
    
    // Apply zone map configuration
    this.applyZoneMapConfig(zone)
    
    // Update ball trail color
    if (this.ballManager) {
      const scenario = this.zoneTriggerSystem?.getAllZones()[0]?.id 
        ? getScenario('samurai-realm')
        : null
      if (scenario) {
        this.ballManager.updateBallMaterialColor(scenario.ballTrailColor)
      }
    }
    
    // Cross-fade music to zone track
    this.soundSystem.playMapMusic(zone.musicTrack)
    
    // Trigger effects
    if (isMajor) {
      this.effects?.addCameraShake(0.5)
      this.effects?.triggerScreenPulse(zone.mapConfig.baseColor, 0.8, 500)
      this.mapManager?.getLCDTableState().triggerFeedbackEffect()
    } else {
      this.effects?.addCameraShake(0.25)
      this.effects?.triggerScreenPulse(zone.mapConfig.baseColor, 0.4, 300)
    }
    
    // Haptic feedback
    if (isMajor && this.hapticManager) {
      this.hapticManager.jackpot()
    }
  }
  
  /**
   * Apply zone map configuration to the table
   */
  private applyZoneMapConfig(zone: ScenarioZone): void {
    const config = zone.mapConfig
    
    // Update LCD table shader
    const matLib = getMaterialLibrary(this.scene!)
    matLib.updateLCDTableEmissive(config.baseColor, config.glowIntensity)
    matLib.updateFlipperMaterialEmissive(config.baseColor)
    matLib.updatePinMaterialEmissive(config.accentColor)
    
    // Update cabinet neon lights
    this.updateCabinetNeonForZone(config.baseColor, config.accentColor)
    
    // Update LCD post-process
    this.mapManager?.getLCDTableState().updateFromMapConfig({
      baseColor: config.baseColor,
      accentColor: config.accentColor,
      scanlineIntensity: config.scanlineIntensity,
      glowIntensity: config.glowIntensity,
      animationSpeed: config.animationSpeed,
    })
  }
  
  /**
   * Update cabinet neon lights for zone colors
   */
  private updateCabinetNeonForZone(baseColor: string, accentColor: string): void {
    if (this.cabinetNeonLights.length === 0) return
    
    const base = Color3.FromHexString(baseColor)
    const accent = Color3.FromHexString(accentColor)
    
    if (this.cabinetNeonLights[0]) {
      this.cabinetNeonLights[0].diffuse = base
    }
    if (this.cabinetNeonLights[1]) {
      this.cabinetNeonLights[1].diffuse = accent
    }
    if (this.cabinetNeonLights[2]) {
      this.cabinetNeonLights[2].diffuse = Color3.Lerp(base, accent, 0.5)
    }
  }
  
  /**
   * Apply scenario global lighting
   */
  private applyScenarioLighting(lighting: {
    ambientColor: string
    keyLightColor: string
    rimLightColor: string
  }): void {
    // Update scene lights
    if (this.keyLight) {
      this.keyLight.diffuse = Color3.FromHexString(lighting.keyLightColor)
    }
    if (this.rimLight) {
      this.rimLight.diffuse = Color3.FromHexString(lighting.rimLightColor)
    }
    if (this.scene) {
      const hemiLight = this.scene.getLightByName('hemiLight') as HemisphericLight
      if (hemiLight) {
        hemiLight.diffuse = Color3.FromHexString(lighting.ambientColor)
      }
    }
  }
  
  /**
   * Show zone system popup notification
   */
  private showZoneSystemPopup(message: string): void {
    const existing = document.getElementById('zone-system-popup')
    if (existing) existing.remove()
    
    const popup = document.createElement('div')
    popup.id = 'zone-system-popup'
    popup.innerHTML = `
      <div style="font-size: 0.7rem; opacity: 0.7; margin-bottom: 4px;">DYNAMIC MODE</div>
      <div>${message}</div>
    `
    popup.style.cssText = `
      position: absolute;
      top: 25%;
      left: 50%;
      transform: translate(-50%, -50%);
      font-family: 'Orbitron', sans-serif;
      font-size: 1.2rem;
      font-weight: 700;
      color: #00ff88;
      text-align: center;
      text-shadow: 0 0 10px #00ff88, 0 0 20px #00ff88;
      pointer-events: none;
      z-index: 100;
      opacity: 0;
      animation: zonePopupFade 2s ease-out forwards;
      background: rgba(0, 0, 0, 0.8);
      padding: 16px 32px;
      border-radius: 8px;
      border: 1px solid #00ff88;
    `
    
    const style = document.createElement('style')
    style.textContent = `
      @keyframes zonePopupFade {
        0% { opacity: 0; transform: translate(-50%, -40%); }
        20% { opacity: 1; transform: translate(-50%, -50%); }
        80% { opacity: 1; transform: translate(-50%, -50%); }
        100% { opacity: 0; transform: translate(-50%, -60%); }
      }
    `
    document.head.appendChild(style)
    document.body.appendChild(popup)
    
    setTimeout(() => {
      popup.remove()
      style.remove()
    }, 2000)
  }
  
  /**
   * Switch to a different scenario
   */
  public switchScenario(scenarioId: string): void {
    const scenario = getScenario(scenarioId)
    if (scenario) {
      this.loadScenario(scenario)
      this.showScenarioSwitchPopup(scenario.name)
    }
  }
  
  /**
   * Show scenario switch popup
   */
  private showScenarioSwitchPopup(name: string): void {
    const popup = document.createElement('div')
    popup.style.cssText = `
      position: absolute;
      top: 30%;
      left: 50%;
      transform: translate(-50%, -50%);
      font-family: 'Orbitron', sans-serif;
      font-size: 1.5rem;
      font-weight: 700;
      color: #ffd700;
      text-align: center;
      text-shadow: 0 0 10px #ffd700;
      pointer-events: none;
      z-index: 100;
      animation: fadeInOut 2s ease-out forwards;
    `
    popup.textContent = `SCENARIO: ${name.toUpperCase()}`
    document.body.appendChild(popup)
    setTimeout(() => popup.remove(), 2000)
  }
  
  /**
   * Cycle through available scenarios
   */
  public cycleScenario(direction: 1 | -1 = 1): void {
    const scenarios = ['samurai-realm', 'cyber-noir', 'quantum-dream', 'movie-gangster', 'fantasy-realm']
    const currentIndex = scenarios.findIndex(id => {
      return this.zoneTriggerSystem?.getAllZones()[0]?.id?.startsWith(id.split('-')[0])
    })
    
    const nextIndex = (Math.max(0, currentIndex) + direction + scenarios.length) % scenarios.length
    this.switchScenario(scenarios[nextIndex])
  }

  /** Collision debounce: track last collision time per body pair */
  private lastCollisionTime: Map<string, number> = new Map()
  private static readonly COLLISION_DEBOUNCE_MS = 16
  private static readonly DEBUG_COMBO_MULTIPLIER_STEP = 3

  /** Body handle cache for O(1) collision lookups */
  private bumperHandleSet: Set<number> = new Set()
  private targetHandleSet: Set<number> = new Set()
  private ballHandleSet: Set<number> = new Set()
  private deathZoneHandle: number = -1
  private adventureSensorHandle: number = -1

  /** Rebuild body handle caches after object creation */
  private rebuildHandleCaches(): void {
    this.bumperHandleSet.clear()
    this.targetHandleSet.clear()
    this.ballHandleSet.clear()

    for (const b of (this.gameObjects?.getBumperBodies() || [])) {
      this.bumperHandleSet.add(b.handle)
    }
    for (const b of (this.gameObjects?.getTargetBodies() || [])) {
      this.targetHandleSet.add(b.handle)
    }
    for (const b of (this.ballManager?.getBallBodies() || [])) {
      this.ballHandleSet.add(b.handle)
    }

    const dz = this.gameObjects?.getDeathZoneBody()
    this.deathZoneHandle = dz ? dz.handle : -1

    const sensor = this.adventureMode?.getSensor()
    this.adventureSensorHandle = sensor ? sensor.handle : -1
  }

  /**
   * Apply a single input frame to the game state
   * Called at the start of stepPhysics() for frame-aligned input processing
   */
  private applyInputFrame(frame: InputFrame): void {
    // Apply flipper inputs only if state changed
    if (frame.flipperLeft !== null) {
      this.handleFlipperLeft(frame.flipperLeft)
    }
    if (frame.flipperRight !== null) {
      this.handleFlipperRight(frame.flipperRight)
    }

    // Apply plunger (one-shot trigger)
    if (frame.plunger) {
      this.handlePlunger()
    }

    // Apply nudge if present
    if (frame.nudge) {
      const rapier = this.physics.getRapier()
      if (rapier) {
        this.applyNudge(new rapier.Vector3(frame.nudge.x, frame.nudge.y, frame.nudge.z))
      }
    }
  }

  private stepPhysics(): void {
    // Update input manager (polls gamepad, updates plunger charge)
    this.inputManager?.update()

    // Process buffered inputs at start of physics step for consistent latency
    const inputFrame = this.inputManager?.processBufferedInputs()
    if (inputFrame) {
      this.applyInputFrame(inputFrame)
    }

    if (!this.stateManager.isPlaying()) return

    const rawDt = this.engine.getDeltaTime() / 1000

    // Fixed timestep physics with accumulator
    this.physics.step(rawDt, (h1, h2, start) => {
      if (!start) return

      // Collision debounce: skip rapid repeat collisions on same pair
      const pairKey = h1 < h2 ? `${h1}_${h2}` : `${h2}_${h1}`
      const now = performance.now()
      const lastTime = this.lastCollisionTime.get(pairKey) || 0
      if (now - lastTime < Game.COLLISION_DEBOUNCE_MS) return
      this.lastCollisionTime.set(pairKey, now)

      // Skip static-static collisions
      const world = this.physics.getWorld()
      if (world) {
        const b1 = world.getRigidBody(h1)
        const b2 = world.getRigidBody(h2)
        if (b1?.isFixed() && b2?.isFixed()) return
      }

      this.processCollision(h1, h2)
    })

    // Use clamped dt for visual/gameplay updates
    const dt = Math.min(rawDt, 1 / 30)

    // Selective mesh sync: skip static/sleeping/unmoved bodies
    const bindings = this.gameObjects?.getBindings() || []
    for (const binding of bindings) {
      const body = binding.rigidBody
      const mesh = binding.mesh
      if (!body || !mesh) continue

      // Skip fixed bodies (walls, bumpers, etc.) - they never move
      if (body.isFixed()) continue
      // Skip sleeping bodies - they haven't moved
      if (body.isSleeping()) continue

      const pos = body.translation()
      const rot = body.rotation()

      // Defensive: validate physics values before assignment
      if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y) || !Number.isFinite(pos.z)) continue
      if (Math.abs(pos.x) > 100 || Math.abs(pos.y) > 100 || Math.abs(pos.z) > 100) continue

      mesh.position.set(pos.x, pos.y, pos.z)

      if (!mesh.rotationQuaternion) {
        mesh.rotationQuaternion = new Quaternion(rot.x, rot.y, rot.z, rot.w)
      } else {
        mesh.rotationQuaternion.set(rot.x, rot.y, rot.z, rot.w)
      }
    }

    // Camera shake is now handled by EffectsSystem.updateCameraShake()

    // Dynamic camera targeting with rule-of-thirds framing
    if (!GameConfig.camera.reducedMotion && this.cameraController && this.ballManager?.getBallBody()) {
      const ballBody = this.ballManager.getBallBody()!
      const pos = ballBody.translation()
      const vel = ballBody.linvel()
      const cameraMode = this.isCameraFollowMode ? CameraMode.BALL_FOLLOW : this.getCameraMode()

      this.cameraController.update(
        dt,
        new Vector3(pos.x, pos.y, pos.z),
        new Vector3(vel.x, vel.y, vel.z),
        cameraMode
      )

      // Apply vertical offset for follow mode (LAYOUT-01)
      if (this.isCameraFollowMode && this.tableCam) {
        const targetY = pos.y + 2.5
        this.tableCam.target.y += (targetY - this.tableCam.target.y) * dt * 5
      }
    }

    // Dynamic World update (scrolling adventure mode)
    if (this.dynamicWorld && this.ballManager?.getBallBody()) {
      const ballBody = this.ballManager.getBallBody()!
      const pos = ballBody.translation()
      this.dynamicWorld.update(new Vector3(pos.x, pos.y, pos.z), dt)
    }

    if (this.debugHUD?.isHUDVisible() && this.stateManager.isPlaying()) {
      this.debugHUD.update(this.buildDebugSnapshot(rawDt))
    }

    // Sync Adventure Mode Kinematics
    const currentBallBodies = this.ballManager?.getBallBodies() || []
    this.adventureMode?.update(dt, currentBallBodies)
    
    // Update Zone Trigger System (Dynamic Mode)
    this.zoneTriggerSystem?.update(currentBallBodies)

    this.gameObjects?.updateBumpers(dt)
    this.gameObjects?.updateTargets(dt)

    if (this.magSpinFeeder) {
      const ballBodies = this.ballManager?.getBallBodies() || []
      this.magSpinFeeder.update(dt, ballBodies)
    }

    if (this.nanoLoomFeeder) {
        const ballBodies = this.ballManager?.getBallBodies() || []
        this.nanoLoomFeeder.update(dt, ballBodies)
    }

    if (this.prismCoreFeeder) {
        const ballBodies = this.ballManager?.getBallBodies() || []
        this.prismCoreFeeder.update(dt, ballBodies)
    }

    if (this.gaussCannon) {
        const ballBodies = this.ballManager?.getBallBodies() || []
        this.gaussCannon.update(dt, ballBodies)
    }

    if (this.quantumTunnel) {
        const ballBodies = this.ballManager?.getBallBodies() || []
        this.quantumTunnel.update(dt, ballBodies)
    }

    this.ballManager?.updateCaughtBalls(dt, () => {
      this.effects?.playBeep(440)
    })

    this.effects?.updateShards(dt)
    this.effects?.updateBloom()
    this.effects?.updateCabinetLighting()
    this.effects?.updateSlotLighting()

    // Update LCD table state for map transitions
    this.mapManager?.update(dt)

    // Update Zone Trigger System for Dynamic Adventure Mode
    if (this.zoneTriggerSystem) {
      const ballBodies = this.ballManager?.getBallBodies() || []
      this.zoneTriggerSystem.update(ballBodies)
    }

    // Adventure Mode: Track survival time
    this.adventureState.updateGoal('survive-time', dt)

    // State-based atmosphere: fog, light temperature, rim drama, bounce proximity
    {
      const ballBody = this.ballManager?.getBallBody()
      const ballPos = ballBody ? (() => {
        const t = ballBody.translation()
        return new Vector3(t.x, t.y, t.z)
      })() : undefined
      this.effects?.updateAtmosphere(dt, ballPos)
    }
    this.ballManager?.updateTrailEffects()
    this.ballManager?.updateGoldBallGlow(dt)
    // Enhanced effects update with fever trail support
    const ballBodies = this.ballManager?.getBallBodies() || []
    const isFever = this.effects?.currentLightingMode === 'fever'
    this.effects?.update(dt, ballBodies, isFever)

    // Stuck ball detection: auto-reset balls that are stuck or out-of-bounds
    const stuckBalls = this.ballManager?.updateStuckDetection(dt) || []
    for (const stuckBall of stuckBalls) {
      if (stuckBall === this.ballManager?.getBallBody()) {
        this.ballManager?.resetBall()
      } else {
        this.ballManager?.removeBall(stuckBall)
      }
    }

    // Refresh handle caches when ball count changes
    if (stuckBalls.length > 0) {
      this.rebuildHandleCaches()
    }

    // Pass Jackpot Phase to display
    const jackpotPhase = this.effects?.jackpotPhase || 0
    this.display?.update(dt, jackpotPhase)

    // Sync State: If effects system says jackpot is over, revert display and atmosphere
    if (this.effects && !this.effects.isJackpotActive && this.display?.getDisplayState() === DisplayState.JACKPOT) {
        this.eventBus.emit('jackpot:end')
        this.eventBus.emit('display:set', DisplayState.IDLE)
        this.effects.setAtmosphereState('IDLE')
    }

    this.updateCombo(dt)
    this.updateTiltDecay(dt)

    if (this.powerupActive) {
      this.powerupTimer -= dt
      if (this.powerupTimer <= 0) this.powerupActive = false
    }
  }

  private processCollision(h1: number, h2: number): void {
    const world = this.physics.getWorld()
    if (!world) return

    // Validate handles
    if (h1 === 0 || h2 === 0 || h1 === h2) return

    const b1 = world.getRigidBody(h1)
    const b2 = world.getRigidBody(h2)
    if (!b1 || !b2) return

    // Adventure mode sensor (O(1) handle check)
    if (this.adventureSensorHandle >= 0 && (h1 === this.adventureSensorHandle || h2 === this.adventureSensorHandle)) {
      this.endAdventureMode()
      return
    }

    // Death zone (O(1) handle check)
    if (this.deathZoneHandle >= 0 && (h1 === this.deathZoneHandle || h2 === this.deathZoneHandle)) {
      const ball = (h1 === this.deathZoneHandle) ? b2 : b1
      this.handleBallLoss(ball)
      return
    }

    // Bumper collision (O(1) Set lookup instead of O(N) array find)
    const h1IsBumper = this.bumperHandleSet.has(h1)
    const h2IsBumper = this.bumperHandleSet.has(h2)
    if (h1IsBumper || h2IsBumper) {
      const bump = h1IsBumper ? b1 : b2
      const ballBody = h1IsBumper ? b2 : b1
      const ballHandle = h1IsBumper ? h2 : h1

      if (this.ballHandleSet.has(ballHandle)) {
        const ballPos = ballBody.translation()
        const bumperVisuals = this.gameObjects?.getBumperVisuals() || []
        const vis = bumperVisuals.find(v => v.body === bump)

        if (vis) {
          // Trigger ball squash-and-stretch animation on impact
          const ballMesh = this.getBallMeshForBody(ballBody)
          if (ballMesh && this.ballAnimator) {
            const velocity = ballBody.linvel()
            const speed = Math.sqrt(velocity.x ** 2 + velocity.y ** 2 + velocity.z ** 2)
            const impactIntensity = Math.min(speed / 20, 1.0)
            // Calculate impact normal (from bumper to ball)
            const bumperPos = vis.mesh.position
            const impactNormal = new Vector3(
              ballPos.x - bumperPos.x,
              ballPos.y - bumperPos.y,
              ballPos.z - bumperPos.z
            ).normalize()
            this.ballAnimator.animateBallImpact(ballMesh, impactNormal, impactIntensity)
          }

          if (ballPos.y > 1.5) {
            if (this.display?.getDisplayState() === DisplayState.IDLE) {
              this.activateHologramCatch(ballBody, bump)
              return
            }
          } else {
            this.gameObjects?.activateBumperHit(bump)
            this.effects?.addCameraShake(0.3)
            this.score += (GAME_TUNING.scoring.bumperHitBase * (Math.floor(this.comboCount / GAME_TUNING.combo.multiplierDivisor) + 1))
            this.comboCount++
            this.comboTimer = GAME_TUNING.combo.expirySeconds

            // FEVER mode: sustained rapid bumper chain
            if (this.comboCount >= GAME_TUNING.combo.feverThreshold && this.display?.getDisplayState() === DisplayState.IDLE) {
              this.eventBus.emit('fever:start')
              this.eventBus.emit('display:set', DisplayState.FEVER)
              this.effects?.setLightingMode('fever', 0)
            }

            // Use enhanced bumper impact with screen shake and ripple rings
            this.effects?.spawnEnhancedBumperImpact(vis.mesh.position, 'medium')
            // Spawn pooled neon spark burst
            this.effects?.spawnBumperSpark(vis.mesh.position, vis.color || PALETTE.CYAN)
            // Spawn animated impact ring effect
            this.effects?.spawnImpactRing(vis.mesh.position, new Vector3(0, 1, 0), PALETTE.CYAN)
            this.effects?.playBeep(400 + Math.random() * 200)
            this.updateHUD()
            this.effects?.setLightingMode('hit', 0.2)

            // Adventure Mode: Track peg hits
            this.adventureState.updateGoal('hit-pegs', 1)

            // Haptic feedback on bumper hit - intensity based on ball velocity
            const velocity = ballBody.linvel()
            const speed = Math.sqrt(velocity.x ** 2 + velocity.y ** 2 + velocity.z ** 2)
            this.hapticManager?.bumper(speed)

            // Secret cabinet shake on big bumper hits
            if (speed > 12) {
              const mapColor = TABLE_MAPS[this.mapManager?.getCurrentMap() || 'neon-helix']?.baseColor || '#00d9ff'
              this.effects?.triggerCabinetShake('heavy', mapColor)
            }

            // Play bumper sound
            this.soundSystem.playSample('bumper', vis.mesh.position)

            return
          }
        }
      }
    }

    // Target collision (O(1) Set lookup)
    const h1IsTarget = this.targetHandleSet.has(h1)
    const h2IsTarget = this.targetHandleSet.has(h2)
    if (h1IsTarget || h2IsTarget) {
      const tgt = h1IsTarget ? b1 : b2
      const ballBody = h1IsTarget ? b2 : b1
      const ballHandle = h1IsTarget ? h2 : h1

      if (this.ballHandleSet.has(ballHandle)) {
        // Trigger ball squash animation on target hit
        const ballMesh = this.getBallMeshForBody(ballBody)
        if (ballMesh && this.ballAnimator) {
          const velocity = ballBody.linvel()
          const speed = Math.sqrt(velocity.x ** 2 + velocity.y ** 2 + velocity.z ** 2)
          const impactIntensity = Math.min(speed / 20, 1.0)
          this.ballAnimator.animateSimpleImpact(ballMesh, impactIntensity)
        }
      }

      if (this.gameObjects?.deactivateTarget(tgt)) {
        this.score += GAME_TUNING.scoring.targetHitBase
        this.effects?.playBeep(1200)
        this.ballManager?.spawnExtraBalls(1)
        this.updateHUD()
        this.eventBus.emit('reach:start')
        this.eventBus.emit('display:set', DisplayState.REACH)
        this.effects?.setLightingMode('reach', 3.0)
        this.effects?.setAtmosphereState('REACH')

        // Rebuild handle caches since new balls were spawned
        this.rebuildHandleCaches()

        // Try to activate slot machine (intermittent activation)
        this.tryActivateSlotMachine()
      }
    }
  }

  /**
   * Get the Babylon mesh associated with a physics body
   */
  private getBallMeshForBody(body: RAPIER.RigidBody): Mesh | null {
    // Check gameObjects bindings first
    const gameObjectBinding = this.gameObjects?.getBindings().find(b => b.rigidBody === body)
    if (gameObjectBinding) {
      return gameObjectBinding.mesh as Mesh
    }
    // Then check ballManager bindings
    const ballManagerBinding = this.ballManager?.getBindings().find(b => b.rigidBody === body)
    return ballManagerBinding?.mesh as Mesh || null
  }

  private activateHologramCatch(ball: RAPIER.RigidBody, bumper: RAPIER.RigidBody): void {
    const bumperVisuals = this.gameObjects?.getBumperVisuals() || []
    const visual = bumperVisuals.find(v => v.body === bumper)
    if (!visual || !visual.hologram) return

    this.ballManager?.activateHologramCatch(ball, visual.hologram.position, 4.0)
    this.effects?.playBeep(880)
    this.eventBus.emit('reach:start')
    this.eventBus.emit('display:set', DisplayState.REACH)
    this.effects?.setLightingMode('reach', 4.0) // Add Reach lighting
  }

  private handleBallLoss(body: RAPIER.RigidBody): void {
    if (!this.stateManager.isPlaying()) return

    this.comboCount = 0
    if (this.display?.getDisplayState() === DisplayState.FEVER) {
      this.eventBus.emit('fever:end')
      this.eventBus.emit('display:set', DisplayState.IDLE)
      this.effects?.setLightingMode('normal', 0)
    }

    // Check if this was a gold ball before removing
    const collected = this.ballManager?.collectBall(body)
    
    if (collected && collected.type !== BallType.STANDARD) {
      // Play collection sound
      this.soundSystem.playGoldBallCollect(collected.type)

      // Add to visual stack
      this.ballStackVisual?.addBall(collected.type)

      // Add to stack
      this.goldBallStack.push({
        type: collected.type,
        timestamp: performance.now()
      })

      // Track session total
      this.sessionGoldBalls++
      
      // Bonus points
      this.score += collected.points

      // Show floating points feedback
      this.uiManager?.showMessage(`+${collected.points}`, 1500)
      
      // Trigger effects
      if (collected.type === BallType.SOLID_GOLD) {
        this.effects?.startSolidGoldPulse()
        this.eventBus.emit('jackpot:start')
        this.eventBus.emit('display:set', DisplayState.JACKPOT)
        this.hapticManager?.jackpot()
      } else {
        this.effects?.setBloomEnergy(1.5)
      }
      
      // Update UI
      this.updateGoldBallDisplay()
    }
    
    // Remove the ball
    this.ballManager?.removeBall(body)

    // Haptic feedback on ball loss
    this.hapticManager?.ballLost()
    
    // Play drain sound
    this.soundSystem.playSample('drain')

    const ballBody = this.ballManager?.getBallBody()
    if (body === ballBody) {
      const ballBodies = this.ballManager?.getBallBodies() || []
      if (ballBodies.length > 0) {
        this.ballManager?.setBallBody(ballBodies[0])
      } else {
        this.lives--
        if (this.lives > 0) {
          this.resetBall()
        } else {
          this.setGameState(GameState.GAME_OVER)
        }
      }
    }

    this.updateHUD()
  }

  /**
   * Update or create the gold ball counter UI
   */
  private updateGoldBallDisplay(): void {
    // Count by type
    const goldPlated = this.goldBallStack.filter(b => b.type === BallType.GOLD_PLATED).length
    const solidGold = this.goldBallStack.filter(b => b.type === BallType.SOLID_GOLD).length
    this.uiManager?.updateGoldBallDisplay(goldPlated, solidGold)

    // Also update a small session badge if it exists
    let sessionBadge = document.getElementById('gold-session-badge')
    if (!sessionBadge) {
      sessionBadge = document.createElement('div')
      sessionBadge.id = 'gold-session-badge'
      sessionBadge.style.cssText = `
        position: absolute;
        top: 60px;
        right: 110px;
        background: rgba(0,0,0,0.6);
        border: 1px solid #ffb700;
        border-radius: 4px;
        padding: 4px 8px;
        font-family: 'Orbitron', sans-serif;
        color: #ffb700;
        font-size: 12px;
        z-index: 50;
      `
      document.getElementById('game-cabinet')?.appendChild(sessionBadge)
    }
    sessionBadge.textContent = `SESSION: ${this.sessionGoldBalls}`
  }

  private resetBall(): void {
    this.ballManager?.resetBall()
    this.applyEquippedRewards()
    this.updateHUD()
  }

  /**
   * Apply equipped rewards (ball trail, skin) when spawning ball
   */
  private applyEquippedRewards(): void {
    const ballTrailReward = this.adventureState.getEquippedReward('ball-trail')
    const skinReward = this.adventureState.getEquippedReward('skin')

    if (ballTrailReward) {
      this.ballManager?.applyBallTrail(ballTrailReward.id)
    }

    if (skinReward) {
      this.ballManager?.applyBallSkin(skinReward.id)
    }
  }

  private updateHUD(): void {
    // Update main HUD
    this.uiManager?.updateHUD({
      score: this.score,
      lives: this.lives,
      combo: this.comboCount,
      bestScore: this.bestScore
    })

    // Adventure Mode: Track score progress
    this.adventureState.setGoalProgress('reach-score', this.score)

    // Update adventure HUD
    this.updateAdventureHUD()
  }

  private updateAdventureHUD(): void {
    const level = this.adventureState.getCurrentLevel()
    if (!level) {
      this.uiManager?.hideAdventureHUD()
      return
    }

    this.uiManager?.updateAdventureHUD(
      {
        name: level.name,
        goals: level.goals.map(g => ({
          description: g.description,
          current: g.current,
          target: g.target
        }))
      },
      this.adventureState.getOverallCompletionPercent()
    )
  }

  private updateCombo(dt: number): void {
    if (this.comboTimer > 0) {
      this.comboTimer -= dt
      if (this.comboTimer <= 0) {
        this.comboCount = 0
        this.updateHUD()
        if (this.display?.getDisplayState() === DisplayState.FEVER) {
          this.eventBus.emit('fever:end')
          this.eventBus.emit('display:set', DisplayState.IDLE)
          this.effects?.setLightingMode('normal', 0)
        }
      }
    }
  }

  // ============================================================================
  // LEADERBOARD - Game Over Score Submission
  // ============================================================================
  
  private async handleGameOverLeaderboard(): Promise<void> {
    // Only submit if score is significant
    if (this.score < 1000) {
      console.log('[Leaderboard] Score too low for submission')
      return
    }
    
    // Update leaderboard context
    this.leaderboardSystem.setContext(this.mapManager?.getCurrentMap() || 'neon-helix')
    
    // Check if score ranks on leaderboard
    const rank = await this.leaderboardSystem.checkRank(this.score)
    
    // Only prompt for name if score is in top 100 (or if rank check failed)
    if (rank === null || rank > 100) {
      console.log('[Leaderboard] Score not in top 100')
      return
    }
    
    // Show name entry dialog
    const result = await this.nameEntryDialog.show(this.score, rank)
    
    if (result.submitted && result.name) {
      // Submit score
      const submitResult = await this.leaderboardSystem.submitScore({
        name: result.name,
        score: this.score,
        map_id: this.mapManager?.getCurrentMap() || 'neon-helix',
        balls: 1, // TODO: track actual balls used
        combo_max: this.comboCount
      })
      
      if (submitResult.success) {
        console.log(`[Leaderboard] Score submitted! Rank #${submitResult.rank}`)
        // Show leaderboard
        this.leaderboardSystem.show()
      }
    }
  }

  // ============================================================================
  // SLOT MACHINE SETUP
  // ============================================================================

  private setupSlotMachineCallbacks(): void {
    if (!this.display) return

    // Configure slot machine for hybrid activation (30% chance every 10,000 points)
    this.display.configureSlotMachine({
      activationMode: 'hybrid' as import('./game-elements/types').SlotActivationMode,
      chancePercent: 0.3,
      scoreThreshold: 10000,
      enableSounds: true,
      enableLightEffects: true,
    })

    // Setup event callback
    this.display.setSlotEventCallback((event, data) => {
      switch (event) {
        case 'spin-start':
          this.effects?.playSlotSpinStart()
          this.effects?.setSlotLightingMode('spin')
          console.log('[Slot] Spin started:', data)
          break

        case 'reel-stop': {
          const reelData = data as { reel: number; symbol: string }
          this.effects?.playReelStop(reelData.reel)
          if (reelData.reel === 2) { // Last reel
            this.effects?.setSlotLightingMode('stop')
          }
          break
        }

        case 'win': {
          const winData = data as { combination: { name: string; multiplier: number }; score: number }
          this.effects?.playSlotWin(winData.combination.multiplier)
          this.effects?.setSlotLightingMode('win')
          this.score += winData.score
          this.updateHUD()
          console.log(`[Slot] Win: ${winData.combination.name} - ${winData.score} points`)
          break
        }

        case 'jackpot': {
          const jackpotData = data as { combination: { name: string }; score: number }
          this.effects?.playSlotJackpot()
          this.effects?.setSlotLightingMode('jackpot')
          this.triggerJackpot()
          console.log(`[Slot] JACKPOT! ${jackpotData.score} points`)
          break
        }

        case 'near-miss':
          this.effects?.playNearMiss()
          console.log('[Slot] Near miss!')
          break

        case 'activation-chance':
          console.log('[Slot] Activated:', data)
          break

        case 'activation-denied':
          console.log('[Slot] Activation denied:', data)
          break
      }
    })
  }

  /**
   * Try to activate slot machine on target hit
   */
  private tryActivateSlotMachine(): void {
    if (!this.display) return

    if (this.display.shouldActivateSlotMachine(this.score)) {
      this.display.startSlotSpin()
    }
  }

  // Ordered list of adventure tracks for cycling
  private static readonly TRACK_ORDER: AdventureTrackType[] = [
    AdventureTrackType.NEON_HELIX,
    AdventureTrackType.CYBER_CORE,
    AdventureTrackType.QUANTUM_GRID,
    AdventureTrackType.SINGULARITY_WELL,
    AdventureTrackType.GLITCH_SPIRE,
    AdventureTrackType.RETRO_WAVE_HILLS,
    AdventureTrackType.CHRONO_CORE,
    AdventureTrackType.HYPER_DRIFT,
    AdventureTrackType.PACHINKO_SPIRE,
    AdventureTrackType.ORBITAL_JUNKYARD,
    AdventureTrackType.FIREWALL_BREACH,
    AdventureTrackType.CPU_CORE,
    AdventureTrackType.CRYO_CHAMBER,
    AdventureTrackType.BIO_HAZARD_LAB,
    AdventureTrackType.GRAVITY_FORGE,
    AdventureTrackType.TIDAL_NEXUS,
    AdventureTrackType.DIGITAL_ZEN_GARDEN,
    AdventureTrackType.SYNTHWAVE_SURF,
    AdventureTrackType.SOLAR_FLARE,
    AdventureTrackType.PRISM_PATHWAY,
    AdventureTrackType.MAGNETIC_STORAGE,
    AdventureTrackType.NEURAL_NETWORK,
    AdventureTrackType.NEON_STRONGHOLD,
    AdventureTrackType.CASINO_HEIST,
    AdventureTrackType.TESLA_TOWER,
    AdventureTrackType.NEON_SKYLINE,
    AdventureTrackType.POLYCHROME_VOID,
  ]

  // Cycling variable for adventure tracks
  private nextAdventureTrack: AdventureTrackType = AdventureTrackType.NEON_HELIX;

  private getTrackDisplayName(track: AdventureTrackType): string {
    return track.replace(/_/g, ' ')
  }

  private cycleAdventureTrack(direction: number): void {
    if (!this.adventureMode?.isActive()) return

    const currentIndex = Game.TRACK_ORDER.indexOf(this.nextAdventureTrack)
    // nextAdventureTrack was already advanced past current, so go back one to find current
    const prevIndex = (currentIndex - 1 + Game.TRACK_ORDER.length) % Game.TRACK_ORDER.length
    const newIndex = (prevIndex + direction + Game.TRACK_ORDER.length) % Game.TRACK_ORDER.length
    const newTrack = Game.TRACK_ORDER[newIndex]

    // Set nextAdventureTrack so startAdventureMode picks it up
    this.nextAdventureTrack = newTrack

    // End current track and start new one
    this.endAdventureMode()
    this.startAdventureMode()
  }

  private startAdventureMode(): void {
    if (!this.adventureMode || !this.scene) return

    const ballBody = this.ballManager?.getBallBody()
    const camera = this.scene.activeCamera as ArcRotateCamera
    const bindings = this.gameObjects?.getBindings() || []
    const ballMesh = bindings.find(b => b.rigidBody === ballBody)?.mesh

    if (ballBody && camera) {
      const pinballMeshes = this.gameObjects?.getPinballMeshes() || []
      pinballMeshes.forEach(m => m.setEnabled(false))

      const track = this.nextAdventureTrack

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.adventureMode.start(ballBody, camera, ballMesh as any, track)

      const trackName = this.getTrackDisplayName(track)
      if (this.scoreElement) {
        this.scoreElement.innerText = `HOLO-DECK: ${trackName}`
      }
      this.adventureModeStartMs = performance.now()

      // Update head screen with track info
      this.display?.setTrackInfo(trackName)
      this.display?.setStoryText(`SECTOR: ${trackName}`)

      // Advance to next track for next activation
      const currentIndex = Game.TRACK_ORDER.indexOf(track)
      this.nextAdventureTrack = Game.TRACK_ORDER[(currentIndex + 1) % Game.TRACK_ORDER.length]
    }
  }

  private endAdventureMode(): void {
    if (!this.adventureMode) return

    const pinballMeshes = this.gameObjects?.getPinballMeshes() || []
    pinballMeshes.forEach(m => m.setEnabled(true))

    this.adventureMode.end()
    this.adventureModeStartMs = null
    this.resetBall()
    this.updateHUD()
  }

  private isDebugHUDAvailable(): boolean {
    return import.meta.env.DEV || this.debugHUDQueryEnabled
  }

  private isDebugHUDKeyboardEnabled(): boolean {
    return this.isDebugHUDAvailable()
  }

  private handleDebugHUDVisibilityChange(visible: boolean): void {
    if (visible) {
      this.initializeDebugInstrumentation()
      return
    }
    this.disposeDebugInstrumentation()
  }

  private initializeDebugInstrumentation(): void {
    if (!this.scene) return
    if (!this.sceneInstrumentation) {
      this.sceneInstrumentation = new SceneInstrumentation(this.scene)
      this.sceneInstrumentation.captureActiveMeshesEvaluationTime = false
      this.sceneInstrumentation.captureRenderTargetsRenderTime = false
      this.sceneInstrumentation.captureFrameTime = true
      this.sceneInstrumentation.captureInterFrameTime = false
    }

    if (!this.engineInstrumentation) {
      this.engineInstrumentation = new EngineInstrumentation(this.engine)
      this.engineInstrumentation.captureGPUFrameTime = false
      this.engineInstrumentation.captureShaderCompilationTime = false
    }
  }

  private disposeDebugInstrumentation(): void {
    this.sceneInstrumentation?.dispose()
    this.sceneInstrumentation = null
    this.engineInstrumentation?.dispose()
    this.engineInstrumentation = null
  }

  private buildDebugSnapshot(rawDt: number): DebugSnapshot {
    const gameState = GameState[this.stateManager.getState()] ?? 'UNKNOWN'
    const displayState = this.display?.getDisplayState() ?? 'none'
    // Babylon does not expose a stable public draw-call counter on all engine types,
    // so diagnostics read the internal perf counter if present.
    const drawCallsCounter = (this.engine as unknown as { _drawCalls?: { current?: number } })._drawCalls
    const adventureTrack = this.adventureMode?.getCurrentZone()
    const activeZoneId = this.zoneTriggerSystem?.getCurrentZoneId()
    const dynamicZoneLabel = activeZoneId ?? this.dynamicWorld?.getCurrentZoneInfo()?.name ?? null
    const multiplier = Math.floor(this.comboCount / Game.DEBUG_COMBO_MULTIPLIER_STEP) + 1
    const isAdventureActive = this.adventureMode?.isActive() ?? false
    const adventureTimeMs = isAdventureActive && this.adventureModeStartMs !== null
      ? performance.now() - this.adventureModeStartMs
      : null

    return {
      gameState,
      displayState,
      score: this.score,
      multiplier,
      lives: this.lives,
      adventureTrack: adventureTrack ? this.getTrackDisplayName(adventureTrack) : null,
      fps: this.scene?.getEngine().getFps() ?? 0,
      drawCalls: drawCallsCounter?.current ?? 0,
      frameTimeMs: rawDt * 1000,
      activeBodies: this.physics.getWorld().bodies.len(),
      physicsStepMs: rawDt * 1000,
      adventureTimeMs,
      dynamicZoneState: dynamicZoneLabel,
      performanceTier: this.effects?.getRuntimePerformanceTier() || 'high',
    }
  }

  private updateDeveloperSettingsVisibility(): void {
    const developerSection = document.getElementById('developer-settings')
    if (!developerSection) return
    developerSection.classList.toggle('hidden', !this.isDebugHUDAvailable())
  }

  // ============================================================================
  // SETTINGS UI
  // ============================================================================

  private setupSettingsUI(): void {
    const settingsBtn = document.getElementById('settings-btn')
    const settingsOverlay = document.getElementById('settings-overlay')
    const closeBtn = document.getElementById('close-settings')
    const saveBtn = document.getElementById('save-settings')

    settingsBtn?.addEventListener('click', () => {
      this.updateDeveloperSettingsVisibility()
      settingsOverlay?.classList.remove('hidden')
      this.loadSettingsIntoUI()
    })

    closeBtn?.addEventListener('click', () => {
      settingsOverlay?.classList.add('hidden')
    })

    saveBtn?.addEventListener('click', () => {
      this.saveSettingsFromUI()
      settingsOverlay?.classList.add('hidden')
    })
  }

  private loadSettingsIntoUI(): void {
    const settings = SettingsManager.load()
    const reducedMotionCheckbox = document.getElementById('reduced-motion') as HTMLInputElement
    const photosensitiveCheckbox = document.getElementById('photosensitive-mode') as HTMLInputElement
    const shakeSlider = document.getElementById('shake-intensity') as HTMLInputElement
    const scanlineSlider = document.getElementById('scanline-intensity') as HTMLInputElement
    const debugHUDCheckbox = document.getElementById('enable-debug-hud') as HTMLInputElement
    
    // Audio settings
    const masterVolumeSlider = document.getElementById('master-volume') as HTMLInputElement
    const musicVolumeSlider = document.getElementById('music-volume') as HTMLInputElement
    const sfxVolumeSlider = document.getElementById('sfx-volume') as HTMLInputElement
    const muteCheckbox = document.getElementById('mute-audio') as HTMLInputElement

    if (reducedMotionCheckbox) reducedMotionCheckbox.checked = settings.reducedMotion
    if (photosensitiveCheckbox) photosensitiveCheckbox.checked = settings.photosensitiveMode
    if (shakeSlider) shakeSlider.value = String(settings.shakeIntensity)
    if (scanlineSlider) {
      scanlineSlider.value = String(settings.scanlineIntensity)
      const span = scanlineSlider.parentElement?.querySelector('span')
      if (span) span.setAttribute('data-value', String(settings.scanlineIntensity))
    }
    if (debugHUDCheckbox) debugHUDCheckbox.checked = settings.enableDebugHUD
    
    // Apply photosensitive mode to LCD table
    this.mapManager?.getLCDTableState().setPhotosensitiveMode(settings.photosensitiveMode)
    
    // Load audio settings
    const volumeSettings = this.soundSystem.getVolumeSettings()
    if (masterVolumeSlider) masterVolumeSlider.value = String(volumeSettings.master)
    if (musicVolumeSlider) musicVolumeSlider.value = String(volumeSettings.music)
    if (sfxVolumeSlider) sfxVolumeSlider.value = String(volumeSettings.sfx)
    if (muteCheckbox) muteCheckbox.checked = volumeSettings.muted
  }

  private saveSettingsFromUI(): void {
    const reducedMotionCheckbox = document.getElementById('reduced-motion') as HTMLInputElement
    const photosensitiveCheckbox = document.getElementById('photosensitive-mode') as HTMLInputElement
    const shakeSlider = document.getElementById('shake-intensity') as HTMLInputElement
    const scanlineSlider = document.getElementById('scanline-intensity') as HTMLInputElement
    const debugHUDCheckbox = document.getElementById('enable-debug-hud') as HTMLInputElement
    
    // Audio settings
    const masterVolumeSlider = document.getElementById('master-volume') as HTMLInputElement
    const musicVolumeSlider = document.getElementById('music-volume') as HTMLInputElement
    const sfxVolumeSlider = document.getElementById('sfx-volume') as HTMLInputElement
    const muteCheckbox = document.getElementById('mute-audio') as HTMLInputElement

    const newSettings = {
      reducedMotion: reducedMotionCheckbox?.checked ?? false,
      photosensitiveMode: photosensitiveCheckbox?.checked ?? false,
      shakeIntensity: parseFloat(shakeSlider?.value ?? '0.08'),
      scanlineIntensity: parseFloat(scanlineSlider?.value ?? '0.12'),
      enableDebugHUD: debugHUDCheckbox?.checked ?? false,
      enableFog: true,
      enableShadows: true
    }

    SettingsManager.save(newSettings)
    SettingsManager.applyToConfig(newSettings)
    this.debugHUDEnabledInSettings = newSettings.enableDebugHUD
    this.scanlineIntensity = newSettings.scanlineIntensity
    console.log('[Accessibility] Settings saved:', newSettings)

    if (this.debugHUDEnabledInSettings && this.isDebugHUDAvailable()) {
      this.debugHUD?.show()
    } else {
      this.debugHUD?.hide()
    }
    
    // Apply photosensitive mode to LCD table
    this.mapManager?.getLCDTableState().setPhotosensitiveMode(newSettings.photosensitiveMode)
    
    // Apply audio settings
    if (masterVolumeSlider) {
      this.soundSystem.setMasterVolume(parseFloat(masterVolumeSlider.value))
    }
    if (musicVolumeSlider) {
      this.soundSystem.setMusicVolume(parseFloat(musicVolumeSlider.value))
    }
    if (sfxVolumeSlider) {
      this.soundSystem.setSfxVolume(parseFloat(sfxVolumeSlider.value))
    }
    if (muteCheckbox && muteCheckbox.checked !== this.soundSystem.getVolumeSettings().muted) {
      this.soundSystem.toggleMute()
    }
  }

  // ============================================================================
  // LATENCY OVERLAY (Debug Mode)
  // ============================================================================

  private setupLatencyOverlay(): void {
    if (!this.showDebugUI) return

    // Create simple HTML overlay for latency display
    this.inputLatencyOverlay = document.createElement('div')
    this.inputLatencyOverlay.id = 'latency-overlay'
    this.inputLatencyOverlay.style.cssText = `
      position: fixed;
      top: 10px;
      left: 10px;
      background: rgba(0, 0, 0, 0.7);
      color: #00ff00;
      padding: 8px 12px;
      border-radius: 4px;
      font-family: monospace;
      font-size: 12px;
      z-index: 1000;
      pointer-events: none;
      border: 1px solid #00ff00;
    `
    this.inputLatencyOverlay.textContent = 'Input: -- ms'
    document.body.appendChild(this.inputLatencyOverlay)
  }

  private updateLatencyDisplay(): void {
    if (!this.inputLatencyOverlay || !this.showDebugUI) return

    const report = this.inputManager?.getLatencyReport()
    if (report) {
      this.inputLatencyOverlay.textContent =
        `Input: ${report.avg.toFixed(1)}ms (P95: ${report.p95.toFixed(1)}ms)`

      // Color code based on latency
      if (report.avg > 20) {
        this.inputLatencyOverlay.style.color = '#ff0000' // Red
        this.inputLatencyOverlay.style.borderColor = '#ff0000'
      } else if (report.avg > 10) {
        this.inputLatencyOverlay.style.color = '#ffff00' // Yellow
        this.inputLatencyOverlay.style.borderColor = '#ffff00'
      } else {
        this.inputLatencyOverlay.style.color = '#00ff00' // Green
        this.inputLatencyOverlay.style.borderColor = '#00ff00'
      }
    }
  }


  /**
   * Set up the on-screen LCD-style map selector buttons.
   * Fetches dynamic maps from the backend and builds the UI.
   * Clicking a button triggers smooth map switch with satisfying feedback.
   */
  private async setupMapSelector(): Promise<void> {
    const selector = document.getElementById('map-selector')
    if (!selector) return

    // Fetch dynamic maps and music from backend in parallel
    await Promise.all([
      this.mapSystem.fetchAll(),
      this.soundSystem.fetchMusicTracks(),
    ])
    for (const map of this.mapSystem.getAllMaps()) {
      if (!TABLE_MAPS[map.id]) {
        registerMap(map.id, map)
      }
    }

    // Build the dynamic map selector UI
    this.buildMapSelectorUI(selector)

    // Set initial highlight
    this.updateMapSelectorUI()
  }

  /**
   * Build the map selector buttons dynamically from fetched maps.
   */
  private buildMapSelectorUI(selector: HTMLElement): void {
    // Clear existing dynamic elements
    const existingButtons = selector.querySelectorAll('.map-btn, .map-refresh, .map-add-hint')
    existingButtons.forEach((el) => el.remove())

    const maps = this.mapSystem.getAllMaps()
    let buttonIndex = 1

    for (const map of maps) {
      const btn = document.createElement('button')
      btn.className = 'map-btn'
      btn.dataset.map = map.id
      btn.title = map.name
      btn.textContent = String(buttonIndex)
      btn.addEventListener('click', () => {
        if (map.id !== this.mapManager?.getCurrentMap()) {
          this.animateMapButtonPress(btn)
          this.mapManager?.getLCDTableState().triggerFeedbackEffect()
          this.switchTableMap(map.id)
        }
      })
      selector.appendChild(btn)
      buttonIndex++
    }

    // Add refresh button (small circular icon)
    const refreshBtn = document.createElement('button')
    refreshBtn.className = 'map-btn map-refresh'
    refreshBtn.title = 'Refresh Content'
    refreshBtn.textContent = '↻'
    refreshBtn.addEventListener('click', async () => {
      refreshBtn.classList.add('spinning')
      await Promise.all([
        this.mapSystem.refresh(),
        this.soundSystem.fetchMusicTracks(),
      ])
      for (const map of this.mapSystem.getAllMaps()) {
        if (!TABLE_MAPS[map.id]) {
          registerMap(map.id, map)
        }
      }
      this.buildMapSelectorUI(selector)
      this.updateMapSelectorUI()
      refreshBtn.classList.remove('spinning')
    })
    selector.appendChild(refreshBtn)

    // Add "Add New Map" hint pointing to storage_manager admin
    const addHint = document.createElement('a')
    addHint.className = 'map-add-hint'
    addHint.href = 'https://storage.noahcohn.com/admin'
    addHint.target = '_blank'
    addHint.title = 'Upload new maps & music in storage_manager'
    addHint.textContent = '+ Add New Map'
    addHint.style.cssText = `
      display: block;
      margin-top: 6px;
      font-size: 10px;
      color: var(--map-accent, #00d9ff);
      text-decoration: none;
      opacity: 0.7;
      transition: opacity 0.2s;
      text-align: center;
    `
    addHint.addEventListener('mouseenter', () => { addHint.style.opacity = '1' })
    addHint.addEventListener('mouseleave', () => { addHint.style.opacity = '0.7' })
    selector.appendChild(addHint)

    // Set up cabinet selector
    this.setupCabinetSelector()

    // Set up levels selector
    this.setupLevelsSelector()
  }

  /**
   * Set up the cabinet selector buttons.
   */
  private setupCabinetSelector(): void {
    const selector = document.getElementById('cabinet-selector')
    if (!selector) return

    const buttons = selector.querySelectorAll('.cabinet-btn')
    buttons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const cabinetType = btn.getAttribute('data-cabinet') as CabinetType
        if (cabinetType) {
          this.loadCabinetPreset(cabinetType)
        }
      })
    })

    // Set initial active state
    this.updateCabinetSelectorUI()
  }

  /**
   * Set up the levels selector button.
   */
  private setupLevelsSelector(): void {
    const levelsBtn = document.getElementById('levels-btn')
    if (!levelsBtn) return

    levelsBtn.addEventListener('click', () => {
      this.toggleLevelSelect()
    })
  }

  /**
   * Animate map button press with scale + glow burst
   */
  private animateMapButtonPress(btn: HTMLElement): void {
    const config = this.mapManager?.getMapSystem().getMap(this.mapManager?.getCurrentMap() || 'neon-helix') || TABLE_MAPS[this.mapManager?.getCurrentMap() || 'neon-helix']
    const accentColor = config ? config.baseColor : '#00d9ff'

    // Apply press animation
    btn.style.transform = 'scale(0.85)'
    btn.style.transition = 'transform 0.1s ease, box-shadow 0.1s ease'

    // Add glow burst
    btn.style.boxShadow = `
      0 0 20px ${accentColor},
      0 0 40px ${accentColor},
      0 0 60px ${accentColor},
      inset 0 0 20px rgba(255, 255, 255, 0.5)
    `

    // Release animation
    setTimeout(() => {
      btn.style.transform = 'scale(1.05)'
      btn.style.boxShadow = `
        0 0 15px ${accentColor},
        0 0 30px ${accentColor},
        inset 0 0 10px rgba(255, 255, 255, 0.3)
      `

      setTimeout(() => {
        btn.style.transform = ''
        btn.style.boxShadow = ''
        btn.style.transition = ''
      }, 150)
    }, 100)
  }

  /**
   * Update the map selector UI to highlight the current map
   * and sync the CSS accent color to the current LCD theme.
   */
  private updateMapSelectorUI(): void {
    const selector = document.getElementById('map-selector')
    if (!selector) return

    const currentMap = this.mapManager?.getCurrentMap() || 'neon-helix'
    const mapConfig = this.mapSystem.getMap(currentMap) || TABLE_MAPS[currentMap]
    const accentColor = mapConfig ? mapConfig.baseColor : '#00d9ff'

    // Update CSS custom property for the panel glow
    selector.style.setProperty('--map-accent', accentColor)

    // Update active button state
    const buttons = selector.querySelectorAll('.map-btn')
    buttons.forEach((btn) => {
      if (btn.classList.contains('map-refresh')) return
      const mapName = (btn as HTMLElement).dataset.map
      if (mapName === currentMap) {
        btn.classList.add('active')
      } else {
        btn.classList.remove('active')
      }
    })
  }
}
