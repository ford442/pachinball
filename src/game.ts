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
  ShadowGenerator
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
    this.scene.clearColor = Color3.FromHexString("#050505").toColor4(1)

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
    
    // FILL LIGHT (Hemisphere) - Reduced for more contrast
    const hemiLight = new HemisphericLight('hemiLight', new Vector3(0.2, 1, 0.1), this.scene)
    hemiLight.intensity = 0.25                    // Reduced from 0.4 for more contrast
    hemiLight.diffuse = new Color3(0.7, 0.8, 0.95) // Cooler fill
    hemiLight.groundColor = new Color3(0.05, 0.05, 0.08) // Darker ground
    
    // KEY LIGHT - Main directional with shadows
    const keyLight = new DirectionalLight('keyLight', new Vector3(-0.6, -0.8, 0.2), this.scene)
    keyLight.intensity = 1.2                      // Stronger key for drama
    keyLight.diffuse = new Color3(1.0, 0.92, 0.85) // Warm white
    keyLight.position = new Vector3(-15, 25, -15)
    
    // Enable shadows for depth perception
    // Shadow map size: 2048 for quality, blur for softness
    const shadowGenerator = new ShadowGenerator(2048, keyLight)
    shadowGenerator.useBlurExponentialShadowMap = true
    shadowGenerator.blurKernel = 32
    shadowGenerator.setDarkness(0.4)              // Not pure black shadows
    this.shadowGenerator = shadowGenerator        // Store for meshes to register
    
    // RIM LIGHT - Strong back light for edge definition
    const rimLight = new DirectionalLight('rimLight', new Vector3(0.2, -0.3, 0.9), this.scene)
    rimLight.intensity = 0.8                      // Stronger for edge glow
    rimLight.diffuse = new Color3(0.5, 0.75, 1.0) // Cool blue rim
    rimLight.position = new Vector3(5, 12, -25)
    
    // BOUNCE LIGHT - Subtle fill from playfield reflection
    const bounceLight = new PointLight('bounceLight', new Vector3(0, -2, 5), this.scene)
    bounceLight.intensity = 0.3
    bounceLight.diffuse = new Color3(0.6, 0.5, 0.8) // Purple-tinted from playfield
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
    matLib.loadEnvironmentTexture()
  }

  private createEnhancedCabinet(): void {
    if (!this.scene) return
    const matLib = getMaterialLibrary(this.scene)
    const cabinetY = -2.5
    
    // Use MaterialLibrary for consistent materials
    const cabinetMat = matLib.getCabinetMaterial()
    const sidePanelMat = matLib.getSidePanelMaterial()

    // Main cabinet body
    const cab = MeshBuilder.CreateBox("cabinet", { width: 26, height: 3, depth: 36 }, this.scene)
    cab.position.set(0.75, cabinetY, 5)
    cab.material = cabinetMat

    // Left side panel
    const leftPanel = MeshBuilder.CreateBox("leftPanel", { width: 1, height: 4, depth: 38 }, this.scene)
    leftPanel.position.set(-12.5, cabinetY + 0.5, 5)
    leftPanel.material = sidePanelMat

    // Right side panel  
    const rightPanel = MeshBuilder.CreateBox("rightPanel", { width: 1, height: 4, depth: 38 }, this.scene)
    rightPanel.position.set(13.5, cabinetY + 0.5, 5)
    rightPanel.material = sidePanelMat

    // Front bezel/glass edge with accent glow
    if (!this.scene) return
    const bezelMat = new StandardMaterial("bezelMat", this.scene)
    bezelMat.diffuseColor = Color3.Black()
    bezelMat.emissiveColor = Color3.FromHexString("#ff0055").scale(0.2)
    
    const bezel = MeshBuilder.CreateBox("bezel", { width: 24, height: 0.5, depth: 1 }, this.scene)
    bezel.position.set(0.75, cabinetY + 1.5, -12.5)
    bezel.material = bezelMat

    // Add to mirror render list if available
    if (this.mirrorTexture?.renderList) {
      this.mirrorTexture.renderList.push(cab, leftPanel, rightPanel, bezel)
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
    skyboxMaterial.diffuseColor = new Color3(0, 0, 0)
    skyboxMaterial.specularColor = new Color3(0, 0, 0)
    // Slightly warmer dark tone for better contrast with neon
    skyboxMaterial.emissiveColor = new Color3(0.015, 0.012, 0.02)
    skybox.material = skyboxMaterial

    // Mirror texture
    this.mirrorTexture = new MirrorTexture("mirror", 1024, this.scene, true)
    this.mirrorTexture.mirrorPlane = new Plane(0, -1, 0, -1.01)
    this.mirrorTexture.level = 0.6

    // Initialize systems
    this.effects = new EffectsSystem(this.scene, this.bloomPipeline)
    this.display = new DisplaySystem(this.scene, this.engine)

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

  private stepPhysics(): void {
    if (this.state !== GameState.PLAYING) return
    
    const dt = this.engine.getDeltaTime() / 1000
    
    this.physics.step((h1, h2, start) => {
      if (!start) return
      this.processCollision(h1, h2)
    })

    // Sync physics to visual meshes
    const bindings = this.gameObjects?.getBindings() || []
    for (const binding of bindings) {
      const body = binding.rigidBody
      const mesh = binding.mesh
      if (!body || !mesh) continue

      const pos = body.translation()
      const rot = body.rotation()

      mesh.position.set(pos.x, pos.y, pos.z)

      if (!mesh.rotationQuaternion) {
        mesh.rotationQuaternion = new Quaternion(rot.x, rot.y, rot.z, rot.w)
      } else {
        mesh.rotationQuaternion.set(rot.x, rot.y, rot.z, rot.w)
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
    
    const b1 = world.getRigidBody(h1)
    const b2 = world.getRigidBody(h2)
    if (!b1 || !b2) return

    // Adventure mode sensor
    const adventureSensor = this.adventureMode?.getSensor()
    if (adventureSensor && (b1 === adventureSensor || b2 === adventureSensor)) {
      this.endAdventureMode()
      return
    }

    // Death zone
    const deathZone = this.gameObjects?.getDeathZoneBody()
    if (deathZone && (b1 === deathZone || b2 === deathZone)) {
      const ball = b1 === deathZone ? b2 : b1
      this.handleBallLoss(ball)
      return
    }

    // Bumper collision
    const bumperBodies = this.gameObjects?.getBumperBodies() || []
    const bump = bumperBodies.find(b => b === b1 || b === b2)
    if (bump) {
      const ballBody = (bump === b1) ? b2 : b1
      const ballBodies = this.ballManager?.getBallBodies() || []
      
      if (ballBodies.includes(ballBody)) {
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

    // Target collision
    const targetBodies = this.gameObjects?.getTargetBodies() || []
    const tgt = targetBodies.find(b => b === b1 || b === b2)
    if (tgt) {
      if (this.gameObjects?.deactivateTarget(tgt)) {
        this.score += 100
        this.effects?.playBeep(1200)
        this.ballManager?.spawnExtraBalls(1)
        this.updateHUD()
        this.display?.setDisplayState(DisplayState.REACH)
        this.effects?.setLightingMode('reach', 3.0) // Changed from 'fever' to 'reach' to match state
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
}