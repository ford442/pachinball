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
  ShaderMaterial,
  ShaderLanguage,
  Mesh,
  PointLight,
} from '@babylonjs/core'
import { numberScrollShader } from './shaders/numberScroll'
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

  // Hologram Catch
  private caughtBalls: Array<{ body: RAPIER.RigidBody, targetPos: Vector3, timer: number }> = []

  // New Display Textures/Materials
  private staticTexture: DynamicTexture | null = null
  private shaderMaterial: ShaderMaterial | null = null // Background Shader

  // --- SLOT MACHINE STATE ---
  private useWGSL = false
  private reelMaterials: ShaderMaterial[] = []
  private reelOffsets: number[] = [0, 0, 0]
  private reelSpeeds: number[] = [0, 0, 0]
  private overlayTexture: DynamicTexture | null = null

  private slotTexture: DynamicTexture | null = null
  // UPDATED: Matched to the new Reel Image (6 symbols)
  private slotSymbols = ['7️⃣', '💎', '🍒', '🔔', '🍇', '⭐'] 
  private slotReels = [0, 0, 0]
  private slotSpeeds = [0, 0, 0]
  private slotMode = 0
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
  private pinballMeshes: Mesh[] = [] 
  private adventureTrack: Mesh[] = []
  private adventureBodies: RAPIER.RigidBody[] = []
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
    this.startScreen = document.getElementById('start-screen')
    this.gameOverScreen = document.getElementById('game-over-screen')
    this.finalScoreElement = document.getElementById('final-score')

    document.getElementById('start-btn')?.addEventListener('click', () => this.startGame())
    document.getElementById('restart-btn')?.addEventListener('click', () => this.startGame())

    this.touchLeftBtn = document.getElementById('touch-left')
    this.touchRightBtn = document.getElementById('touch-right')
    this.touchPlungerBtn = document.getElementById('touch-plunger')
    this.touchNudgeBtn = document.getElementById('touch-nudge')
    this.touchLeftBtn?.addEventListener('touchstart', (e) => { e.preventDefault(); this.triggerLeftFlipper() })
    this.touchRightBtn?.addEventListener('touchstart', (e) => { e.preventDefault(); this.triggerRightFlipper() })
    this.touchPlungerBtn?.addEventListener('touchstart', (e) => { e.preventDefault(); this.triggerPlunger() })
    this.touchNudgeBtn?.addEventListener('touchstart', (e) => { e.preventDefault(); this.applyNudge(new this.rapier!.Vector3(0,0,1)) })

    try {
      const v = localStorage.getItem('pachinball.best')
      if (v) this.bestScore = Math.max(0, parseInt(v, 10) || 0)
    } catch {}
    this.updateHUD()

    const camera = new ArcRotateCamera('camera', -Math.PI / 2, Math.PI / 2.2, 25, new Vector3(0, 2, 5), this.scene)
    camera.attachControl(canvas, true)
    
    this.bloomPipeline = new DefaultRenderingPipeline('pachinbloom', true, this.scene, [camera])
    if (this.bloomPipeline) {
      this.bloomPipeline.bloomEnabled = true
      this.bloomPipeline.bloomKernel = 64
      this.bloomPipeline.bloomWeight = 0.4 
    }

    new HemisphericLight('light', new Vector3(0.3, 1, 0.3), this.scene)

    await this.initPhysics()
    this.buildScene()

    try {
      this.audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
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
    this.setGameState(GameState.MENU)
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    this.scene?.dispose()
    this.world?.free()
    this.ready = false
  }

  // ... (Game State Methods: setGameState, startGame remain unchanged) ...
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
          } catch {}
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
    this.powerupActive = false
    this.powerupTimer = 0
    for (let i = this.ballBodies.length - 1; i >= 0; i--) {
      const rb = this.ballBodies[i]
      if (rb !== this.ballBody) {
        this.world?.removeRigidBody(rb)
        this.ballBodies.splice(i, 1)
      }
    }
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
  // ... (End Game State Methods) ...

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
    if (event.code === 'KeyQ') this.applyNudge(new this.rapier.Vector3(-0.6, 0, 0.3))
    if (event.code === 'KeyE') this.applyNudge(new this.rapier.Vector3(0.6, 0, 0.3))
    if (event.code === 'KeyW') this.applyNudge(new this.rapier.Vector3(0, 0, 0.8))
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

  // ... (Physics Init and Grid Texture remain unchanged) ...
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
  // ... (End Physics Init) ...

  private buildScene(): void {
    if (!this.scene || !this.world || !this.rapier) throw new Error('Scene not ready')

    const skybox = MeshBuilder.CreateBox("skybox", { size: 100.0 }, this.scene);
    const skyboxMaterial = new StandardMaterial("skyBox", this.scene);
    skyboxMaterial.backFaceCulling = false;
    skyboxMaterial.diffuseColor = new Color3(0, 0, 0);
    skyboxMaterial.specularColor = new Color3(0, 0, 0);
    skyboxMaterial.emissiveColor = new Color3(0.01, 0.01, 0.02);
    skybox.material = skyboxMaterial;

    const groundMat = new StandardMaterial('groundMat', this.scene);
    groundMat.diffuseTexture = this.createGridTexture(this.scene);
    (groundMat.diffuseTexture as Texture).uScale = 4;
    (groundMat.diffuseTexture as Texture).vScale = 8;
    groundMat.specularColor = new Color3(0.5, 0.5, 0.5);

    this.mirrorTexture = new MirrorTexture("mirror", 1024, this.scene, true);
    this.mirrorTexture.mirrorPlane = new Plane(0, -1, 0, -1.01);
    this.mirrorTexture.level = 0.6;
    groundMat.reflectionTexture = this.mirrorTexture;

    const wallMat = new StandardMaterial('wallMat', this.scene);
    wallMat.diffuseColor = Color3.Black();
    wallMat.emissiveColor = Color3.FromHexString("#00eeff");
    wallMat.alpha = 0.3;

    const ground = MeshBuilder.CreateGround('ground', { width: 24, height: 32 }, this.scene) as Mesh
    ground.position.set(0, -1, 5)
    ground.material = groundMat;
    const groundBody = this.world.createRigidBody(this.rapier.RigidBodyDesc.fixed().setTranslation(0, -1, 5))
    this.world.createCollider(this.rapier.ColliderDesc.cuboid(12, 0.1, 16), groundBody)
    this.bindings.push({ mesh: ground, rigidBody: groundBody })

    // Walls
    const wallH = 4;
    this.createWall(new Vector3(-10, wallH, 5), new Vector3(0.2, 5, 32), wallMat)
    this.createWall(new Vector3(11.5, wallH, 5), new Vector3(0.2, 5, 32), wallMat)
    this.createWall(new Vector3(0.75, wallH, 20.5), new Vector3(22.5, 5, 1.0), wallMat)
    this.createWall(new Vector3(9.5, wallH, 2), new Vector3(0.2, 5, 26), wallMat)
    this.createWall(new Vector3(10.5, wallH, -10.5), new Vector3(1.9, 5, 1.0), wallMat)

    // Cabinet
    const cabinetMat = new StandardMaterial("cabinetMat", this.scene);
    cabinetMat.diffuseColor = Color3.FromHexString("#111111");
    const cab = MeshBuilder.CreateBox("cabinet", { width: 26, height: 4, depth: 36 }, this.scene);
    cab.position.set(0.75, -3, 5);
    cab.material = cabinetMat;

    this.createBackbox(new Vector3(0.75, 8, 21.5));
    this.createCabinetLighting();

    this.deathZoneBody = this.world.createRigidBody(this.rapier.RigidBodyDesc.fixed().setTranslation(0, -2, -14))
    this.world.createCollider(this.rapier.ColliderDesc.cuboid(20, 2, 2).setSensor(true).setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS), this.deathZoneBody)

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

    const trail = new TrailMesh("ballTrail", ball, this.scene as Scene, 0.3, 20, true);
    const trailMat = new StandardMaterial("trailMat", this.scene);
    trailMat.emissiveColor = Color3.FromHexString("#00ffff");
    trail.material = trailMat;

    const flipperMat = new StandardMaterial('flipperMat', this.scene);
    flipperMat.diffuseColor = Color3.Yellow();
    flipperMat.emissiveColor = Color3.FromHexString("#aa6600");
    this.createFlippers(flipperMat)

    this.createPachinkoField(new Vector3(0, 0.5, 12), 14, 8)
    this.createBumpers()
    
    const slingMat = new StandardMaterial('slingMat', this.scene);
    slingMat.emissiveColor = Color3.White();
    this.createSlingshot(new Vector3(-6.5, 0, -3), -Math.PI / 6, slingMat)
    this.createSlingshot(new Vector3(6.5, 0, -3), Math.PI / 6, slingMat)
  }

  // --- UPDATED: BACKBOX WITH CYBER BACKGROUND & NEW REELS ---
  private createBackbox(pos: Vector3): void {
      if (!this.scene) return

      this.useWGSL = this.engine.getClassName() === "WebGPUEngine" || (this.engine as any).isWebGPU === true;

      const frame = MeshBuilder.CreateBox("backboxFrame", { width: 22, height: 14, depth: 2 }, this.scene)
      frame.position.copyFrom(pos)
      const frameMat = new StandardMaterial("frameMat", this.scene)
      frameMat.diffuseColor = Color3.Black()
      frameMat.roughness = 0.5
      frame.material = frameMat

      // --- LAYER 1: CYBER SHADER BACKGROUND ---
      const bgLayer = MeshBuilder.CreatePlane("backboxBg", { width: 20, height: 12 }, this.scene)
      bgLayer.position.copyFrom(pos); bgLayer.position.z -= 0.5; bgLayer.rotation.y = Math.PI

      // New Moving Grid Shader
      const cyberShader = new ShaderMaterial("cyberBg", this.scene, {
        vertexSource: `
            attribute vec3 position;
            attribute vec2 uv;
            uniform mat4 worldViewProjection;
            varying vec2 vUV;
            void main() {
                gl_Position = worldViewProjection * vec4(position, 1.0);
                vUV = uv;
            }
        `,
        fragmentSource: `
            uniform float time;
            uniform float speed;
            varying vec2 vUV;
            void main() {
                // Moving grid effect
                float t = time * speed;
                float gridX = step(0.95, fract(vUV.x * 20.0 + sin(t*0.5)*0.5));
                float gridY = step(0.95, fract(vUV.y * 10.0 + t));
                vec3 base = vec3(0.05, 0.0, 0.15); // Deep purple
                vec3 lines = vec3(0.0, 1.0, 0.8) * (gridX + gridY) * 0.5;
                gl_FragColor = vec4(base + lines, 1.0);
            }
        `
      }, { 
          attributes: ["position", "uv"], 
          uniforms: ["worldViewProjection", "time", "speed"] 
      });
      
      this.shaderMaterial = cyberShader;
      bgLayer.material = cyberShader;
      this.backboxLayers.background = bgLayer;

      // --- LAYER 2: MAIN DISPLAY (Reels) ---
      if (this.useWGSL) {
          console.log("Initializing WGSL Reels");
          const gap = 7;

          // UPDATED: Use the new /reel.png
          const numTexture = new Texture("/reel.png", this.scene);
          numTexture.wrapU = Texture.CLAMP_ADDRESSMODE;
          numTexture.wrapV = Texture.WRAP_ADDRESSMODE; 

          for(let i=0; i<3; i++) {
              const reel = MeshBuilder.CreatePlane(`reel_${i}`, { width: 6, height: 10 }, this.scene);
              reel.position.copyFrom(pos);
              reel.position.x += (i - 1) * gap;
              reel.position.z -= 0.7;
              reel.rotation.y = Math.PI;

              const mat = new ShaderMaterial(`reelMat_${i}`, this.scene, {
                  vertexSource: numberScrollShader.vertex,
                  fragmentSource: numberScrollShader.fragment,
              }, {
                  attributes: ["position", "uv"],
                  uniforms: ["worldViewProjection", "uOffset", "uSpeed", "uColor"],
                  samplers: ["mySampler"],
                  shaderLanguage: ShaderLanguage.WGSL
              });

              mat.setTexture("myTexture", numTexture);
              mat.setFloat("uOffset", 0.0);
              mat.setFloat("uSpeed", 0.0);
              mat.setColor3("uColor", new Color3(1.0, 0.8, 0.2)); 

              reel.material = mat;
              this.reelMaterials.push(mat);
          }
      } else {
          console.log("WebGPU not detected. Falling back to Canvas Reels.");
          const mainDisplay = MeshBuilder.CreatePlane("backboxScreen", { width: 20, height: 12 }, this.scene)
          mainDisplay.position.copyFrom(pos); mainDisplay.position.z -= 0.8; mainDisplay.rotation.y = Math.PI

          const screenMat = new StandardMaterial("screenMat", this.scene)
          this.slotTexture = new DynamicTexture("slotTex", {width: 1024, height: 512}, this.scene, true)
          this.slotTexture.hasAlpha = true
          screenMat.diffuseTexture = this.slotTexture
          screenMat.emissiveColor = Color3.White()
          mainDisplay.material = screenMat
          this.backboxLayers.mainDisplay = mainDisplay
      }

      // --- LAYER 3: UI OVERLAY WITH SCANLINES ---
      const overlay = MeshBuilder.CreatePlane("backboxOverlay", { width: 20, height: 12 }, this.scene)
      overlay.position.copyFrom(pos); overlay.position.z -= 1.01; overlay.rotation.y = Math.PI

      const overlayMat = new StandardMaterial("overlayMat", this.scene)
      this.overlayTexture = new DynamicTexture("overlayTex", 512, this.scene, true)
      this.overlayTexture.hasAlpha = true
      overlayMat.diffuseTexture = this.overlayTexture
      overlayMat.emissiveColor = Color3.White()
      overlayMat.alpha = 0.99
      overlay.material = overlayMat
      this.backboxLayers.overlay = overlay
  }

  private drawSlots(dt: number) {
      if (!this.slotTexture) return
      // (Legacy Canvas Update Logic - Unchanged logic, just ensure 6 symbols if used)
      // Since we updated slotSymbols, this fallback logic automatically adapts.
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
      const w = 1024; const h = 512
      ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, w, h)
      
      const reelW = w / 3
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
              
              ctx.fillStyle = (this.slotMode === 0 && row === 0) ? '#ffffff' : '#888888'
              if (this.displayState === DisplayState.FEVER && row === 0) {
                   ctx.fillStyle = '#ffff00'; ctx.shadowBlur = 40; ctx.shadowColor = '#ffaa00'
              } else { ctx.shadowBlur = 0 }
              ctx.fillText(symbol, centerX, y)
          }
      }
      this.slotTexture.update()
  }

  // --- UPDATED: 6-SYMBOL SNAPPING LOGIC ---
  private updateWGSLReels(dt: number) {
      for(let i=0; i<3; i++) {
          const mat = this.reelMaterials[i];

          if (this.slotMode === 1) { // Accelerate
              this.reelSpeeds[i] = lerp(this.reelSpeeds[i], 8.0, dt * 2);
          }
          else if (this.slotMode === 2) { // Stopping
               // UPDATED: Snap to 6 symbols
               const symbolHeight = 1.0 / 6.0; 

               this.reelSpeeds[i] = Math.max(0.5, this.reelSpeeds[i] - dt * 4);

               if (this.reelSpeeds[i] <= 1.0) { 
                   const currentOffset = this.reelOffsets[i];
                   const targetIndex = Math.round(currentOffset / symbolHeight);
                   const targetOffset = targetIndex * symbolHeight;
                   const diff = targetOffset - currentOffset;

                   if (Math.abs(diff) < 0.005) {
                       this.reelOffsets[i] = targetOffset;
                       this.reelSpeeds[i] = 0;
                   } else {
                       this.reelSpeeds[i] = diff * 10.0;
                   }
               }
          }
          this.reelOffsets[i] += this.reelSpeeds[i] * dt;
          mat.setFloat("uOffset", this.reelOffsets[i]);
          mat.setFloat("uSpeed", Math.abs(this.reelSpeeds[i]));
      }
  }

  private updateOverlay() {
      if (!this.overlayTexture) return
      const ctx = this.overlayTexture.getContext() as CanvasRenderingContext2D
      const w = 512; const h = 512
      ctx.clearRect(0, 0, w, h)

      // 1. Text
      if (this.displayState === DisplayState.REACH) {
          ctx.fillStyle = 'rgba(255, 0, 85, 0.8)'
          ctx.font = 'bold 40px Orbitron, Arial'
          ctx.textAlign = 'center'
          ctx.fillText('REACH!', w/2, h/2)
      } else if (this.displayState === DisplayState.FEVER) {
          ctx.fillStyle = 'rgba(255, 215, 0, 1.0)'
          ctx.font = 'bold 50px Orbitron, Arial'
          ctx.textAlign = 'center'
          ctx.shadowBlur = 15
          ctx.shadowColor = '#ffd700'
          ctx.fillText('JACKPOT!', w/2, h/2)
      }

      // 2. Scanlines (New!)
      ctx.fillStyle = 'rgba(0, 0, 0, 0.2)'
      for(let y=0; y<h; y+=4) {
          ctx.fillRect(0, y, w, 2)
      }
      
      this.overlayTexture.update()
  }

  // ... (Remainder of class: createCabinetLighting, createPachinkoField, createAdventureTrack, helpers, processCollision, etc. remain unchanged) ...
  // [Note: Ensure all other existing methods like createCabinetLighting, createPachinkoField, createAdventureTrack, processCollision, 
  //  handleBallLoss, resetBall, spawnExtraBalls, updateHUD, updateShards, updateCaughtBalls, updateVideo, updateCombo, 
  //  updateBloom, setDisplayState, updateDisplayState, updateCabinetLighting, startAdventureMode, endAdventureMode, 
  //  spawnShardBurst, playBeep and control stubs are preserved.]

  private createCabinetLighting(): void {
      if (!this.scene) return
      const stripPositions = [
          { pos: new Vector3(-12.5, 2, 5), size: new Vector3(0.3, 3, 30) },
          { pos: new Vector3(13.5, 2, 5), size: new Vector3(0.3, 3, 30) },
          { pos: new Vector3(0.75, 6, 5), size: new Vector3(24, 0.3, 30) },
      ]
      stripPositions.forEach((config, idx) => {
          const strip = MeshBuilder.CreateBox(`ledStrip${idx}`, { width: config.size.x, height: config.size.y, depth: config.size.z }, this.scene as Scene)
          strip.position.copyFrom(config.pos)
          const mat = new StandardMaterial(`ledStripMat${idx}`, this.scene as Scene)
          mat.emissiveColor = Color3.FromHexString("#00aaff")
          mat.alpha = 0.6
          strip.material = mat
          const light = new PointLight(`stripLight${idx}`, config.pos, this.scene as Scene)
          light.diffuse = Color3.FromHexString("#00aaff")
          light.intensity = 0.5
          light.range = 15
          this.cabinetLights.push({ mesh: strip, material: mat, pointLight: light })
      })
  }

  private createPachinkoField(center: Vector3, width: number, height: number): void {
      if (!this.scene || !this.world || !this.rapier) return
      const pinMat = new StandardMaterial("pinMat", this.scene)
      pinMat.diffuseColor = Color3.FromHexString("#cccccc"); pinMat.specularColor = Color3.White(); pinMat.specularPower = 128
      pinMat.emissiveColor = Color3.FromHexString("#003333").scale(0.1); pinMat.alpha = 1.0

      const rows = 6; const cols = 9; const spacingX = width / cols; const spacingZ = height / rows
      for(let r=0; r<rows; r++) {
          const offsetX = (r % 2 === 0) ? 0 : spacingX / 2
          for(let c=0; c<cols; c++) {
              const x = center.x - (width/2) + c * spacingX + offsetX
              const z = center.z - (height/2) + r * spacingZ
              if (Math.abs(x) < 2 && Math.abs(z - center.z) < 2) continue;
              const pin = MeshBuilder.CreateCylinder(`pin_${r}_${c}`, { diameter: 0.3, height: 1.5 }, this.scene)
              pin.position.set(x, 0.5, z); pin.material = pinMat
              const body = this.world.createRigidBody(this.rapier.RigidBodyDesc.fixed().setTranslation(x, 0.5, z))
              this.world.createCollider(this.rapier.ColliderDesc.cylinder(0.75, 0.15).setRestitution(0.5), body)
              this.bindings.push({ mesh: pin, rigidBody: body })
              this.pinballMeshes.push(pin)
          }
      }
      const catcher = MeshBuilder.CreateTorus("catcher", { diameter: 2.5, thickness: 0.2 }, this.scene)
      catcher.position.set(center.x, 0.2, center.z)
      const catcherMat = new StandardMaterial("catcherMat", this.scene)
      catcherMat.emissiveColor = Color3.FromHexString("#ff00aa"); catcherMat.alpha = 0.8
      catcher.material = catcherMat
      const catchBody = this.world.createRigidBody(this.rapier.RigidBodyDesc.fixed().setTranslation(center.x, 0.2, center.z))
      this.world.createCollider(this.rapier.ColliderDesc.cylinder(0.5, 1.0).setSensor(true).setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS), catchBody)
      this.targetBodies.push(catchBody); this.targetMeshes.push(catcher); this.targetActive.push(true); this.targetRespawnTimer.push(0); this.pinballMeshes.push(catcher)
  }

  private createAdventureTrack() {
      if (!this.scene || !this.world || !this.rapier) return
      const holoMat = new StandardMaterial("holoTrackMat", this.scene)
      holoMat.emissiveColor = Color3.FromHexString("#00ffff"); holoMat.diffuseColor = Color3.Black(); holoMat.alpha = 0.6; holoMat.wireframe = true
      let currentPos = new Vector3(0, 2, 8) 
      const addRamp = (width: number, length: number, drop: number, rotY: number) => {
          const box = MeshBuilder.CreateBox("holoRamp", { width, height: 0.5, depth: length }, this.scene)
          const forward = new Vector3(Math.sin(rotY), 0, Math.cos(rotY))
          const center = currentPos.add(forward.scale(length / 2))
          center.y -= drop / 2
          box.position.copyFrom(center); box.rotation.y = rotY; box.rotation.x = Math.atan2(drop, length); box.material = holoMat
          this.adventureTrack.push(box)
          const q = Quaternion.FromEulerAngles(box.rotation.x, box.rotation.y, 0)
          const body = this.world!.createRigidBody(this.rapier!.RigidBodyDesc.fixed().setTranslation(center.x, center.y, center.z).setRotation({x: q.x, y: q.y, z: q.z, w: q.w}))
          this.world!.createCollider(this.rapier!.ColliderDesc.cuboid(width/2, 0.25, length/2), body)
          this.adventureBodies.push(body)
          currentPos = currentPos.add(forward.scale(length)); currentPos.y -= drop
          return currentPos
      }
      let heading = Math.PI
      addRamp(6, 10, 4, heading); heading += Math.PI / 2
      addRamp(4, 6, 1, heading); heading -= Math.PI / 1.5
      addRamp(4, 12, 3, heading)
      const basin = MeshBuilder.CreateBox("basin", { width: 8, height: 1, depth: 4}, this.scene)
      basin.position.set(0, currentPos.y - 1, -8); basin.material = holoMat; this.adventureTrack.push(basin)
      const bBody = this.world.createRigidBody(this.rapier.RigidBodyDesc.fixed().setTranslation(0, currentPos.y - 1, -8))
      this.world.createCollider(this.rapier.ColliderDesc.cuboid(4, 0.5, 2), bBody); this.adventureBodies.push(bBody)
      const sensorY = currentPos.y - 0.5
      const sensor = this.world.createRigidBody(this.rapier.RigidBodyDesc.fixed().setTranslation(0, sensorY, -8))
      this.world.createCollider(this.rapier.ColliderDesc.cuboid(2, 1, 1).setSensor(true).setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS), sensor)
      this.adventureSensor = sensor
  }

  private createWall(pos: Vector3, size: Vector3, mat: StandardMaterial): void {
     if (!this.scene || !this.world || !this.rapier) return
     const w = MeshBuilder.CreateBox("w", { width: size.x, height: size.y*2, depth: size.z}, this.scene)
     w.position.copyFrom(pos); w.material = mat
     const b = this.world.createRigidBody(this.rapier.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z))
     this.world.createCollider(this.rapier.ColliderDesc.cuboid(size.x/2, size.y, size.z/2), b)
     this.bindings.push({ mesh: w, rigidBody: b }); this.pinballMeshes.push(w)
  }

  private createSlingshot(pos: Vector3, rot: number, mat: StandardMaterial): void {
      if (!this.scene || !this.world || !this.rapier) return
      const mesh = MeshBuilder.CreateBox("sling", { width: 0.5, height: 2, depth: 4 }, this.scene)
      mesh.rotation.y = rot; mesh.position.copyFrom(pos); mesh.material = mat
      const q = Quaternion.FromEulerAngles(0, rot, 0)
      const b = this.world.createRigidBody(this.rapier.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z).setRotation({x:q.x, y:q.y, z:q.z, w:q.w}))
      this.world.createCollider(this.rapier.ColliderDesc.cuboid(0.25, 1, 2).setRestitution(1.5).setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS), b)
      this.bindings.push({mesh, rigidBody: b}); this.bumperBodies.push(b); this.bumperVisuals.push({ mesh, body: b, hitTime: 0, sweep: 0 }); this.pinballMeshes.push(mesh)
  }

  private createFlippers(mat: StandardMaterial) {
     const make = (pos: Vector3, right: boolean) => {
        const mesh = MeshBuilder.CreateBox("flipper", { width: 3.5, depth: 0.5, height: 0.5}, this.scene) as Mesh
        mesh.material = mat
        const body = this.world!.createRigidBody(this.rapier!.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z))
        this.world!.createCollider(this.rapier!.ColliderDesc.cuboid(1.75, 0.25, 0.25), body)
        this.bindings.push({mesh, rigidBody: body}); this.pinballMeshes.push(mesh)
        const anchor = this.world!.createRigidBody(this.rapier!.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z))
        const pX = right ? 1.5 : -1.5
        const jParams = this.rapier!.JointData.revolute(new this.rapier!.Vector3(pX,0,0), new this.rapier!.Vector3(pX,0,0), new this.rapier!.Vector3(0,1,0))
        jParams.limitsEnabled = true; jParams.limits = right ? [-Math.PI/4, Math.PI/6] : [-Math.PI/6, Math.PI/4]
        const joint = this.world!.createImpulseJoint(jParams, anchor, body, true) as RAPIER.RevoluteImpulseJoint
        joint.configureMotorPosition(right ? -Math.PI/4 : Math.PI/4, 100000, 1000)
        return joint
     }
     if (this.scene && this.world) {
        this.flipperLeftJoint = make(new Vector3(-4, -0.5, -7), false); this.flipperRightJoint = make(new Vector3(4, -0.5, -7), true)
     }
  }

  private createBumpers(): void {
    if (!this.scene || !this.world || !this.rapier) return
    const make = (x: number, z: number, colorHex: string) => {
        const bumper = MeshBuilder.CreateSphere("bump", { diameter: 0.8 }, this.scene as Scene) as Mesh
        bumper.position.set(x, 0.5, z); const mat = new StandardMaterial("bMat", this.scene as Scene); mat.emissiveColor = Color3.FromHexString(colorHex); bumper.material = mat
        const holo = MeshBuilder.CreateCylinder("holo", { diameter: 0.8, height: 3, tessellation: 16 }, this.scene as Scene)
        holo.position.set(x, 2.0, z); const holoMat = new StandardMaterial("holoMat", this.scene as Scene); holoMat.wireframe = true; holoMat.emissiveColor = Color3.FromHexString(colorHex); holoMat.alpha = 0.3; holo.material = holoMat
        const body = this.world!.createRigidBody(this.rapier!.RigidBodyDesc.fixed().setTranslation(x, 0.5, z))
        this.world!.createCollider(this.rapier!.ColliderDesc.ball(0.4).setRestitution(1.5).setActiveEvents(this.rapier!.ActiveEvents.COLLISION_EVENTS), body)
        this.world!.createCollider(this.rapier!.ColliderDesc.cylinder(1.5, 0.5).setSensor(true).setTranslation(0, 2.0, 0).setActiveEvents(this.rapier!.ActiveEvents.COLLISION_EVENTS), body)
        this.bindings.push({ mesh: bumper, rigidBody: body }); this.bumperBodies.push(body); this.bumperVisuals.push({ mesh: bumper, body: body, hologram: holo, hitTime: 0, sweep: Math.random() }); this.pinballMeshes.push(bumper); this.pinballMeshes.push(holo)
    }
    make(0, 8, "#ff00aa"); make(-4, 4, "#00aaff"); make(4, 4, "#00aaff")
  }

  private stepPhysics(): void {
    if (this.state !== GameState.PLAYING || !this.world) return
    this.world.step(this.eventQueue!)
    const dt = this.engine.getDeltaTime() / 1000
    this.eventQueue!.drainCollisionEvents((h1, h2, start) => { if (!start) return; this.processCollision(h1, h2) })
    const time = performance.now() * 0.001
    this.bumperVisuals.forEach(vis => {
        if (vis.hologram) { vis.hologram.rotation.y += dt * 1.5; vis.hologram.position.y = 2.0 + Math.sin(time * 2 + vis.sweep * 10) * 0.2 }
        if (vis.hitTime > 0) {
            vis.hitTime -= dt; const s = 1 + (vis.hitTime * 2); vis.mesh.scaling.set(s,s,s)
            if (vis.hologram) { vis.hologram.scaling.set(1, 1 + vis.hitTime, 1); vis.hologram.material!.alpha = 0.8 }
        } else {
             vis.mesh.scaling.set(1,1,1); if (vis.hologram) { vis.hologram.scaling.set(1,1,1); vis.hologram.material!.alpha = 0.3 }
        }
    })
    for(let i=0; i<this.targetActive.length; i++) {
        if(!this.targetActive[i]) {
            this.targetRespawnTimer[i] -= dt; if (this.targetRespawnTimer[i] <= 0) { this.targetActive[i] = true; this.targetMeshes[i].isVisible = true }
        }
    }
    this.updateShards(dt); this.updateCaughtBalls(dt); this.updateCombo(dt); this.updateBloom(dt); this.updateDisplayState(dt); this.updateCabinetLighting(dt); this.updateVideo()
    if (this.powerupActive) { this.powerupTimer -= dt; if (this.powerupTimer <= 0) this.powerupActive = false }
  }

  private processCollision(h1: number, h2: number) {
      const b1 = this.world!.getRigidBody(h1); const b2 = this.world!.getRigidBody(h2)
      if (!b1 || !b2) return
      if (this.adventureActive && this.adventureSensor && (b1 === this.adventureSensor || b2 === this.adventureSensor)) { this.endAdventureMode(); return }
      if (b1 === this.deathZoneBody || b2 === this.deathZoneBody) { const ball = b1 === this.deathZoneBody ? b2 : b1; this.handleBallLoss(ball); return }
      const bump = this.bumperBodies.find(b => b === b1 || b === b2)
      if (bump) {
          const ballBody = (bump === b1) ? b2 : b1
          if (this.ballBodies.includes(ballBody)) {
              const vis = this.bumperVisuals.find(v => v.body === bump)
              if (vis) {
                   const ballPos = ballBody.translation()
                   if (ballPos.y > 1.5) {
                       if (this.displayState === DisplayState.IDLE) { this.activateHologramCatch(ballBody, bump); return }
                   } else {
                       vis.hitTime = 0.2; this.score += (10 * (Math.floor(this.comboCount/3)+1)); this.comboCount++; this.comboTimer = 1.5; this.spawnShardBurst(vis.mesh.position); this.bloomEnergy = 2.0; this.playBeep(400 + Math.random()*200); this.updateHUD(); this.lightingMode = 'hit'; this.lightingTimer = 0.2; return
                   }
              }
          }
      }
      const tgt = this.targetBodies.find(b => b === b1 || b === b2)
      if (tgt) {
          const idx = this.targetBodies.indexOf(tgt)
          if (this.targetActive[idx]) {
             this.score += 100; this.targetActive[idx] = false; this.targetMeshes[idx].isVisible = false; this.targetRespawnTimer[idx] = 5.0; this.playBeep(1200); this.spawnExtraBalls(1); this.updateHUD(); this.setDisplayState(DisplayState.REACH); this.lightingMode = 'fever'; this.lightingTimer = 3.0
          }
      }
  }
  
  private activateHologramCatch(ball: RAPIER.RigidBody, bumper: RAPIER.RigidBody) {
      if (!this.rapier) return
      ball.setBodyType(this.rapier.RigidBodyType.KinematicPositionBased, true)
      const visual = this.bumperVisuals.find(v => v.body === bumper)
      if (!visual || !visual.hologram) return
      this.caughtBalls.push({ body: ball, targetPos: visual.hologram.position.clone(), timer: 4.0 })
      const mesh = this.bindings.find(b => b.rigidBody === ball)?.mesh as Mesh;
      if (mesh && mesh.material && mesh.material instanceof StandardMaterial) { (mesh.material as StandardMaterial).emissiveColor = new Color3(1, 0, 0) }
      this.playBeep(880, 0); this.setDisplayState(DisplayState.REACH)
  }

  private handleBallLoss(body: RAPIER.RigidBody) {
      if (this.state !== GameState.PLAYING) return
      this.comboCount = 0
      const idx = this.ballBodies.indexOf(body)
      if (idx !== -1) {
          this.world?.removeRigidBody(body); this.ballBodies.splice(idx, 1)
          const bIdx = this.bindings.findIndex(b => b.rigidBody === body)
          if (bIdx !== -1) { this.bindings[bIdx].mesh.dispose(); this.bindings.splice(bIdx, 1) }
      }
      if (body === this.ballBody) {
          if (this.ballBodies.length > 0) { this.ballBody = this.ballBodies[0] } else { this.lives--; if (this.lives > 0) this.resetBall(); else this.setGameState(GameState.GAME_OVER) }
      }
      this.updateHUD()
  }

  private resetBall() {
      if (!this.world || !this.rapier || !this.scene) return
      if (this.ballBodies.length === 0) {
          const mat = new StandardMaterial("ballMat", this.scene); mat.emissiveColor = new Color3(0.2,0.2,0.2)
          const b = MeshBuilder.CreateSphere("ball", {diameter:1}, this.scene) as Mesh; b.material = mat
          const body = this.world.createRigidBody(this.rapier.RigidBodyDesc.dynamic().setTranslation(10.5, 0.5, -9))
          this.world.createCollider(this.rapier.ColliderDesc.ball(0.5).setRestitution(0.7).setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS), body)
          this.ballBody = body; this.ballBodies.push(body); this.bindings.push({mesh:b, rigidBody:body}); if (this.mirrorTexture?.renderList) this.mirrorTexture.renderList.push(b)
      } else {
          this.ballBody!.setTranslation(new this.rapier.Vector3(10.5, 0.5, -9), true); this.ballBody!.setLinvel(new this.rapier.Vector3(0,0,0), true); this.ballBody!.setAngvel(new this.rapier.Vector3(0,0,0), true)
      }
      this.updateHUD()
  }

  private spawnExtraBalls(count: number) {
      if (!this.world || !this.scene || !this.rapier) return
      for(let i=0; i<count; i++) {
          const b = MeshBuilder.CreateSphere("xb", {diameter:1}, this.scene) as Mesh; b.position.set(10.5, 0.5, -9 - i)
          const mat = new StandardMaterial("xbMat", this.scene); mat.diffuseColor = Color3.Green(); b.material = mat
          const body = this.world.createRigidBody(this.rapier.RigidBodyDesc.dynamic().setTranslation(b.position.x, b.position.y, b.position.z))
          this.world.createCollider(this.rapier.ColliderDesc.ball(0.5).setRestitution(0.7).setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS), body)
          this.bindings.push({mesh:b, rigidBody:body}); this.ballBodies.push(body); if (this.mirrorTexture?.renderList) this.mirrorTexture.renderList.push(b)
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
          const s = this.shards[i]; s.life -= dt; if (s.life<=0) { s.mesh.dispose(); this.shards.splice(i,1); continue }; s.mesh.position.addInPlace(s.vel.scale(dt)); s.vel.y -= 9.8 * dt
      }
  }

  private updateCaughtBalls(dt: number) {
      if (!this.rapier) return
      for (let i = this.caughtBalls.length - 1; i >= 0; i--) {
          const catchData = this.caughtBalls[i]; catchData.timer -= dt
          const current = catchData.body.translation(); const target = catchData.targetPos
          const nextX = current.x + (target.x - current.x) * 5 * dt; const nextY = current.y + (target.y - current.y) * 5 * dt; const nextZ = current.z + (target.z - current.z) * 5 * dt
          catchData.body.setNextKinematicTranslation({ x: nextX, y: nextY, z: nextZ })
          if (catchData.timer <= 0) {
              catchData.body.setBodyType(this.rapier.RigidBodyType.Dynamic, true)
              const mesh = this.bindings.find(b => b.rigidBody === catchData.body)?.mesh as Mesh; if (mesh && mesh.material && mesh.material instanceof StandardMaterial) { (mesh.material as StandardMaterial).emissiveColor = new Color3(0.2, 0.2, 0.2) }
              catchData.body.applyImpulse({ x: (Math.random()-0.5)*5, y: 5, z: 5 }, true); this.playBeep(440, 0); this.caughtBalls.splice(i, 1)
          }
      }
  }

  private updateVideo() {
      if (!this.staticTexture) return
      const ctx = this.staticTexture.getContext() as CanvasRenderingContext2D
      const w = 256; const h = 256; ctx.clearRect(0, 0, w, h); ctx.fillStyle = 'rgba(255, 255, 255, 0.1)'
      for(let i=0; i<20; i++) { const x = Math.random() * w; const y = Math.random() * h; const sw = Math.random() * 50; const sh = Math.random() * 5; ctx.fillRect(x, y, sw, sh) }
      this.staticTexture.update()
  }

  private updateCombo(dt: number) { if (this.comboTimer > 0) { this.comboTimer -= dt; if (this.comboTimer <= 0) { this.comboCount = 0; this.updateHUD() } } }
  
  private updateBloom(dt: number) { if (this.bloomPipeline) { this.bloomEnergy = Math.max(0, this.bloomEnergy - dt); this.bloomPipeline.bloomWeight = 0.4 + (this.bloomEnergy * 0.4) } }

  private setDisplayState(newState: DisplayState) {
      this.displayState = newState; this.displayTransitionTimer = 0
      if (newState === DisplayState.REACH) { this.slotMode = 1; this.slotSpeeds = [5.0, 5.0, 5.0]; this.slotStopTimer = 2.0 }
      else if (newState === DisplayState.FEVER) { this.slotMode = 2; this.slotReels = [0.1, 0.4, 0.7]; this.slotSpeeds = [2.0, 3.0, 4.0] }
      else if (newState === DisplayState.IDLE) { this.slotMode = 0; this.slotSpeeds = [0, 0, 0] }
  }

  private updateDisplayState(dt: number) {
      this.displayTransitionTimer += dt
      if (this.shaderMaterial) {
          this.shaderMaterial.setFloat("time", performance.now() * 0.001)
          let speed = 0.5; if (this.displayState === DisplayState.REACH) speed = 5.0; if (this.displayState === DisplayState.FEVER) speed = 10.0
          this.shaderMaterial.setFloat("speed", speed)
      }
      if (this.useWGSL) { this.updateWGSLReels(dt) } else { this.drawSlots(dt) }
      this.updateOverlay()
      if (this.slotMode === 1) {
           this.slotStopTimer -= dt; if (this.slotStopTimer <= 0) { this.slotMode = 2; this.slotSpeeds = [0.0, 5.0, 5.0] }
      }
      if (this.slotMode === 2) {
           let stopped = false
           if (this.useWGSL) { stopped = this.reelSpeeds[0] === 0 && this.reelSpeeds[1] === 0 && this.reelSpeeds[2] === 0 } else { stopped = this.slotSpeeds[0] === 0 && this.slotSpeeds[1] === 0 && this.slotSpeeds[2] === 0 }
           if (this.displayState === DisplayState.REACH && stopped) { this.setDisplayState(DisplayState.FEVER) }
      }
      if (this.displayState === DisplayState.FEVER && this.displayTransitionTimer > 6.0) { this.setDisplayState(DisplayState.IDLE) }
  }

  private updateCabinetLighting(dt: number) {
      const time = performance.now() * 0.001
      if (this.lightingTimer > 0) { this.lightingTimer -= dt; if (this.lightingTimer <= 0) { this.lightingMode = 'normal' } }
      this.cabinetLights.forEach((light, idx) => {
          let targetColor: Color3; let intensity = 0.5
          switch (this.lightingMode) {
              case 'hit': targetColor = Color3.White(); intensity = 2.0; break
              case 'fever': { const hue = (time * 2 + idx * 0.3) % 1; targetColor = Color3.FromHSV(hue * 360, 0.8, 1.0); intensity = 1.5 + Math.sin(time * 10) * 0.5; break }
              case 'normal': default: { const breath = 0.5 + Math.sin(time + idx * 0.5) * 0.3; targetColor = Color3.FromHexString("#00aaff").scale(breath); intensity = 0.5 + breath * 0.2; break }
          }
          light.material.emissiveColor = Color3.Lerp(light.material.emissiveColor, targetColor, dt * 10); light.pointLight.diffuse = light.material.emissiveColor; light.pointLight.intensity = intensity
      })
  }
  
  public startAdventureMode() {
      if (this.adventureActive || !this.scene || !this.ballBody) return
      this.adventureActive = true
      this.pinballMeshes.forEach(m => m.setEnabled(false)) 
      this.createAdventureTrack()
      this.ballBody.setTranslation({ x: 0, y: 3, z: 8 }, true); this.ballBody.setLinvel({ x: 0, y: 0, z: 0 }, true)
      this.tableCamera = this.scene.activeCamera as ArcRotateCamera
      this.followCamera = new ArcRotateCamera("isoCam", -Math.PI/2, 0.8, 15, Vector3.Zero(), this.scene)
      const ballMesh = this.bindings.find(b => b.rigidBody === this.ballBody)?.mesh; if (ballMesh) this.followCamera.lockedTarget = ballMesh
      this.scene.activeCamera = this.followCamera
      if (this.scoreElement) this.scoreElement.innerText = "HOLO-DECK ACTIVE"
  }
  
  public endAdventureMode() {
       if (!this.adventureActive || !this.scene) return
       this.adventureActive = false
       this.pinballMeshes.forEach(m => m.setEnabled(true))
       this.resetBall()
       if (this.tableCamera) { this.scene.activeCamera = this.tableCamera; this.followCamera?.dispose(); this.followCamera = null }
       this.adventureTrack.forEach(m => m.dispose()); this.adventureTrack = []
       if (this.world) { this.adventureBodies.forEach(body => { this.world!.removeRigidBody(body) }); this.adventureBodies = []; if (this.adventureSensor) { this.world.removeRigidBody(this.adventureSensor); this.adventureSensor = null } }
       this.updateHUD()
  }

  private spawnShardBurst(pos: Vector3) {
     if (!this.scene) return
     for(let i=0; i<8; i++) {
         const m = MeshBuilder.CreateBox("s", {size:0.15}, this.scene) as Mesh
         m.position.copyFrom(pos); const mat = new StandardMaterial("sm", this.scene); mat.emissiveColor = Color3.Teal(); m.material = mat
         const vel = new Vector3(Math.random()-0.5, Math.random()+1, Math.random()-0.5).scale(5); this.shards.push({ mesh: m, vel, life: 1.0, material: mat })
     }
  }
  
  private playBeep(freq: number, _dummy?: number) {
     if (!this.audioCtx) return
     const o = this.audioCtx.createOscillator(); const g = this.audioCtx.createGain()
     o.frequency.value = freq; o.connect(g); g.connect(this.audioCtx.destination)
     o.start(); g.gain.exponentialRampToValueAtTime(0.0001, this.audioCtx.currentTime+0.1); o.stop(this.audioCtx.currentTime+0.1)
  }
  
  private triggerLeftFlipper() {}
  private triggerRightFlipper() {}
  private triggerPlunger() {}
  private applyNudge(v: RAPIER.Vector3) { if (this.ballBody) { void v } }
}

function lerp(start: number, end: number, t: number) { return start * (1 - t) + end * t }
