import {
  MeshBuilder,
  Vector3,
  Scene,
  StandardMaterial,
  PBRMaterial,
  Color3,
  Color4,
  TrailMesh,
  PointLight,
  Mesh,
  ParticleSystem,
  Texture,
} from '@babylonjs/core'
import type { MirrorTexture } from '@babylonjs/core'
import type * as RAPIER from '@dimforge/rapier3d-compat'
import { GameConfig, BallType, BALL_TIERS } from '../config'
import type { PhysicsBinding, BallData } from './types'
import { getMaterialLibrary } from '../materials'
import { getSoundSystem } from './sound-system'



export class BallManager {
  private scene: Scene
  private world: RAPIER.World
  private rapier: typeof RAPIER
  private ballBody: RAPIER.RigidBody | null = null
  private ballBodies: RAPIER.RigidBody[] = []
  private caughtBalls: Array<{ body: RAPIER.RigidBody; targetPos: Vector3; timer: number }> = []
  // Note: CaughtBall type from './types' has the same shape
  private mirrorTexture: MirrorTexture | null = null
  private bindings: PhysicsBinding[] = []
  private matLib: ReturnType<typeof getMaterialLibrary>
  private trails: Map<RAPIER.RigidBody, TrailMesh> = new Map()
  private trailMaterials: Map<TrailMesh, StandardMaterial> = new Map()
  private ballTrails: Map<
    RAPIER.RigidBody,
    { mesh: TrailMesh; material: StandardMaterial; baseWidth: number; isFading: boolean }
  > = new Map()
  private ballDataMap: Map<RAPIER.RigidBody, BallData> = new Map()
  private goldBallCount = 0
  private onGoldBallCollected?: (type: BallType, points: number) => void

  /** Track ball positions for stuck detection */
  private ballStuckTimers: Map<RAPIER.RigidBody, { lastPos: { x: number; y: number; z: number }; stuckTime: number }> = new Map()
  /** Threshold: if ball moves less than this per second, it may be stuck */
  private static readonly STUCK_VELOCITY_THRESHOLD = 0.1
  /** Time before a stuck ball is auto-reset */
  private static readonly STUCK_TIMEOUT = 5.0

  constructor(scene: Scene, world: RAPIER.World, rapier: typeof RAPIER, bindings: PhysicsBinding[]) {
    this.scene = scene
    this.world = world
    this.rapier = rapier
    this.bindings = bindings
    this.matLib = getMaterialLibrary(scene)
  }

  setMirrorTexture(texture: MirrorTexture): void {
    this.mirrorTexture = texture
  }

  getBindings(): PhysicsBinding[] {
    return this.bindings
  }

  /**
   * Helper to calculate density required to achieve target mass for a given radius.
   * Volume = (4/3) * pi * r^3
   * Density = Mass / Volume
   */
  private getDensityForMass(mass: number, radius: number): number {
    const volume = (4 / 3) * Math.PI * Math.pow(radius, 3)
    return mass / volume
  }

  createMainBall(): RAPIER.RigidBody {
    // Enhanced ball: high-poly sphere with bevel ring and map-reactive material
    const diameter = GameConfig.ball.radius * 2
    
    // High-segment sphere for smooth highlights
    const ball = MeshBuilder.CreateSphere('ball', { 
      diameter: diameter,
      segments: 32,  // High poly for smooth bevel highlights
      slice: 1       // Full sphere
    }, this.scene) as Mesh
    
    // Enhanced chrome ball material with map-reactive glow
    const ballMat = this.matLib.getEnhancedChromeBallMaterial()
    ball.material = ballMat

    // Subtle bevel highlight: inner core sphere for layered glass/metallic look
    const ballCore = MeshBuilder.CreateSphere('ballCore', { diameter: diameter * 0.65, segments: 16 }, this.scene) as Mesh
    ballCore.parent = ball
    ballCore.material = this.matLib.getEnhancedChromeBallMaterial()
    if (ballCore.material) {
      const coreMat = ballCore.material as PBRMaterial
      coreMat.emissiveColor = Color3.FromHexString('#00d9ff').scale(0.25)
      coreMat.emissiveIntensity = 0.5
      coreMat.alpha = 0.85
    }

    // Thin equatorial ring for premium highlight detail
    const ballRing = MeshBuilder.CreateTorus('ballRing', { diameter: diameter * 0.85, thickness: 0.015, tessellation: 32 }, this.scene) as Mesh
    ballRing.parent = ball
    ballRing.rotation.x = Math.PI / 2
    const ringMat = new StandardMaterial('ballRingMat', this.scene)
    ringMat.emissiveColor = Color3.White()
    ringMat.disableLighting = true
    ballRing.material = ringMat
    
    // Use Config for Spawn Point (Plain Objects -> Vector3 implicitly handled by rapier setTranslation usually takes x,y,z args, or we pass individual components)
    const spawn = GameConfig.ball.spawnMain

    const ballBody = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.dynamic()
        .setTranslation(spawn.x, spawn.y, spawn.z)
        .setCcdEnabled(true)
        .setCanSleep(true)        // Ball sleep: idle balls cost ~0 CPU
        .setLinearDamping(GameConfig.ball.linearDamping)   // Natural roll decay
        .setAngularDamping(GameConfig.ball.angularDamping) // Spin decay
    )

    const density = this.getDensityForMass(GameConfig.ball.mass, GameConfig.ball.radius)

    this.world.createCollider(
      this.rapier.ColliderDesc.ball(GameConfig.ball.radius)
        .setRestitution(GameConfig.ball.restitution)
        .setFriction(GameConfig.ball.friction)
        .setDensity(density)
        .setActiveEvents(
          this.rapier.ActiveEvents.COLLISION_EVENTS |
          this.rapier.ActiveEvents.CONTACT_FORCE_EVENTS
        ),
      ballBody
    )

    this.bindings.push({ mesh: ball, rigidBody: ballBody })
    this.ballBody = ballBody
    this.ballBodies.push(ballBody)
    
    if (this.mirrorTexture?.renderList) {
      this.mirrorTexture.renderList.push(ball)
    }

    // Add subtle point light for ball visibility (disabled in reduced motion mode)
    if (!GameConfig.camera.reducedMotion) {
      const ballLight = new PointLight("ballLight", Vector3.Zero(), this.scene)
      ballLight.parent = ball
      ballLight.diffuse = Color3.FromHexString("#00ffff")
      ballLight.intensity = 0.3
      ballLight.range = 5
    }

    const trailWidth = GameConfig.ball.radius * 0.6
    const trail = new TrailMesh("ballTrail", ball, this.scene, trailWidth, 20, true)
    const trailMat = new StandardMaterial("trailMat", this.scene)
    trailMat.emissiveColor = Color3.FromHexString("#00ffff")
    trail.material = trailMat

    // Store for velocity-based updates
    if (this.ballBody) {
      this.trails.set(this.ballBody, trail)
      this.trailMaterials.set(trail, trailMat)
      this.ballTrails.set(this.ballBody, {
        mesh: trail,
        material: trailMat,
        baseWidth: trailWidth,
        isFading: false,
      })
    }

    return ballBody
  }

  spawnExtraBalls(count: number, position?: Vector3): void {
    const spawn = position ? { x: position.x, y: position.y, z: position.z } : GameConfig.ball.spawnPachinko
    const density = this.getDensityForMass(GameConfig.ball.mass, GameConfig.ball.radius)

    for (let i = 0; i < count; i++) {
      const b = MeshBuilder.CreateSphere("xb", { diameter: GameConfig.ball.radius * 2 }, this.scene) as Mesh
      // Offset slightly to avoid stacking
      b.position.set(spawn.x + (Math.random() - 0.5), spawn.y + (i * 2), spawn.z)
      
      b.material = this.matLib.getExtraBallMaterial()

      const body = this.world.createRigidBody(
        this.rapier.RigidBodyDesc.dynamic()
          .setTranslation(b.position.x, b.position.y, b.position.z)
          .setCcdEnabled(true)
          .setCanSleep(true)
          .setLinearDamping(GameConfig.ball.linearDamping)
          .setAngularDamping(GameConfig.ball.angularDamping)
      )

      this.world.createCollider(
        this.rapier.ColliderDesc.ball(GameConfig.ball.radius)
          .setRestitution(GameConfig.ball.restitution)
          .setFriction(GameConfig.ball.friction)
          .setDensity(density)
          .setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS),
        body
      )

      this.bindings.push({ mesh: b, rigidBody: body })
      this.ballBodies.push(body)
      
      if (this.mirrorTexture?.renderList) {
        this.mirrorTexture.renderList.push(b)
      }

      // Add velocity-based trail for extra balls
      const trailWidth = GameConfig.ball.radius * 0.4
      const trail = new TrailMesh(`trail_${i}`, b, this.scene, trailWidth, 15, true)
      const trailMat = new StandardMaterial(`trailMat_${i}`, this.scene)
      trailMat.emissiveColor = Color3.FromHexString("#00ffff")
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
  }

  resetBall(): void {
    const density = this.getDensityForMass(GameConfig.ball.mass, GameConfig.ball.radius)

    if (this.ballBodies.length === 0) {
      const mat = this.matLib.getChromeBallMaterial()
      
      const b = MeshBuilder.CreateSphere("ball", { diameter: GameConfig.ball.radius * 2 }, this.scene) as Mesh
      b.material = mat
      
      const spawn = GameConfig.ball.spawnMain
      const body = this.world.createRigidBody(
        this.rapier.RigidBodyDesc.dynamic()
          .setTranslation(spawn.x, spawn.y, spawn.z)
          .setCcdEnabled(true)
      )
      
      this.world.createCollider(
        this.rapier.ColliderDesc.ball(GameConfig.ball.radius)
          .setRestitution(GameConfig.ball.restitution)
          .setFriction(GameConfig.ball.friction)
          .setDensity(density)
          .setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS),
        body
      )

      this.ballBody = body
      this.ballBodies.push(body)
      this.bindings.push({ mesh: b, rigidBody: body })
      
      if (this.mirrorTexture?.renderList) {
        this.mirrorTexture.renderList.push(b)
      }
    } else {
      const spawn = GameConfig.ball.spawnMain
      this.ballBody!.setTranslation(new this.rapier.Vector3(spawn.x, spawn.y, spawn.z), true)
      this.ballBody!.setLinvel(new this.rapier.Vector3(0, 0, 0), true)
      this.ballBody!.setAngvel(new this.rapier.Vector3(0, 0, 0), true)
    }
  }

  removeBall(body: RAPIER.RigidBody): void {
    // Clean up ball data
    this.ballDataMap.delete(body)
    
    const idx = this.ballBodies.indexOf(body)
    if (idx !== -1) {
      this.world.removeRigidBody(body)
      this.ballBodies.splice(idx, 1)

      const bIdx = this.bindings.findIndex(b => b.rigidBody === body)
      if (bIdx !== -1) {
        this.bindings[bIdx].mesh.dispose()
        this.bindings.splice(bIdx, 1)
      }

      // Clean up trail data
      const trail = this.trails.get(body)
      if (trail) {
        this.trailMaterials.delete(trail)
        trail.dispose()
        this.trails.delete(body)
      }
      this.ballTrails.delete(body)
    }
  }

  removeExtraBalls(): void {
    for (let i = this.ballBodies.length - 1; i >= 0; i--) {
      const rb = this.ballBodies[i]
      if (rb !== this.ballBody) {
        this.world.removeRigidBody(rb)
        this.ballBodies.splice(i, 1)
      }
    }
    
    this.bindings = this.bindings.filter(b => {
      if (!b.mesh.name.startsWith('ball')) return true
      if (b.rigidBody === this.ballBody) return true
      b.mesh.dispose()
      return false
    })
  }

  activateHologramCatch(ball: RAPIER.RigidBody, targetPos: Vector3, duration: number): void {
    ball.setBodyType(this.rapier.RigidBodyType.KinematicPositionBased, true)
    this.caughtBalls.push({ body: ball, targetPos: targetPos.clone(), timer: duration })

    const mesh = this.bindings.find(b => b.rigidBody === ball)?.mesh as Mesh
    if (mesh && mesh.material) {
      // PBRMaterial also has emissiveColor
      (mesh.material as PBRMaterial).emissiveColor = new Color3(1, 0, 0)
    }

    // Mark trail for fade effect
    const trailData = this.ballTrails.get(ball)
    if (trailData) {
      trailData.isFading = true
    }
  }

  updateCaughtBalls(dt: number, onRelease: (ball: RAPIER.RigidBody) => void): void {
    for (let i = this.caughtBalls.length - 1; i >= 0; i--) {
      const catchData = this.caughtBalls[i]
      catchData.timer -= dt

      const current = catchData.body.translation()
      const target = catchData.targetPos
      // Improved kinematic following: exponential decay for frame-rate independence
      const lerpFactor = 1 - Math.exp(-5 * dt)
      const nextX = current.x + (target.x - current.x) * lerpFactor
      const nextY = current.y + (target.y - current.y) * lerpFactor
      const nextZ = current.z + (target.z - current.z) * lerpFactor
      catchData.body.setNextKinematicTranslation({ x: nextX, y: nextY, z: nextZ })

      if (catchData.timer <= 0) {
        catchData.body.setBodyType(this.rapier.RigidBodyType.Dynamic, true)

        const mesh = this.bindings.find(b => b.rigidBody === catchData.body)?.mesh as Mesh
        if (mesh && mesh.material) {
          (mesh.material as PBRMaterial).emissiveColor = new Color3(0.2, 0.2, 0.2)
        }

        // Reset trail fade state
        const trailData = this.ballTrails.get(catchData.body)
        if (trailData) {
          trailData.isFading = false
          trailData.material.alpha = 1.0
        }

        catchData.body.applyImpulse({ x: (Math.random() - 0.5) * 5, y: 5, z: 5 }, true)
        onRelease(catchData.body)
        this.caughtBalls.splice(i, 1)
      }
    }
  }

  getBallBody(): RAPIER.RigidBody | null {
    return this.ballBody
  }

  getBallBodies(): RAPIER.RigidBody[] {
    return this.ballBodies
  }

  setBallBody(body: RAPIER.RigidBody | null): void {
    this.ballBody = body
  }

  hasBalls(): boolean {
    return this.ballBodies.length > 0
  }

  /**
   * Update ball material with map-reactive color
   * Called when switching table maps
   */
  updateBallMaterialColor(mapColorHex: string): void {
    const mainBallBinding = this.bindings.find(b => b.mesh.name === 'ball')
    if (mainBallBinding) {
      const ballMesh = mainBallBinding.mesh
      if (ballMesh instanceof Mesh && ballMesh.material) {
        this.matLib.updateBallMaterialColor(
          ballMesh.material as PBRMaterial, 
          mapColorHex
        )
      }
      
      // Update inner core glow color
      const coreMesh = ballMesh.getChildren().find(c => c.name === 'ballCore') as Mesh | undefined
      if (coreMesh && coreMesh.material) {
        const coreMat = coreMesh.material as PBRMaterial
        coreMat.emissiveColor = Color3.FromHexString(mapColorHex).scale(0.25)
        if (coreMat.subSurface.isRefractionEnabled) {
          coreMat.subSurface.tintColor = Color3.FromHexString(mapColorHex)
        }
      }
      
      // Update ball point light color
      const ballLight = ballMesh.getChildren().find(c => c.name === 'ballLight') as PointLight | undefined
      if (ballLight) {
        ballLight.diffuse = Color3.FromHexString(mapColorHex)
      }
    }
    
    // Also update trail color
    const mapColor = Color3.FromHexString(mapColorHex)
    for (const trailMat of this.trailMaterials.values()) {
      trailMat.emissiveColor = mapColor
    }
  }

  updateTrailEffects(): void {
    const cyan = Color3.FromHexString("#00ffff")
    const magenta = Color3.FromHexString("#ff00ff")

    for (const [body, trailData] of this.ballTrails) {
      const vel = body.linvel()
      const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z)

      if (trailData.isFading) {
        // Fade trail when ball is hologram-caught
        trailData.material.alpha = Math.max(0, trailData.material.alpha - 0.05)
        trailData.material.emissiveColor = Color3.Lerp(
          trailData.material.emissiveColor,
          Color3.Black(),
          0.1
        )
      } else {
        // Width widens with speed (Babylon.js TrailMesh supports width updates)
        const widthMultiplier = 1.0 + Math.min(speed / 30, 1.0)
        ;(trailData.mesh as unknown as { width: number }).width = trailData.baseWidth * widthMultiplier

        // Color shifts cyan -> magenta with speed
        const t = Math.min(speed / 40, 1.0)
        trailData.material.emissiveColor = Color3.Lerp(cyan, magenta, t)
      }
    }
  }

  /**
   * Detect stuck balls and out-of-bounds balls.
   * Stuck balls are auto-reset after STUCK_TIMEOUT seconds.
   * Out-of-bounds balls are immediately respawned.
   */
  updateStuckDetection(dt: number): RAPIER.RigidBody[] {
    const stuckBalls: RAPIER.RigidBody[] = []

    for (const body of this.ballBodies) {
      if (body.isSleeping()) continue

      const pos = body.translation()
      const vel = body.linvel()
      const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z)

      // Out-of-bounds detection: immediate reset
      if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y) || !Number.isFinite(pos.z) ||
          Math.abs(pos.x) > 50 || Math.abs(pos.y) > 50 || Math.abs(pos.z) > 50) {
        stuckBalls.push(body)
        this.ballStuckTimers.delete(body)
        continue
      }

      // Stuck detection: low velocity for extended time
      let tracker = this.ballStuckTimers.get(body)
      if (!tracker) {
        tracker = { lastPos: { x: pos.x, y: pos.y, z: pos.z }, stuckTime: 0 }
        this.ballStuckTimers.set(body, tracker)
      }

      if (speed < BallManager.STUCK_VELOCITY_THRESHOLD) {
        tracker.stuckTime += dt
        if (tracker.stuckTime >= BallManager.STUCK_TIMEOUT) {
          stuckBalls.push(body)
          tracker.stuckTime = 0
        }
      } else {
        tracker.stuckTime = 0
      }

      tracker.lastPos = { x: pos.x, y: pos.y, z: pos.z }
    }

    return stuckBalls
  }

  /**
   * Apply equipped reward skin to the main ball
   */
  applyBallSkin(skinId: string): void {
    const binding = this.bindings.find(b => b.mesh.name === 'ball')
    if (!binding) return

    const ball = binding.mesh as Mesh
    const core = ball.getChildren().find(c => c.name === 'ballCore') as Mesh

    switch (skinId) {
      case 'quantum-skin':
        if (ball.material) {
          const pbrMat = ball.material as PBRMaterial
          pbrMat.albedoColor = new Color3(0, 0, 0)
          pbrMat.emissiveColor = Color3.FromHexString('#220033')
        }
        if (core?.material) {
          (core.material as PBRMaterial).emissiveColor = Color3.FromHexString('#440066')
        }
        break
      default:
        // Keep default chrome
        break
    }
  }

  /**
   * Apply equipped reward trail to the main ball
   */
  applyBallTrail(trailId: string): void {
    const trailData = this.ballBody ? this.ballTrails.get(this.ballBody) : null
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
        // Default cyan
        trailData.material.emissiveColor = Color3.FromHexString('#00FFFF')
        break
    }
  }

  /**
   * Clear all applied rewards (reset to default)
   */
  clearRewards(): void {
    // Reset ball material to default chrome
    const binding = this.bindings.find(b => b.mesh.name === 'ball')
    if (binding) {
      const mesh = binding.mesh as Mesh
      mesh.material = this.matLib.getEnhancedChromeBallMaterial()
    }

    // Reset trail to default
    const trailData = this.ballBody ? this.ballTrails.get(this.ballBody) : null
    if (trailData) {
      trailData.material.emissiveColor = Color3.FromHexString('#00FFFF')
      trailData.baseWidth = GameConfig.ball.radius * 0.6
    }
  }

  /**
   * Play visual effect when a gold ball spawns
   */
  private playSpawnEffect(position: Vector3, type: BallType): void {
    if (type === BallType.STANDARD) return

    const isSolidGold = type === BallType.SOLID_GOLD

    // Create particle system for spawn burst
    const particleSystem = new ParticleSystem(
      `spawnEffect_${type}_${Date.now()}`,
      isSolidGold ? 50 : 20,
      this.scene
    )

    // Particle texture (use circle or create simple)
    particleSystem.particleTexture = this.createParticleTexture(isSolidGold ? '#ffb700' : '#ffd700')

    // Emitter position
    particleSystem.emitter = position

    // Particle colors
    if (isSolidGold) {
      particleSystem.color1 = new Color4(1, 0.76, 0.15, 1)   // Rich gold
      particleSystem.color2 = new Color4(1, 0.9, 0.4, 1)     // Lighter gold
      particleSystem.colorDead = new Color4(1, 0.7, 0, 0)    // Fade to transparent
    } else {
      particleSystem.color1 = new Color4(0.95, 0.87, 0.65, 1) // Light gold
      particleSystem.color2 = new Color4(1, 0.95, 0.8, 1)     // Even lighter
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
    particleSystem.minEmitPower = 1
    particleSystem.maxEmitPower = isSolidGold ? 5 : 3
    particleSystem.updateSpeed = 0.02

    // Gravity
    particleSystem.gravity = new Vector3(0, -2, 0)

    // Start and auto-cleanup
    particleSystem.start()

    // Stop emission after burst
    setTimeout(() => {
      particleSystem.stop()
      // Dispose after particles die
      setTimeout(() => {
        particleSystem.dispose()
      }, 1500)
    }, isSolidGold ? 300 : 200)
  }

  /**
   * Create a simple circular particle texture
   */
  private createParticleTexture(colorHex: string): Texture {
    const size = 64
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')!

    // Draw circle
    ctx.beginPath()
    ctx.arc(size/2, size/2, size/2 - 2, 0, Math.PI * 2)
    ctx.fillStyle = colorHex
    ctx.fill()

    // Add glow
    const gradient = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2)
    gradient.addColorStop(0, colorHex)
    gradient.addColorStop(0.5, colorHex + '80')
    gradient.addColorStop(1, colorHex + '00')
    ctx.fillStyle = gradient
    ctx.fill()

    const texture = new Texture(
      canvas.toDataURL(),
      this.scene
    )
    return texture
  }

  /**
   * Create a ball with specific type
   */
  createBallOfType(type: BallType, position?: Vector3, playEffect = false): RAPIER.RigidBody {
    const config = BALL_TIERS[type]
    const spawnPos = position || GameConfig.ball.spawnMain

    // Create mesh based on type
    const diameter = GameConfig.ball.radius * 2
    const ball = MeshBuilder.CreateSphere(`ball_${type}`, {
      diameter,
      segments: 32,
      slice: 1
    }, this.scene) as Mesh

    // Apply material based on type
    ball.material = this.getMaterialForType(type)

    // Create physics body
    const body = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.dynamic()
        .setTranslation(spawnPos.x, spawnPos.y, spawnPos.z)
        .setCcdEnabled(true)
        .setCanSleep(true)
        .setLinearDamping(GameConfig.ball.linearDamping)
        .setAngularDamping(GameConfig.ball.angularDamping)
    )

    const density = this.getDensityForMass(GameConfig.ball.mass, GameConfig.ball.radius)

    this.world.createCollider(
      this.rapier.ColliderDesc.ball(GameConfig.ball.radius)
        .setRestitution(GameConfig.ball.restitution)
        .setFriction(GameConfig.ball.friction)
        .setDensity(density)
        .setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS),
      body
    )

    // Store ball data
    const ballData: BallData = {
      type,
      spawnTime: performance.now(),
      points: config.basePoints,
      mesh: ball,
      rigidBody: body
    }

    this.ballDataMap.set(body, ballData)
    this.bindings.push({ mesh: ball, rigidBody: body })
    this.ballBodies.push(body)

    // Add trail with type-specific color
    this.addTrailForBall(body, config.trailColor)

    // Play effect if requested
    if (playEffect && type !== BallType.STANDARD) {
      const effectPos = position || GameConfig.ball.spawnMain
      this.playSpawnEffect(new Vector3(effectPos.x, effectPos.y, effectPos.z), type)
    }

    return body
  }

  /**
   * Get material for ball type
   */
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
   * Add trail for a ball with specific color
   */
  private addTrailForBall(body: RAPIER.RigidBody, colorHex: string): void {
    const binding = this.bindings.find(b => b.rigidBody === body)
    if (!binding) return

    const trailWidth = GameConfig.ball.radius * 0.6
    const trail = new TrailMesh(`trail_${body.handle}`, binding.mesh, this.scene, trailWidth, 20, true)
    const trailMat = new StandardMaterial(`trailMat_${body.handle}`, this.scene)
    trailMat.emissiveColor = Color3.FromHexString(colorHex)
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

  /**
   * Get ball type for a body
   */
  getBallType(body: RAPIER.RigidBody): BallType {
    return this.ballDataMap.get(body)?.type || BallType.STANDARD
  }

  /**
   * Get ball data for a body
   */
  getBallData(body: RAPIER.RigidBody): BallData | undefined {
    return this.ballDataMap.get(body)
  }

  /**
   * Mark a ball as collected (when it drains)
   */
  collectBall(body: RAPIER.RigidBody): { type: BallType; points: number } | null {
    const data = this.ballDataMap.get(body)
    if (!data) return null

    // Update gold ball counter
    if (data.type !== BallType.STANDARD) {
      this.goldBallCount++
    }

    // Trigger callback if registered
    this.onGoldBallCollected?.(data.type, data.points)

    return { type: data.type, points: data.points }
  }

  /**
   * Set callback for gold ball collection
   */
  setOnGoldBallCollected(callback: (type: BallType, points: number) => void): void {
    this.onGoldBallCollected = callback
  }

  /**
   * Get total gold balls collected
   */
  getGoldBallCount(): number {
    return this.goldBallCount
  }

  /**
   * Spawn a random ball with weighted probability
   */
  spawnRandomBall(position?: Vector3): RAPIER.RigidBody {
    const rand = Math.random()
    let cumulative = 0

    for (const [typeKey, config] of Object.entries(BALL_TIERS)) {
      cumulative += config.spawnWeight
      if (rand <= cumulative) {
        const type = typeKey as BallType
        const spawnPos = position || GameConfig.ball.spawnMain

        // Create the ball
        const body = this.createBallOfType(type, position)

        // Play spawn effect for gold balls
        if (type !== BallType.STANDARD) {
          this.playSpawnEffect(new Vector3(spawnPos.x, spawnPos.y, spawnPos.z), type)
          const soundSystem = getSoundSystem()
          soundSystem.playGoldBallSpawn(type)
        }

        return body
      }
    }

    return this.createMainBall()  // Fallback
  }
}
