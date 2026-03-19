import {
  ArcRotateCamera,
  Color3,
  HemisphericLight,
  MeshBuilder,
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
  Scalar
} from '@babylonjs/core'
import { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline'
import type { Engine } from '@babylonjs/core/Engines/engine'
import type { Nullable } from '@babylonjs/core/types'
import type { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine'
import type * as RAPIER from '@dimforge/rapier3d-compat'

import {
  GameState,
  DisplayState,
  PhysicsSystem,
  InputHandler,
  DisplaySystem,
  EffectsSystem,
  GameObjects,
  BallManager,
  AdventureMode,
  AdventureTrackType,
  MagSpinFeeder,
  MagSpinState,
  NanoLoomFeeder,
  NanoLoomState,
  PrismCoreFeeder,
  PrismCoreState,
  GaussCannonFeeder,
  GaussCannonState,
  QuantumTunnelFeeder,
  QuantumTunnelState,
  getMaterialLibrary,
  resetMaterialLibrary,
  detectQualityTier,
  SettingsManager,
  PALETTE,
  SURFACES,
  INTENSITY,
  LIGHTING,
  color,
  emissive,
} from './game-elements'
import { GameConfig } from './config'
import { scanlinePixelShader } from './shaders/scanline'

// Register the shader
Effect.ShadersStore["scanlineFragmentShader"] = scanlinePixelShader.fragment
Effect.ShadersStore["scanlinePixelShader"] = scanlinePixelShader.fragment

export class Game {
  private readonly engine: Engine | WebGPUEngine
  private scene: Nullable<Scene> = null
  
  // Game Systems
  private physics: PhysicsSystem
  private display: DisplaySystem | null = null
  private effects: EffectsSystem | null = null
  private gameObjects: GameObjects | null = null
  private ballManager: BallManager | null = null
  private adventureMode: AdventureMode | null = null
  private magSpinFeeder: MagSpinFeeder | null = null
  private nanoLoomFeeder: NanoLoomFeeder | null = null
  private prismCoreFeeder: PrismCoreFeeder | null = null
  private gaussCannon: GaussCannonFeeder | null = null
  private quantumTunnel: QuantumTunnelFeeder | null = null
  private inputHandler: InputHandler | null = null
  
  // Rendering
  private bloomPipeline: DefaultRenderingPipeline | null = null
  private mirrorTexture: MirrorTexture | null = null
  private tableRenderTarget: RenderTargetTexture | null = null
  private headRenderTarget: RenderTargetTexture | null = null
  private shadowGenerator: ShadowGenerator | null = null
  
  // Game State
  private ready = false
  private state: GameState = GameState.MENU
  private score = 0
  private lives = 3
  private bestScore = 0
  private comboCount = 0
  private comboTimer = 0
  private powerupActive = false
  private powerupTimer = 0
  private tiltActive = false
  
  private cameraShakeIntensity: number = 0
  private cameraShakeDecay: number = 5.0
  private targetOffset: Vector3 = Vector3.Zero()
  
  // UI References
  private scoreElement: HTMLElement | null = null
  private livesElement: HTMLElement | null = null
  private comboElement: HTMLElement | null = null
  private bestHudElement: HTMLElement | null = null
  private menuOverlay: HTMLElement | null = null
  private startScreen: HTMLElement | null = null
  private gameOverScreen: HTMLElement | null = null
  private pauseOverlay: HTMLElement | null = null
  private finalScoreElement: HTMLElement | null = null

  constructor(engine: Engine | WebGPUEngine) {
    this.engine = engine
    this.physics = new PhysicsSystem()
  }

  async init(): Promise<void> {
    if ('initAsync' in this.engine) {
      await this.engine.initAsync()
    }

    this.scene = new Scene(this.engine)
    this.scene.clearColor = color(SURFACES.VOID).toColor4(1)

    // Atmospheric fog for depth layering (disabled in reduced motion mode)
    if (!GameConfig.camera.reducedMotion) {
      this.scene.fogMode = Scene.FOGMODE_EXP2
      this.scene.fogDensity = 0.02
      this.scene.fogColor = this.scene.clearColor
    }

    // UI Bindings
    this.scoreElement = document.getElementById('score')
    this.livesElement = document.getElementById('lives')
    this.menuOverlay = document.getElementById('menu-overlay')
    this.pauseOverlay = document.getElementById('pause-overlay')
    this.comboElement = document.getElementById('combo')
    this.bestHudElement = document.getElementById('best')
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
    SettingsManager.applyToConfig(settings)
    console.log('[Accessibility] Settings loaded:', settings)

    // Setup settings UI
    this.setupSettingsUI()

    // -----------------------------------------------------------------
    // 2️⃣ DUAL‑CAMERA SETUP (TOP = Machine Head, BOTTOM = Ball Table)
    // -----------------------------------------------------------------

    // ---- TABLE CAMERA (bottom 60% of the screen) --------------------
    // TUNING RATIONALE:
    // - Lower FOV (0.65 vs 0.8): Creates more telephoto, dramatic perspective
    //   that enhances depth perception through stronger perspective convergence
    // - Lower beta (PI/3.5 vs PI/4): More side-angle view, less top-down,
    //   makes table feel deeper and shows off the 3D cabinet structure
    // - Closer radius (32 vs 35): Brings camera in for more intimacy with playfield
    // - Target shifted to z=2: Focuses on flipper area where action happens,
    //   while still showing upper playfield
    const tableCam = new ArcRotateCamera(
      'tableCam',
      -Math.PI / 2,               // alpha: front-facing
      Math.PI / 3.5,              // beta: ~51° tilt (was 45°) - more side view
      32,                         // radius: closer for immersion (was 35)
      new Vector3(0, 0, 2),       // target: shifted toward flippers (was z=5)
      this.scene
    )
    tableCam.mode = ArcRotateCamera.PERSPECTIVE_CAMERA
    tableCam.fov = 0.65           // Narrower FOV (~37°) for dramatic perspective

    // Viewport: x, y, width, height – y = 0 starts at the *bottom* of the canvas
    tableCam.viewport = new Viewport(0, 0, 1, 0.6) // 60% height

    // Enable player camera controls for looking around the table
    tableCam.attachControl(this.engine.getRenderingCanvas(), true)
    
    // Adjusted limits for new camera angle
    tableCam.lowerBetaLimit = Math.PI / 6     // Don't go too horizontal (30°)
    tableCam.upperBetaLimit = Math.PI / 2.2   // Don't go past top-down
    tableCam.lowerRadiusLimit = 22            // Closer zoom minimum
    tableCam.upperRadiusLimit = 45            // Tighter max zoom
    // Restrict horizontal rotation to 180° arc on the player-facing side
    tableCam.lowerAlphaLimit = -Math.PI       // Left limit
    tableCam.upperAlphaLimit = 0              // Right limit (player always faces table)
    
    // Add subtle camera inertia for smooth feel
    tableCam.inertia = 0.85
    tableCam.wheelPrecision = 50

    // ---- HEAD CAMERA (top 40% of the screen) ------------------------
    const headCam = new ArcRotateCamera(
      'headCam',
      -Math.PI / 2,
      Math.PI / 2,
      25,
      new Vector3(0.75, 8, 21.5), // Matches your display.ts target
      this.scene
    )
    headCam.mode = ArcRotateCamera.ORTHOGRAPHIC_CAMERA

    // Viewport: starts at y = 0.6 (i.e. after the bottom 60%)
    headCam.viewport = new Viewport(0, 0.6, 1, 0.4) // 40% height

    // Orthographic bounds for the backbox
    const headScale = 24
    headCam.orthoTop    =  headScale * 0.2
    headCam.orthoBottom = -headScale * 0.2
    headCam.orthoLeft   = -headScale / 2
    headCam.orthoRight  =  headScale / 2

    // Register both cameras as the *active* set for the scene
    this.scene.activeCameras = [tableCam, headCam]

    // -----------------------------------------------------------------
    // 2.5️⃣ RENDER TARGET TEXTURES (for future 3D cabinet view)
    // -----------------------------------------------------------------
    // Create render targets that match the viewport dimensions.
    // The table camera uses 60% of the height, head camera uses 40%.
    const canvasWidth = this.engine.getRenderWidth()
    const canvasHeight = this.engine.getRenderHeight()

    // Table render target (bottom 60% of screen)
    const tableWidth = Math.floor(canvasWidth)  // Full width
    const tableHeight = Math.floor(canvasHeight * 0.6) // 60% height
    this.tableRenderTarget = new RenderTargetTexture(
      'tableRenderTarget',
      { width: tableWidth, height: tableHeight },
      this.scene,
      false, // generateMipMaps
      true,  // doNotChangeAspectRatio
      undefined, // type
      false, // isCube
      undefined, // samplingMode
      true,  // generateDepthBuffer
      false, // generateStencilBuffer
      false, // isMulti
      undefined, // format
      false  // delayAllocation
    )
    this.tableRenderTarget.activeCamera = tableCam
    this.tableRenderTarget.renderList = null // Render all scene meshes

    // Head render target (top 40% of screen)
    const headWidth = Math.floor(canvasWidth)   // Full width
    const headHeight = Math.floor(canvasHeight * 0.4) // 40% height
    this.headRenderTarget = new RenderTargetTexture(
      'headRenderTarget',
      { width: headWidth, height: headHeight },
      this.scene,
      false, // generateMipMaps
      true,  // doNotChangeAspectRatio
      undefined, // type
      false, // isCube
      undefined, // samplingMode
      true,  // generateDepthBuffer
      false, // generateStencilBuffer
      false, // isMulti
      undefined, // format
      false  // delayAllocation
    )
    this.headRenderTarget.activeCamera = headCam
    this.headRenderTarget.renderList = null // Render all scene meshes

    // -----------------------------------------------------------------
    // 3️⃣ POST‑PROCESS PIPELINES (bloom + scanlines)
    // -----------------------------------------------------------------
    
    // Bloom – applied to *both* viewports
    this.bloomPipeline = new DefaultRenderingPipeline(
      'pachinbloom',
      true,
      this.scene,
      [tableCam, headCam]
    )
    if (this.bloomPipeline) {
      this.bloomPipeline.bloomEnabled = true
      // Adjusted bloom for dramatic lighting:
      // - Larger kernel for softer, more atmospheric glow
      // - Lower threshold to catch more highlights with new key light
      // - Balanced weight for visible but not overwhelming bloom
      this.bloomPipeline.bloomKernel = 48          // Softer spread
      this.bloomPipeline.bloomWeight = 0.25        // Slightly stronger for drama
      this.bloomPipeline.bloomThreshold = 0.7      // Catch more highlights
      
      // Tone mapping for better contrast range
      // Reinhard tone mapping preserves highlight detail with strong key light
      this.bloomPipeline.imageProcessing.toneMappingEnabled = true
      // Use standard tone mapping (Reinhard value is 2)
      this.bloomPipeline.imageProcessing.toneMappingType = 2
      
      // Contrast adjustment for more punch
      this.bloomPipeline.imageProcessing.contrast = 1.1
      this.bloomPipeline.imageProcessing.exposure = 1.0
    }

    // Scanline effect – only on the head camera
    const scanline = new PostProcess(
        "scanline",
        "scanline",
        ["uTime"],
        null,
        1.0,
        headCam, // Only attached to head camera!
        Texture.BILINEAR_SAMPLINGMODE,
        this.engine
    )
    scanline.onApply = (effect) => {
        effect.setFloat("uTime", performance.now() * 0.001)
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
    
    // Enable shadows for depth perception
    const shadowGenerator = new ShadowGenerator(2048, keyLight)
    shadowGenerator.useBlurExponentialShadowMap = true
    shadowGenerator.blurKernel = 32
    shadowGenerator.setDarkness(0.4)
    this.shadowGenerator = shadowGenerator
    
    // RIM LIGHT - Strong back light for edge definition
    const rimLight = new DirectionalLight('rimLight', new Vector3(0.2, -0.3, 0.9), this.scene)
    rimLight.intensity = LIGHTING.RIM.intensity
    rimLight.diffuse = color(LIGHTING.RIM.color)
    rimLight.position = new Vector3(5, 12, -25)
    
    // BOUNCE LIGHT - Subtle fill from playfield reflection
    const bounceLight = new PointLight('bounceLight', new Vector3(0, -2, 5), this.scene)
    bounceLight.intensity = LIGHTING.BOUNCE.intensity
    bounceLight.diffuse = color(LIGHTING.BOUNCE.color)
    bounceLight.range = 20

    // Initialize Game Logic and Physics
    await this.physics.init()
    this.buildScene()

    // Initialize input handler
    this.inputHandler = new InputHandler(
      {
        onFlipperLeft: (pressed) => this.handleFlipperLeft(pressed),
        onFlipperRight: (pressed) => this.handleFlipperRight(pressed),
        onPlunger: () => this.handlePlunger(),
        onNudge: (direction) => this.applyNudge(direction),
        onPause: () => this.togglePause(),
        onReset: () => this.resetBall(),
        onStart: () => this.startGame(),
        onAdventureToggle: () => this.toggleAdventure(),
        onTrackNext: () => this.cycleAdventureTrack(1),
        onTrackPrev: () => this.cycleAdventureTrack(-1),
        onJackpotTrigger: () => this.triggerJackpot(),
        getState: () => this.state,
        getTiltActive: () => this.tiltActive,
      },
      this.physics.getRapier()
    )

    const touchLeftBtn = document.getElementById('touch-left')
    const touchRightBtn = document.getElementById('touch-right')
    const touchPlungerBtn = document.getElementById('touch-plunger')
    const touchNudgeBtn = document.getElementById('touch-nudge')
    this.inputHandler.setupTouchControls(touchLeftBtn, touchRightBtn, touchPlungerBtn, touchNudgeBtn)

    this.scene.onBeforeRenderObservable.add(() => {
      this.stepPhysics()
    })
    
    this.engine.runRenderLoop(() => {
      this.scene?.render()
    })

    window.addEventListener('keydown', this.inputHandler.handleKeyDown)
    window.addEventListener('keyup', this.inputHandler.handleKeyUp)
    
    this.ready = true
    this.setGameState(GameState.MENU)
  }

  private setupEnvironmentLighting(): void {
    // Use MaterialLibrary to load environment texture
    if (!this.scene) return
    const matLib = getMaterialLibrary(this.scene)

    // Detect hardware quality tier and configure material library
    matLib.qualityTier = detectQualityTier(this.engine)

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

  dispose(): void {
    if (this.inputHandler) {
      window.removeEventListener('keydown', this.inputHandler.handleKeyDown)
      window.removeEventListener('keyup', this.inputHandler.handleKeyUp)
    }
    resetMaterialLibrary()
    this.scene?.dispose()
    this.physics.dispose()
    this.ready = false
  }

  private buildScene(): void {
    if (!this.scene) throw new Error('Scene not ready')
    const world = this.physics.getWorld()
    const rapier = this.physics.getRapier()
    if (!world || !rapier) throw new Error('Physics not ready')

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
    this.mirrorTexture = new MirrorTexture("mirror", 1024, this.scene, true)
    this.mirrorTexture.mirrorPlane = new Plane(0, -1, 0, -1.01)
    this.mirrorTexture.level = 0.6

    // Initialize systems
    this.effects = new EffectsSystem(this.scene, this.bloomPipeline)
    this.display = new DisplaySystem(this.scene, this.engine)
    
    // Setup slot machine event callback
    this.setupSlotMachineCallbacks()

    const particleTexture = this.effects.createParticleTexture()
    this.gameObjects = new GameObjects(this.scene, world, rapier, GameConfig, particleTexture)
    this.ballManager = new BallManager(this.scene, world, rapier, this.gameObjects.getBindings())
    this.adventureMode = new AdventureMode(this.scene, world, rapier)

    this.magSpinFeeder = new MagSpinFeeder(this.scene, world, rapier, GameConfig.magSpin)
    this.magSpinFeeder.onStateChange = (state) => {
      switch (state) {
        case MagSpinState.CATCH:
          this.effects?.playBeep(300)
          break
        case MagSpinState.SPIN:
          this.effects?.playBeep(600)
          break
        case MagSpinState.RELEASE:
          this.effects?.playBeep(1200)
          this.effects?.spawnShardBurst(this.magSpinFeeder?.getPosition() || new Vector3(0, 0, 0))
          this.effects?.setBloomEnergy(2.0)
          break
      }
    }

    this.nanoLoomFeeder = new NanoLoomFeeder(this.scene, world, rapier, GameConfig.nanoLoom)
    this.nanoLoomFeeder.onStateChange = (state, position) => {
        switch (state) {
            case NanoLoomState.LIFT:
                this.effects?.playBeep(800)
                break
            case NanoLoomState.WEAVE:
                this.effects?.playBeep(1000)
                break
            case NanoLoomState.EJECT:
                this.effects?.playBeep(1200)
                if (position) {
                  this.effects?.spawnShardBurst(position)
                }
                break
        }
    }

    this.prismCoreFeeder = new PrismCoreFeeder(this.scene, world, rapier, GameConfig.prismCore)
    this.prismCoreFeeder.onStateChange = (state, count) => {
        switch (state) {
            case PrismCoreState.LOCKED_1:
            case PrismCoreState.LOCKED_2:
                this.effects?.playBeep(1500)
                this.display?.setStoryText(`CORE LOCK: ${count}/3`)
                this.effects?.spawnShardBurst(this.prismCoreFeeder?.getPosition() || Vector3.Zero())
                // Spawn a replacement ball at the plunger so play continues
                this.ballManager?.spawnExtraBalls(1, new Vector3(8.5, 0.5, -9)) // Plunger lane approx
                break

            case PrismCoreState.OVERLOAD:
                this.effects?.playBeep(2000)
                this.effects?.startJackpotSequence() // Optional: sync with Jackpot
                this.display?.setStoryText("MULTIBALL ENGAGED")
                this.effects?.spawnShardBurst(this.prismCoreFeeder?.getPosition() || Vector3.Zero())
                break
        }
    }

    this.gaussCannon = new GaussCannonFeeder(this.scene, world, rapier, GameConfig.gaussCannon)
    this.gaussCannon.onStateChange = (state) => {
      switch (state) {
        case GaussCannonState.LOAD:
          this.effects?.playBeep(300)
          break
        case GaussCannonState.AIM:
          this.effects?.playBeep(600) // Rising pitch?
          break
        case GaussCannonState.FIRE:
          this.effects?.playBeep(2000) // Laser shot
          this.effects?.spawnShardBurst(this.gaussCannon?.getPosition() || Vector3.Zero())
          break
      }
    }

    this.quantumTunnel = new QuantumTunnelFeeder(this.scene, world, rapier, GameConfig.quantumTunnel)
    this.quantumTunnel.onStateChange = (state) => {
      switch (state) {
        case QuantumTunnelState.CAPTURE:
          this.effects?.playBeep(200) // Deep sound
          break
        case QuantumTunnelState.EJECT:
          this.effects?.playBeep(2000) // High pitch
          this.effects?.spawnShardBurst(this.quantumTunnel?.getPosition() || Vector3.Zero())
          break
      }
    }

    // [NEW] LINK ADVENTURE EVENTS TO DISPLAY SYSTEM
    this.adventureMode.setEventListener((event, data) => {
      console.log(`Adventure Event: ${event}`)

      switch (event) {
        case 'START': {
          // Switch display to Mission Mode
          this.display?.setDisplayState(DisplayState.ADVENTURE)
          const trackType = data as AdventureTrackType | undefined
          const trackName = trackType ? this.getTrackDisplayName(trackType) : 'UNKNOWN SECTOR'
          this.display?.setTrackInfo(trackName)
          this.display?.setStoryText(`ENTERING: ${trackName}`)
          // Set mood lighting
          this.effects?.setLightingMode('reach', 0.5)
          break
        }

        case 'END':
          // Return to Pinball Mode
          this.display?.setDisplayState(DisplayState.IDLE)
          this.effects?.setLightingMode('normal', 1.0)
          this.effects?.playBeep(440) // Transition sound

          // Bonus Points
          this.score += 5000
          this.updateHUD()
          break
      }
    })

    // Build game objects
    this.gameObjects.createGround()
    this.gameObjects.createWalls()
    this.gameObjects.createCabinetDecoration()

    // Enhanced Cabinet with side panels for depth
    this.createEnhancedCabinet()

    this.display.createBackbox(new Vector3(0.75, 15, 30))
    this.effects.createCabinetLighting()

    // Register decorative materials for fever/reach effects
    if (!this.scene) return
    const matLib = getMaterialLibrary(this.scene)
    const plasticMat = matLib.getNeonBumperMaterial('#FF0055')
    this.effects.registerDecorativeMaterial(plasticMat)

    this.gameObjects.createDeathZone()
    
    this.ballManager.setMirrorTexture(this.mirrorTexture)
    this.ballManager.createMainBall()

    this.gameObjects.createFlippers()
    this.gameObjects.createPachinkoField(new Vector3(0, 0.5, 12), 14, 8)
    this.gameObjects.createBumpers()
    this.gameObjects.createSlingshots()

    // Build handle caches for O(1) collision lookups
    this.rebuildHandleCaches()

    // Register shadows after all meshes created (including ball)
    this.registerShadowCasters()
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
      this.shadowGenerator.contactHardeningLightSizeU = 1.5
      this.shadowGenerator.contactHardeningLightSizeV = 1.5
    }

    // Get all pinball meshes from GameObjects
    const pinballMeshes = this.gameObjects.getPinballMeshes()
    
    // Register gameplay-critical meshes for shadows
    for (const mesh of pinballMeshes) {
      // Skip transparent/emissive-only meshes
      if (mesh.name.includes('holo') || mesh.name.includes('glass')) continue
      
      this.shadowGenerator.addShadowCaster(mesh, true)
    }

    // Ground receives shadows but doesn't cast
    if (this.scene) {
      const ground = this.scene.getMeshByName('ground')
      if (ground) {
        ground.receiveShadows = true
      }
    }
  }

  private setGameState(newState: GameState): void {
    this.state = newState
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
        break
    }
  }

  private startGame(): void {
    this.score = 0
    this.lives = 3
    this.comboCount = 0
    this.comboTimer = 0
    this.gameObjects?.resetTargets()
    this.powerupActive = false
    this.powerupTimer = 0
    this.ballManager?.removeExtraBalls()
    this.updateHUD()
    this.resetBall()
    this.setGameState(GameState.PLAYING)
  }

  private togglePause(): void {
    if (!this.ready) return
    this.setGameState(this.state === GameState.PLAYING ? GameState.PAUSED : GameState.PLAYING)
  }

  private handleFlipperLeft(pressed: boolean): void {
    if (!this.ready || this.state !== GameState.PLAYING) return
    if (this.tiltActive && pressed) {
      this.effects?.playBeep(220)
      return
    }
    
    const joint = this.gameObjects?.getFlipperJoints().left
    if (joint) {
      // UPDATED: Use Config values
      const stiffness = GameConfig.table.flipperStrength
      const damping = GameConfig.flipper.damping
      const angle = pressed ? -Math.PI / 6 : Math.PI / 4
      ;(joint as RAPIER.RevoluteImpulseJoint).configureMotorPosition(angle, stiffness, damping)
    }
  }

  private handleFlipperRight(pressed: boolean): void {
    if (!this.ready || this.state !== GameState.PLAYING) return
    if (this.tiltActive && pressed) {
      this.effects?.playBeep(220)
      return
    }
    
    const joint = this.gameObjects?.getFlipperJoints().right
    if (joint) {
      // UPDATED: Use Config values
      const stiffness = GameConfig.table.flipperStrength
      const damping = GameConfig.flipper.damping
      const angle = pressed ? Math.PI / 6 : -Math.PI / 4
      ;(joint as RAPIER.RevoluteImpulseJoint).configureMotorPosition(angle, stiffness, damping)
    }
  }

  private handlePlunger(): void {
    const rapier = this.physics.getRapier()
    const ballBody = this.ballManager?.getBallBody()
    if (!ballBody || !rapier) return
    
    const pos = ballBody.translation()
    if (pos.x > 8 && pos.z < -4) {
      // Use config for impulse
      ballBody.applyImpulse(new rapier.Vector3(0, 0, GameConfig.plunger.impulse), true)
    }
  }

  private applyNudge(direction: RAPIER.Vector3): void {
    // Stub for nudge functionality
    void direction
  }

  private triggerJackpot(): void {
      if (this.state !== GameState.PLAYING) return
      console.log("JACKPOT TRIGGERED!")

      this.effects?.startJackpotSequence()
      this.display?.setDisplayState(DisplayState.JACKPOT)

      // Bonus Score
      this.score += 100000
      this.updateHUD()
  }

  private toggleAdventure(): void {
    if (this.adventureMode?.isActive()) {
      this.endAdventureMode()
    } else {
      this.startAdventureMode()
    }
  }

  /** Collision debounce: track last collision time per body pair */
  private lastCollisionTime: Map<string, number> = new Map()
  private static readonly COLLISION_DEBOUNCE_MS = 16

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

  private stepPhysics(): void {
    if (this.state !== GameState.PLAYING) return

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

    // Apply camera shake to table camera
    if (this.cameraShakeIntensity > 0 && this.scene) {
      const tableCam = this.scene.activeCameras?.[0] as ArcRotateCamera
      if (tableCam) {
        const shakeX = (Math.random() - 0.5) * this.cameraShakeIntensity
        const shakeY = (Math.random() - 0.5) * this.cameraShakeIntensity * 0.5
        tableCam.target.x += shakeX
        tableCam.target.y += shakeY
      }
      this.cameraShakeIntensity = Math.max(0, this.cameraShakeIntensity - dt * this.cameraShakeDecay)
    }

    // Subtle target drift toward ball for better framing (only in reduced motion = false)
    if (!GameConfig.camera.reducedMotion && this.ballManager?.getBallBody()) {
      const ballPos = this.ballManager.getBallBody()!.translation()
      const targetX = Math.max(-5, Math.min(5, ballPos.x)) // Clamp to safe range
      const targetZ = Math.max(-2, Math.min(8, ballPos.z))
      
      this.targetOffset.x = Scalar.Lerp(this.targetOffset.x, targetX * 0.3, dt * 2)
      this.targetOffset.z = Scalar.Lerp(this.targetOffset.z, (targetZ - 2) * 0.2, dt * 2)
      
      const tableCam = this.scene.activeCameras?.[0] as ArcRotateCamera
      if (tableCam) {
        tableCam.target.x = this.targetOffset.x
        tableCam.target.z = 2 + this.targetOffset.z
      }
    }

    // Sync Adventure Mode Kinematics
    const currentBallBodies = this.ballManager?.getBallBodies() || []
    this.adventureMode?.update(dt, currentBallBodies)

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
    this.effects?.updateBloom(dt)
    this.effects?.updateCabinetLighting(dt)
    this.effects?.updateSlotLighting(dt)
    this.ballManager?.updateTrailEffects(dt)

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

    // Sync State: If effects system says jackpot is over, revert display
    if (this.effects && !this.effects.isJackpotActive && this.display?.getDisplayState() === DisplayState.JACKPOT) {
        this.display.setDisplayState(DisplayState.IDLE)
    }
    
    this.updateCombo(dt)
    
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
          if (ballPos.y > 1.5) {
            if (this.display?.getDisplayState() === DisplayState.IDLE) {
              this.activateHologramCatch(ballBody, bump)
              return
            }
          } else {
            this.gameObjects?.activateBumperHit(bump)
            this.cameraShakeIntensity = GameConfig.camera.shakeIntensity
            this.score += (10 * (Math.floor(this.comboCount / 3) + 1))
            this.comboCount++
            this.comboTimer = 1.5
            this.effects?.spawnShardBurst(vis.mesh.position)
            this.effects?.setBloomEnergy(2.0)
            this.effects?.playBeep(400 + Math.random() * 200)
            this.updateHUD()
            this.effects?.setLightingMode('hit', 0.2)
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
      if (this.gameObjects?.deactivateTarget(tgt)) {
        this.score += 100
        this.effects?.playBeep(1200)
        this.ballManager?.spawnExtraBalls(1)
        this.updateHUD()
        this.display?.setDisplayState(DisplayState.REACH)
        this.effects?.setLightingMode('reach', 3.0)

        // Rebuild handle caches since new balls were spawned
        this.rebuildHandleCaches()

        // Try to activate slot machine (intermittent activation)
        this.tryActivateSlotMachine()
      }
    }
  }

  private activateHologramCatch(ball: RAPIER.RigidBody, bumper: RAPIER.RigidBody): void {
    const bumperVisuals = this.gameObjects?.getBumperVisuals() || []
    const visual = bumperVisuals.find(v => v.body === bumper)
    if (!visual || !visual.hologram) return
    
    this.ballManager?.activateHologramCatch(ball, visual.hologram.position, 4.0)
    this.effects?.playBeep(880)
    this.display?.setDisplayState(DisplayState.REACH)
    this.effects?.setLightingMode('reach', 4.0) // Add Reach lighting
  }

  private handleBallLoss(body: RAPIER.RigidBody): void {
    if (this.state !== GameState.PLAYING) return
    
    this.comboCount = 0
    this.ballManager?.removeBall(body)
    
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

  private resetBall(): void {
    this.ballManager?.resetBall()
    this.updateHUD()
  }

  private updateHUD(): void {
    if (this.scoreElement) this.scoreElement.textContent = String(this.score)
    if (this.livesElement) this.livesElement.textContent = String(this.lives)
    if (this.comboElement) this.comboElement.textContent = this.comboCount > 1 ? `Combo ${this.comboCount}` : ""
    if (this.bestHudElement) this.bestHudElement.textContent = String(this.bestScore)
  }

  private updateCombo(dt: number): void {
    if (this.comboTimer > 0) {
      this.comboTimer -= dt
      if (this.comboTimer <= 0) {
        this.comboCount = 0
        this.updateHUD()
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
    this.resetBall()
    this.updateHUD()
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
    
    if (reducedMotionCheckbox) reducedMotionCheckbox.checked = settings.reducedMotion
    if (photosensitiveCheckbox) photosensitiveCheckbox.checked = settings.photosensitiveMode
    if (shakeSlider) shakeSlider.value = String(settings.shakeIntensity)
  }

  private saveSettingsFromUI(): void {
    const reducedMotionCheckbox = document.getElementById('reduced-motion') as HTMLInputElement
    const photosensitiveCheckbox = document.getElementById('photosensitive-mode') as HTMLInputElement
    const shakeSlider = document.getElementById('shake-intensity') as HTMLInputElement
    
    const newSettings = {
      reducedMotion: reducedMotionCheckbox?.checked ?? false,
      photosensitiveMode: photosensitiveCheckbox?.checked ?? false,
      shakeIntensity: parseFloat(shakeSlider?.value ?? '0.08'),
      enableFog: true,
      enableShadows: true
    }
    
    SettingsManager.save(newSettings)
    SettingsManager.applyToConfig(newSettings)
    console.log('[Accessibility] Settings saved:', newSettings)
  }
}