import {
  ArcRotateCamera,
  Color3,
  HemisphericLight,
  MeshBuilder,
  Quaternion,
  Scene,
  TransformNode,
  Vector3,
  Texture,
  DynamicTexture,
  MirrorTexture,
  Plane,
  TrailMesh,
  StandardMaterial,
  Mesh,
  PointLight,
} from '@babylonjs/core'
import { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline'
import type { Engine } from '@babylonjs/core/Engines/engine'
import type { Nullable } from '@babylonjs/core/types'
import type { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine'
import type * as RAPIER from '@dimforge/rapier3d-compat'

// Gravity: -Y (down), -Z (roll towards player)
const GRAVITY = new Vector3(0, -9.81, -5.0)

interface PhysicsBinding {
  mesh: TransformNode
  rigidBody: RAPIER.RigidBody
}

interface BumperVisual {
  mesh: Mesh
  body: RAPIER.RigidBody
  hologram?: Mesh // Reference to the hovering hologram
  hitTime: number
  sweep: number
}

enum GameState {
  MENU,
  PAUSED,
  PLAYING,
  GAME_OVER,
}

enum DisplayState {
  IDLE,
  REACH,
  FEVER,
}

export class Game {
  private readonly engine: Engine | WebGPUEngine
  private scene: Nullable<Scene> = null
  private rapier: typeof RAPIER | null = null
  private world: RAPIER.World | null = null
  
  // Physics & Game Objects
  private bindings: PhysicsBinding[] = []
  private flipperLeftJoint: RAPIER.ImpulseJoint | null = null
  private flipperRightJoint: RAPIER.ImpulseJoint | null = null
  private ballBody: RAPIER.RigidBody | null = null
  private deathZoneBody: RAPIER.RigidBody | null = null
  private bumperBodies: RAPIER.RigidBody[] = []
  private targetBodies: RAPIER.RigidBody[] = []
  private targetMeshes: Mesh[] = []
  private targetActive: boolean[] = []
  private targetRespawnTimer: number[] = []
  private ballBodies: RAPIER.RigidBody[] = []
  private bumperVisuals: BumperVisual[] = []
  private shards: Array<{ mesh: Mesh; vel: Vector3; life: number; material: StandardMaterial }> = []
  
  // Systems
  private eventQueue: RAPIER.EventQueue | null = null
  private bloomPipeline: DefaultRenderingPipeline | null = null
  private bloomEnergy = 0
  private mirrorTexture: MirrorTexture | null = null
  private audioCtx: AudioContext | null = null
  
  // Display System
  private displayState: DisplayState = DisplayState.IDLE
  private displayTransitionTimer = 0
  private backboxLayers: {
    background: Mesh | null
    mainDisplay: Mesh | null
    overlay: Mesh | null
  } = { background: null, mainDisplay: null, overlay: null }

  // --- SLOT MACHINE STATE ---
  private slotTexture: DynamicTexture | null = null
  private slotSymbols = ['7️⃣', '💎', '🍒', '🔔', '🍇', '⭐']
  // Current vertical offset of each reel (0 to 1)
  private slotReels = [0, 0, 0]
  // Speed of each reel
  private slotSpeeds = [0, 0, 0]
  // State: 0=Stopped, 1=Spinning, 2=Stopping
  private slotMode = 0
  // Timer to stagger the stopping of reels
  private slotStopTimer = 0
  
  // Cabinet Lighting
  private cabinetLights: Array<{ mesh: Mesh; material: StandardMaterial; pointLight: PointLight }> = []
  private lightingMode: 'normal' | 'hit' | 'fever' = 'normal'
  private lightingTimer = 0
  
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
  
  // Adventure Mode (Holo-Deck)
  private pinballMeshes: Mesh[] = [] // Track standard parts to hide them later
  private adventureTrack: Mesh[] = []
  private adventureActive = false
  private adventureSensor: RAPIER.RigidBody | null = null
  private tableCamera: ArcRotateCamera | null = null
  private followCamera: ArcRotateCamera | null = null
  
  // UI
  private scoreElement: HTMLElement | null = null
  private livesElement: HTMLElement | null = null
  private comboElement: HTMLElement | null = null
  private bestHudElement: HTMLElement | null = null
  private menuOverlay: HTMLElement | null = null
  private startScreen: HTMLElement | null = null
  private gameOverScreen: HTMLElement | null = null
  private pauseOverlay: HTMLElement | null = null
  private finalScoreElement: HTMLElement | null = null
  
  // Controls
  private touchLeftBtn: HTMLElement | null = null
  private touchRightBtn: HTMLElement | null = null
  private touchPlungerBtn: HTMLElement | null = null
  private touchNudgeBtn: HTMLElement | null = null

  constructor(engine: Engine | WebGPUEngine) {
    this.engine = engine
  }

  async init(canvas: HTMLCanvasElement): Promise<void> {
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
    // Note: removed unused bestMenuElement/bestFinalElement bindings to satisfy linter
    this.startScreen = document.getElementById('start-screen')
    this.gameOverScreen = document.getElementById('game-over-screen')
    this.finalScoreElement = document.getElementById('final-score')

    document.getElementById('start-btn')?.addEventListener('click', () => this.startGame())
    document.getElementById('restart-btn')?.addEventListener('click', () => this.startGame())

    // Mobile/Touch Inputs
    this.touchLeftBtn = document.getElementById('touch-left')
    this.touchRightBtn = document.getElementById('touch-right')
    this.touchPlungerBtn = document.getElementById('touch-plunger')
    this.touchNudgeBtn = document.getElementById('touch-nudge')
    this.touchLeftBtn?.addEventListener('touchstart', (e) => { e.preventDefault(); this.triggerLeftFlipper() })
    this.touchRightBtn?.addEventListener('touchstart', (e) => { e.preventDefault(); this.triggerRightFlipper() })
    this.touchPlungerBtn?.addEventListener('touchstart', (e) => { e.preventDefault(); this.triggerPlunger() })
    this.touchNudgeBtn?.addEventListener('touchstart', (e) => { e.preventDefault(); this.applyNudge(new this.rapier!.Vector3(0,0,1)) })

    // Load Best Score
    try {
      const v = localStorage.getItem('pachinball.best')
      if (v) this.bestScore = Math.max(0, parseInt(v, 10) || 0)
    } catch {
      // Ignore localStorage errors
    }
    this.updateHUD()

    // --- CAMERA SETUP ---
    // Lower alpha/beta to look "through" the table at the back screen
    const camera = new ArcRotateCamera('camera', -Math.PI / 2, Math.PI / 2.2, 25, new Vector3(0, 2, 5), this.scene)
    camera.attachControl(canvas, true)
    camera.keysUp = []
    camera.keysDown = []
    camera.keysLeft = []
    camera.keysRight = []

    // --- POST PROCESSING (BLOOM) ---
    this.bloomPipeline = new DefaultRenderingPipeline('pachinbloom', true, this.scene, [camera])
    if (this.bloomPipeline) {
      this.bloomPipeline.bloomEnabled = true
      this.bloomPipeline.bloomKernel = 64
      this.bloomPipeline.bloomWeight = 0.4 // Higher bloom for holograms
    }

    new HemisphericLight('light', new Vector3(0.3, 1, 0.3), this.scene)

    await this.initPhysics()
    this.buildScene()

    // Audio
    try {
      this.audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
    } catch {
      this.audioCtx = null
    }

    // Loop
    this.scene.onBeforeRenderObservable.add(() => {
      this.stepPhysics()
    })
    this.engine.runRenderLoop(() => {
      this.scene?.render()
    })

    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    this.ready = true
    this.setGameState(GameState.MENU)
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    this.scene?.dispose()
    this.world?.free()
    this.ready = false
  }

  private setGameState(newState: GameState) {
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
        if (this.audioCtx?.state === 'suspended') this.audioCtx.resume().catch(() => {})
        break
      case GameState.PAUSED:
        if (this.menuOverlay) this.menuOverlay.classList.add('hidden')
        if (this.pauseOverlay) this.pauseOverlay.classList.remove('hidden')
        if (this.audioCtx?.state === 'running') this.audioCtx.suspend().catch(() => {})
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

  private startGame() {
    this.score = 0
    this.lives = 3
    this.comboCount = 0
    this.comboTimer = 0
    this.targetActive.fill(true)
    this.targetRespawnTimer.fill(0)
    this.targetMeshes.forEach(m => m.isVisible = true)
    
    // Reset balls
    this.powerupActive = false
    this.powerupTimer = 0
    for (let i = this.ballBodies.length - 1; i >= 0; i--) {
      const rb = this.ballBodies[i]
      if (rb !== this.ballBody) {
        this.world?.removeRigidBody(rb)
        this.ballBodies.splice(i, 1)
      }
    }
    // Clean up extra bindings
    this.bindings = this.bindings.filter(b => {
        if (!b.mesh.name.startsWith('ball')) return true;
        if (b.rigidBody === this.ballBody) return true;
        b.mesh.dispose();
        return false;
    })

    this.updateHUD()
    this.resetBall()
    this.setGameState(GameState.PLAYING)
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (!this.ready || !this.rapier) return
    if (event.code === 'KeyP') {
      this.setGameState(this.state === GameState.PLAYING ? GameState.PAUSED : GameState.PLAYING)
      return
    }
    if (event.code === 'KeyR' && this.state === GameState.PLAYING) { this.resetBall(); return }
    if ((event.code === 'Space' || event.code === 'Enter') && this.state === GameState.MENU) { this.startGame(); return }
    if (this.state !== GameState.PLAYING) return

    const stiffness = 100000; const damping = 1000
    if (event.code === 'ArrowLeft' || event.code === 'KeyZ') {
       if (this.tiltActive) { this.playBeep(220); return }
       if (this.flipperLeftJoint) (this.flipperLeftJoint as RAPIER.RevoluteImpulseJoint).configureMotorPosition(-Math.PI / 6, stiffness, damping)
    }
    if (event.code === 'ArrowRight' || event.code === 'Slash') {
       if (this.tiltActive) { this.playBeep(220); return }
       if (this.flipperRightJoint) (this.flipperRightJoint as RAPIER.RevoluteImpulseJoint).configureMotorPosition(Math.PI / 6, stiffness, damping)
    }
    if (event.code === 'Space' || event.code === 'Enter') {
      if (this.ballBody) {
        const pos = this.ballBody.translation();
        if (pos.x > 8 && pos.z < -4) this.ballBody.applyImpulse(new this.rapier.Vector3(0, 0, 15), true)
      }
    }
    // Nudge
    if (event.code === 'KeyQ') this.applyNudge(new this.rapier.Vector3(-0.6, 0, 0.3))
    if (event.code === 'KeyE') this.applyNudge(new this.rapier.Vector3(0.6, 0, 0.3))
    if (event.code === 'KeyW') this.applyNudge(new this.rapier.Vector3(0, 0, 0.8))
    // Holo-Deck Adventure Mode Toggle
    if (event.code === 'KeyH') {
      if (this.adventureActive) this.endAdventureMode()
      else this.startAdventureMode()
    }
  }

  private onKeyUp = (event: KeyboardEvent): void => {
    if (!this.ready || !this.rapier || this.state !== GameState.PLAYING) return
    const stiffness = 100000; const damping = 1000
    if (event.code === 'ArrowLeft' || event.code === 'KeyZ') {
       if (this.flipperLeftJoint) (this.flipperLeftJoint as RAPIER.RevoluteImpulseJoint).configureMotorPosition(Math.PI / 4, stiffness, damping)
    }
    if (event.code === 'ArrowRight' || event.code === 'Slash') {
       if (this.flipperRightJoint) (this.flipperRightJoint as RAPIER.RevoluteImpulseJoint).configureMotorPosition(-Math.PI / 4, stiffness, damping)
    }
  }

  private async initPhysics(): Promise<void> {
    if (this.rapier) return
    this.rapier = await import('@dimforge/rapier3d-compat')
    await (this.rapier.init as unknown as () => Promise<void>)()
    this.world = new this.rapier.World(new this.rapier.Vector3(GRAVITY.x, GRAVITY.y, GRAVITY.z))
    this.eventQueue = new this.rapier.EventQueue(true)
  }

  private createGridTexture(scene: Scene): Texture {
    const dynamicTexture = new DynamicTexture('gridTexture', 512, scene, true)
    dynamicTexture.hasAlpha = true
    const ctx = dynamicTexture.getContext()
    const size = 512
    ctx.fillStyle = '#050510'
    ctx.fillRect(0, 0, size, size)
    ctx.lineWidth = 3
    ctx.strokeStyle = '#aa00ff'
    ctx.shadowBlur = 10
    ctx.shadowColor = '#d000ff'
    const step = size / 8
    for (let i = 0; i <= size; i += step) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, size); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(size, i); ctx.stroke()
    }
    ctx.strokeRect(0, 0, size, size)
    dynamicTexture.update()
    return dynamicTexture
  }

  private buildScene(): void {
    if (!this.scene || !this.world || !this.rapier) throw new Error('Scene not ready')

    // Skybox (Darker)
    const skybox = MeshBuilder.CreateBox("skybox", { size: 100.0 }, this.scene);
    const skyboxMaterial = new StandardMaterial("skyBox", this.scene);
    skyboxMaterial.backFaceCulling = false;
    skyboxMaterial.diffuseColor = new Color3(0, 0, 0);
    skyboxMaterial.specularColor = new Color3(0, 0, 0);
    skyboxMaterial.emissiveColor = new Color3(0.01, 0.01, 0.02);
    skybox.material = skyboxMaterial;

    // Table Materials
    const groundMat = new StandardMaterial('groundMat', this.scene);
    groundMat.diffuseTexture = this.createGridTexture(this.scene);
    (groundMat.diffuseTexture as Texture).uScale = 4;
    (groundMat.diffuseTexture as Texture).vScale = 8;
    groundMat.specularColor = new Color3(0.5, 0.5, 0.5);

    this.mirrorTexture = new MirrorTexture("mirror", 1024, this.scene, true);
    this.mirrorTexture.mirrorPlane = new Plane(0, -1, 0, -1.01);
    this.mirrorTexture.level = 0.6;
    groundMat.reflectionTexture = this.mirrorTexture;

    // Walls
    const wallMat = new StandardMaterial('wallMat', this.scene);
    wallMat.diffuseColor = Color3.Black();
    wallMat.emissiveColor = Color3.FromHexString("#00eeff");
    wallMat.alpha = 0.3;

    // Playfield Base
    const ground = MeshBuilder.CreateGround('ground', { width: 24, height: 32 }, this.scene) as Mesh
    ground.position.set(0, -1, 5) // Longer board
    ground.material = groundMat;
    const groundBody = this.world.createRigidBody(this.rapier.RigidBodyDesc.fixed().setTranslation(0, -1, 5))
    this.world.createCollider(this.rapier.ColliderDesc.cuboid(12, 0.1, 16), groundBody)
    this.bindings.push({ mesh: ground, rigidBody: groundBody })

    // Walls Setup
    const wallH = 4;
    // Left
    this.createWall(new Vector3(-10, wallH, 5), new Vector3(0.2, 5, 32), wallMat)
    // Right
    this.createWall(new Vector3(11.5, wallH, 5), new Vector3(0.2, 5, 32), wallMat)
    // Top (near backbox)
    this.createWall(new Vector3(0.75, wallH, 20.5), new Vector3(22.5, 5, 1.0), wallMat)
    // Plunger Lane
    this.createWall(new Vector3(9.5, wallH, 2), new Vector3(0.2, 5, 26), wallMat)
    this.createWall(new Vector3(10.5, wallH, -10.5), new Vector3(1.9, 5, 1.0), wallMat)

    // Cabinet
    const cabinetMat = new StandardMaterial("cabinetMat", this.scene);
    cabinetMat.diffuseColor = Color3.FromHexString("#111111");
    const cab = MeshBuilder.CreateBox("cabinet", { width: 26, height: 4, depth: 36 }, this.scene);
    cab.position.set(0.75, -3, 5);
    cab.material = cabinetMat;

    // --- NEW: BACKBOX SCREEN ---
    this.createBackbox(new Vector3(0.75, 8, 21.5));

    // --- NEW: CABINET LED STRIPS ---
    this.createCabinetLighting();

    // Death Zone
    this.deathZoneBody = this.world.createRigidBody(this.rapier.RigidBodyDesc.fixed().setTranslation(0, -2, -14))
    this.world.createCollider(this.rapier.ColliderDesc.cuboid(20, 2, 2).setSensor(true).setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS), this.deathZoneBody)

    // Main Ball
    const ballMat = new StandardMaterial('ballMat', this.scene);
    ballMat.diffuseColor = Color3.White();
    ballMat.emissiveColor = new Color3(0.2, 0.2, 0.2);
    
    const ball = MeshBuilder.CreateSphere('ball', { diameter: 1 }, this.scene) as Mesh
    ball.material = ballMat;
    const ballBody = this.world.createRigidBody(this.rapier.RigidBodyDesc.dynamic().setTranslation(10.5, 0.5, -9).setCcdEnabled(true))
    this.world.createCollider(this.rapier.ColliderDesc.ball(0.5).setRestitution(0.7).setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS | this.rapier.ActiveEvents.CONTACT_FORCE_EVENTS), ballBody)
    
    this.bindings.push({ mesh: ball, rigidBody: ballBody })
    this.ballBody = ballBody
    this.ballBodies.push(ballBody)
    if (this.mirrorTexture.renderList) this.mirrorTexture.renderList.push(ball)

    // Trail
    const trail = new TrailMesh("ballTrail", ball, this.scene as Scene, 0.3, 20, true);
    const trailMat = new StandardMaterial("trailMat", this.scene);
    trailMat.emissiveColor = Color3.FromHexString("#00ffff");
    trail.material = trailMat;

    // Components
    const flipperMat = new StandardMaterial('flipperMat', this.scene);
    flipperMat.diffuseColor = Color3.Yellow();
    flipperMat.emissiveColor = Color3.FromHexString("#aa6600");
    this.createFlippers(flipperMat)

    // --- NEW: PACHINKO FIELD (Upper Playfield) ---
    this.createPachinkoField(new Vector3(0, 0.5, 12), 14, 8)

    // Bumpers with Holograms
    this.createBumpers()
    
    // Slingshots
    const slingMat = new StandardMaterial('slingMat', this.scene);
    slingMat.emissiveColor = Color3.White();
    this.createSlingshot(new Vector3(-6.5, 0, -3), -Math.PI / 6, slingMat)
    this.createSlingshot(new Vector3(6.5, 0, -3), Math.PI / 6, slingMat)
  }

  // --- NEW: BACKBOX SCREEN CREATION ---
  private createBackbox(pos: Vector3): void {
      if (!this.scene) return
      // Frame
      const frame = MeshBuilder.CreateBox("backboxFrame", { width: 22, height: 14, depth: 2 }, this.scene)
      frame.position.copyFrom(pos)
      const frameMat = new StandardMaterial("frameMat", this.scene)
      frameMat.diffuseColor = Color3.Black()
      frameMat.roughness = 0.5
      frame.material = frameMat

      // --- LAYER 1: BACKGROUND ---
      const bgLayer = MeshBuilder.CreatePlane("backboxBg", { width: 20, height: 12 }, this.scene)
      bgLayer.position.copyFrom(pos)
      bgLayer.position.z -= 0.5
      bgLayer.rotation.y = Math.PI
      
      const bgMat = new StandardMaterial("bgMat", this.scene)
      const bgTexture = this.createGridTexture(this.scene)
      bgMat.diffuseTexture = bgTexture
      bgMat.emissiveColor = new Color3(0.05, 0.0, 0.1)
      bgLayer.material = bgMat
      this.backboxLayers.background = bgLayer

      // --- LAYER 2: MAIN DISPLAY (Slot Machine) ---
      const mainDisplay = MeshBuilder.CreatePlane("backboxScreen", { width: 20, height: 12 }, this.scene)
      mainDisplay.position.copyFrom(pos)
      mainDisplay.position.z -= 0.8
      mainDisplay.rotation.y = Math.PI

      const screenMat = new StandardMaterial("screenMat", this.scene)
      // Confirmed: Removed VideoTexture placeholder
      this.slotTexture = new DynamicTexture("slotTex", {width: 1024, height: 512}, this.scene, true)
      screenMat.diffuseTexture = this.slotTexture
      screenMat.emissiveColor = Color3.White()
      screenMat.alpha = 1.0
      mainDisplay.material = screenMat
      this.backboxLayers.mainDisplay = mainDisplay

      // --- LAYER 3: TRANSPARENT LCD OVERLAY ---
      const overlay = MeshBuilder.CreatePlane("backboxOverlay", { width: 20, height: 12 }, this.scene)
      overlay.position.copyFrom(pos)
      overlay.position.z -= 1.01
      overlay.rotation.y = Math.PI

      const overlayMat = new StandardMaterial("overlayMat", this.scene)
      const overlayTexture = new DynamicTexture("overlayTex", 512, this.scene, true)
      overlayTexture.hasAlpha = true
      overlayMat.diffuseTexture = overlayTexture
      overlayMat.emissiveColor = Color3.White()
      overlayMat.alpha = 0.99
      overlay.material = overlayMat
      this.backboxLayers.overlay = overlay
  }

  // --- NEW: CABINET LIGHTING SYSTEM ---
  private drawSlots(dt: number) {
      if (!this.slotTexture) return

      // Update Physics/Animation of Reels
      for (let i = 0; i < 3; i++) {
          this.slotReels[i] += this.slotSpeeds[i] * dt
          this.slotReels[i] %= 1.0

          if (this.slotMode === 2) {
              if (this.slotSpeeds[i] > 0 && this.slotSpeeds[i] < 0.5) {
                   const snap = Math.round(this.slotReels[i] * this.slotSymbols.length) / this.slotSymbols.length
                   if (Math.abs(this.slotReels[i] - snap) < 0.01) {
                       this.slotReels[i] = snap
                       this.slotSpeeds[i] = 0
                   }
              }
          }
      }

      const ctx = this.slotTexture.getContext() as CanvasRenderingContext2D
      const w = 1024
      const h = 512

      // Background (Dark Glass)
      ctx.fillStyle = '#000000'
      ctx.fillRect(0, 0, w, h)

      // Draw Reels
      const reelW = w / 3
      // CHANGED: Use Orbitron for consistency
      ctx.font = 'bold 140px Orbitron, Arial, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'

      for (let i = 0; i < 3; i++) {
          const centerX = i * reelW + reelW / 2
          const offset = this.slotReels[i]
          const totalSyms = this.slotSymbols.length
          const rawIdx = offset * totalSyms
          const baseIdx = Math.floor(rawIdx)
          const subOffset = (rawIdx - baseIdx)

          for (let row = -1; row <= 1; row++) {
              let symIdx = (baseIdx - row) % totalSyms
              if (symIdx < 0) symIdx += totalSyms

              const symbol = this.slotSymbols[symIdx]
              const y = h/2 + (row * 180) + (subOffset * 180)

              if (this.slotSpeeds[i] > 2) {
                  ctx.fillStyle = 'rgba(255, 255, 255, 0.3)'
                  ctx.fillText(symbol, centerX, y - 20)
              }

              ctx.fillStyle = (this.slotMode === 0 && row === 0) ? '#ffffff' : '#888888' // Darker grey for inactive rows

              if (this.displayState === DisplayState.FEVER && row === 0) {
                   ctx.fillStyle = '#ffff00'
                   ctx.shadowBlur = 40
                   ctx.shadowColor = '#ffaa00'
              } else {
                   ctx.shadowBlur = 0
              }

              ctx.fillText(symbol, centerX, y)
          }

          // Reel Divider Lines
          ctx.strokeStyle = '#222' // Subtle dividers
          ctx.lineWidth = 4
          ctx.beginPath()
          ctx.moveTo(i * reelW, 0); ctx.lineTo(i * reelW, h)
          ctx.stroke()
      }

      // Draw Payline Overlay
      ctx.strokeStyle = 'rgba(255, 0, 50, 0.4)'
      ctx.lineWidth = 6
      ctx.beginPath()
      ctx.moveTo(0, h/2); ctx.lineTo(w, h/2)
      ctx.stroke()

      this.slotTexture.update()
  }

  // --- NEW: CABINET LIGHTING SYSTEM ---
  private createCabinetLighting(): void {
      if (!this.scene) return
      
      // LED strips along the edges of the cabinet
      const stripPositions = [
          { pos: new Vector3(-12.5, 2, 5), size: new Vector3(0.3, 3, 30) },  // Left strip
          { pos: new Vector3(13.5, 2, 5), size: new Vector3(0.3, 3, 30) },   // Right strip
          { pos: new Vector3(0.75, 6, 5), size: new Vector3(24, 0.3, 30) },  // Top strip
      ]

      stripPositions.forEach((config, idx) => {
          const strip = MeshBuilder.CreateBox(`ledStrip${idx}`, 
              { width: config.size.x, height: config.size.y, depth: config.size.z }, 
              this.scene as Scene)
          strip.position.copyFrom(config.pos)
          
          const mat = new StandardMaterial(`ledStripMat${idx}`, this.scene as Scene)
          mat.emissiveColor = Color3.FromHexString("#00aaff") // Start with blue/teal
          mat.alpha = 0.6
          strip.material = mat

          // Add point light for each strip to cast light on playfield
          const light = new PointLight(`stripLight${idx}`, config.pos, this.scene as Scene)
          light.diffuse = Color3.FromHexString("#00aaff")
          light.intensity = 0.5
          light.range = 15

          this.cabinetLights.push({ mesh: strip, material: mat, pointLight: light })
      })
  }

  // --- NEW: PACHINKO NAILS FIELD ---
  private createPachinkoField(center: Vector3, width: number, height: number): void {
      if (!this.scene || !this.world || !this.rapier) return
      
      // Metallic pin material for physical/digital contrast
      const pinMat = new StandardMaterial("pinMat", this.scene)
      pinMat.diffuseColor = Color3.FromHexString("#cccccc") // Chrome/silver
      pinMat.specularColor = Color3.White()
      pinMat.specularPower = 128 // High shine
      pinMat.emissiveColor = Color3.FromHexString("#003333").scale(0.1) // Subtle teal glow
      pinMat.alpha = 1.0 // Fully opaque for physical look

      const rows = 6
      const cols = 9
      const spacingX = width / cols
      const spacingZ = height / rows

      for(let r=0; r<rows; r++) {
          // Offset every other row for hexagonal packing
          const offsetX = (r % 2 === 0) ? 0 : spacingX / 2
          for(let c=0; c<cols; c++) {
              const x = center.x - (width/2) + c * spacingX + offsetX
              const z = center.z - (height/2) + r * spacingZ
              
              // Skip center for a "lane" or target
              if (Math.abs(x) < 2 && Math.abs(z - center.z) < 2) continue;

              const pin = MeshBuilder.CreateCylinder(`pin_${r}_${c}`, { diameter: 0.3, height: 1.5 }, this.scene)
              pin.position.set(x, 0.5, z)
              pin.material = pinMat
              
              const body = this.world.createRigidBody(this.rapier.RigidBodyDesc.fixed().setTranslation(x, 0.5, z))
              this.world.createCollider(this.rapier.ColliderDesc.cylinder(0.75, 0.15).setRestitution(0.5), body)
              this.bindings.push({ mesh: pin, rigidBody: body })
              this.pinballMeshes.push(pin)
          }
      }

      // Add a Center Catcher (Bucket) with distinct glowing material
      const catcher = MeshBuilder.CreateTorus("catcher", { diameter: 2.5, thickness: 0.2 }, this.scene)
      catcher.position.set(center.x, 0.2, center.z)
      const catcherMat = new StandardMaterial("catcherMat", this.scene)
      catcherMat.emissiveColor = Color3.FromHexString("#ff00aa") // Bright pink glow
      catcherMat.alpha = 0.8
      catcher.material = catcherMat
      const catchBody = this.world.createRigidBody(this.rapier.RigidBodyDesc.fixed().setTranslation(center.x, 0.2, center.z))
      // Sensor inside the ring
      this.world.createCollider(this.rapier.ColliderDesc.cylinder(0.5, 1.0).setSensor(true).setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS), catchBody)
      this.targetBodies.push(catchBody)
      this.targetMeshes.push(catcher)
      this.targetActive.push(true)
      this.targetRespawnTimer.push(0)
      this.pinballMeshes.push(catcher)
  }

  // --- ADVENTURE MODE: HOLO-DECK TRACK ---
  private createAdventureTrack() {
      if (!this.scene || !this.world || !this.rapier) return

      // Material: "Hard Light" (Bright, semi-transparent)
      const holoMat = new StandardMaterial("holoTrackMat", this.scene)
      holoMat.emissiveColor = Color3.FromHexString("#00ffff")
      holoMat.diffuseColor = Color3.Black()
      holoMat.alpha = 0.6
      holoMat.wireframe = true

      // Start the track slightly above the main board
      let currentPos = new Vector3(0, 2, 8) 
      
      const addRamp = (width: number, length: number, drop: number, rotY: number) => {
          // Visual
          const box = MeshBuilder.CreateBox("holoRamp", { width, height: 0.5, depth: length }, this.scene)
          
          // Position relative to the "cursor"
          // We move 'length/2' forward in the local rotation space
          const forward = new Vector3(Math.sin(rotY), 0, Math.cos(rotY))
          const center = currentPos.add(forward.scale(length / 2))
          center.y -= drop / 2 // Slope down
          
          box.position.copyFrom(center)
          box.rotation.y = rotY
          box.rotation.x = Math.atan2(drop, length) // Tilt down
          box.material = holoMat
          this.adventureTrack.push(box)

          // Physics
          const q = Quaternion.FromEulerAngles(box.rotation.x, box.rotation.y, 0)
          const body = this.world!.createRigidBody(
             this.rapier!.RigidBodyDesc.fixed()
             .setTranslation(center.x, center.y, center.z)
             .setRotation({x: q.x, y: q.y, z: q.z, w: q.w})
          )
          this.world!.createCollider(this.rapier!.ColliderDesc.cuboid(width/2, 0.25, length/2), body)
          
          // Update cursor to end of ramp
          currentPos = currentPos.add(forward.scale(length))
          currentPos.y -= drop
          
          return currentPos
      }

      // --- GENERATE THE "TABLE MAZE" ---
      // 1. Rise up! (A platform appearing out of the back)
      // 2. A Zig-Zag course falling down towards the flippers
      
      let heading = Math.PI // Facing towards player (-Z)
      
      // Segment 1: Steep drop from backboard
      addRamp(6, 10, 4, heading) 
      
      // Segment 2: Sharp Left Turn
      heading += Math.PI / 2
      addRamp(4, 6, 1, heading)
      
      // Segment 3: Sharp Right Turn (Downhill fast!)
      heading -= Math.PI / 1.5
      addRamp(4, 12, 3, heading)

      // Segment 4: The Catch Basin (Near flippers)
      const basin = MeshBuilder.CreateBox("basin", { width: 8, height: 1, depth: 4}, this.scene)
      basin.position.set(0, currentPos.y - 1, -8)
      basin.material = holoMat
      this.adventureTrack.push(basin)
      
      const bBody = this.world.createRigidBody(this.rapier.RigidBodyDesc.fixed().setTranslation(0, currentPos.y - 1, -8))
      this.world.createCollider(this.rapier.ColliderDesc.cuboid(4, 0.5, 2), bBody)

      // Add "Return Sensor" in the basin
      const sensor = this.world.createRigidBody(this.rapier.RigidBodyDesc.fixed().setTranslation(0, currentPos.y, -8))
      this.world.createCollider(
          this.rapier.ColliderDesc.cuboid(2, 1, 1).setSensor(true).setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS), 
          sensor
      )
      // Store sensor separately for adventure mode detection
      this.adventureSensor = sensor
  }

  // Helper Wrappers
  private createWall(pos: Vector3, size: Vector3, mat: StandardMaterial): void {
     if (!this.scene || !this.world || !this.rapier) return
     const w = MeshBuilder.CreateBox("w", { width: size.x, height: size.y*2, depth: size.z}, this.scene)
     w.position.copyFrom(pos); w.material = mat
     const b = this.world.createRigidBody(this.rapier.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z))
     this.world.createCollider(this.rapier.ColliderDesc.cuboid(size.x/2, size.y, size.z/2), b)
     this.bindings.push({ mesh: w, rigidBody: b })
     this.pinballMeshes.push(w)
  }

  private createSlingshot(pos: Vector3, rot: number, mat: StandardMaterial): void {
      if (!this.scene || !this.world || !this.rapier) return
      const mesh = MeshBuilder.CreateBox("sling", { width: 0.5, height: 2, depth: 4 }, this.scene)
      mesh.rotation.y = rot; mesh.position.copyFrom(pos); mesh.material = mat
      const q = Quaternion.FromEulerAngles(0, rot, 0)
      const b = this.world.createRigidBody(this.rapier.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z).setRotation({x:q.x, y:q.y, z:q.z, w:q.w}))
      this.world.createCollider(this.rapier.ColliderDesc.cuboid(0.25, 1, 2).setRestitution(1.5).setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS), b)
      this.bindings.push({mesh, rigidBody: b})
      this.bumperBodies.push(b)
      this.bumperVisuals.push({ mesh, body: b, hitTime: 0, sweep: 0 })
      this.pinballMeshes.push(mesh)
  }

  private createFlippers(mat: StandardMaterial) {
     // reuse existing logic
     const make = (pos: Vector3, right: boolean) => {
        const mesh = MeshBuilder.CreateBox("flipper", { width: 3.5, depth: 0.5, height: 0.5}, this.scene) as Mesh
        mesh.material = mat
        const body = this.world!.createRigidBody(this.rapier!.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z))
        this.world!.createCollider(this.rapier!.ColliderDesc.cuboid(1.75, 0.25, 0.25), body)
        this.bindings.push({mesh, rigidBody: body})
        this.pinballMeshes.push(mesh)
        const anchor = this.world!.createRigidBody(this.rapier!.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z))
        const pX = right ? 1.5 : -1.5
        const jParams = this.rapier!.JointData.revolute(new this.rapier!.Vector3(pX,0,0), new this.rapier!.Vector3(pX,0,0), new this.rapier!.Vector3(0,1,0))
        jParams.limitsEnabled = true
        jParams.limits = right ? [-Math.PI/4, Math.PI/6] : [-Math.PI/6, Math.PI/4]
        const joint = this.world!.createImpulseJoint(jParams, anchor, body, true) as RAPIER.RevoluteImpulseJoint
        joint.configureMotorPosition(right ? -Math.PI/4 : Math.PI/4, 100000, 1000)
        return joint
     }
     if (this.scene && this.world) {
        this.flipperLeftJoint = make(new Vector3(-4, -0.5, -7), false)
        this.flipperRightJoint = make(new Vector3(4, -0.5, -7), true)
     }
  }

  private createBumpers(): void {
    if (!this.scene || !this.world || !this.rapier) return

    const make = (x: number, z: number, colorHex: string) => {
        const bumper = MeshBuilder.CreateSphere("bump", { diameter: 0.8 }, this.scene as Scene) as Mesh
        bumper.position.set(x, 0.5, z)
        const mat = new StandardMaterial("bMat", this.scene as Scene)
        mat.emissiveColor = Color3.FromHexString(colorHex)
        bumper.material = mat
        
        // --- NEW: HOLOGRAPHIC OVERLAY ---
        // A tall wireframe cylinder that floats above the bumper
        const holo = MeshBuilder.CreateCylinder("holo", { diameter: 0.8, height: 3, tessellation: 16 }, this.scene as Scene)
        holo.position.set(x, 2.0, z)
        const holoMat = new StandardMaterial("holoMat", this.scene as Scene)
        holoMat.wireframe = true
        holoMat.emissiveColor = Color3.FromHexString(colorHex)
        holoMat.alpha = 0.3
        holo.material = holoMat
        
        const body = this.world!.createRigidBody(this.rapier!.RigidBodyDesc.fixed().setTranslation(x, 0.5, z))
        this.world!.createCollider(this.rapier!.ColliderDesc.ball(0.4).setRestitution(1.5).setActiveEvents(this.rapier!.ActiveEvents.COLLISION_EVENTS), body)
        
        this.bindings.push({ mesh: bumper, rigidBody: body })
        this.bumperBodies.push(body)
        this.bumperVisuals.push({ mesh: bumper, body: body, hologram: holo, hitTime: 0, sweep: Math.random() })
        this.pinballMeshes.push(bumper)
        this.pinballMeshes.push(holo)
    }

    make(0, 8, "#ff00aa")   // Center pink
    make(-4, 4, "#00aaff")  // Left blue
    make(4, 4, "#00aaff")   // Right blue
  }

  // --- GAME LOOP & UPDATES ---

  private stepPhysics(): void {
    if (this.state !== GameState.PLAYING || !this.world) return
    this.world.step(this.eventQueue!)

    const dt = this.engine.getDeltaTime() / 1000
    
    // Process Events
    this.eventQueue!.drainCollisionEvents((h1, h2, start) => {
        if (!start) return
        this.processCollision(h1, h2)
    })

    // Animation: Rotate holograms and pulse bumpers
    const time = performance.now() * 0.001
    this.bumperVisuals.forEach(vis => {
        if (vis.hologram) {
            vis.hologram.rotation.y += dt * 1.5
            // Bobbing effect
            vis.hologram.position.y = 2.0 + Math.sin(time * 2 + vis.sweep * 10) * 0.2
        }
        // Hit animation
        if (vis.hitTime > 0) {
            vis.hitTime -= dt
            const s = 1 + (vis.hitTime * 2)
            vis.mesh.scaling.set(s,s,s)
            if (vis.hologram) {
                 vis.hologram.scaling.set(1, 1 + vis.hitTime, 1) // Stretch hologram on hit
                 vis.hologram.material!.alpha = 0.8 // Brighten
            }
        } else {
             vis.mesh.scaling.set(1,1,1)
             if (vis.hologram) {
                 vis.hologram.scaling.set(1,1,1)
                 vis.hologram.material!.alpha = 0.3
             }
        }
    })

    // Update targets respawn
    for(let i=0; i<this.targetActive.length; i++) {
        if(!this.targetActive[i]) {
            this.targetRespawnTimer[i] -= dt
            if (this.targetRespawnTimer[i] <= 0) {
                this.targetActive[i] = true
                this.targetMeshes[i].isVisible = true
            }
        }
    }

    this.updateShards(dt)
    this.updateCombo(dt)
    this.updateBloom(dt)
    this.updateDisplayState(dt)
    this.updateCabinetLighting(dt)
    if (this.powerupActive) {
        this.powerupTimer -= dt
        if (this.powerupTimer <= 0) this.powerupActive = false
    }
  }

  private processCollision(h1: number, h2: number) {
      const b1 = this.world!.getRigidBody(h1); const b2 = this.world!.getRigidBody(h2)
      if (!b1 || !b2) return
      
      // Adventure Mode Sensor - End Adventure
      if (this.adventureActive && this.adventureSensor && (b1 === this.adventureSensor || b2 === this.adventureSensor)) {
          this.endAdventureMode()
          return
      }
      
      // Death Zone
      if (b1 === this.deathZoneBody || b2 === this.deathZoneBody) {
          const ball = b1 === this.deathZoneBody ? b2 : b1
          this.handleBallLoss(ball)
          return
      }

      // Bumpers
      const bump = this.bumperBodies.find(b => b === b1 || b === b2)
      if (bump) {
          const vis = this.bumperVisuals.find(v => v.body === bump)
          if (vis) {
             vis.hitTime = 0.2
             this.score += (10 * (Math.floor(this.comboCount/3)+1))
             this.comboCount++
             this.comboTimer = 1.5
             this.spawnShardBurst(vis.mesh.position)
             this.bloomEnergy = 2.0
             this.playBeep(400 + Math.random()*200)
             this.updateHUD()
             // Trigger cabinet lighting flash
             this.lightingMode = 'hit'
             this.lightingTimer = 0.2
          }
          return
      }

      // Targets (Pachinko Catcher)
      const tgt = this.targetBodies.find(b => b === b1 || b === b2)
      if (tgt) {
          const idx = this.targetBodies.indexOf(tgt)
          if (this.targetActive[idx]) {
             this.score += 100
             this.targetActive[idx] = false
             this.targetMeshes[idx].isVisible = false
             this.targetRespawnTimer[idx] = 5.0
             this.playBeep(1200)
             this.spawnExtraBalls(1) // Prize: Extra ball!
             this.updateHUD()
             // Trigger REACH display state
             this.setDisplayState(DisplayState.REACH)
             this.lightingMode = 'fever'
             this.lightingTimer = 3.0
          }
      }
  }
  
  private handleBallLoss(body: RAPIER.RigidBody) {
      if (this.state !== GameState.PLAYING) return
      this.comboCount = 0
      
      const idx = this.ballBodies.indexOf(body)
      if (idx !== -1) {
          this.world?.removeRigidBody(body)
          this.ballBodies.splice(idx, 1)
          // Find mesh binding
          const bIdx = this.bindings.findIndex(b => b.rigidBody === body)
          if (bIdx !== -1) {
             this.bindings[bIdx].mesh.dispose()
             this.bindings.splice(bIdx, 1)
          }
      }

      // If main ball lost
      if (body === this.ballBody) {
          if (this.ballBodies.length > 0) {
              this.ballBody = this.ballBodies[0] // Promote another ball
          } else {
              this.lives--
              if (this.lives > 0) this.resetBall()
              else this.setGameState(GameState.GAME_OVER)
          }
      }
      this.updateHUD()
  }

  private resetBall() {
      if (!this.world || !this.rapier || !this.scene) return
      // Create new ball if missing
      if (this.ballBodies.length === 0) {
          const mat = new StandardMaterial("ballMat", this.scene)
          mat.emissiveColor = new Color3(0.2,0.2,0.2)
          const b = MeshBuilder.CreateSphere("ball", {diameter:1}, this.scene) as Mesh
          b.material = mat
          const body = this.world.createRigidBody(this.rapier.RigidBodyDesc.dynamic().setTranslation(10.5, 0.5, -9))
          this.world.createCollider(this.rapier.ColliderDesc.ball(0.5).setRestitution(0.7).setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS), body)
          this.ballBody = body
          this.ballBodies.push(body)
          this.bindings.push({mesh:b, rigidBody:body})
          if (this.mirrorTexture?.renderList) this.mirrorTexture.renderList.push(b)
      } else {
          // Reset existing
          this.ballBody!.setTranslation(new this.rapier.Vector3(10.5, 0.5, -9), true)
          this.ballBody!.setLinvel(new this.rapier.Vector3(0,0,0), true)
          this.ballBody!.setAngvel(new this.rapier.Vector3(0,0,0), true)
      }
      this.updateHUD()
  }

  private spawnExtraBalls(count: number) {
      if (!this.world || !this.scene || !this.rapier) return
      for(let i=0; i<count; i++) {
          const b = MeshBuilder.CreateSphere("xb", {diameter:1}, this.scene) as Mesh
          b.position.set(10.5, 0.5, -9 - i)
          const mat = new StandardMaterial("xbMat", this.scene); mat.diffuseColor = Color3.Green()
          b.material = mat
          const body = this.world.createRigidBody(this.rapier.RigidBodyDesc.dynamic().setTranslation(b.position.x, b.position.y, b.position.z))
          this.world.createCollider(this.rapier.ColliderDesc.ball(0.5).setRestitution(0.7).setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS), body)
          this.bindings.push({mesh:b, rigidBody:body})
          this.ballBodies.push(body)
          if (this.mirrorTexture?.renderList) this.mirrorTexture.renderList.push(b)
      }
  }

  private updateHUD() {
      if (this.scoreElement) this.scoreElement.textContent = String(this.score)
      if (this.livesElement) this.livesElement.textContent = String(this.lives)
      if (this.comboElement) this.comboElement.textContent = this.comboCount > 1 ? `Combo ${this.comboCount}` : ""
      if (this.bestHudElement) this.bestHudElement.textContent = String(this.bestScore)
  }

  private updateShards(dt: number) {
      for(let i=this.shards.length-1; i>=0; i--) {
          const s = this.shards[i]; s.life -= dt
          if (s.life<=0) { s.mesh.dispose(); this.shards.splice(i,1); continue }
          s.mesh.position.addInPlace(s.vel.scale(dt))
          s.vel.y -= 9.8 * dt
      }
  }

  private updateCombo(dt: number) {
      if (this.comboTimer > 0) {
          this.comboTimer -= dt
          if (this.comboTimer <= 0) { this.comboCount = 0; this.updateHUD() }
      }
  }
  
  private updateBloom(dt: number) {
      if (this.bloomPipeline) {
          this.bloomEnergy = Math.max(0, this.bloomEnergy - dt)
          this.bloomPipeline.bloomWeight = 0.4 + (this.bloomEnergy * 0.4)
      }
  }

  private setDisplayState(newState: DisplayState) {
      this.displayState = newState
      this.displayTransitionTimer = 0
      
      // --- SLOT MACHINE LOGIC TRIGGERS ---
      if (newState === DisplayState.REACH) {
          // START SPIN
          this.slotMode = 1 // Spinning
          this.slotSpeeds = [5.0, 5.0, 5.0] // Fast speed
          this.slotStopTimer = 2.0 // Spin for 2 seconds before slowing
      }
      else if (newState === DisplayState.FEVER) {
          // FORCED WIN (Jackpot)
          this.slotMode = 2 // Stopping
          // Set reels to align to '7' (Index 0)
          // We mathematically set the 'target' offset to 0.0 (Symbol 0)
          this.slotReels = [0.1, 0.4, 0.7] // Offset slightly so they roll into place
          this.slotSpeeds = [2.0, 3.0, 4.0] // Different speeds for drama
      }
      else if (newState === DisplayState.IDLE) {
          this.slotMode = 0
          this.slotSpeeds = [0, 0, 0]
      }

      // --- OVERLAY TEXT LOGIC (Layer 3) ---
      if (!this.backboxLayers.overlay || !this.scene) return
      
      const overlayMat = this.backboxLayers.overlay.material as StandardMaterial
      const overlayTexture = overlayMat.diffuseTexture as DynamicTexture
      if (!overlayTexture) return
      
      const ctx = overlayTexture.getContext() as CanvasRenderingContext2D
      ctx.clearRect(0, 0, 512, 512)
      
      // Only draw text if meaningful
      if (newState === DisplayState.REACH) {
          ctx.fillStyle = 'rgba(255, 0, 85, 0.8)'
          ctx.font = 'bold 60px Orbitron, Arial'
          ctx.textAlign = 'center'
          ctx.fillText('REACH!', 256, 100)
      } else if (newState === DisplayState.FEVER) {
          ctx.fillStyle = 'rgba(255, 215, 0, 1.0)'
          ctx.font = 'bold 80px Orbitron, Arial'
          ctx.textAlign = 'center'
          ctx.shadowBlur = 30
          ctx.shadowColor = '#ffd700'
          ctx.fillText('JACKPOT!', 256, 256)
      }
      overlayTexture.update()
  }

  private updateDisplayState(dt: number) {
      this.displayTransitionTimer += dt
      
      // Update the slot visuals every frame
      this.drawSlots(dt)

      // State Machine for Slots
      if (this.slotMode === 1) { // Spinning
           this.slotStopTimer -= dt
           if (this.slotStopTimer <= 0) {
               // Transition to stopping
               this.slotMode = 2
               // Stagger the stops: Left stops first, then middle, then right
               this.slotSpeeds = [0.0, 5.0, 5.0] // Force Stop 1 immediately for effect, or dampen
           }
      }

      if (this.slotMode === 2) { // Stopping Phase
           // Dampen speeds
           this.slotSpeeds[0] = Math.max(0, this.slotSpeeds[0] - dt * 2)
           this.slotSpeeds[1] = Math.max(0, this.slotSpeeds[1] - dt * 1.5)
           this.slotSpeeds[2] = Math.max(0, this.slotSpeeds[2] - dt * 1.0)

           // If all stopped and we are in REACH, auto-trigger FEVER (simulated win)
           if (this.displayState === DisplayState.REACH &&
               this.slotSpeeds[0] === 0 && this.slotSpeeds[1] === 0 && this.slotSpeeds[2] === 0) {
                   // In a real game, you'd check RNG here.
                   // For this demo, REACH always leads to FEVER/WIN after a moment.
                   this.setDisplayState(DisplayState.FEVER)
           }
      }

      // Logic to revert to IDLE
      if (this.displayState === DisplayState.FEVER && this.displayTransitionTimer > 6.0) {
          this.setDisplayState(DisplayState.IDLE)
      }
  }

  private updateCabinetLighting(dt: number) {
      const time = performance.now() * 0.001
      
      // Update lighting timer
      if (this.lightingTimer > 0) {
          this.lightingTimer -= dt
          if (this.lightingTimer <= 0) {
              this.lightingMode = 'normal'
          }
      }

      this.cabinetLights.forEach((light, idx) => {
          let targetColor: Color3
          let intensity = 0.5
          
          switch (this.lightingMode) {
              case 'hit':
                  // Flash white/silver
                  targetColor = Color3.White()
                  intensity = 2.0
                  break
              case 'fever': {
                  // Strobing rainbow/pulsing red-gold
                  const hue = (time * 2 + idx * 0.3) % 1
                  targetColor = Color3.FromHSV(hue * 360, 0.8, 1.0)
                  intensity = 1.5 + Math.sin(time * 10) * 0.5
                  break
              }
              case 'normal':
              default: {
                  // Breathing blue/teal
                  const breath = 0.5 + Math.sin(time + idx * 0.5) * 0.3
                  targetColor = Color3.FromHexString("#00aaff").scale(breath)
                  intensity = 0.5 + breath * 0.2
                  break
              }
          }
          
          // Smooth color transition
          light.material.emissiveColor = Color3.Lerp(
              light.material.emissiveColor, 
              targetColor, 
              dt * 10
          )
          light.pointLight.diffuse = light.material.emissiveColor
          light.pointLight.intensity = intensity
      })
  }

  public startAdventureMode() {
      if (this.adventureActive || !this.scene || !this.ballBody) return
      this.adventureActive = true

      // 1. Hide Physical Table (The "Dimming" Effect)
      this.pinballMeshes.forEach(m => m.setEnabled(false)) 
      // Note: We use setEnabled(false) so physics might still run, but visuals are gone. 
      // For true "Holo-Deck", we assume the holo-track is above the physical colliders 
      // or we accept that the ball might bump invisible bumpers if we aren't careful.
      // Ideally, the holo-track is physically higher (y=2 to y=5).

      // 2. Spawn Track
      this.createAdventureTrack()

      // 3. Teleport Ball to Start (Top of the new Holograms)
      this.ballBody.setTranslation({ x: 0, y: 3, z: 8 }, true)
      this.ballBody.setLinvel({ x: 0, y: 0, z: 0 }, true)

      // 4. Isometric Camera Setup
      this.tableCamera = this.scene.activeCamera as ArcRotateCamera
      
      // A steep angle (beta = 0.8) keeps it looking down, 
      // but close zoom (radius = 15) focuses on the action.
      this.followCamera = new ArcRotateCamera("isoCam", -Math.PI/2, 0.8, 15, Vector3.Zero(), this.scene)
      
      // Lock target to the ball mesh
      const ballMesh = this.bindings.find(b => b.rigidBody === this.ballBody)?.mesh
      if (ballMesh) this.followCamera.lockedTarget = ballMesh
      
      this.scene.activeCamera = this.followCamera
      
      if (this.scoreElement) this.scoreElement.innerText = "HOLO-DECK ACTIVE"
  }
  
  public endAdventureMode() {
       if (!this.adventureActive || !this.scene) return
       this.adventureActive = false

       // 1. Restore Physical Table
       this.pinballMeshes.forEach(m => m.setEnabled(true))

       // 2. Teleport Ball back to Plunger or Field
       this.resetBall()

       // 3. Restore Camera
       if (this.tableCamera) {
           this.scene.activeCamera = this.tableCamera
           this.followCamera?.dispose()
           this.followCamera = null
       }

       // 4. Cleanup Track
       this.adventureTrack.forEach(m => m.dispose())
       this.adventureTrack = []
       
       // 5. Cleanup Physics Bodies
       if (this.adventureSensor && this.world) {
           this.world.removeRigidBody(this.adventureSensor)
           this.adventureSensor = null
       }
       
       // Reset score display
       this.updateHUD()
  }

  private spawnShardBurst(pos: Vector3) {
     if (!this.scene) return
     for(let i=0; i<8; i++) {
         const m = MeshBuilder.CreateBox("s", {size:0.15}, this.scene) as Mesh
         m.position.copyFrom(pos)
         const mat = new StandardMaterial("sm", this.scene)
         mat.emissiveColor = Color3.Teal()
         m.material = mat
         const vel = new Vector3(Math.random()-0.5, Math.random()+1, Math.random()-0.5).scale(5)
         this.shards.push({ mesh: m, vel, life: 1.0, material: mat })
     }
  }
  
  private playBeep(freq: number) {
     if (!this.audioCtx) return
     const o = this.audioCtx.createOscillator(); const g = this.audioCtx.createGain()
     o.frequency.value = freq; o.connect(g); g.connect(this.audioCtx.destination)
     o.start(); g.gain.exponentialRampToValueAtTime(0.0001, this.audioCtx.currentTime+0.1); o.stop(this.audioCtx.currentTime+0.1)
  }
  
  // Touch/Nudge stubs
  private triggerLeftFlipper() {
    // Stub for touch controls
  }
  private triggerRightFlipper() {
    // Stub for touch controls
  }
  private triggerPlunger() {
    // Stub for touch controls
  }
  private applyNudge(v: RAPIER.Vector3) {
    // Stub for nudge functionality - would apply impulse to ball
    if (this.ballBody) {
      // Implementation placeholder - v parameter reserved for future use
      void v
    }
  }
}
