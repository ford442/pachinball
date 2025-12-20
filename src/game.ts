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
} from '@babylonjs/core'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import type { Engine } from '@babylonjs/core/Engines/engine'
import type { Nullable } from '@babylonjs/core/types'
import type { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine'
import type * as RAPIER from '@dimforge/rapier3d-compat'

// Gravity tilted to pull ball down (-Z) and onto the table (-Y)
const GRAVITY = new Vector3(0, -9.81, -5.0)

// See ASSETS_GUIDE.md for info on adding real textures
interface PhysicsBinding {
  mesh: TransformNode
  rigidBody: RAPIER.RigidBody
}

interface BumperVisual {
  mesh: Mesh
  body: RAPIER.RigidBody
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
  private bindings: PhysicsBinding[] = []
  private flipperLeftJoint: RAPIER.ImpulseJoint | null = null
  private flipperRightJoint: RAPIER.ImpulseJoint | null = null
  private ready = false

  // Game State
  private state: GameState = GameState.MENU
  private score = 0
  private lives = 3
  private bestScore = 0
  private comboCount = 0
  private comboTimer = 0
  private readonly comboTimeout = 1.6

  // UI Elements
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
  // touch controls
  private touchLeftBtn: HTMLElement | null = null
  private touchRightBtn: HTMLElement | null = null
  private touchPlungerBtn: HTMLElement | null = null
  private touchNudgeBtn: HTMLElement | null = null

  private eventQueue: RAPIER.EventQueue | null = null
  private ballBody: RAPIER.RigidBody | null = null
  private deathZoneBody: RAPIER.RigidBody | null = null
  private bumperBodies: RAPIER.RigidBody[] = []
  private targetBodies: RAPIER.RigidBody[] = []
  private targetMeshes: Mesh[] = []
  private targetActive: boolean[] = []
  private targetRespawnTimer: number[] = []
  private spinnerBody: RAPIER.RigidBody | null = null
  private spinnerMesh: Mesh | null = null
  // Multiball / power-ups
  private ballBodies: RAPIER.RigidBody[] = []
  private powerupActive = false
  private powerupTimer = 0
  private readonly powerupDuration = 10
  private targetsHitSincePower = 0
  // Nudge / tilt mechanics
  private nudgeCount = 0
  private nudgeWindowTimer = 0
  private readonly nudgeWindow = 1.4
  private readonly nudgeThreshold = 7
  private tiltActive = false
  private tiltTimer = 0
  private readonly tiltDuration = 3
  private bumperVisuals: BumperVisual[] = []
  private shards: Array<{ mesh: Mesh; vel: Vector3; life: number; material: StandardMaterial }> = []
  private mirrorTexture: MirrorTexture | null = null
  private audioCtx: AudioContext | null = null
  private contactForceMap = new Map<string, number>()
  private bloomPipeline: DefaultRenderingPipeline | null = null
  private bloomEnergy = 0
  private readonly voiceCuePaths: Record<string, string> = { fever: '/voice/fever.mp3' }
  private voiceBuffers = new Map<string, AudioBuffer | null>()
  private voiceLoads = new Map<string, Promise<AudioBuffer | null>>()
  private voiceCooldown = 0

  constructor(engine: Engine | WebGPUEngine) {
    this.engine = engine
  }

  async init(canvas: HTMLCanvasElement): Promise<void> {
    if ('initAsync' in this.engine) {
      await this.engine.initAsync()
    }

    this.scene = new Scene(this.engine)
    this.scene.clearColor = Color3.FromHexString("#050505").toColor4(1)

    // Bind UI
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
    // powerup / balls HUD
    // elements: balls, powerup and powerup-name
    const balls = document.getElementById('balls')
    if (balls) this.bestHudElement = this.bestHudElement || null // no-op to keep TS happy

    document.getElementById('start-btn')?.addEventListener('click', () => this.startGame())
    document.getElementById('restart-btn')?.addEventListener('click', () => this.startGame())

    // Touch controls (mobile)
    this.touchLeftBtn = document.getElementById('touch-left')
    this.touchRightBtn = document.getElementById('touch-right')
    this.touchPlungerBtn = document.getElementById('touch-plunger')
    this.touchNudgeBtn = document.getElementById('touch-nudge')
    this.touchLeftBtn?.addEventListener('touchstart', (e) => { e.preventDefault(); this.triggerLeftFlipper() })
    this.touchRightBtn?.addEventListener('touchstart', (e) => { e.preventDefault(); this.triggerRightFlipper() })
    this.touchPlungerBtn?.addEventListener('touchstart', (e) => { e.preventDefault(); this.triggerPlunger() })
    this.touchNudgeBtn?.addEventListener('touchstart', (e) => { e.preventDefault(); this.applyNudge(new this.rapier!.Vector3(0,0,1)) })

    // Load persisted best score
    try {
      const v = localStorage.getItem('pachinball.best')
      if (v) this.bestScore = Math.max(0, parseInt(v, 10) || 0)
    } catch {}

    this.updateHUD()
    // Visual cue: brief pulse when combo increases
    if (this.comboElement && this.comboCount > 1) {
      try {
        this.comboElement.classList.add('pulse')
        setTimeout(() => { this.comboElement && this.comboElement.classList.remove('pulse') }, 420)
      } catch {}
    }

    // Camera positioned at -Z (Player side), looking slightly down
    const camera = new ArcRotateCamera('camera', -Math.PI / 2, Math.PI / 3, 28, new Vector3(0, 1, 0), this.scene)
    camera.attachControl(canvas, true)
    // Disable the camera's built-in keyboard bindings so arrow keys are handled by our game input
    // (ArcRotateCamera exposes keys arrays; clearing them prevents camera from capturing arrow keys)
    camera.keysUp = []
    camera.keysDown = []
    camera.keysLeft = []
    camera.keysRight = []

    this.bloomPipeline = new DefaultRenderingPipeline('pachinbloom', true, this.scene, [camera])
    if (this.bloomPipeline) {
      this.bloomPipeline.bloomEnabled = true
      this.bloomPipeline.bloomKernel = 64
      this.bloomPipeline.bloomWeight = 0.15
    }

    new HemisphericLight('light', new Vector3(0.3, 1, 0.3), this.scene)

    await this.initPhysics()
    this.buildScene()

    try {
      this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)()
    } catch {
      this.audioCtx = null
    }

    this.scene.onBeforeRenderObservable.add(() => {
      this.stepPhysics()
    })

    this.engine.runRenderLoop(() => {
      this.scene?.render()
    })

    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    this.ready = true

    // Initial state
    this.setGameState(GameState.MENU)
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    this.scene?.dispose()
    this.world?.free()
    for (const s of this.shards) {
      try {
        s.mesh.dispose()
        s.material.dispose()
      } catch { /* ignore */ }
    }
    this.shards = []
    this.scene = null
    this.world = null
    this.rapier = null
    this.bindings = []
    this.flipperLeftJoint = null
    this.flipperRightJoint = null
    this.ready = false
    this.score = 0
    this.lives = 3
    this.scoreElement = null
    this.livesElement = null
    this.eventQueue = null
    this.ballBody = null
    this.deathZoneBody = null
    this.bumperBodies = []
    this.bumperVisuals = []
    this.contactForceMap.clear()
    this.bloomPipeline?.dispose()
    this.bloomPipeline = null
    this.bloomEnergy = 0
    this.voiceBuffers.clear()
    this.voiceLoads.clear()
    this.voiceCooldown = 0
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
        if (this.audioCtx && this.audioCtx.state === 'suspended') {
          this.audioCtx.resume().catch(() => {})
        }
        break
      case GameState.PAUSED:
        // Keep normal scene visible but freeze physics / show a pause overlay
        if (this.menuOverlay) this.menuOverlay.classList.add('hidden')
        if (this.pauseOverlay) this.pauseOverlay.classList.remove('hidden')
        if (this.audioCtx && this.audioCtx.state === 'running') {
          this.audioCtx.suspend().catch(() => {})
        }
        break
      case GameState.GAME_OVER:
        if (this.gameOverScreen) this.gameOverScreen.classList.remove('hidden')
        if (this.finalScoreElement) this.finalScoreElement.textContent = this.score.toString()
        // Update best score
        if (this.score > this.bestScore) {
          this.bestScore = this.score
          try { localStorage.setItem('pachinball.best', String(this.bestScore)) } catch {}
        }
        // Update any UI showing best
        if (this.bestFinalElement) this.bestFinalElement.textContent = String(this.bestScore)
        if (this.bestMenuElement) this.bestMenuElement.textContent = String(this.bestScore)
        if (this.bestHudElement) this.bestHudElement.textContent = String(this.bestScore)
        break
    }
  }

  private startGame() {
    this.score = 0
    this.lives = 3
    this.comboCount = 0
    this.comboTimer = 0
    // reset any targets (ensure they're visible and active)
    for (let i = 0; i < this.targetActive.length; i++) {
      this.targetActive[i] = true
      this.targetRespawnTimer[i] = 0
      try { this.targetMeshes[i].isVisible = true } catch {}
    }
    // reset powerups / balls
    this.powerupActive = false
    this.powerupTimer = 0
    this.targetsHitSincePower = 0
    // remove any extra balls beyond the main ball
    for (let i = this.ballBodies.length - 1; i >= 0; i--) {
      const rb = this.ballBodies[i]
      if (rb !== this.ballBody) {
        const bidx = this.bindings.findIndex((b) => b.rigidBody === rb)
        if (bidx >= 0) {
          try { this.bindings[bidx].mesh.dispose() } catch {}
          this.bindings.splice(bidx, 1)
        }
        try { this.world?.removeRigidBody(rb) } catch {}
        this.ballBodies.splice(i, 1)
      }
    }
    this.updateHUD()
    this.resetBall()
    this.setGameState(GameState.PLAYING)
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (!this.ready || !this.rapier) return

    // Toggle pause at any time (during play)
    if (event.code === 'KeyP') {
      if (this.state === GameState.PLAYING) {
        this.setGameState(GameState.PAUSED)
      } else if (this.state === GameState.PAUSED) {
        this.setGameState(GameState.PLAYING)
      }
      return
    }

    if (event.code === 'KeyR' && this.state === GameState.PLAYING) {
      this.resetBall()
      return
    }

    // Special-case: allow starting the game from the menu using Space/Enter
    if ((event.code === 'Space' || event.code === 'Enter') && this.state === GameState.MENU) {
      this.startGame()
      return
    }

    // Everything below is only for active gameplay
    if (this.state !== GameState.PLAYING) return

    // Flipper control
    const stiffness = 100000
    const damping = 1000

    if (event.code === 'ArrowLeft' || event.code === 'KeyZ') {
       if (this.tiltActive) { this.playBeep(220); return }
       if (this.flipperLeftJoint) {
         const target = -Math.PI / 6;
         (this.flipperLeftJoint as RAPIER.RevoluteImpulseJoint).configureMotorPosition(target, stiffness, damping)
       }
    }

    if (event.code === 'ArrowRight' || event.code === 'Slash') {
       if (this.tiltActive) { this.playBeep(220); return }
       if (this.flipperRightJoint) {
         const target = Math.PI / 6;
         (this.flipperRightJoint as RAPIER.RevoluteImpulseJoint).configureMotorPosition(target, stiffness, damping)
       }
    }

    // Plunger
    if (event.code === 'Space' || event.code === 'Enter') {
      if (this.ballBody && this.rapier) {
        // Only launch if ball is roughly in the plunger lane
        const pos = this.ballBody.translation();
        // Lane is roughly x > 8, z < -5
        if (pos.x > 8 && pos.z < -4) {
           this.ballBody.applyImpulse(new this.rapier.Vector3(0, 0, 15), true)
        }
      }
    }

    // Nudge (table nudge) — small impulse to move balls and can cause tilt if abused
    if (event.code === 'KeyQ') { // nudge left
      this.applyNudge(new this.rapier.Vector3(-0.6, 0, 0.3))
      return
    }
    if (event.code === 'KeyE') { // nudge right
      this.applyNudge(new this.rapier.Vector3(0.6, 0, 0.3))
      return
    }
    if (event.code === 'KeyW') { // nudge forward
      this.applyNudge(new this.rapier.Vector3(0, 0, 0.8))
      return
    }
  }

  private onKeyUp = (event: KeyboardEvent): void => {
    if (!this.ready || !this.rapier) return
    if (this.state !== GameState.PLAYING) return

    const stiffness = 100000
    const damping = 1000

    if (event.code === 'ArrowLeft' || event.code === 'KeyZ') {
       if (this.flipperLeftJoint) {
         // Return to rest position (PI/4)
         (this.flipperLeftJoint as RAPIER.RevoluteImpulseJoint).configureMotorPosition(Math.PI / 4, stiffness, damping)
       }
    }

    if (event.code === 'ArrowRight' || event.code === 'Slash') {
       if (this.flipperRightJoint) {
         // Return to rest position (-PI/4)
         (this.flipperRightJoint as RAPIER.RevoluteImpulseJoint).configureMotorPosition(-Math.PI / 4, stiffness, damping)
       }
    }
  }

  private async initPhysics(): Promise<void> {
    if (this.rapier) return
    this.rapier = await import('@dimforge/rapier3d-compat')
    // Use the single-object form to avoid the runtime deprecation warning
    // (accepts options like { module_or_path }). Passing an empty object keeps defaults
    // use the object form at runtime to avoid the deprecation path in the loader
    // types declare init() with no args — cast to any to keep type-checker happy
    await (this.rapier.init as any)({})
    this.world = new this.rapier.World(new this.rapier.Vector3(GRAVITY.x, GRAVITY.y, GRAVITY.z))
    this.eventQueue = new this.rapier.EventQueue(true)
  }

  private createGridTexture(scene: Scene): Texture {
    const dynamicTexture = new DynamicTexture('gridTexture', 512, scene, true)
    dynamicTexture.hasAlpha = true
    const ctx = dynamicTexture.getContext()
    const size = 512

    // Background
    ctx.fillStyle = '#050510'
    ctx.fillRect(0, 0, size, size)

    // Grid
    ctx.lineWidth = 3
    ctx.strokeStyle = '#aa00ff'
    ctx.shadowBlur = 10
    ctx.shadowColor = '#d000ff'

    const div = 8
    const step = size / div

    for (let i = 0; i <= size; i += step) {
      ctx.beginPath()
      ctx.moveTo(i, 0)
      ctx.lineTo(i, size)
      ctx.stroke()

      ctx.beginPath()
      ctx.moveTo(0, i)
      ctx.lineTo(size, i)
      ctx.stroke()
    }

    // Border
    ctx.strokeRect(0, 0, size, size)

    dynamicTexture.update()
    return dynamicTexture
  }

  private buildScene(): void {
    if (!this.scene || !this.world || !this.rapier) {
      throw new Error('Scene or physics not initialized')
    }

    // Skybox
    const skybox = MeshBuilder.CreateBox("skybox", { size: 100.0 }, this.scene);
    const skyboxMaterial = new StandardMaterial("skyBox", this.scene);
    skyboxMaterial.backFaceCulling = false;
    skyboxMaterial.diffuseColor = new Color3(0, 0, 0);
    skyboxMaterial.specularColor = new Color3(0, 0, 0);
    skyboxMaterial.emissiveColor = new Color3(0.05, 0.05, 0.1);
    skybox.material = skyboxMaterial;

    // Materials
    const groundMat = new StandardMaterial('groundMat', this.scene);
    groundMat.diffuseTexture = this.createGridTexture(this.scene);
    (groundMat.diffuseTexture as Texture).uScale = 4;
    (groundMat.diffuseTexture as Texture).vScale = 8;
    groundMat.specularColor = new Color3(0.3, 0.3, 0.3);

    this.mirrorTexture = new MirrorTexture("mirror", 1024, this.scene, true);
    this.mirrorTexture.mirrorPlane = new Plane(0, -1, 0, -1.01);
    this.mirrorTexture.level = 0.5;
    groundMat.reflectionTexture = this.mirrorTexture;

    // Walls - simple glass style
    const wallMat = new StandardMaterial('wallMat', this.scene);
    wallMat.diffuseColor = Color3.FromHexString("#000000");
    wallMat.emissiveColor = Color3.FromHexString("#0088ff");
    wallMat.alpha = 0.4;
    wallMat.specularPower = 64;

    const flipperMat = new StandardMaterial('flipperMat', this.scene);
    flipperMat.diffuseColor = Color3.Black();
    flipperMat.emissiveColor = Color3.FromHexString("#ffdd00");

    const slingshotMat = new StandardMaterial('slingshotMat', this.scene);
    slingshotMat.diffuseColor = Color3.Black();
    slingshotMat.emissiveColor = Color3.White();

    const ballMat = new StandardMaterial('ballMat', this.scene);
    ballMat.diffuseColor = Color3.White();
    ballMat.specularPower = 128;
    ballMat.emissiveColor = new Color3(0.1, 0.1, 0.1);

    // Ground - widen to 24 to fit plunger lane
    const ground = MeshBuilder.CreateGround('ground', { width: 24, height: 26 }, this.scene) as Mesh
    ground.position.y = -1
    ground.position.z = 2 // Shift up slightly to center play area
    ground.material = groundMat;
    const groundBody = this.world.createRigidBody(this.rapier.RigidBodyDesc.fixed().setTranslation(0, -1, 2))
    this.world.createCollider(this.rapier.ColliderDesc.cuboid(12, 0.1, 13), groundBody)
    this.bindings.push({ mesh: ground, rigidBody: groundBody })

    // Walls
    const wallHeight = 4;

    // Left Wall
    this.createWall(new Vector3(-10, wallHeight, 2), new Vector3(0.1, 5, 26), wallMat)

    // Right Wall (Outer)
    this.createWall(new Vector3(11.5, wallHeight, 2), new Vector3(0.1, 5, 26), wallMat)

    // Top Wall
    // Increased thickness to prevent tunneling
    this.createWall(new Vector3(0.75, wallHeight, 15.5), new Vector3(22.5, 5, 2.0), wallMat)

    // Plunger Lane Divider
    this.createWall(new Vector3(9.5, wallHeight, -1), new Vector3(0.1, 5, 20), wallMat)

    // Plunger Lane Base (Stopper)
    this.createWall(new Vector3(10.5, wallHeight, -10.5), new Vector3(1.9, 5, 1.0), wallMat)

    // Cabinet Shell
    const cabinetMat = new StandardMaterial("cabinetMat", this.scene);
    cabinetMat.diffuseColor = Color3.Black();
    const cabBottom = MeshBuilder.CreateBox("cabinetBase", { width: 25, height: 2, depth: 30 }, this.scene);
    cabBottom.position.set(0.75, -2, 2);
    cabBottom.material = cabinetMat;

    // Death Zone (Bottom)
    const deathZonePos = new Vector3(0, -1, -12);
    this.deathZoneBody = this.world.createRigidBody(this.rapier.RigidBodyDesc.fixed().setTranslation(deathZonePos.x, deathZonePos.y, deathZonePos.z))
    this.world.createCollider(
        this.rapier.ColliderDesc.cuboid(12, 1, 1)
        .setSensor(true)
        .setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS),
        this.deathZoneBody
    )

    // Ball
    const ball = MeshBuilder.CreateSphere('ball', { diameter: 1 }, this.scene) as Mesh
    // Start position in plunger lane
    ball.position.set(10.5, 0.5, -9)
    ball.material = ballMat;
    const ballBody = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.dynamic()
        .setTranslation(10.5, 0.5, -9)
        .setCcdEnabled(true)
    )
    this.world.createCollider(
      this.rapier
        .ColliderDesc.ball(0.5)
        .setRestitution(0.7)
        .setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS | this.rapier.ActiveEvents.CONTACT_FORCE_EVENTS),
      ballBody
    )
    this.bindings.push({ mesh: ball, rigidBody: ballBody })
    this.ballBody = ballBody
    this.ballBodies.push(ballBody)

    // Add ball to mirror
    if (this.mirrorTexture?.renderList) this.mirrorTexture.renderList.push(ball);

    // Ball Trail
    const trail = new TrailMesh("ballTrail", ball, this.scene as Scene, 0.4, 30, true);
    const trailMat = new StandardMaterial("trailMat", this.scene);
    trailMat.emissiveColor = Color3.FromHexString("#00ffff");
    trailMat.diffuseColor = Color3.FromHexString("#00ffff");
    trail.material = trailMat;

    // Flippers
    this.createFlippers(flipperMat)

    // Bumpers
    this.createBumpers()

    // Slingshots (Angled bumpers above flippers)
    this.createSlingshot(new Vector3(-6.5, 0, -3), -Math.PI / 6, slingshotMat)
    this.createSlingshot(new Vector3(6.5, 0, -3), Math.PI / 6, slingshotMat)
  }

  private createWall(pos: Vector3, size: Vector3, mat: StandardMaterial): void {
      if (!this.scene || !this.world || !this.rapier) return

      const wall = MeshBuilder.CreateBox(`wall_${pos.x}_${pos.z}`, { width: size.x, height: size.y*2, depth: size.z }, this.scene)
      wall.position.copyFrom(pos)
      wall.material = mat;

      const body = this.world.createRigidBody(this.rapier.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z))
      this.world.createCollider(this.rapier.ColliderDesc.cuboid(size.x/2, size.y, size.z/2), body)
      this.bindings.push({ mesh: wall, rigidBody: body })

      if (this.mirrorTexture?.renderList) this.mirrorTexture.renderList.push(wall);
  }

  private createSlingshot(pos: Vector3, rotationY: number, mat: StandardMaterial): void {
      if (!this.scene || !this.world || !this.rapier) return

      const size = { w: 0.5, h: 2, d: 4 }

      const mesh = MeshBuilder.CreateBox(`sling_${pos.x}`, { width: size.w, height: size.h, depth: size.d }, this.scene)
      mesh.rotation.y = rotationY;
      mesh.position.copyFrom(pos)
      mesh.material = mat

      const q = Quaternion.FromEulerAngles(0, rotationY, 0);

      const body = this.world.createRigidBody(
          this.rapier.RigidBodyDesc.fixed()
            .setTranslation(pos.x, pos.y, pos.z)
            .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      )

      this.world.createCollider(
          this.rapier.ColliderDesc.cuboid(size.w/2, size.h/2, size.d/2)
            .setRestitution(1.5)
            .setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS | this.rapier.ActiveEvents.CONTACT_FORCE_EVENTS),
          body
      )

      this.bindings.push({ mesh: mesh, rigidBody: body })
      this.bumperBodies.push(body)
      this.bumperVisuals.push({ mesh: mesh, body: body, hitTime: 0, sweep: Math.random() })

      if (this.mirrorTexture?.renderList) this.mirrorTexture.renderList.push(mesh);
  }

  private createFlippers(mat: StandardMaterial): void {
      if (!this.scene || !this.world || !this.rapier) return
      const left = this.createFlipper(new Vector3(-4, -0.5, -7), false, mat)
      this.flipperLeftJoint = left.joint
      const right = this.createFlipper(new Vector3(4, -0.5, -7), true, mat)
      this.flipperRightJoint = right.joint
  }

  private createFlipper(pos: Vector3, isRight: boolean, mat: StandardMaterial): { body: RAPIER.RigidBody, joint: RAPIER.ImpulseJoint } {
      if (!this.scene || !this.world || !this.rapier) throw new Error('Physics not ready')

      const width = 3.5
      const depth = 0.5
      const height = 0.3

      const flipper = MeshBuilder.CreateBox(isRight ? 'flipperRight' : 'flipperLeft', { width, depth, height }, this.scene) as Mesh
      flipper.rotationQuaternion = Quaternion.Identity()
      flipper.material = mat;

      const body = this.world.createRigidBody(
          this.rapier.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z)
      )

      this.world.createCollider(
          this.rapier.ColliderDesc.cuboid(width/2, height/2, depth/2).setFriction(0.9),
          body
      )
      this.bindings.push({ mesh: flipper, rigidBody: body })

      const anchorBody = this.world.createRigidBody(this.rapier.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z))

      const pivotX = isRight ? 1.5 : -1.5

      const jointParams = this.rapier.JointData.revolute(
          new this.rapier.Vector3(pivotX, 0, 0),
           new this.rapier.Vector3(pivotX, 0, 0),
           new this.rapier.Vector3(0, 1, 0)
      )

      jointParams.limitsEnabled = true
      if (isRight) {
          jointParams.limits = [-Math.PI / 4, Math.PI / 6]
      } else {
          jointParams.limits = [-Math.PI / 6, Math.PI / 4]
      }

      const joint = this.world.createImpulseJoint(jointParams, anchorBody, body, true) as RAPIER.RevoluteImpulseJoint

      const stiffness = 100000
      const damping = 1000
      const restAngle = isRight ? -Math.PI / 4 : Math.PI / 4

      joint.configureMotorPosition(restAngle, stiffness, damping)

      if (this.mirrorTexture?.renderList) this.mirrorTexture.renderList.push(flipper);

      return { body, joint }
  }

  private createBumpers(): void {
      if (!this.scene || !this.world || !this.rapier) return

    const makeBumper = (name: string, x: number, z: number, color: Color3) => {
        const bumper = MeshBuilder.CreateSphere(name, { diameter: 0.8 }, this.scene as Scene) as Mesh
        bumper.position.set(x, 0.5, z)
        const mat = new StandardMaterial(name + 'Mat', this.scene as Scene);
        mat.diffuseColor = Color3.Black();
        mat.emissiveColor = color;
        bumper.material = mat;

        // Light
        const light = new PointLight(name + "Light", new Vector3(x, 1, z), this.scene as Scene);
        light.diffuse = color;
        light.intensity = 0.8;

        const body = this.world!.createRigidBody(this.rapier!.RigidBodyDesc.fixed().setTranslation(x, 0.5, z))
        this.world!.createCollider(
          this.rapier!
            .ColliderDesc.ball(0.4)
            .setRestitution(1.5)
            .setActiveEvents(this.rapier!.ActiveEvents.COLLISION_EVENTS | this.rapier!.ActiveEvents.CONTACT_FORCE_EVENTS),
          body
        )
        this.bindings.push({ mesh: bumper, rigidBody: body })
        this.bumperBodies.push(body)
        this.bumperVisuals.push({ mesh: bumper, body: body, hitTime: 0, sweep: Math.random() })

        if (this.mirrorTexture?.renderList) this.mirrorTexture.renderList.push(bumper);
    }

    makeBumper('bumper1', 2, 3, Color3.FromHexString("#ff0044"));
    makeBumper('bumper2', -2, 3, Color3.FromHexString("#ff0044"));
    makeBumper('bumper3', 0, 6, Color3.FromHexString("#ff0044"));

    // Targets & ramps
    this.createTargets()
  }

  private createTargets(): void {
    if (!this.scene || !this.world || !this.rapier) return

    // Create three drop targets near the upper playfield
    const positions = [new Vector3(-4, 0.5, 9), new Vector3(0, 0.5, 10), new Vector3(4, 0.5, 9)]
    for (let i = 0; i < positions.length; i++) {
      const pos = positions[i]
      const target = MeshBuilder.CreateBox(`target_${i}`, { width: 1, height: 0.6, depth: 0.4 }, this.scene)
      target.position.copyFrom(pos)
      target.rotationQuaternion = null
      const mat = new StandardMaterial(`targetMat_${i}`, this.scene)
      mat.diffuseColor = Color3.FromHexString('#22ff88')
      mat.emissiveColor = Color3.FromHexString('#006633')
      target.material = mat

      const body = this.world.createRigidBody(this.rapier.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z))
      // small thin collider to act as a target sensor
      this.world.createCollider(this.rapier.ColliderDesc.cuboid(0.45, 0.3, 0.2)
        .setSensor(true)
        .setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS), body)

        this.targetBodies.push(body)
        this.targetMeshes.push(target)
        this.targetActive.push(true)
        this.targetRespawnTimer.push(0)
    }

    // Spinner — a rotating target that awards points and spins when hit
    const spPos = new Vector3(0, 0.5, 5)
    const spinner = MeshBuilder.CreateCylinder('spinner', { diameter: 1.6, height: 0.2, tessellation: 12 }, this.scene)
    spinner.position.copyFrom(spPos)
    spinner.rotation.x = Math.PI / 2
    spinner.material = new StandardMaterial('spinnerMat', this.scene)
    ;(spinner.material as StandardMaterial).diffuseColor = Color3.FromHexString('#ffcc44')

    const spinnerBody = this.world.createRigidBody(this.rapier.RigidBodyDesc.fixed().setTranslation(spPos.x, spPos.y, spPos.z))
    this.world.createCollider(this.rapier.ColliderDesc.cuboid(0.8, 0.1, 0.2).setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS), spinnerBody)
    this.spinnerBody = spinnerBody
    this.spinnerMesh = spinner
  }

  private updateHUD(): void {
    if (this.scoreElement) this.scoreElement.textContent = this.score.toString()
    if (this.livesElement) this.livesElement.textContent = this.lives.toString()
    if (this.comboElement) {
      if (this.comboCount <= 1) {
        this.comboElement.style.display = 'none'
      } else {
        const mult = Math.floor(this.comboCount / 3) + 1
        this.comboElement.style.display = 'block'
        this.comboElement.textContent = `Combo ${this.comboCount} (x${mult})`
      }
    }
    // balls and power-up UI
    const ballsEl = document.getElementById('balls')
    if (ballsEl) ballsEl.textContent = String(Math.max(1, this.ballBodies.length || 1))
    const pIt = document.getElementById('powerup')
    const pName = document.getElementById('powerup-name')
    if (this.powerupActive) {
      if (pIt) pIt.style.display = 'block'
      if (pName) pName.textContent = `Multiball (${Math.ceil(this.powerupTimer)}s)`
    } else {
      if (pIt) pIt.style.display = 'none'
      if (pName) pName.textContent = '—'
    }
    if (this.bestHudElement) this.bestHudElement.textContent = String(this.bestScore)
    if (this.bestMenuElement) this.bestMenuElement.textContent = String(this.bestScore)
    if (this.bestFinalElement) this.bestFinalElement.textContent = String(this.bestScore)
    const tiltEl = document.getElementById('tilt')
    if (tiltEl) {
      if (this.tiltActive) {
        tiltEl.style.display = 'block'
      } else {
        tiltEl.style.display = 'none'
      }
    }
  }

  private stepPhysics(): void {
    // Only run physics while actively playing
    if (this.state !== GameState.PLAYING) return
    if (!this.world || !this.scene || !this.rapier) return
    if (this.eventQueue) {
      this.world.step(this.eventQueue)
    } else {
      this.world.step()
    }

    const engineTyped = this.engine as Engine
    const rawDt = typeof engineTyped.getDeltaTime === 'function' ? engineTyped.getDeltaTime() / 1000 : 1 / 60
    const dt = Math.min(0.1, Math.max(0.0001, rawDt))
    const bumperHitDuration = 0.18
    if (this.eventQueue) {
      this.eventQueue.drainContactForceEvents((event) => {
        const key = this.contactKey(event.collider1(), event.collider2())
        const magnitude = event.totalForceMagnitude()
        const existing = this.contactForceMap.get(key) ?? 0
        this.contactForceMap.set(key, Math.max(existing, magnitude))
      })
      this.eventQueue.drainCollisionEvents((handle1, handle2, started) => {
        if (started) this.processCollision(handle1, handle2, bumperHitDuration)
      })
      this.contactForceMap.clear()
    }
    this.animateBumpers(dt, bumperHitDuration)
    // update target respawn timers
    if (this.targetRespawnTimer.length > 0) {
      for (let i = 0; i < this.targetRespawnTimer.length; i++) {
        if (!this.targetActive[i]) {
          this.targetRespawnTimer[i] = Math.max(0, this.targetRespawnTimer[i] - dt)
          if (this.targetRespawnTimer[i] <= 0) {
            this.targetActive[i] = true
            try { this.targetMeshes[i].isVisible = true } catch {}
          }
        }
      }
    }
    this.updateShards(dt)
    this.updateCombo(dt)
    // Handle power-up timer
    if (this.powerupActive) {
      this.powerupTimer = Math.max(0, this.powerupTimer - dt)
      if (this.powerupTimer <= 0) {
        // deactivate and remove any extra balls (keep the main primary ball)
        this.powerupActive = false
        for (let i = this.ballBodies.length - 1; i >= 0; i--) {
          const rb = this.ballBodies[i]
          if (rb !== this.ballBody) {
            const bidx = this.bindings.findIndex((b) => b.rigidBody === rb)
            if (bidx >= 0) {
              try { this.bindings[bidx].mesh.dispose() } catch {}
              this.bindings.splice(bidx, 1)
            }
            try { this.world?.removeRigidBody(rb) } catch {}
            this.ballBodies.splice(i, 1)
          }
        }
      }
    }
    // handle nudge/tilt timers
    if (this.nudgeWindowTimer > 0) {
      this.nudgeWindowTimer = Math.max(0, this.nudgeWindowTimer - dt)
      if (this.nudgeWindowTimer <= 0) this.nudgeCount = 0
    }
    if (this.tiltActive) {
      this.tiltTimer = Math.max(0, this.tiltTimer - dt)
      if (this.tiltTimer <= 0) {
        this.tiltActive = false
        this.nudgeCount = 0
      }
    }
    this.updateBloom(dt)
    this.voiceCooldown = Math.max(0, this.voiceCooldown - dt)
  }

  private processCollision(handle1: number, handle2: number, bumperHitDuration: number): void {
    if (!this.world) return
    const body1 = this.world.getRigidBody(handle1)
    const body2 = this.world.getRigidBody(handle2)
    if (!body1 || !body2) return

    // Check Death Zone
    if (body1 === this.deathZoneBody || body2 === this.deathZoneBody) {
      const other = body1 === this.deathZoneBody ? body2 : body1;
      // If any ball falls into the death zone, handle it
      const idx = this.ballBodies.indexOf(other)
      if (idx >= 0) {
        this.handleBallLoss(other)
        return;
      }
    }

    // Bumpers
    const bumperBody = this.bumperBodies.includes(body1) ? body1 : this.bumperBodies.includes(body2) ? body2 : null
    if (bumperBody) {
      const other = bumperBody === body1 ? body2 : body1
      if (this.ballBodies.includes(other)) {
        const key = this.contactKey(handle1, handle2)
        this.handleBumperHit(bumperBody, key, bumperHitDuration)
        return
      }
    }

    // Targets
    const targetBody = this.targetBodies.includes(body1) ? body1 : this.targetBodies.includes(body2) ? body2 : null
    if (targetBody) {
      const other = targetBody === body1 ? body2 : body1
      if (this.ballBodies.includes(other)) {
        this.handleTargetHit(targetBody)
        return
      }
    }

    // Spinner
    if (this.spinnerBody && (body1 === this.spinnerBody || body2 === this.spinnerBody)) {
      const other = body1 === this.spinnerBody ? body2 : body1
      if (this.ballBodies.includes(other)) {
        this.handleSpinnerHit()
        return
      }
    }
  }

  private handleBallLoss(lostBody?: RAPIER.RigidBody): void {
    if (this.state !== GameState.PLAYING) return;

    // Reset combo when the ball is lost
    this.comboCount = 0
    this.comboTimer = 0
    this.updateHUD()

    if (lostBody) {
      const idx = this.ballBodies.indexOf(lostBody)
      if (idx >= 0) {
        // Remove binding/mesh for the lost ball
        const bidx = this.bindings.findIndex((b) => b.rigidBody === lostBody)
        if (bidx >= 0) {
          try { this.bindings[bidx].mesh.dispose() } catch {}
          this.bindings.splice(bidx, 1)
        }
        try { this.world?.removeRigidBody(lostBody) } catch {}
        this.ballBodies.splice(idx, 1)

        // If additional balls remain, don't take a life
        if (this.ballBodies.length > 0) {
          // If the primary ball was removed, promote another remaining ball to be the primary
          if (this.ballBody === lostBody) {
            this.ballBody = this.ballBodies[0]
          }
          this.playVoiceCue('fever')
          return
        }
      }
    }

    // No more balls left -> decrement lives and reset
    this.lives--
    this.updateHUD()
    this.playVoiceCue('fever') // Reuse sound for now or add new one later

    if (this.lives > 0) {
      // Clean up any remaining ball bodies
      for (const b of this.ballBodies) {
        try { this.world?.removeRigidBody(b) } catch {}
      }
      this.ballBodies = []
      // Recreate a single main ball
      this.resetBall()
    } else {
      this.setGameState(GameState.GAME_OVER)
    }
  }

  private handleTargetHit(body: RAPIER.RigidBody): void {
    const idx = this.targetBodies.indexOf(body)
    if (idx < 0) return
    if (!this.targetActive[idx]) return

    // Score bonus and visual feedback
    const points = 50
    this.score += points
    this.updateHUD()

    // Visual: hide target and start respawn timer
    const mesh = this.targetMeshes[idx]
    try { mesh.isVisible = false } catch {}
    this.targetActive[idx] = false
    this.targetRespawnTimer[idx] = 6.0

    this.playBeep(1200)
    this.bloomEnergy = Math.min(2.6, this.bloomEnergy + 0.24)

    // Track target progress for unlocking power-ups (e.g., multiball)
    this.targetsHitSincePower++
    if (this.targetsHitSincePower >= 3 && !this.powerupActive) {
      this.activatePowerup('multiball')
      this.targetsHitSincePower = 0
    }
  }

  private activatePowerup(kind: 'multiball') {
    if (kind === 'multiball') {
      // spawn 2 extra balls
      this.powerupActive = true
      this.powerupTimer = this.powerupDuration
      this.spawnExtraBalls(2)
      this.showPowerToast('Multiball!')
    }
  }

  private showPowerToast(text: string, ms = 1600) {
    try {
      const el = document.getElementById('power-toast')
      if (!el) return
      el.textContent = text
      el.classList.remove('hidden')
      el.classList.add('show')
      setTimeout(() => {
        el.classList.remove('show')
        el.classList.add('hidden')
      }, ms)
    } catch {}
  }

  private spawnExtraBalls(count: number) {
    if (!this.world || !this.scene || !this.rapier) return
    for (let i = 0; i < count; i++) {
      const b = MeshBuilder.CreateSphere(`ball_extra_${Date.now()}_${i}`, { diameter: 1 }, this.scene) as Mesh
      b.material = new StandardMaterial(`ballExtraMat_${Date.now()}_${i}`, this.scene)
      ;(b.material as StandardMaterial).diffuseColor = Color3.White()
      b.position.set(10.5 + (i * 0.4), 0.5, -9 - i * 0.3)
      const rb = this.world.createRigidBody(this.rapier.RigidBodyDesc.dynamic().setTranslation(b.position.x, b.position.y, b.position.z))
      this.world.createCollider(
        this.rapier
          .ColliderDesc.ball(0.5)
          .setRestitution(0.7)
          .setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS | this.rapier.ActiveEvents.CONTACT_FORCE_EVENTS),
        rb
      )
      this.bindings.push({ mesh: b, rigidBody: rb })
      this.ballBodies.push(rb)
      if (this.mirrorTexture?.renderList) this.mirrorTexture.renderList.push(b);
    }
  }

  private handleSpinnerHit(): void {
    // Spinner hit awards variable points and adds small spin
    const points = 20
    this.score += points
    this.updateHUD()
    // Quick visual rotation
      if (this.spinnerMesh) {
        try {
          this.spinnerMesh.rotation.y += 0.5 + Math.random() * 2
        } catch {}
    }
    this.playBeep(900 + Math.random() * 600)
    this.bloomEnergy = Math.min(2.6, this.bloomEnergy + 0.12)
  }

  private triggerLeftFlipper(): void {
    if (this.state !== GameState.PLAYING) return
    if (this.tiltActive) { this.playBeep(220); return }
    if (!this.rapier) return
    const stiffness = 100000
    const damping = 1000
    if (this.flipperLeftJoint) {
        // Trigger up
        (this.flipperLeftJoint as RAPIER.RevoluteImpulseJoint).configureMotorPosition(-Math.PI / 6, stiffness, damping)
        // Auto-release after short delay for touch controls if no touch-up event is easy to bind?
        // Actually, touchstart is just one event. A real implementation would handle touchend.
        // For now, let's just hold it for a bit or rely on user tapping?
        // "touchstart" doesn't auto-release.
        // Let's add a timeout to release for simple tap behavior on touch
        setTimeout(() => {
             if (this.flipperLeftJoint) (this.flipperLeftJoint as RAPIER.RevoluteImpulseJoint).configureMotorPosition(Math.PI / 4, stiffness, damping)
        }, 150)
    }
  }

  private triggerRightFlipper(): void {
    if (this.state !== GameState.PLAYING) return
    if (this.tiltActive) { this.playBeep(220); return }
    if (!this.rapier) return
    const stiffness = 100000
    const damping = 1000
    if (this.flipperRightJoint) {
        (this.flipperRightJoint as RAPIER.RevoluteImpulseJoint).configureMotorPosition(Math.PI / 6, stiffness, damping)
        setTimeout(() => {
             if (this.flipperRightJoint) (this.flipperRightJoint as RAPIER.RevoluteImpulseJoint).configureMotorPosition(-Math.PI / 4, stiffness, damping)
        }, 150)
    }
  }

  private triggerPlunger(): void {
    if (this.state !== GameState.PLAYING) return
    if (!this.ballBody || !this.rapier) return
    try {
      const pos = this.ballBody.translation()
        if (pos.x > 8 && pos.z < -4) {
          this.ballBody.applyImpulse(new this.rapier.Vector3(0, 0, 15), true)
        }
    } catch {}
  }

  private handleBumperHit(bumperBody: RAPIER.RigidBody, contactKey: string, bumperHitDuration: number): void {
    // Track combo: consecutive hits within a short window increase streak
    this.comboCount = Math.min(9999, this.comboCount + 1)
    this.comboTimer = this.comboTimeout
    const multiplier = Math.floor(this.comboCount / 3) + 1
    const points = 10 * multiplier
    this.score += points
    this.updateHUD()
    const visual = this.bumperVisuals.find((v) => v.body === bumperBody)
    if (visual) {
      visual.hitTime = bumperHitDuration
      visual.sweep = (visual.sweep + 0.2) % 1
    }
    const strength = this.estimateImpactStrength(contactKey)
    const count = Math.min(64, Math.max(6, Math.round(strength * 10)))
    const emitPower = Math.min(7, 1 + strength * 1.4)
    const freq = Math.min(2400, Math.max(220, 550 + strength * 240))
    this.playBeep(freq)
    if (visual) {
      this.spawnShardBurst(visual.mesh.position.clone(), count, emitPower, visual.sweep)
    }
    this.bloomEnergy = Math.min(2.4, this.bloomEnergy + strength * 0.12)
    this.playVoiceCue('fever')
  }

  private estimateImpactStrength(contactKey: string): number {
    let strength = this.contactForceMap.get(contactKey) ?? 0
    if (strength < 0.1 && this.ballBody) {
      try {
        const lv = this.ballBody.linvel()
        const speed = Math.sqrt(lv.x * lv.x + lv.y * lv.y + lv.z * lv.z)
        strength = Math.max(0.1, speed)
      } catch {
        strength = 1
      }
    }
    return Math.max(0.1, Math.min(4, strength))
  }

  private animateBumpers(dt: number, bumperHitDuration: number): void {
    const restoreRate = Math.min(1, dt * 6)
    for (const visual of this.bumperVisuals) {
      const mat = visual.mesh.material as StandardMaterial | null
      if (visual.hitTime > 0) {
        visual.hitTime = Math.max(0, visual.hitTime - dt)
        const t = visual.hitTime / bumperHitDuration
        const scale = 1 + 0.6 * t
        // Handle vector scaling for different mesh types differently if needed,
        // but uniform scaling is generally safe for visual effect
        visual.mesh.scaling.set(scale, scale, scale)

        if (mat) {
          const hue = (visual.sweep + (1 - t)) % 1
          mat.emissiveColor = Color3.FromHSV(hue, 0.9, 1)
          mat.diffuseColor = Color3.FromHSV((hue + 0.08) % 1, 0.5, 0.85)
        }
      } else {
        const current = visual.mesh.scaling.x
        const eased = current + (1 - current) * restoreRate
        visual.mesh.scaling.set(eased, eased, eased)
        if (mat) {
            // Restore to original color if it was changed
            // Slingshots are white, Bumpers are red. We need to know which one it is or store original color?
            // For now, let's just use a simple heuristic or reset to white-ish for slingshots if we can distinguish
            // Actually `animateBumpers` logic assumes everything is a red bumper.
            // I should fix this to respect the material's original color or type.
            // But `bumperVisuals` stores mesh and body.
            // I can check mesh name.
            if (visual.mesh.name.startsWith('sling')) {
                 mat.emissiveColor = Color3.Lerp(mat.emissiveColor, Color3.FromHexString("#333333"), restoreRate)
                 mat.diffuseColor = Color3.Lerp(mat.diffuseColor, Color3.White(), restoreRate)
            } else {
                 mat.emissiveColor = Color3.Lerp(mat.emissiveColor, Color3.Black(), restoreRate)
                 mat.diffuseColor = Color3.Lerp(mat.diffuseColor, Color3.Red(), restoreRate)
            }
        }
      }
    }
  }

  private updateShards(dt: number): void {
    const dtSim = Math.min(0.05, dt)
    for (let i = this.shards.length - 1; i >= 0; i--) {
      const s = this.shards[i]
      s.life -= dtSim
      if (s.life <= 0) {
        try {
          s.mesh.dispose()
          s.material.dispose()
        } catch {}
        this.shards.splice(i, 1)
        continue
      }
      const dpos = s.vel.scale(dtSim)
      s.mesh.position.addInPlace(dpos)
      s.vel.y += GRAVITY.y * dtSim * 0.8
      const alpha = Math.max(0, s.life / 0.6)
      s.material.alpha = alpha
      const scale = 0.08 + 0.12 * alpha
      s.mesh.scaling.set(scale, scale * 0.6, scale)
    }
  }

  // Called regularly from stepPhysics — handle combo timeout
  private updateCombo(dt: number): void {
    if (this.comboTimer <= 0) return
    this.comboTimer = Math.max(0, this.comboTimer - dt)
    if (this.comboTimer === 0) {
      this.comboCount = 0
      this.updateHUD()
    }
  }

  private applyNudge(forceVec: RAPIER.Vector3) {
    if (!this.world || !this.rapier || this.tiltActive) return
    // Apply impulse to all balls to simulate nudging the table
    for (const b of this.ballBodies) {
      try {
        b.applyImpulse(forceVec, true)
      } catch {}
    }

    // Track rapid nudges to detect tilt
    this.nudgeCount++
    this.nudgeWindowTimer = this.nudgeWindow
    if (this.nudgeCount >= this.nudgeThreshold && !this.tiltActive) {
      this.tiltActive = true
      this.tiltTimer = this.tiltDuration
      // Penalize player: briefly disable flippers by setting a bloom and audio cue
      this.playBeep(220)
    }
  }

  private updateBloom(dt: number): void {
    if (!this.bloomPipeline) return
    this.bloomEnergy = Math.max(0, this.bloomEnergy - dt * 0.9)
    this.bloomPipeline.bloomWeight = 0.15 + Math.min(0.85, this.bloomEnergy)
  }

  // Create a short beep using WebAudio. Optional frequency (Hz) can be passed.
  private playBeep(frequencyHz?: number): void {
    if (!this.audioCtx) return
    try {
      const ctx = this.audioCtx
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.type = 'sine'
      o.frequency.value = typeof frequencyHz === 'number' ? frequencyHz : 900 + Math.random() * 400
      g.gain.value = 0
      o.connect(g)
      g.connect(ctx.destination)
      const now = ctx.currentTime
      g.gain.setValueAtTime(0.0001, now)
      g.gain.linearRampToValueAtTime(0.12, now + 0.005)
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.14)
      o.start(now)
      o.stop(now + 0.15)
      // cleanup after stop
      o.onended = () => {
        try { o.disconnect(); g.disconnect() } catch { /* ignore */ }
      }
    } catch {
      // ignore audio errors
    }
  }

  // Spawn small shard meshes at `pos`. `count` shards with initial velocity scaled by `power`.
  private spawnShardBurst(pos: Vector3, count = 12, power = 2, hueSeed = Math.random()): void {
    if (!this.scene) return
    for (let i = 0; i < count; i++) {
      const shard = MeshBuilder.CreateSphere(`shard_${Date.now()}_${i}`, { diameter: 0.12 }, this.scene as Scene) as Mesh
      shard.position.set(pos.x, pos.y, pos.z)
      const mat = new StandardMaterial(`shardMat_${Date.now()}_${i}`, this.scene)
      const hue = (hueSeed + Math.random() * 0.12) % 1
      mat.emissiveColor = Color3.FromHSV(hue, 0.9, 1)
      mat.alpha = 1
      shard.material = mat
      const speed = 1.5 + Math.random() * (1.2 * Math.min(3, power))
      const vel = new Vector3((Math.random() - 0.5) * speed, 0.6 + Math.random() * speed, (Math.random() - 0.5) * speed)
      this.shards.push({ mesh: shard, vel, life: 0.6, material: mat })
    }
  }

  // Reset ball position/velocity and score
  private resetBall(): void {
    if (!this.world || !this.ballBody || !this.rapier) return
    // Reset to plunger lane
    this.ballBody.setTranslation(new this.rapier.Vector3(10.5, 0.5, -9), true)
    this.ballBody.setLinvel(new this.rapier.Vector3(0, 0, 0), true)
    this.ballBody.setAngvel(new this.rapier.Vector3(0, 0, 0), true)
    this.updateHUD()
  }

  private contactKey(handle1: number, handle2: number): string {
    return handle1 < handle2 ? `${handle1}-${handle2}` : `${handle2}-${handle1}`
  }

  private playVoiceCue(name: keyof typeof this.voiceCuePaths): void {
    if (!this.audioCtx || this.voiceCooldown > 0) return
    const path = this.voiceCuePaths[name]
    if (!path) return
    const ctx = this.audioCtx
    const trigger = (buffer: AudioBuffer | null): void => {
      if (!buffer) return
      const source = ctx.createBufferSource()
      const gain = ctx.createGain()
      gain.gain.value = 0.9
      source.buffer = buffer
      source.connect(gain)
      gain.connect(ctx.destination)
      source.start()
      source.onended = () => {
        try {
          source.disconnect()
          gain.disconnect()
        } catch {}
      }
      this.voiceCooldown = 0.9
    }
    const cached = this.voiceBuffers.get(name)
    if (cached !== undefined) {
      trigger(cached)
      return
    }
    let pending = this.voiceLoads.get(name)
    if (!pending) {
      pending = this.loadVoiceCue(name, path)
      this.voiceLoads.set(name, pending)
    }
    pending
      .then((buffer) => {
        this.voiceBuffers.set(name, buffer)
        if (buffer) trigger(buffer)
      })
      .catch(() => {})
      .finally(() => {
        this.voiceLoads.delete(name)
      })
  }

  private async loadVoiceCue(name: string, path: string): Promise<AudioBuffer | null> {
    if (!this.audioCtx) return null
    try {
      const res = await fetch(path)
      if (!res.ok) throw new Error('missing asset')
      const arrayBuf = await res.arrayBuffer()
      return await this.audioCtx.decodeAudioData(arrayBuf)
    } catch (err) {
      console.warn(`Voice asset missing for cue "${name}". Add file at ${path}.`)
      return null
    }
  }
}
