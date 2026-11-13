import { Color4 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem'
import { Scene } from '@babylonjs/core/scene'
import type { PhysicsBody } from '../core/physics-api'
import { EffectsConfig, BallType } from '../config'
import { emissive, QualityTier } from '../game-elements/visual-language'
import { TransientField } from './transient-field'

/** Trail quads alive at once, across all balls (`maxParticlesPerBall` each). Spawns beyond it are dropped. */
const FEVER_TRAIL_CAPACITY = 512
/** Peak alpha of a fresh trail quad; it fades linearly to 0 over its lifetime. */
const FEVER_TRAIL_ALPHA = 0.7

/** One fever-trail quad: a position and an age. It is a row in a `TransientField`, not a mesh. */
interface FeverTrail {
  x: number
  y: number
  z: number
  life: number
  maxLife: number
}

export class TrailEffects {
  private scene: Scene
  private feverTrails: Map<number, FeverTrail[]> = new Map()
  private lastTrailSpawn: Map<number, number> = new Map()
  /** Every fever-trail quad is an instance of this one camera-facing plane (#524). */
  private readonly feverField: TransientField
  /** Spent particles, reused so a fever burst allocates nothing once warm. */
  private readonly feverPool: FeverTrail[] = []
  private feverLive = 0
  private readonly feverTintR: number
  private readonly feverTintG: number
  private readonly feverTintB: number

  private ballTrails: Map<
    number,
    {
      system: ParticleSystem
      body: PhysicsBody
      mesh: Mesh
      type: BallType
    }
  > = new Map()

  constructor(scene: Scene) {
    this.scene = scene
    this.feverField = new TransientField(
      scene,
      () => MeshBuilder.CreatePlane('feverTrailField', { size: 0.25 }, scene),
      FEVER_TRAIL_CAPACITY,
    )
    // Same colour as the emissive material this replaced; the field clamps it to 0..1.
    const tint = emissive(EffectsConfig.feverTrail.color, EffectsConfig.feverTrail.intensity)
    this.feverTintR = tint.r
    this.feverTintG = tint.g
    this.feverTintB = tint.b
  }

  // Fever trail API (assumes gating is handled externally)
  updateFeverTrails(
    ballBodies: { translation: () => { x: number; y: number; z: number }; handle: number }[],
    isFever: boolean,
    dt: number,
    isEnabled = true
  ): void {
    if (!isEnabled) {
      this.clearFeverTrails()
      return
    }

    if (!isFever) {
      this.clearFeverTrails()
      return
    }

    const now = performance.now() / 1000

    for (const body of ballBodies) {
      const handle = body.handle
      const lastSpawn = this.lastTrailSpawn.get(handle) || 0

      // Check spawn rate
      if (now - lastSpawn < EffectsConfig.feverTrail.spawnRate) continue

      // Spawn new trail particle
      this.spawnTrailParticle(body)
      this.lastTrailSpawn.set(handle, now)
    }

    // Update existing particles
    this.updateTrailParticles(dt)
  }

  private spawnTrailParticle(body: { translation: () => { x: number; y: number; z: number }; handle: number }): void {
    const pos = body.translation()
    const handle = body.handle

    // Get or create trail array for this ball
    let trails = this.feverTrails.get(handle)
    if (!trails) {
      trails = []
      this.feverTrails.set(handle, trails)
    }

    // Enforce max particles per ball: the oldest is recycled as the new one
    let particle: FeverTrail | undefined
    if (trails.length >= EffectsConfig.feverTrail.maxParticlesPerBall) {
      particle = trails.shift()
    } else if (this.feverLive >= FEVER_TRAIL_CAPACITY) {
      return
    } else {
      this.feverLive++
    }
    particle ??= this.feverPool.pop() ?? { x: 0, y: 0, z: 0, life: 0, maxLife: 0 }

    particle.x = pos.x
    particle.y = pos.y
    particle.z = pos.z
    particle.life = EffectsConfig.feverTrail.lifetime
    particle.maxLife = EffectsConfig.feverTrail.lifetime
    trails.push(particle)
  }

  private updateTrailParticles(dt: number): void {
    const field = this.feverField
    field.begin()
    field.setBillboardCamera(this.scene.activeCamera)
    for (const [, trails] of this.feverTrails) {
      for (let i = trails.length - 1; i >= 0; i--) {
        const trail = trails[i]
        if (!trail) continue
        trail.life -= dt

        if (trail.life <= 0) {
          this.feverPool.push(trail)
          this.feverLive--
          trails.splice(i, 1)
          continue
        }

        // Fade alpha, shrink slightly
        const lifeRatio = trail.life / trail.maxLife
        field.pushBillboard(
          trail.x, trail.y, trail.z,
          0.5 + lifeRatio * 0.5,
          this.feverTintR, this.feverTintG, this.feverTintB, FEVER_TRAIL_ALPHA * lifeRatio,
        )
      }
    }
    field.end()
  }

  clearFeverTrails(): void {
    // Called every frame outside fever: nothing to release, nothing shown.
    if (this.feverLive === 0 && this.feverTrails.size === 0) return
    for (const trails of this.feverTrails.values()) {
      for (const trail of trails) this.feverPool.push(trail)
    }
    this.feverLive = 0
    this.feverTrails.clear()
    this.lastTrailSpawn.clear()
    this.feverField.begin()
    this.feverField.end()
  }

  dispose(): void {
    this.clearFeverTrails()
    for (const trail of this.ballTrails.values()) {
      trail.system.stop()
      trail.system.dispose()
    }
    this.ballTrails.clear()
    this.feverField.dispose()
  }

  // Ball particle trails
  addBallTrail(body: PhysicsBody, mesh: Mesh, ballType: BallType): void {
    if (this.ballTrails.has(body.handle)) return

    const ps = new ParticleSystem(`ballTrail_${body.handle}`, 100, this.scene)
    ps.emitter = mesh

    // Trail colors by ball type
    if (ballType === BallType.GOLD_PLATED || ballType === BallType.SOLID_GOLD) {
      ps.color1 = new Color4(1, 0.85, 0.4, 1)
      ps.color2 = new Color4(1, 0.7, 0.2, 1)
      ps.colorDead = new Color4(1, 0.6, 0, 0)
    } else {
      ps.color1 = new Color4(0.9, 0.95, 1, 1)
      ps.color2 = new Color4(0.7, 0.85, 1, 1)
      ps.colorDead = new Color4(0.5, 0.7, 1, 0)
    }

    ps.minSize = 0.04
    ps.maxSize = 0.04
    ps.minLifeTime = 0.15
    ps.maxLifeTime = 0.15
    ps.emitRate = 0
    ps.blendMode = ParticleSystem.BLENDMODE_ADD
    ps.gravity = Vector3.Zero()
    ps.direction1 = new Vector3(0, 0, 0)
    ps.direction2 = new Vector3(0, 0, 0)
    ps.minEmitPower = 0
    ps.maxEmitPower = 0
    ps.updateSpeed = 0.016

    ps.start()
    this.ballTrails.set(body.handle, { system: ps, body, mesh, type: ballType })
  }

  removeBallTrail(body: PhysicsBody): void {
    const trail = this.ballTrails.get(body.handle)
    if (!trail) return
    trail.system.stop()
    trail.system.dispose()
    this.ballTrails.delete(body.handle)
  }

  updateTrails(balls: { body: PhysicsBody; mesh: Mesh; type: BallType }[], qualityTier: QualityTier): void {
    // Quality tier gating: disable trails entirely on LOW
    if (qualityTier === QualityTier.LOW) {
      // Clean up any existing trails
      for (const trail of this.ballTrails.values()) {
        trail.system.stop()
        trail.system.dispose()
      }
      this.ballTrails.clear()
      return
    }

    const activeHandles = new Set<number>()

    for (const ball of balls) {
      activeHandles.add(ball.body.handle)

      if (!this.ballTrails.has(ball.body.handle)) {
        this.addBallTrail(ball.body, ball.mesh, ball.type)
      }

      const trail = this.ballTrails.get(ball.body.handle)
      if (!trail) continue

      // Update emit rate based on velocity magnitude
      const vel = ball.body.linvel()
      const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z)

      if (speed < 1.0) {
        trail.system.emitRate = 0
      } else if (speed > 5.0) {
        trail.system.emitRate = 60
      } else {
        // Linear interpolation between 0 and 60
        trail.system.emitRate = ((speed - 1.0) / 4.0) * 60
      }
    }

    // Remove trails for balls that are no longer active
    for (const [handle, trail] of this.ballTrails) {
      if (!activeHandles.has(handle)) {
        trail.system.stop()
        trail.system.dispose()
        this.ballTrails.delete(handle)
      }
    }
  }
}
