/**
 * Ball presentation — the `BallView` the game gives its `BallManager`: meshes, physics bindings,
 * ribbon trails, the ball light, spawn particles, the gold glow, skins and the map tint.
 *
 * Split out of `ball-manager-spawn.ts` / `ball-manager-gold.ts` / `ball-manager.ts` (#528) so the
 * sim half (bodies, ball data, multiball, gold collection, stuck detection) runs in Node with no
 * Babylon import. Nothing here may move a body or change what the sim reads.
 */

import { PointLight } from '@babylonjs/core/Lights/pointLight'
import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { TrailMesh } from '@babylonjs/core/Meshes/trailMesh'
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem'
import type { Scene } from '@babylonjs/core/scene'
import type { PhysicsBody } from '../core/physics-api'
import type { Vec3Like } from '../core/vec3-scalar'
import { BallType, GameConfig } from '../config'
import { getCampaignRewardsManager } from '../adventure/campaign-rewards-manager'
import { getSoundSystem } from '../audio/sound-system'
import { getMaterialLibrary } from '../materials'
import { getSharedUnlitMaterial } from '../materials/material-basic'
import { TrailMaterialPool } from '../materials/material-trail'
import type { BallView, BallVisualSpec } from './ball-manager-context'
import type { PhysicsBinding } from './types'
import { QualityTier, color, emissive, INTENSITY, PALETTE, pulse } from './visual-language'

export interface BallTrailData {
  mesh: TrailMesh
  material: StandardMaterial
  baseWidth: number
  isFading: boolean
}

export interface BallMaterialLibrary {
  qualityTier: QualityTier
  getEnhancedChromeBallMaterial(): PBRMaterial
  getExtraBallMaterial(): PBRMaterial
  getGoldPlatedBallMaterial(): PBRMaterial
  getSolidGoldBallMaterial(): PBRMaterial
  updateBallMaterialColor(material: PBRMaterial, mapColorHex: string): void
}

/** What the presentation reads back from the sim: the main ball and each ball's tier. */
export interface BallPresentationSim {
  readonly ballBody: PhysicsBody | null
  getBallType(body: PhysicsBody): BallType
  hasBallData(body: PhysicsBody): boolean
}

// Speed-tint endpoints for updateTrailEffects, parsed once instead of per trail per frame.
const TRAIL_SLOW_COLOR: Readonly<Color3> = Color3.FromHexString('#00ffff')
const TRAIL_FAST_COLOR: Readonly<Color3> = Color3.FromHexString('#ff00ff')
const TRAIL_FADE_COLOR: Readonly<Color3> = Color3.Black()

/** Ribbon width multiplier for a ball moving at `speed` (1× at rest, 2× from 30 u/s up). */
export function trailWidthMultiplier(speed: number): number {
  return 1.0 + Math.min(speed / 30, 1.0)
}

/** The trail state `updateTrailEffects` walks (a `BallPresentation`, or a test double). */
export interface TrailEffectsHost {
  ballTrails: Map<PhysicsBody, BallTrailData>
}

/**
 * Per-frame trail update: widen with speed, tint cyan → magenta, or fade out when caught.
 * Allocation-free: colours lerp into each material's own `emissiveColor`.
 */
export function updateTrailEffects(host: TrailEffectsHost): void {
  for (const [body, trailData] of host.ballTrails) {
    const vel = body.linvel()
    const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z)
    const material = trailData.material

    if (trailData.isFading) {
      // Fade trail when ball is hologram-caught
      material.alpha = Math.max(0, material.alpha - 0.05)
      Color3.LerpToRef(material.emissiveColor, TRAIL_FADE_COLOR, 0.1, material.emissiveColor)
    } else {
      // TrailMesh's ribbon width is `diameter` (read every frame when it extends the ribbon).
      trailData.mesh.diameter = trailData.baseWidth * trailWidthMultiplier(speed)

      // Color shifts cyan -> magenta with speed
      const t = Math.min(speed / 40, 1.0)
      Color3.LerpToRef(TRAIL_SLOW_COLOR, TRAIL_FAST_COLOR, t, material.emissiveColor)
    }
  }
}

export class BallPresentation implements BallView, TrailEffectsHost {
  readonly matLib: BallMaterialLibrary
  readonly trails: Map<PhysicsBody, TrailMesh> = new Map()
  readonly trailMaterials: Map<TrailMesh, StandardMaterial> = new Map()
  /** Recycles the per-ball trail materials: a ball's trail takes one, its removal hands it back (#524). */
  readonly trailMaterialPool: TrailMaterialPool
  readonly ballTrails: Map<PhysicsBody, BallTrailData> = new Map()
  private glowTime = 0
  private sim: BallPresentationSim | null = null

  constructor(
    readonly scene: Scene,
    /** Shared with `GameObjects` (mesh interpolation walks one list). */
    readonly bindings: PhysicsBinding[],
  ) {
    this.matLib = getMaterialLibrary(scene)
    this.trailMaterialPool = new TrailMaterialPool(scene)
  }

  /** The ball manager this view draws (set once by `BallManager`'s constructor). */
  attach(sim: BallPresentationSim): void {
    this.sim = sim
  }

  // ---- BallView ---------------------------------------------------------

  spawned(body: PhysicsBody, spec: BallVisualSpec): void {
    switch (spec.kind) {
      case 'main':
        this.createMainBallVisual(body, spec.position)
        return
      case 'extra':
        this.createExtraBallVisual(body, spec.index, spec.position)
        return
      case 'reset': {
        const b = MeshBuilder.CreateSphere('ball', { diameter: GameConfig.ball.radius * 2, segments: 32 }, this.scene)
        b.material = this.matLib.getEnhancedChromeBallMaterial()
        this.bindings.push({ mesh: b, rigidBody: body })
        return
      }
      case 'typed': {
        const ball = MeshBuilder.CreateSphere(`ball_${spec.type}`, {
          diameter: GameConfig.ball.radius * 2,
          segments: 32,
          slice: 1,
        }, this.scene)
        ball.material = this.getMaterialForType(spec.type)
        this.bindings.push({ mesh: ball, rigidBody: body })
        this.addTrailForBall(body, spec.trailColor)
        return
      }
      case 'swarm': {
        const goldBall = MeshBuilder.CreateSphere(`smallGoldBall_${spec.type}_${spec.index}`, {
          diameter: spec.radius * 2,
          segments: 24,
          slice: 1,
        }, this.scene)
        // Use bright gold material with strong emissive
        goldBall.material = this.matLib.getSolidGoldBallMaterial()
        this.bindings.push({ mesh: goldBall, rigidBody: body })
        // Bright gold trail
        this.addTrailForBall(body, '#ffdd00')
        return
      }
    }
  }

  removed(body: PhysicsBody): void {
    const bIdx = this.bindings.findIndex((b) => b.rigidBody === body)
    const binding = this.bindings[bIdx]
    if (binding) {
      binding.mesh.dispose()
      this.bindings.splice(bIdx, 1)
    }
    this.disposeTrail(body)
  }

  removedExtras(keep: PhysicsBody | null): void {
    for (let i = this.bindings.length - 1; i >= 0; i--) {
      const b = this.bindings[i]
      if (!b || !b.mesh.name.startsWith('ball')) continue
      if (b.rigidBody === keep) continue
      b.mesh.dispose()
      this.bindings.splice(i, 1)
    }
  }

  /** Dispose a ball's ribbon trail and hand its material back to the pool. */
  disposeTrail(body: PhysicsBody): void {
    const trail = this.trails.get(body)
    if (trail) {
      const material = this.trailMaterials.get(trail)
      this.trailMaterials.delete(trail)
      trail.dispose()
      this.trails.delete(body)
      if (material) this.trailMaterialPool.release(material)
    }
    this.ballTrails.delete(body)
  }

  caught(body: PhysicsBody): void {
    const mesh = this.bindings.find((b) => b.rigidBody === body)?.mesh as Mesh
    if (mesh && mesh.material) {
      // PBRMaterial also has emissiveColor
      (mesh.material as PBRMaterial).emissiveColor = new Color3(1, 0, 0)
    }
    // Mark trail for fade effect
    const trailData = this.ballTrails.get(body)
    if (trailData) {
      trailData.isFading = true
    }
  }

  released(body: PhysicsBody): void {
    const mesh = this.bindings.find((b) => b.rigidBody === body)?.mesh as Mesh
    if (mesh && mesh.material) {
      (mesh.material as PBRMaterial).emissiveColor = new Color3(0.2, 0.2, 0.2)
    }
    // Reset trail fade state
    const trailData = this.ballTrails.get(body)
    if (trailData) {
      trailData.isFading = false
      trailData.material.alpha = 1.0
    }
  }

  spawnEffect(position: Vec3Like, type: BallType, swarmBurst: boolean): void {
    this.playSpawnEffect(new Vector3(position.x, position.y, position.z), type, swarmBurst)
  }

  goldBallSpawned(type: BallType): void {
    getSoundSystem().playGoldBallSpawn(type)
  }

  applyCampaignRewards(): void {
    const campaignRewards = getCampaignRewardsManager()
    const equippedBallSkin = campaignRewards?.getEquippedReward('ball-skin')
    if (equippedBallSkin) {
      this.applyBallSkin(equippedBallSkin.cosmeticId)
    }
  }

  // ---- Per-frame and cosmetic API (BallManager forwards these) ----------

  updateTrailEffects(): void {
    updateTrailEffects(this)
  }

  /**
   * Update gentle pulsing emissive glow on gold ball materials.
   * Called once per frame from the game loop.
   */
  updateGoldBallGlow(dt: number): void {
    this.glowTime += dt
    const goldPlated = this.matLib.getGoldPlatedBallMaterial()
    const solidGold = this.matLib.getSolidGoldBallMaterial()
    // Gentle slow pulse: 0.5 Hz = 2-second period
    goldPlated.emissiveIntensity = pulse(this.glowTime, 0.5, 0.15, 0.35)
    // Slightly slower and stronger for solid gold
    solidGold.emissiveIntensity = pulse(this.glowTime, 0.4, 0.25, 0.55)
  }

  /**
   * Update ball material with map-reactive color.
   * Called when switching table maps.
   */
  updateBallMaterialColor(mapColorHex: string): void {
    const mainBallBinding = this.bindings.find((b) => b.mesh.name === 'ball')
    if (mainBallBinding) {
      const ballMesh = mainBallBinding.mesh
      if (ballMesh instanceof Mesh && ballMesh.material) {
        this.matLib.updateBallMaterialColor(
          ballMesh.material as PBRMaterial,
          mapColorHex,
        )
      }

      // Update inner core glow color
      const coreMesh = ballMesh.getChildren().find((c) => c.name === 'ballCore') as Mesh | undefined
      if (coreMesh && coreMesh.material) {
        const coreMat = coreMesh.material as PBRMaterial
        coreMat.emissiveColor = Color3.FromHexString(mapColorHex).scale(0.25)
        if (coreMat.subSurface.isRefractionEnabled) {
          coreMat.subSurface.tintColor = Color3.FromHexString(mapColorHex)
        }
      }

      // Update ball point light color
      const ballLight = ballMesh.getChildren().find((c) => c.name === 'ballLight') as PointLight | undefined
      if (ballLight) {
        ballLight.diffuse = Color3.FromHexString(mapColorHex)
      }
    }

    // Also update trail color. Each material gets its own copy: updateTrailEffects lerps into
    // `emissiveColor` in place, so a shared instance would make every trail follow the last one.
    const mapColor = Color3.FromHexString(mapColorHex)
    for (const trailMat of this.trailMaterials.values()) {
      trailMat.emissiveColor = mapColor.clone()
    }
  }

  /**
   * Apply equipped reward skin to the main ball.
   */
  applyBallSkin(skinId: string): void {
    const binding = this.bindings.find((b) => b.mesh.name === 'ball')
    if (!binding) return

    const ball = binding.mesh as Mesh
    const core = ball.getChildren().find((c) => c.name === 'ballCore') as Mesh

    switch (skinId) {
      case 'quantum-skin':
      case 'ball-skin-prism':
        if (ball.material) {
          const pbrMat = ball.material as PBRMaterial
          pbrMat.albedoColor = color(PALETTE.AMBIENT)
          pbrMat.emissiveColor = emissive(PALETTE.PURPLE, INTENSITY.NORMAL)
          pbrMat.emissiveIntensity = this.matLib.qualityTier === QualityTier.HIGH ? 1.1 : 0.8
          if (this.matLib.qualityTier === QualityTier.HIGH) {
            pbrMat.iridescence.isEnabled = true
            pbrMat.iridescence.intensity = 0.35
          }
        }
        if (core?.material) {
          const coreMat = core.material as PBRMaterial
          coreMat.emissiveColor = emissive(PALETTE.MAGENTA, INTENSITY.ACTIVE)
          coreMat.emissiveIntensity = this.matLib.qualityTier === QualityTier.HIGH ? 1.3 : 1.0
        }
        break
      case 'ball-skin-cascade':
        if (ball.material) {
          const pbrMat = ball.material as PBRMaterial
          pbrMat.albedoColor = color(PALETTE.WHITE)
          pbrMat.emissiveColor = emissive(PALETTE.CYAN, INTENSITY.NORMAL)
          pbrMat.emissiveIntensity = 0.85
          pbrMat.clearCoat.isEnabled = true
          pbrMat.clearCoat.intensity = 0.6
          pbrMat.clearCoat.roughness = 0.12
        }
        if (core?.material) {
          const coreMat = core.material as PBRMaterial
          coreMat.emissiveColor = emissive(PALETTE.CYAN, INTENSITY.ACTIVE)
          coreMat.emissiveIntensity = 0.9
        }
        break
      case 'ball-skin-aurum':
        if (ball.material) {
          const pbrMat = ball.material as PBRMaterial
          pbrMat.albedoColor = color(PALETTE.GOLD)
          pbrMat.emissiveColor = emissive(PALETTE.GOLD, INTENSITY.NORMAL)
          pbrMat.emissiveIntensity = 0.95
          pbrMat.clearCoat.isEnabled = true
          pbrMat.clearCoat.intensity = 0.8
          pbrMat.clearCoat.roughness = 0.08
        }
        if (core?.material) {
          const coreMat = core.material as PBRMaterial
          coreMat.emissiveColor = emissive(PALETTE.GOLD, INTENSITY.HIGH)
          coreMat.emissiveIntensity = 0.8
        }
        break
      default:
        break
    }
  }

  /**
   * Apply equipped reward trail to the main ball.
   */
  applyBallTrail(trailId: string): void {
    const main = this.sim?.ballBody ?? null
    const trailData = main ? this.ballTrails.get(main) : null
    if (!trailData) return

    switch (trailId) {
      case 'neon-trail':
        trailData.material.emissiveColor = Color3.FromHexString('#00FFFF')
        trailData.baseWidth = GameConfig.ball.radius * 0.6
        break
      case 'singularity-trail':
        trailData.material.emissiveColor = new Color3(1, 0, 1)
        trailData.baseWidth = GameConfig.ball.radius * 0.7
        break
      default:
        trailData.material.emissiveColor = Color3.FromHexString('#00FFFF')
        break
    }
  }

  /**
   * Clear all applied rewards (reset to default).
   */
  clearRewards(): void {
    const binding = this.bindings.find((b) => b.mesh.name === 'ball')
    if (binding) {
      const mesh = binding.mesh as Mesh
      mesh.material = this.matLib.getEnhancedChromeBallMaterial()
    }

    const main = this.sim?.ballBody ?? null
    const trailData = main ? this.ballTrails.get(main) : null
    if (trailData) {
      trailData.material.emissiveColor = Color3.FromHexString('#00FFFF')
      trailData.baseWidth = GameConfig.ball.radius * 0.6
    }
  }

  playSpawnEffect(position: Vector3, type: BallType, swarmBurst = false): void {
    if (type === BallType.STANDARD) return

    const isSolidGold = type === BallType.SOLID_GOLD

    // Create particle system for spawn burst
    const particleSystem = new ParticleSystem(
      `spawnEffect_${type}_${Date.now()}`,
      swarmBurst ? (isSolidGold ? 90 : 60) : (isSolidGold ? 50 : 20),
      this.scene,
    )

    // Particle texture
    particleSystem.particleTexture = this.createParticleTexture(isSolidGold ? '#ffb700' : '#ffd700')

    // Emitter position
    particleSystem.emitter = position

    // Particle colors
    if (isSolidGold) {
      particleSystem.color1 = new Color4(1, 0.76, 0.15, 1) // Rich gold
      particleSystem.color2 = new Color4(1, 0.9, 0.4, 1) // Lighter gold
      particleSystem.colorDead = new Color4(1, 0.7, 0, 0) // Fade to transparent
    } else {
      particleSystem.color1 = new Color4(0.95, 0.87, 0.65, 1) // Light gold
      particleSystem.color2 = new Color4(1, 0.95, 0.8, 1) // Even lighter
      particleSystem.colorDead = new Color4(0.9, 0.8, 0.5, 0) // Fade out
    }

    // Size
    particleSystem.minSize = 0.05
    particleSystem.maxSize = isSolidGold ? 0.2 : 0.1

    // Lifetime
    particleSystem.minLifeTime = 0.3
    particleSystem.maxLifeTime = isSolidGold ? 1.0 : 0.6

    // Emission
    particleSystem.emitRate = isSolidGold ? 100 : 50
    particleSystem.targetStopDuration = isSolidGold ? 0.3 : 0.2

    // Direction and speed
    particleSystem.direction1 = new Vector3(-1, 1, -1)
    particleSystem.direction2 = new Vector3(1, 1, 1)
    particleSystem.minEmitPower = swarmBurst ? 2 : 1
    particleSystem.maxEmitPower = swarmBurst
      ? (isSolidGold ? 8 : 6)
      : (isSolidGold ? 5 : 3)
    particleSystem.updateSpeed = 0.02

    // Gravity
    particleSystem.gravity = new Vector3(0, -2, 0)

    // Start and auto-cleanup: `targetStopDuration` (set above) stops emission after the burst and
    // `disposeOnStop` has the scene dispose the system once its last particle dies. Babylon owns
    // the lifetime, so nothing fires after scene.dispose() (the old raw timeouts double-disposed).
    particleSystem.disposeOnStop = true
    particleSystem.start()
  }

  getBallMeshesByType(type: BallType): Mesh[] {
    const result: Mesh[] = []
    for (const binding of this.bindings) {
      if (!this.sim?.hasBallData(binding.rigidBody)) continue
      if (this.sim.getBallType(binding.rigidBody) === type) {
        result.push(binding.mesh as Mesh)
      }
    }
    return result
  }

  addTrailForBall(body: PhysicsBody, colorHex: string): void {
    const binding = this.bindings.find((b) => b.rigidBody === body)
    if (!binding) return

    const trailWidth = GameConfig.ball.radius * 0.6
    const trail = new TrailMesh(`trail_${body.handle}`, binding.mesh, this.scene, trailWidth, 20, true)
    const trailMat = this.trailMaterialPool.acquire(Color3.FromHexString(colorHex))
    trail.material = trailMat

    this.trails.set(body, trail)
    this.trailMaterials.set(trail, trailMat)
    this.ballTrails.set(body, {
      mesh: trail,
      material: trailMat,
      baseWidth: trailWidth,
      isFading: false,
    })
  }

  // ---- Builders ---------------------------------------------------------

  private createMainBallVisual(ballBody: PhysicsBody, spawn: Vec3Like): void {
    // Enhanced ball: high-poly sphere with bevel ring and map-reactive material
    const diameter = GameConfig.ball.radius * 2

    // High-segment sphere for smooth highlights
    const ball = MeshBuilder.CreateSphere('ball', {
      diameter,
      segments: 32, // High poly for smooth bevel highlights
      slice: 1, // Full sphere
    }, this.scene)

    // Enhanced chrome ball material with map-reactive glow
    const ballMat = this.matLib.getEnhancedChromeBallMaterial()
    ball.material = ballMat

    // Subtle bevel highlight: inner core sphere for layered glass/metallic look
    const ballCore = MeshBuilder.CreateSphere('ballCore', { diameter: diameter * 0.65, segments: 16 }, this.scene)
    ballCore.parent = ball
    ballCore.material = this.matLib.getEnhancedChromeBallMaterial()
    if (ballCore.material) {
      const coreMat = ballCore.material as PBRMaterial
      coreMat.emissiveColor = Color3.FromHexString('#00d9ff').scale(0.25)
      coreMat.emissiveIntensity = 0.5
      coreMat.alpha = 0.85
    }

    // Thin equatorial ring for premium highlight detail
    const ballRing = MeshBuilder.CreateTorus('ballRing', { diameter: diameter * 0.85, thickness: 0.015, tessellation: 32 }, this.scene)
    ballRing.parent = ball
    ballRing.rotation.x = Math.PI / 2
    // Every ball's ring is the same white unlit material and nothing writes it: one per scene.
    ballRing.material = getSharedUnlitMaterial(this.scene, 'ballRingMat', { emissive: Color3.White() })

    // Position mesh at spawn point immediately so it is visible before physics syncs
    ball.position.set(spawn.x, spawn.y, spawn.z)

    this.bindings.push({ mesh: ball, rigidBody: ballBody })

    // Add subtle point light for ball visibility (disabled in reduced motion mode)
    if (!GameConfig.camera.reducedMotion) {
      const ballLight = new PointLight('ballLight', Vector3.Zero(), this.scene)
      ballLight.parent = ball
      ballLight.diffuse = Color3.FromHexString('#00ffff')
      ballLight.intensity = 0.3
      ballLight.range = 5
    }

    const trailWidth = GameConfig.ball.radius * 0.6
    const trail = new TrailMesh('ballTrail', ball, this.scene, trailWidth, 20, true)
    const trailMat = this.trailMaterialPool.acquire(Color3.FromHexString('#00ffff'))
    trail.material = trailMat

    // Store for velocity-based updates
    this.trails.set(ballBody, trail)
    this.trailMaterials.set(trail, trailMat)
    this.ballTrails.set(ballBody, {
      mesh: trail,
      material: trailMat,
      baseWidth: trailWidth,
      isFading: false,
    })
  }

  private createExtraBallVisual(body: PhysicsBody, i: number, at: Vec3Like): void {
    const b = MeshBuilder.CreateSphere('xb', { diameter: GameConfig.ball.radius * 2, segments: 32 }, this.scene)
    b.position.set(at.x, at.y, at.z)
    b.material = this.matLib.getExtraBallMaterial()

    this.bindings.push({ mesh: b, rigidBody: body })

    // Add velocity-based trail for extra balls
    const trailWidth = GameConfig.ball.radius * 0.4
    const trail = new TrailMesh(`trail_${i}`, b, this.scene, trailWidth, 15, true)
    const trailMat = this.trailMaterialPool.acquire(Color3.FromHexString('#00ffff'))
    trail.material = trailMat
    this.trails.set(body, trail)
    this.trailMaterials.set(trail, trailMat)
    this.ballTrails.set(body, {
      mesh: trail,
      material: trailMat,
      baseWidth: trailWidth,
      isFading: false,
    })
  }

  private getMaterialForType(type: BallType): PBRMaterial {
    switch (type) {
      case BallType.GOLD_PLATED:
        return this.matLib.getGoldPlatedBallMaterial()
      case BallType.SOLID_GOLD:
        return this.matLib.getSolidGoldBallMaterial()
      default:
        return this.matLib.getEnhancedChromeBallMaterial()
    }
  }

  /**
   * Create a simple circular particle texture.
   */
  private createParticleTexture(colorHex: string): Texture {
    const size = 64
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')!

    // Draw circle
    ctx.beginPath()
    ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2)
    ctx.fillStyle = colorHex
    ctx.fill()

    // Add glow
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    gradient.addColorStop(0, colorHex)
    gradient.addColorStop(0.5, colorHex + '80')
    gradient.addColorStop(1, colorHex + '00')
    ctx.fillStyle = gradient
    ctx.fill()

    return new Texture(canvas.toDataURL(), this.scene)
  }
}
