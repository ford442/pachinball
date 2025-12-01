import {
  ArcRotateCamera,
  Color3,
  HemisphericLight,
  MeshBuilder,
  Quaternion,
  Scene,
  TransformNode,
  Vector3,
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
  PLAYING,
  GAME_OVER,
}

export class Game {
  private readonly engine: Engine | WebGPUEngine
  private scene: Nullable<Scene> = null
  private rapier: typeof RAPIER | null = null
  private world: RAPIER.World | null = null
  private bindings: PhysicsBinding[] = []
  private flipperLeftBody: RAPIER.RigidBody | null = null
  private flipperRightBody: RAPIER.RigidBody | null = null
  private ready = false

  // Game State
  private state: GameState = GameState.MENU
  private score = 0
  private lives = 3

  // UI Elements
  private scoreElement: HTMLElement | null = null
  private livesElement: HTMLElement | null = null
  private menuOverlay: HTMLElement | null = null
  private startScreen: HTMLElement | null = null
  private gameOverScreen: HTMLElement | null = null
  private finalScoreElement: HTMLElement | null = null

  private eventQueue: RAPIER.EventQueue | null = null
  private ballBody: RAPIER.RigidBody | null = null
  private deathZoneBody: RAPIER.RigidBody | null = null
  private bumperBodies: RAPIER.RigidBody[] = []
  private bumperVisuals: BumperVisual[] = []
  private shards: Array<{ mesh: Mesh; vel: Vector3; life: number; material: StandardMaterial }> = []
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
    this.startScreen = document.getElementById('start-screen')
    this.gameOverScreen = document.getElementById('game-over-screen')
    this.finalScoreElement = document.getElementById('final-score')

    document.getElementById('start-btn')?.addEventListener('click', () => this.startGame())
    document.getElementById('restart-btn')?.addEventListener('click', () => this.startGame())

    this.updateHUD()

    // Camera positioned at -Z (Player side), looking slightly down
    const camera = new ArcRotateCamera('camera', -Math.PI / 2, Math.PI / 3, 28, new Vector3(0, 1, 0), this.scene)
    camera.attachControl(canvas, true)

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
    this.ready = true

    // Initial state
    this.setGameState(GameState.MENU)
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown)
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
    this.flipperLeftBody = null
    this.flipperRightBody = null
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
    if (this.startScreen) this.startScreen.classList.add('hidden')
    if (this.gameOverScreen) this.gameOverScreen.classList.add('hidden')

    switch (newState) {
      case GameState.MENU:
        if (this.startScreen) this.startScreen.classList.remove('hidden')
        break
      case GameState.PLAYING:
        if (this.menuOverlay) this.menuOverlay.classList.add('hidden')
        if (this.audioCtx && this.audioCtx.state === 'suspended') {
            this.audioCtx.resume()
        }
        break
      case GameState.GAME_OVER:
        if (this.gameOverScreen) this.gameOverScreen.classList.remove('hidden')
        if (this.finalScoreElement) this.finalScoreElement.textContent = this.score.toString()
        break
    }
  }

  private startGame() {
    this.score = 0
    this.lives = 3
    this.updateHUD()
    this.resetBall()
    this.setGameState(GameState.PLAYING)
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (!this.ready || !this.rapier) return

    if (event.code === 'KeyR' && this.state === GameState.PLAYING) {
      this.resetBall()
      return
    }

    if (this.state !== GameState.PLAYING) return

    // Flipper control
    const torqueMag = 80;

    if (event.code === 'ArrowLeft' || event.code === 'KeyZ') {
       if (this.flipperLeftBody) {
         this.flipperLeftBody.applyTorqueImpulse(new this.rapier.Vector3(0, torqueMag, 0), true)
       }
    }

    if (event.code === 'ArrowRight' || event.code === 'Slash') {
       if (this.flipperRightBody) {
         this.flipperRightBody.applyTorqueImpulse(new this.rapier.Vector3(0, -torqueMag, 0), true)
       }
    }

    // Plunger
    if (event.code === 'Space' || event.code === 'Enter') {
        if (this.ballBody) {
            // Only launch if ball is roughly in the plunger lane
            const pos = this.ballBody.translation();
            // Lane is roughly x > 8, z < -5
            if (pos.x > 8 && pos.z < -4) {
                 this.ballBody.applyImpulse(new this.rapier.Vector3(0, 0, 15), true)
            }
        }
    }
  }

  private async initPhysics(): Promise<void> {
    if (this.rapier) return
    this.rapier = await import('@dimforge/rapier3d-compat')
    await this.rapier.init()
    this.world = new this.rapier.World(new this.rapier.Vector3(GRAVITY.x, GRAVITY.y, GRAVITY.z))
    this.eventQueue = new this.rapier.EventQueue(true)
  }

  private buildScene(): void {
    if (!this.scene || !this.world || !this.rapier) {
      throw new Error('Scene or physics not initialized')
    }

    // Materials
    const groundMat = new StandardMaterial('groundMat', this.scene);
    groundMat.diffuseColor = Color3.FromHexString("#222233");

    const wallMat = new StandardMaterial('wallMat', this.scene);
    wallMat.diffuseColor = Color3.FromHexString("#44aaff");
    wallMat.alpha = 0.5;
    wallMat.emissiveColor = Color3.FromHexString("#001133");

    const flipperMat = new StandardMaterial('flipperMat', this.scene);
    flipperMat.diffuseColor = Color3.FromHexString("#ffff00");

    const slingshotMat = new StandardMaterial('slingshotMat', this.scene);
    slingshotMat.diffuseColor = Color3.White();
    slingshotMat.emissiveColor = Color3.FromHexString("#333333");

    const ballMat = new StandardMaterial('ballMat', this.scene);
    ballMat.diffuseColor = Color3.White();
    ballMat.specularPower = 64;

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
    this.createWall(new Vector3(0.75, wallHeight, 14.5), new Vector3(22.5, 5, 0.1), wallMat)

    // Plunger Lane Divider
    // Gap at top for ball to enter playfield
    // Lane width ~1.5 units. X pos around 9.
    this.createWall(new Vector3(9.5, wallHeight, -1), new Vector3(0.1, 5, 20), wallMat)

    // Plunger Lane Base (Stopper)
    // At bottom of lane so ball doesn't roll out backwards
    this.createWall(new Vector3(10.5, wallHeight, -10), new Vector3(1.9, 5, 0.1), wallMat)

    // Death Zone (Bottom)
    // Sensor to detect ball falling out
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
    const ballBody = this.world.createRigidBody(this.rapier.RigidBodyDesc.dynamic().setTranslation(10.5, 0.5, -9))
    this.world.createCollider(
      this.rapier
        .ColliderDesc.ball(0.5)
        .setRestitution(0.7)
        .setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS | this.rapier.ActiveEvents.CONTACT_FORCE_EVENTS),
      ballBody
    )
    this.bindings.push({ mesh: ball, rigidBody: ballBody })
    this.ballBody = ballBody

    // Flippers
    this.createFlippers(flipperMat)

    // Bumpers
    this.createBumpers()

    // Slingshots (Angled bumpers above flippers)
    // Left Slingshot
    // Position: X ~ -6.5, Z ~ -3
    this.createSlingshot(new Vector3(-6.5, 0, -3), -Math.PI / 6, slingshotMat)

    // Right Slingshot
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
  }

  private createSlingshot(pos: Vector3, rotationY: number, mat: StandardMaterial): void {
      if (!this.scene || !this.world || !this.rapier) return

      const size = { w: 0.5, h: 2, d: 4 }

      const mesh = MeshBuilder.CreateBox(`sling_${pos.x}`, { width: size.w, height: size.h, depth: size.d }, this.scene)
      mesh.rotation.y = rotationY;
      mesh.position.copyFrom(pos)
      mesh.material = mat

      // Rapier needs the rotation in the collider or body
      const q = Quaternion.FromEulerAngles(0, rotationY, 0);

      const body = this.world.createRigidBody(
          this.rapier.RigidBodyDesc.fixed()
            .setTranslation(pos.x, pos.y, pos.z)
            .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      )

      this.world.createCollider(
          this.rapier.ColliderDesc.cuboid(size.w/2, size.h/2, size.d/2)
            .setRestitution(1.5) // High bounce
            .setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS | this.rapier.ActiveEvents.CONTACT_FORCE_EVENTS),
          body
      )

      this.bindings.push({ mesh: mesh, rigidBody: body })
      this.bumperBodies.push(body) // Treat as bumper for scoring/sound
      this.bumperVisuals.push({ mesh: mesh, body: body, hitTime: 0, sweep: Math.random() })
  }

  private createFlippers(mat: StandardMaterial): void {
      if (!this.scene || !this.world || !this.rapier) return

      // Left Flipper
      this.flipperLeftBody = this.createFlipper(new Vector3(-4, -0.5, -7), false, mat)

      // Right Flipper
      this.flipperRightBody = this.createFlipper(new Vector3(4, -0.5, -7), true, mat)
  }

  private createFlipper(pos: Vector3, isRight: boolean, mat: StandardMaterial): RAPIER.RigidBody {
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

      const joint = this.rapier.JointData.revolute(
          new this.rapier.Vector3(pivotX, 0, 0),
           new this.rapier.Vector3(pivotX, 0, 0),
           new this.rapier.Vector3(0, 1, 0)
      )

      if (isRight) {
          joint.limitsEnabled = true
          joint.limits = [-Math.PI / 4, Math.PI / 6]
      } else {
          joint.limitsEnabled = true
          joint.limits = [-Math.PI / 6, Math.PI / 4]
      }

      this.world.createImpulseJoint(joint, anchorBody, body, true)

      return body
  }

  private createBumpers(): void {
      if (!this.scene || !this.world || !this.rapier) return

    const bumper1 = MeshBuilder.CreateSphere('bumper1', { diameter: 0.8 }, this.scene) as Mesh
    bumper1.position.set(2, 0.5, 3)
    bumper1.material = new StandardMaterial('bumperMat', this.scene)
    ;(bumper1.material as StandardMaterial).diffuseColor = Color3.Red()
    const bumperBody1 = this.world.createRigidBody(this.rapier.RigidBodyDesc.fixed().setTranslation(2, 0.5, 3))
    this.world.createCollider(
      this.rapier
        .ColliderDesc.ball(0.4)
        .setRestitution(1.5)
        .setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS | this.rapier.ActiveEvents.CONTACT_FORCE_EVENTS),
      bumperBody1
    )
    this.bindings.push({ mesh: bumper1, rigidBody: bumperBody1 })
    this.bumperBodies.push(bumperBody1)
    this.bumperVisuals.push({ mesh: bumper1, body: bumperBody1, hitTime: 0, sweep: Math.random() })

    const bumper2 = MeshBuilder.CreateSphere('bumper2', { diameter: 0.8 }, this.scene) as Mesh
    bumper2.position.set(-2, 0.5, 3)
    bumper2.material = new StandardMaterial('bumperMat', this.scene)
    ;(bumper2.material as StandardMaterial).diffuseColor = Color3.Red()
    const bumperBody2 = this.world.createRigidBody(this.rapier.RigidBodyDesc.fixed().setTranslation(-2, 0.5, 3))
    this.world.createCollider(
      this.rapier
        .ColliderDesc.ball(0.4)
        .setRestitution(1.5)
        .setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS | this.rapier.ActiveEvents.CONTACT_FORCE_EVENTS),
      bumperBody2
    )
    this.bindings.push({ mesh: bumper2, rigidBody: bumperBody2 })
    this.bumperBodies.push(bumperBody2)
    this.bumperVisuals.push({ mesh: bumper2, body: bumperBody2, hitTime: 0, sweep: Math.random() })

    // Third bumper
    const bumper3 = MeshBuilder.CreateSphere('bumper3', { diameter: 0.8 }, this.scene) as Mesh
    bumper3.position.set(0, 0.5, 6)
    bumper3.material = new StandardMaterial('bumperMat', this.scene)
    ;(bumper3.material as StandardMaterial).diffuseColor = Color3.Red()
    const bumperBody3 = this.world.createRigidBody(this.rapier.RigidBodyDesc.fixed().setTranslation(0, 0.5, 6))
    this.world.createCollider(
      this.rapier
        .ColliderDesc.ball(0.4)
        .setRestitution(1.5)
        .setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS | this.rapier.ActiveEvents.CONTACT_FORCE_EVENTS),
      bumperBody3
    )
    this.bindings.push({ mesh: bumper3, rigidBody: bumperBody3 })
    this.bumperBodies.push(bumperBody3)
    this.bumperVisuals.push({ mesh: bumper3, body: bumperBody3, hitTime: 0, sweep: Math.random() })
  }

  private updateHUD(): void {
    if (this.scoreElement) this.scoreElement.textContent = this.score.toString()
    if (this.livesElement) this.livesElement.textContent = this.lives.toString()
  }

  private stepPhysics(): void {
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
    this.updateShards(dt)
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
        if (other === this.ballBody) {
            this.handleBallLoss();
            return;
        }
    }

    const bumperBody = this.bumperBodies.includes(body1) ? body1 : this.bumperBodies.includes(body2) ? body2 : null
    if (!bumperBody) return
    const other = bumperBody === body1 ? body2 : body1
    if (other !== this.ballBody) return
    const key = this.contactKey(handle1, handle2)
    this.handleBumperHit(bumperBody, key, bumperHitDuration)
  }

  private handleBallLoss(): void {
      if (this.state !== GameState.PLAYING) return;

      this.lives--;
      this.updateHUD();
      this.playVoiceCue('fever') // Reuse sound for now or add new one later

      if (this.lives > 0) {
          this.resetBall();
      } else {
          this.setGameState(GameState.GAME_OVER);
      }
  }

  private handleBumperHit(bumperBody: RAPIER.RigidBody, contactKey: string, bumperHitDuration: number): void {
    this.score += 10
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
      const shard = MeshBuilder.CreateSphere(`shard_${Date.now()}_${i}`, { diameter: 0.12 }, this.scene) as Mesh
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
