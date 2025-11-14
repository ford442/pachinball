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
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import type { Engine } from '@babylonjs/core/Engines/engine'
import type { Nullable } from '@babylonjs/core/types'
import type { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine'
import type * as RAPIER from '@dimforge/rapier3d-compat'
import { ActiveEvents } from '@dimforge/rapier3d-compat/pipeline/event_queue'

const GRAVITY = new Vector3(0, -9.81, 0)

interface PhysicsBinding {
  mesh: TransformNode
  rigidBody: RAPIER.RigidBody
}

export class Game {
  private readonly engine: Engine | WebGPUEngine
  private scene: Nullable<Scene> = null
  private rapier: typeof RAPIER | null = null
  private world: RAPIER.World | null = null
  private bindings: PhysicsBinding[] = []
  private flipperBody: RAPIER.RigidBody | null = null
  private ready = false
  private score = 0
  private scoreElement: HTMLElement | null = null
  private eventQueue: RAPIER.EventQueue | null = null
  private ballBody: RAPIER.RigidBody | null = null
  private bumperBodies: RAPIER.RigidBody[] = []
  private bumperVisuals: { mesh: TransformNode; body: RAPIER.RigidBody; hitTime: number }[] = []
  // simple shard particles (mesh-based) for robust, type-safe behavior
  private shards: { mesh: TransformNode; vel: Vector3; life: number; material: StandardMaterial }[] = []
  private audioCtx: AudioContext | null = null
  private contactForceMap = new Map<string, number>()

  constructor(engine: Engine | WebGPUEngine) {
    this.engine = engine
  }

  async init(canvas: HTMLCanvasElement): Promise<void> {
    if ('initAsync' in this.engine) {
      await this.engine.initAsync()
    }

    this.scene = new Scene(this.engine)
    this.scene.clearColor = Color3.Black().toColor4(1)
    this.scoreElement = document.getElementById('score')
    this.updateScore()

    const camera = new ArcRotateCamera('camera', Math.PI / 2.5, 1, 25, new Vector3(0, 1, 0), this.scene)
    camera.attachControl(canvas, true)

    new HemisphericLight('light', new Vector3(0.3, 1, 0.3), this.scene)

    await this.initPhysics()
    this.buildScene()

    // Create AudioContext for short beep sounds. Some browsers require a user gesture to resume,
    // but creating here is safe — playback will only work after user interaction if needed.
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
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown)
    this.scene?.dispose()
    this.world?.free()
    // dispose any live shard meshes and materials
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
    this.flipperBody = null
    this.ready = false
    this.score = 0
    this.scoreElement = null
    this.eventQueue = null
    this.ballBody = null
    this.bumperBodies = []
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.code === 'KeyR') {
      this.resetBall()
      return
    }
    if (event.code !== 'Space' || !this.ready || !this.flipperBody || !this.rapier) return
    const torque = new this.rapier.Vector3(0, 80, 0)
    this.flipperBody.applyTorqueImpulse(torque, true)
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

    const ground = MeshBuilder.CreateGround('ground', { width: 20, height: 20 }, this.scene)
    ground.position.y = -1
    ground.material = new StandardMaterial('groundMat', this.scene)
    ;(ground.material as StandardMaterial).diffuseColor = Color3.Gray()
    const groundBody = this.world.createRigidBody(this.rapier.RigidBodyDesc.fixed().setTranslation(0, -1, 0))
    this.world.createCollider(this.rapier.ColliderDesc.cuboid(10, 0.1, 10), groundBody)
    this.bindings.push({ mesh: ground, rigidBody: groundBody })

    // Add walls
    const wallLeft = MeshBuilder.CreateBox('wallLeft', { width: 0.1, height: 10, depth: 20 }, this.scene)
    wallLeft.position.set(-10, 4, 0)
    wallLeft.material = new StandardMaterial('wallMat', this.scene)
    ;(wallLeft.material as StandardMaterial).diffuseColor = Color3.White()
    ;(wallLeft.material as StandardMaterial).alpha = 0.3
    const wallLeftBody = this.world.createRigidBody(this.rapier.RigidBodyDesc.fixed().setTranslation(-10, 4, 0))
    this.world.createCollider(this.rapier.ColliderDesc.cuboid(0.05, 5, 10), wallLeftBody)
    this.bindings.push({ mesh: wallLeft, rigidBody: wallLeftBody })

    const wallRight = MeshBuilder.CreateBox('wallRight', { width: 0.1, height: 10, depth: 20 }, this.scene)
    wallRight.position.set(10, 4, 0)
    wallRight.material = new StandardMaterial('wallMat', this.scene)
    ;(wallRight.material as StandardMaterial).diffuseColor = Color3.White()
    ;(wallRight.material as StandardMaterial).alpha = 0.3
    const wallRightBody = this.world.createRigidBody(this.rapier.RigidBodyDesc.fixed().setTranslation(10, 4, 0))
    this.world.createCollider(this.rapier.ColliderDesc.cuboid(0.05, 5, 10), wallRightBody)
    this.bindings.push({ mesh: wallRight, rigidBody: wallRightBody })

    const wallTop = MeshBuilder.CreateBox('wallTop', { width: 20, height: 10, depth: 0.1 }, this.scene)
    wallTop.position.set(0, 4, -10)
    wallTop.material = new StandardMaterial('wallMat', this.scene)
    ;(wallTop.material as StandardMaterial).diffuseColor = Color3.White()
    ;(wallTop.material as StandardMaterial).alpha = 0.3
    const wallTopBody = this.world.createRigidBody(this.rapier.RigidBodyDesc.fixed().setTranslation(0, 4, -10))
    this.world.createCollider(this.rapier.ColliderDesc.cuboid(10, 5, 0.05), wallTopBody)
    this.bindings.push({ mesh: wallTop, rigidBody: wallTopBody })

    const ball = MeshBuilder.CreateSphere('ball', { diameter: 1 }, this.scene)
    ball.position.set(0, 5, 0)
    ball.material = new StandardMaterial('ballMat', this.scene)
    ;(ball.material as StandardMaterial).diffuseColor = Color3.White()
    const ballBody = this.world.createRigidBody(this.rapier.RigidBodyDesc.dynamic().setTranslation(0, 5, 0))
    this.world.createCollider(
      this.rapier
        .ColliderDesc.ball(0.5)
        .setRestitution(0.7)
        .setActiveEvents(ActiveEvents.COLLISION_EVENTS | ActiveEvents.CONTACT_FORCE_EVENTS),
      ballBody
    )
    this.bindings.push({ mesh: ball, rigidBody: ballBody })
    this.ballBody = ballBody

    const flipper = MeshBuilder.CreateBox('flipper', { width: 3, depth: 0.5, height: 0.3 }, this.scene)
    flipper.rotationQuaternion = Quaternion.Identity()
    flipper.position.set(-4, -0.5, 0)

    const flipperBody = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.dynamic().setTranslation(-4, -0.5, 0)
    )
    this.world.createCollider(this.rapier.ColliderDesc.cuboid(1.5, 0.15, 0.25).setFriction(0.9), flipperBody)
    this.bindings.push({ mesh: flipper, rigidBody: flipperBody })
    this.flipperBody = flipperBody

    const anchorBody = this.world.createRigidBody(this.rapier.RigidBodyDesc.fixed().setTranslation(-4, -0.5, 0))

    const hinge = this.rapier.JointData.revolute(
      new this.rapier.Vector3(-1.5, 0, 0),
      new this.rapier.Vector3(0, 0, 0),
      new this.rapier.Vector3(0, 1, 0)
    )

    this.world.createImpulseJoint(hinge, anchorBody, flipperBody, true)

    // Add bumpers
    const bumper1 = MeshBuilder.CreateSphere('bumper1', { diameter: 0.5 }, this.scene)
    bumper1.position.set(2, 2, 0)
    bumper1.material = new StandardMaterial('bumperMat', this.scene)
    ;(bumper1.material as StandardMaterial).diffuseColor = Color3.Red()
    const bumperBody1 = this.world.createRigidBody(this.rapier.RigidBodyDesc.fixed().setTranslation(2, 2, 0))
    this.world.createCollider(
      this.rapier
        .ColliderDesc.ball(0.25)
        .setRestitution(1.5)
        .setActiveEvents(ActiveEvents.COLLISION_EVENTS | ActiveEvents.CONTACT_FORCE_EVENTS),
      bumperBody1
    )
    this.bindings.push({ mesh: bumper1, rigidBody: bumperBody1 })
    this.bumperBodies.push(bumperBody1)
    this.bumperVisuals.push({ mesh: bumper1, body: bumperBody1, hitTime: 0 })

    const bumper2 = MeshBuilder.CreateSphere('bumper2', { diameter: 0.5 }, this.scene)
    bumper2.position.set(-2, 2, 0)
    bumper2.material = new StandardMaterial('bumperMat', this.scene)
    ;(bumper2.material as StandardMaterial).diffuseColor = Color3.Red()
    const bumperBody2 = this.world.createRigidBody(this.rapier.RigidBodyDesc.fixed().setTranslation(-2, 2, 0))
    this.world.createCollider(
      this.rapier
        .ColliderDesc.ball(0.25)
        .setRestitution(1.5)
        .setActiveEvents(ActiveEvents.COLLISION_EVENTS | ActiveEvents.CONTACT_FORCE_EVENTS),
      bumperBody2
    )
    this.bindings.push({ mesh: bumper2, rigidBody: bumperBody2 })
    this.bumperBodies.push(bumperBody2)
    this.bumperVisuals.push({ mesh: bumper2, body: bumperBody2, hitTime: 0 })
  }

  private updateScore(): void {
    if (this.scoreElement) {
      this.scoreElement.textContent = this.score.toString()
    }
  }

  private stepPhysics(): void {
    if (!this.world || !this.scene || !this.rapier) return

    // Step the physics world (pass eventQueue to collect collision events when available)
    if (this.eventQueue) {
      this.world.step(this.eventQueue)
    } else {
      this.world.step()
    }

    // Delta time in seconds from the engine (Engine.getDeltaTime returns ms)
    // const engineTyped = this.engine as Engine
    // const dt = typeof engineTyped.getDeltaTime === 'function' ? engineTyped.getDeltaTime() / 1000 : 1 / 60

    // Process collision events and trigger bumper hit animations
    const bumperHitDuration = 0.18 // seconds
    if (this.eventQueue) {
      this.eventQueue.drainContactForceEvents((event) => {
        const key = this.contactKey(event.collider1(), event.collider2())
        const magnitude = event.totalForceMagnitude()
        const existing = this.contactForceMap.get(key) ?? 0
        this.contactForceMap.set(key, Math.max(existing, magnitude))
      })
      this.eventQueue.drainCollisionEvents((handle1, handle2, started) => {
        if (!started) return
        const body1 = this.world!.getRigidBody(handle1)
        const body2 = this.world!.getRigidBody(handle2)
        // If collision is between ball and a bumper
        if ((this.bumperBodies.includes(body1) && body2 === this.ballBody) ||
            (this.bumperBodies.includes(body2) && body1 === this.ballBody)) {
          this.score += 10
          this.updateScore()
          // Find the bumper visual and start hit animation
          const bumperBody = this.bumperBodies.includes(body1) ? body1 : body2
          const visual = this.bumperVisuals.find(v => v.body === bumperBody)
          if (visual) visual.hitTime = bumperHitDuration
          const key = this.contactKey(handle1, handle2)
          let strength = this.contactForceMap.get(key) ?? 0
          if (strength < 0.1) {
            try {
              const ball = this.ballBody
              if (ball) {
                const lv = ball.linvel()
                const speed = Math.sqrt(lv.x * lv.x + lv.y * lv.y + lv.z * lv.z)
                strength = Math.max(0.1, speed)
              }
            } catch {
              strength = 1
            }
          }

          // Map strength to particle count and emit power
          const count = Math.min(64, Math.max(4, Math.round(strength * 8)))
          const emitPower = Math.min(6, 0.8 + strength * 1.2)

          // Map strength to beep pitch (Hz)
          const freq = Math.min(2400, Math.max(220, 600 + strength * 220))

          // Play beep with tuned frequency and spawn shard meshes scaled by strength
          this.playBeep(freq)
          if (visual) this.spawnShardBurst(visual.mesh.position.clone(), count, emitPower)
         }
       })
     }
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
  private spawnShardBurst(pos: Vector3, count = 12, power = 2): void {
    if (!this.scene) return
    for (let i = 0; i < count; i++) {
      const shard = MeshBuilder.CreateSphere(`shard_${Date.now()}_${i}`, { diameter: 0.12 }, this.scene)
      shard.position.set(pos.x, pos.y, pos.z)
      const mat = new StandardMaterial(`shardMat_${Date.now()}_${i}`, this.scene)
      mat.emissiveColor = Color3.FromInts(255, 190, 60).toColor3()
      mat.alpha = 1
      shard.material = mat
      const speed = 1.5 + Math.random() * (1.5 * Math.min(3, power))
      const vel = new Vector3((Math.random() - 0.5) * speed, 0.5 + Math.random() * speed, (Math.random() - 0.5) * speed)
      this.shards.push({ mesh: shard, vel, life: 0.6, material: mat })
    }
  }

  // Reset ball position/velocity and score
  private resetBall(): void {
    if (!this.world || !this.ballBody || !this.rapier) return
    this.ballBody.setTranslation(new this.rapier.Vector3(0, 5, 0), true)
    this.ballBody.setLinvel(new this.rapier.Vector3(0, 0, 0), true)
    this.ballBody.setAngvel(new this.rapier.Vector3(0, 0, 0), true)
    this.score = 0
    this.updateScore()
  }

  private contactKey(handle1: number, handle2: number): string {
    return handle1 < handle2 ? `${handle1}-${handle2}` : `${handle2}-${handle1}`
  }

  private stepPhysics(): void {
    if (!this.world || !this.scene || !this.rapier) return

    // Step the physics world (pass eventQueue to collect collision events when available)
    if (this.eventQueue) {
      this.world.step(this.eventQueue)
    } else {
      this.world.step()
    }

    // Delta time in seconds from the engine (Engine.getDeltaTime returns ms)
    const engineTyped = this.engine as Engine
    const dt = typeof engineTyped.getDeltaTime === 'function' ? engineTyped.getDeltaTime() / 1000 : 1 / 60

    // Process collision events and trigger bumper hit animations
    const bumperHitDuration = 0.18 // seconds
    if (this.eventQueue) {
      this.eventQueue.drainContactForceEvents((event) => {
        const key = this.contactKey(event.collider1(), event.collider2())
        const magnitude = event.totalForceMagnitude()
        const existing = this.contactForceMap.get(key) ?? 0
        this.contactForceMap.set(key, Math.max(existing, magnitude))
      })
      this.eventQueue.drainCollisionEvents((handle1, handle2, started) => {
        if (!started) return
        const body1 = this.world!.getRigidBody(handle1)
        const body2 = this.world!.getRigidBody(handle2)
        // If collision is between ball and a bumper
        if ((this.bumperBodies.includes(body1) && body2 === this.ballBody) ||
            (this.bumperBodies.includes(body2) && body1 === this.ballBody)) {
          this.score += 10
          this.updateScore()
          // Find the bumper visual and start hit animation
          const bumperBody = this.bumperBodies.includes(body1) ? body1 : body2
          const visual = this.bumperVisuals.find(v => v.body === bumperBody)
          if (visual) visual.hitTime = bumperHitDuration
          const key = this.contactKey(handle1, handle2)
          let strength = this.contactForceMap.get(key) ?? 0
          if (strength < 0.1) {
            try {
              const ball = this.ballBody
              if (ball) {
                const lv = ball.linvel()
                const speed = Math.sqrt(lv.x * lv.x + lv.y * lv.y + lv.z * lv.z)
                strength = Math.max(0.1, speed)
              }
            } catch {
              strength = 1
            }
          }

          // Map strength to particle count and emit power
          const count = Math.min(64, Math.max(4, Math.round(strength * 8)))
          const emitPower = Math.min(6, 0.8 + strength * 1.2)

          // Map strength to beep pitch (Hz)
          const freq = Math.min(2400, Math.max(220, 600 + strength * 220))

          // Play beep with tuned frequency and spawn shard meshes scaled by strength
          this.playBeep(freq)
          if (visual) this.spawnShardBurst(visual.mesh.position.clone(), count, emitPower)
         }
       })
     }

    // Animate bumper scales based on hitTime timers (use a fixed decay step)
    const decayStep = 1 / 60
    for (const v of this.bumperVisuals) {
      if (v.hitTime > 0) {
        v.hitTime = Math.max(0, v.hitTime - decayStep)
        const t = v.hitTime / bumperHitDuration // 0..1
        const scale = 1 + 0.6 * t
        v.mesh.scaling.set(scale, scale, scale)
      } else {
        // restore
        const current = v.mesh.scaling.x
        v.mesh.scaling.set(current + (1 - current) * 0.2, current + (1 - current) * 0.2, current + (1 - current) * 0.2)
      }
    }

    // Update shard particles (simple non-physics shards)
    const dtSim = 1 / 60
    for (let i = this.shards.length - 1; i >= 0; i--) {
      const s = this.shards[i]
      s.life -= dtSim
      if (s.life <= 0) {
        try {
          s.mesh.dispose()
          s.material.dispose()
        } catch { /* ignore */ }
        this.shards.splice(i, 1)
        continue
      }
      const dpos = s.vel.scale(dtSim)
      s.mesh.position.addInPlace(dpos)
      s.vel.y += GRAVITY.y * dtSim * 0.5
      const alpha = Math.max(0, s.life / 0.6)
      s.material.alpha = alpha
      const scale = 0.12 * (0.5 + alpha * 0.5)
      s.mesh.scaling.set(scale, scale, scale)
    }
  }
