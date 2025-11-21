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
import { ActiveEvents } from '@dimforge/rapier3d-compat/pipeline/event_queue'

const GRAVITY = new Vector3(0, -9.81, 0)

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
    this.scene.clearColor = Color3.Black().toColor4(1)
    this.scoreElement = document.getElementById('score')
    this.updateScore()

    const camera = new ArcRotateCamera('camera', Math.PI / 2.5, 1, 25, new Vector3(0, 1, 0), this.scene)
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
    this.bumperVisuals = []
    this.contactForceMap.clear()
    this.bloomPipeline?.dispose()
    this.bloomPipeline = null
    this.bloomEnergy = 0
    this.voiceBuffers.clear()
    this.voiceLoads.clear()
    this.voiceCooldown = 0
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

    const ground = MeshBuilder.CreateGround('ground', { width: 20, height: 20 }, this.scene) as Mesh
    ground.position.y = -1
    ground.material = new StandardMaterial('groundMat', this.scene)
    ;(ground.material as StandardMaterial).diffuseColor = Color3.Gray()
    const groundBody = this.world.createRigidBody(this.rapier.RigidBodyDesc.fixed().setTranslation(0, -1, 0))
    this.world.createCollider(this.rapier.ColliderDesc.cuboid(10, 0.1, 10), groundBody)
    this.bindings.push({ mesh: ground, rigidBody: groundBody })

    // Add walls
    const wallLeft = MeshBuilder.CreateBox('wallLeft', { width: 0.1, height: 10, depth: 20 }, this.scene) as Mesh
    wallLeft.position.set(-10, 4, 0)
    wallLeft.material = new StandardMaterial('wallMat', this.scene)
    ;(wallLeft.material as StandardMaterial).diffuseColor = Color3.White()
    ;(wallLeft.material as StandardMaterial).alpha = 0.3
    const wallLeftBody = this.world.createRigidBody(this.rapier.RigidBodyDesc.fixed().setTranslation(-10, 4, 0))
    this.world.createCollider(this.rapier.ColliderDesc.cuboid(0.05, 5, 10), wallLeftBody)
    this.bindings.push({ mesh: wallLeft, rigidBody: wallLeftBody })

    const wallRight = MeshBuilder.CreateBox('wallRight', { width: 0.1, height: 10, depth: 20 }, this.scene) as Mesh
    wallRight.position.set(10, 4, 0)
    wallRight.material = new StandardMaterial('wallMat', this.scene)
    ;(wallRight.material as StandardMaterial).diffuseColor = Color3.White()
    ;(wallRight.material as StandardMaterial).alpha = 0.3
    const wallRightBody = this.world.createRigidBody(this.rapier.RigidBodyDesc.fixed().setTranslation(10, 4, 0))
    this.world.createCollider(this.rapier.ColliderDesc.cuboid(0.05, 5, 10), wallRightBody)
    this.bindings.push({ mesh: wallRight, rigidBody: wallRightBody })

    const wallTop = MeshBuilder.CreateBox('wallTop', { width: 20, height: 10, depth: 0.1 }, this.scene) as Mesh
    wallTop.position.set(0, 4, -10)
    wallTop.material = new StandardMaterial('wallMat', this.scene)
    ;(wallTop.material as StandardMaterial).diffuseColor = Color3.White()
    ;(wallTop.material as StandardMaterial).alpha = 0.3
    const wallTopBody = this.world.createRigidBody(this.rapier.RigidBodyDesc.fixed().setTranslation(0, 4, -10))
    this.world.createCollider(this.rapier.ColliderDesc.cuboid(10, 5, 0.05), wallTopBody)
    this.bindings.push({ mesh: wallTop, rigidBody: wallTopBody })

    const ball = MeshBuilder.CreateSphere('ball', { diameter: 1 }, this.scene) as Mesh
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

    const flipper = MeshBuilder.CreateBox('flipper', { width: 3, depth: 0.5, height: 0.3 }, this.scene) as Mesh
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
    const bumper1 = MeshBuilder.CreateSphere('bumper1', { diameter: 0.5 }, this.scene) as Mesh
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
    this.bumperVisuals.push({ mesh: bumper1, body: bumperBody1, hitTime: 0, sweep: Math.random() })

    const bumper2 = MeshBuilder.CreateSphere('bumper2', { diameter: 0.5 }, this.scene) as Mesh
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
    this.bumperVisuals.push({ mesh: bumper2, body: bumperBody2, hitTime: 0, sweep: Math.random() })
  }

  private updateScore(): void {
    if (this.scoreElement) {
      this.scoreElement.textContent = this.score.toString()
    }
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
    const bumperBody = this.bumperBodies.includes(body1) ? body1 : this.bumperBodies.includes(body2) ? body2 : null
    if (!bumperBody) return
    const other = bumperBody === body1 ? body2 : body1
    if (other !== this.ballBody) return
    const key = this.contactKey(handle1, handle2)
    this.handleBumperHit(bumperBody, key, bumperHitDuration)
  }

  private handleBumperHit(bumperBody: RAPIER.RigidBody, contactKey: string, bumperHitDuration: number): void {
    this.score += 10
    this.updateScore()
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
          mat.emissiveColor = Color3.Lerp(mat.emissiveColor, Color3.Black(), restoreRate)
          mat.diffuseColor = Color3.Lerp(mat.diffuseColor, Color3.Red(), restoreRate)
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
    this.ballBody.setTranslation(new this.rapier.Vector3(0, 5, 0), true)
    this.ballBody.setLinvel(new this.rapier.Vector3(0, 0, 0), true)
    this.ballBody.setAngvel(new this.rapier.Vector3(0, 0, 0), true)
    this.score = 0
    this.updateScore()
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
