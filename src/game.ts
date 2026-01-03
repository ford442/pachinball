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
} from './game-elements'

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
  private inputHandler: InputHandler | null = null
  
  // Rendering
  private bloomPipeline: DefaultRenderingPipeline | null = null
  private mirrorTexture: MirrorTexture | null = null
  
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

  constructor(engine: Engine | WebGPUEngine) {
    this.engine = engine
    this.physics = new PhysicsSystem()
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

    try {
      const v = localStorage.getItem('pachinball.best')
      if (v) this.bestScore = Math.max(0, parseInt(v, 10) || 0)
    } catch {
      // Ignore localStorage errors
    }
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

  dispose(): void {
    if (this.inputHandler) {
      window.removeEventListener('keydown', this.inputHandler.handleKeyDown)
      window.removeEventListener('keyup', this.inputHandler.handleKeyUp)
    }
    this.scene?.dispose()
    this.physics.dispose()
    this.ready = false
  }

  private buildScene(): void {
    if (!this.scene) throw new Error('Scene not ready')
    const world = this.physics.getWorld()
    const rapier = this.physics.getRapier()
    if (!world || !rapier) throw new Error('Physics not ready')

    // Skybox
    const skybox = MeshBuilder.CreateBox("skybox", { size: 100.0 }, this.scene)
    const skyboxMaterial = new StandardMaterial("skyBox", this.scene)
    skyboxMaterial.backFaceCulling = false
    skyboxMaterial.diffuseColor = new Color3(0, 0, 0)
    skyboxMaterial.specularColor = new Color3(0, 0, 0)
    skyboxMaterial.emissiveColor = new Color3(0.01, 0.01, 0.02)
    skybox.material = skyboxMaterial

    // Mirror texture
    this.mirrorTexture = new MirrorTexture("mirror", 1024, this.scene, true)
    this.mirrorTexture.mirrorPlane = new Plane(0, -1, 0, -1.01)
    this.mirrorTexture.level = 0.6

    // Initialize systems
    this.effects = new EffectsSystem(this.scene, this.bloomPipeline)
    this.display = new DisplaySystem(this.scene, this.engine)
    this.gameObjects = new GameObjects(this.scene, world, rapier)
    this.ballManager = new BallManager(this.scene, world, rapier, this.gameObjects.getBindings())
    this.adventureMode = new AdventureMode(this.scene, world, rapier)

    // Build game objects
    this.gameObjects.createGround(this.mirrorTexture)
    this.gameObjects.createWalls()
    
    // Cabinet
    const cabinetMat = new StandardMaterial("cabinetMat", this.scene)
    cabinetMat.diffuseColor = Color3.FromHexString("#111111")
    const cab = MeshBuilder.CreateBox("cabinet", { width: 26, height: 4, depth: 36 }, this.scene)
    cab.position.set(0.75, -3, 5)
    cab.material = cabinetMat

    this.display.createBackbox(new Vector3(0.75, 8, 21.5))
    this.effects.createCabinetLighting()

    this.gameObjects.createDeathZone()
    
    this.ballManager.setMirrorTexture(this.mirrorTexture)
    this.ballManager.createMainBall()

    this.gameObjects.createFlippers()
    this.gameObjects.createPachinkoField(new Vector3(0, 0.5, 12), 14, 8)
    this.gameObjects.createBumpers()
    this.gameObjects.createSlingshots()
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
      const stiffness = 100000
      const damping = 1000
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
      const stiffness = 100000
      const damping = 1000
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
      ballBody.applyImpulse(new rapier.Vector3(0, 0, 15), true)
    }
  }

  private applyNudge(direction: RAPIER.Vector3): void {
    // Stub for nudge functionality
    void direction
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

    this.gameObjects?.updateBumpers(dt)
    this.gameObjects?.updateTargets(dt)
    
    this.ballManager?.updateCaughtBalls(dt, () => {
      this.effects?.playBeep(440)
    })
    
    this.effects?.updateShards(dt)
    this.effects?.updateBloom(dt)
    this.effects?.updateCabinetLighting(dt)
    this.display?.update(dt)
    
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

  private startAdventureMode(): void {
    if (!this.adventureMode || !this.scene) return
    
    const ballBody = this.ballManager?.getBallBody()
    const camera = this.scene.activeCamera as ArcRotateCamera
    const bindings = this.gameObjects?.getBindings() || []
    const ballMesh = bindings.find(b => b.rigidBody === ballBody)?.mesh
    
    if (ballBody && camera) {
      const pinballMeshes = this.gameObjects?.getPinballMeshes() || []
      pinballMeshes.forEach(m => m.setEnabled(false))
      
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.adventureMode.start(ballBody, camera, ballMesh as any)
      
      if (this.scoreElement) {
        this.scoreElement.innerText = "HOLO-DECK ACTIVE"
      }
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
