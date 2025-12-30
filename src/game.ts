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
  PointLight,
  TrailMesh,
  VideoTexture,
  StandardMaterial,
  Mesh,
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
  private spinnerBody: RAPIER.RigidBody | null = null
  private spinnerMesh: Mesh | null = null
  private ballBodies: RAPIER.RigidBody[] = []
  private bumperVisuals: BumperVisual[] = []
  private shards: Array<{ mesh: Mesh; vel: Vector3; life: number; material: StandardMaterial }> = []
  
  // Systems
  private eventQueue: RAPIER.EventQueue | null = null
  private bloomPipeline: DefaultRenderingPipeline | null = null
  private bloomEnergy = 0
  private mirrorTexture: MirrorTexture | null = null
  private audioCtx: AudioContext | null = null
  private contactForceMap = new Map<string, number>()
  
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
  private targetsHitSincePower = 0
  private nudgeCount = 0
  private nudgeWindowTimer = 0
  private tiltActive = false
  private tiltTimer = 0
  
  // Constants
  private readonly comboTimeout = 1.6
  private readonly powerupDuration = 10
  private readonly nudgeWindow = 1.4
  private readonly nudgeThreshold = 7
  private readonly tiltDuration = 3
  private readonly voiceCuePaths: Record<string, string> = { fever: '/voice/fever.mp3' }
  private voiceBuffers = new Map<string, AudioBuffer | null>()
  private voiceLoads = new Map<string, Promise<AudioBuffer | null>>()
  private voiceCooldown = 0

  // UI
  private scoreElement: HTMLElement | null = null
  private livesElement: HTMLElement | null = null
  private comboElement: HTMLElement | null = null
  private bestHudElement: HTMLElement | null = null
  private bestMenuElement: HTMLElement | null = null
  private bestFinalElement: HTMLElement | null = null
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
    this.bestMenuElement = document.getElementById('best-score-menu')
    this.bestFinalElement = document.getElementById('best-score-final')
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
    } catch {}
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
      this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)()
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

  // ... (GameState management methods same as before)
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
          try { localStorage.setItem('pachinball.best', String(this.bestScore)) } catch {}
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

  // ... (Input methods same as before: onKeyDown, onKeyUp)
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
    await (this.rapier.init as any)({})
    this.world = new this.rapier.World(new this.rapier.Vector3(GRAVITY.x, GRAVITY.y, GRAVITY.z))
    this.eventQueue = new this.rapier.EventQueue(true)
  }

  // ... (createGridTexture same as before)
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
      frame.material = frameMat

      // Screen Surface
      const screen = MeshBuilder.CreatePlane("backboxScreen", { width: 20, height: 12 }, this.scene)
      screen.position.copyFrom(pos)
      screen.position.z -= 1.01 // Push forward slightly
      screen.rotation.y = Math.PI // Face player
      screen.rotation.z = Math.PI // Fix orientation if needed

      const screenMat = new StandardMaterial("screenMat", this.scene)
      // Placeholder for the "Woman/Waterfall/Tiger" video
      // To use a real video, replace null with a URL, e.g., "videos/myloop.mp4"
      // Note: Browsers require user interaction to play video with audio, but muted usually works.
      const videoTexture = new VideoTexture("screenVideo", ["/vite.svg"], this.scene, true, false) 
      // Using vite.svg as placeholder. For real video:
      // const videoTexture = new VideoTexture("vid", ["path/to/video.mp4"], this.scene, true)
      
      screenMat.diffuseTexture = videoTexture
      screenMat.emissiveColor = Color3.White() // Self-illuminated
      screen.material = screenMat
  }

  // --- NEW: PACHINKO NAILS FIELD ---
  private createPachinkoField(center: Vector3, width: number, height: number): void {
      if (!this.scene || !this.world || !this.rapier) return
      
      const pinMat = new StandardMaterial("pinMat", this.scene)
      pinMat.emissiveColor = Color3.FromHexString("#00ffaa")
      pinMat.alpha = 0.6

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
          }
      }

      // Add a Center Catcher (Bucket)
      const catcher = MeshBuilder.CreateTorus("catcher", { diameter: 2.5, thickness: 0.2 }, this.scene)
      catcher.position.set(center.x, 0.2, center.z)
      catcher.material = pinMat
      const catchBody = this.world.createRigidBody(this.rapier.RigidBodyDesc.fixed().setTranslation(center.x, 0.2, center.z))
      // Sensor inside the ring
      this.world.createCollider(this.rapier.ColliderDesc.cylinder(0.5, 1.0).setSensor(true).setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS), catchBody)
      this.targetBodies.push(catchBody)
      this.targetMeshes.push(catcher)
      this.targetActive.push(true)
      this.targetRespawnTimer.push(0)
  }

  // Helper Wrappers
  private createWall(pos: Vector3, size: Vector3, mat: StandardMaterial): void {
     if (!this.scene || !this.world || !this.rapier) return
     const w = MeshBuilder.CreateBox("w", { width: size.x, height: size.y*2, depth: size.z}, this.scene)
     w.position.copyFrom(pos); w.material = mat
     const b = this.world.createRigidBody(this.rapier.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z))
     this.world.createCollider(this.rapier.ColliderDesc.cuboid(size.x/2, size.y, size.z/2), b)
     this.bindings.push({ mesh: w, rigidBody: b })
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
  }

  private createFlippers(mat: StandardMaterial) {
     // reuse existing logic
     const make = (pos: Vector3, right: boolean) => {
        const mesh = MeshBuilder.CreateBox("flipper", { width: 3.5, depth: 0.5, height: 0.5}, this.scene) as Mesh
        mesh.material = mat
        const body = this.world!.createRigidBody(this.rapier!.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z))
        this.world!.createCollider(this.rapier!.ColliderDesc.cuboid(1.75, 0.25, 0.25), body)
        this.bindings.push({mesh, rigidBody: body})
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
    if (this.powerupActive) {
        this.powerupTimer -= dt
        if (this.powerupTimer <= 0) this.powerupActive = false
    }
  }

  private processCollision(h1: number, h2: number) {
      const b1 = this.world!.getRigidBody(h1); const b2 = this.world!.getRigidBody(h2)
      if (!b1 || !b2) return
      
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
          }
      }
  }

  // ... (Remaining helpers: handleBallLoss, spawnShardBurst, spawnExtraBalls, updateShards, updateCombo, updateBloom, playBeep, updateHUD, resetBall, etc.)
  // These implementations can remain largely identical to previous version, ensuring basic functionality.
  
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
      if (!this.world || !this.rapier) return
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
  private triggerLeftFlipper() {}
  private triggerRightFlipper() {}
  private triggerPlunger() {}
  private applyNudge(v: RAPIER.Vector3) {}
}
