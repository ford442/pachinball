import { MeshBuilder, Vector3, StandardMaterial, Mesh, ParticleSystem, Color4, Scene } from '@babylonjs/core'
import type * as RAPIER from '@dimforge/rapier3d-compat'
import { EffectsConfig, BallType } from '../config'
import { emissive, QualityTier } from '../game-elements/visual-language'

interface FeverTrail {
  mesh: Mesh
  material: StandardMaterial
  life: number
  maxLife: number
}

export class TrailEffects {
  private scene: Scene
  private feverTrails: Map<number, FeverTrail[]> = new Map()
  private lastTrailSpawn: Map<number, number> = new Map()

  private ballTrails: Map<
    number,
    {
      system: ParticleSystem
      body: RAPIER.RigidBody
      mesh: Mesh
      type: BallType
    }
  > = new Map()

  constructor(scene: Scene) {
    this.scene = scene
  }

  // Fever trail API (assumes gating is handled externally)
  updateFeverTrails(
    ballBodies: { translation: () => { x: number; y: number; z: number }; handle: number }[],
    isFever: boolean,
    dt: number
  ): void {
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

    // Enforce max particles per ball
    if (trails.length >= EffectsConfig.feverTrail.maxParticlesPerBall) {
      // Remove oldest
      const oldest = trails.shift()
      if (oldest) {
        oldest.mesh.dispose()
        oldest.material.dispose()
      }
    }

    // Create particle mesh
    const particle = MeshBuilder.CreatePlane(`feverTrail_${Date.now()}`, { size: 0.25 }, this.scene)

    particle.position.set(pos.x, pos.y, pos.z)
    particle.billboardMode = Mesh.BILLBOARDMODE_ALL

    const mat = new StandardMaterial(`trailMat_${Date.now()}`, this.scene)
    mat.emissiveColor = emissive(EffectsConfig.feverTrail.color, EffectsConfig.feverTrail.intensity)
    mat.alpha = 0.7
    mat.disableLighting = true
    particle.material = mat

    trails.push({
      mesh: particle,
      material: mat,
      life: EffectsConfig.feverTrail.lifetime,
      maxLife: EffectsConfig.feverTrail.lifetime,
    })
  }

  private updateTrailParticles(dt: number): void {
    for (const [, trails] of this.feverTrails) {
      for (let i = trails.length - 1; i >= 0; i--) {
        const trail = trails[i]
        trail.life -= dt

        if (trail.life <= 0) {
          trail.mesh.dispose()
          trail.material.dispose()
          trails.splice(i, 1)
          continue
        }

        // Fade alpha
        const lifeRatio = trail.life / trail.maxLife
        trail.material.alpha = 0.7 * lifeRatio

        // Shrink slightly
        const scale = 0.5 + lifeRatio * 0.5
        trail.mesh.scaling.setAll(scale)
      }
    }
  }

  clearFeverTrails(): void {
    for (const trails of this.feverTrails.values()) {
      for (const trail of trails) {
        trail.mesh.dispose()
        trail.material.dispose()
      }
    }
    this.feverTrails.clear()
    this.lastTrailSpawn.clear()
  }

  // Ball particle trails
  addBallTrail(body: RAPIER.RigidBody, mesh: Mesh, ballType: BallType): void {
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

  removeBallTrail(body: RAPIER.RigidBody): void {
    const trail = this.ballTrails.get(body.handle)
    if (!trail) return
    trail.system.stop()
    trail.system.dispose()
    this.ballTrails.delete(body.handle)
  }

  updateTrails(balls: { body: RAPIER.RigidBody; mesh: Mesh; type: BallType }[], qualityTier: QualityTier): void {
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
