import {
  Color3,
  Mesh,
  MeshBuilder,
  PointLight,
  StandardMaterial,
  TrailMesh,
  Vector3,
} from '@babylonjs/core'
import type { PBRMaterial } from '@babylonjs/core'
import type * as RAPIER from '@dimforge/rapier3d-compat'
import { BALL_TIERS, BallType, GameConfig } from '../config'
import { getCampaignRewardsManager } from './campaign-rewards-manager'
import {
  getDensityForMass,
  getTunedBallPhysics,
  nowMs,
  type BallManagerHost,
} from './ball-manager-context'
import { COLLISION_GROUP_PRESETS } from './physics'
import { getSoundSystem } from './sound-system'
import { QualityTier, color, emissive, INTENSITY, PALETTE } from './visual-language'

export function createMainBall(host: BallManagerHost): RAPIER.RigidBody {
  // Enhanced ball: high-poly sphere with bevel ring and map-reactive material
  const diameter = GameConfig.ball.radius * 2

  // High-segment sphere for smooth highlights
  const ball = MeshBuilder.CreateSphere('ball', {
    diameter,
    segments: 32, // High poly for smooth bevel highlights
    slice: 1, // Full sphere
  }, host.scene) as Mesh

  // Enhanced chrome ball material with map-reactive glow
  const ballMat = host.matLib.getEnhancedChromeBallMaterial()
  ball.material = ballMat

  // Subtle bevel highlight: inner core sphere for layered glass/metallic look
  const ballCore = MeshBuilder.CreateSphere('ballCore', { diameter: diameter * 0.65, segments: 16 }, host.scene) as Mesh
  ballCore.parent = ball
  ballCore.material = host.matLib.getEnhancedChromeBallMaterial()
  if (ballCore.material) {
    const coreMat = ballCore.material as PBRMaterial
    coreMat.emissiveColor = Color3.FromHexString('#00d9ff').scale(0.25)
    coreMat.emissiveIntensity = 0.5
    coreMat.alpha = 0.85
  }

  // Thin equatorial ring for premium highlight detail
  const ballRing = MeshBuilder.CreateTorus('ballRing', { diameter: diameter * 0.85, thickness: 0.015, tessellation: 32 }, host.scene) as Mesh
  ballRing.parent = ball
  ballRing.rotation.x = Math.PI / 2
  const ringMat = new StandardMaterial('ballRingMat', host.scene)
  ringMat.emissiveColor = Color3.White()
  ringMat.disableLighting = true
  ballRing.material = ringMat

  // Use Config for Spawn Point
  const spawn = GameConfig.ball.spawnMain
  const physics = getTunedBallPhysics()

  // Position mesh at spawn point immediately so it is visible before physics syncs
  ball.position.set(spawn.x, spawn.y, spawn.z)

  const ballBody = host.world.createRigidBody(
    host.rapier.RigidBodyDesc.dynamic()
      .setTranslation(spawn.x, spawn.y, spawn.z)
      .setCcdEnabled(true)
      .setCanSleep(true) // Ball sleep: idle balls cost ~0 CPU
      .setLinearDamping(physics.linearDamping)
      .setAngularDamping(physics.angularDamping),
  )

  const density = getDensityForMass(GameConfig.ball.mass, GameConfig.ball.radius)

  host.world.createCollider(
    host.rapier.ColliderDesc.ball(GameConfig.ball.radius)
      .setRestitution(physics.restitution)
      .setFriction(physics.friction)
      .setDensity(density)
      .setCollisionGroups(COLLISION_GROUP_PRESETS.BALL)
      .setContactForceEventThreshold(0.5)
      .setActiveEvents(
        host.rapier.ActiveEvents.COLLISION_EVENTS
        | host.rapier.ActiveEvents.CONTACT_FORCE_EVENTS,
      ),
    ballBody,
  )

  // Zero any residual velocity and give a gentle "pop" so the ball rolls up
  // the plunger lane slightly before settling — makes the spawn visible to player
  ballBody.setLinvel(new host.rapier.Vector3(0, 0, 0), true)
  ballBody.setAngvel(new host.rapier.Vector3(0, 0, 0), true)
  ballBody.applyImpulse(new host.rapier.Vector3(0, 0, 2.5), true)

  host.ballSaveSystem.onBallLaunched(nowMs())

  host.bindings.push({ mesh: ball, rigidBody: ballBody })
  host.ballBody = ballBody
  host.ballBodies.push(ballBody)

  if (host.mirrorTexture?.renderList) {
    host.mirrorTexture.renderList.push(ball)
  }

  // Add subtle point light for ball visibility (disabled in reduced motion mode)
  if (!GameConfig.camera.reducedMotion) {
    const ballLight = new PointLight('ballLight', Vector3.Zero(), host.scene)
    ballLight.parent = ball
    ballLight.diffuse = Color3.FromHexString('#00ffff')
    ballLight.intensity = 0.3
    ballLight.range = 5
  }

  const trailWidth = GameConfig.ball.radius * 0.6
  const trail = new TrailMesh('ballTrail', ball, host.scene, trailWidth, 20, true)
  const trailMat = new StandardMaterial('trailMat', host.scene)
  trailMat.emissiveColor = Color3.FromHexString('#00ffff')
  trail.material = trailMat

  // Store for velocity-based updates
  host.trails.set(ballBody, trail)
  host.trailMaterials.set(trail, trailMat)
  host.ballTrails.set(ballBody, {
    mesh: trail,
    material: trailMat,
    baseWidth: trailWidth,
    isFading: false,
  })

  return ballBody
}

export function spawnExtraBalls(host: BallManagerHost, count: number, position?: Vector3): void {
  const spawn = position ? { x: position.x, y: position.y, z: position.z } : GameConfig.ball.spawnPachinko
  const density = getDensityForMass(GameConfig.ball.mass, GameConfig.ball.radius)
  const physics = getTunedBallPhysics()

  for (let i = 0; i < count; i++) {
    const b = MeshBuilder.CreateSphere('xb', { diameter: GameConfig.ball.radius * 2, segments: 32 }, host.scene) as Mesh
    // Offset slightly to avoid stacking
    b.position.set(spawn.x + (Math.random() - 0.5), spawn.y + (i * 2), spawn.z)

    b.material = host.matLib.getExtraBallMaterial()

    const body = host.world.createRigidBody(
      host.rapier.RigidBodyDesc.dynamic()
        .setTranslation(b.position.x, b.position.y, b.position.z)
        .setCcdEnabled(true)
        .setCanSleep(true)
        .setLinearDamping(physics.linearDamping)
        .setAngularDamping(physics.angularDamping),
    )

    host.world.createCollider(
      host.rapier.ColliderDesc.ball(GameConfig.ball.radius)
        .setRestitution(physics.restitution)
        .setFriction(physics.friction)
        .setDensity(density)
        .setCollisionGroups(COLLISION_GROUP_PRESETS.BALL)
        .setActiveEvents(
          host.rapier.ActiveEvents.COLLISION_EVENTS
          | host.rapier.ActiveEvents.CONTACT_FORCE_EVENTS,
        ),
      body,
    )

    host.bindings.push({ mesh: b, rigidBody: body })
    host.ballBodies.push(body)

    if (host.mirrorTexture?.renderList) {
      host.mirrorTexture.renderList.push(b)
    }

    // Add velocity-based trail for extra balls
    const trailWidth = GameConfig.ball.radius * 0.4
    const trail = new TrailMesh(`trail_${i}`, b, host.scene, trailWidth, 15, true)
    const trailMat = new StandardMaterial(`trailMat_${i}`, host.scene)
    trailMat.emissiveColor = Color3.FromHexString('#00ffff')
    trail.material = trailMat
    host.trails.set(body, trail)
    host.trailMaterials.set(trail, trailMat)
    host.ballTrails.set(body, {
      mesh: trail,
      material: trailMat,
      baseWidth: trailWidth,
      isFading: false,
    })
  }
}

export function resetBall(host: BallManagerHost): void {
  const density = getDensityForMass(GameConfig.ball.mass, GameConfig.ball.radius)

  if (host.ballBodies.length === 0) {
    const mat = host.matLib.getEnhancedChromeBallMaterial()

    const b = MeshBuilder.CreateSphere('ball', { diameter: GameConfig.ball.radius * 2, segments: 32 }, host.scene) as Mesh
    b.material = mat

    const spawn = GameConfig.ball.spawnMain
    const body = host.world.createRigidBody(
      host.rapier.RigidBodyDesc.dynamic()
        .setTranslation(spawn.x, spawn.y, spawn.z)
        .setCcdEnabled(true),
    )

    host.world.createCollider(
      host.rapier.ColliderDesc.ball(GameConfig.ball.radius)
        .setRestitution(GameConfig.ball.restitution)
        .setFriction(GameConfig.ball.friction)
        .setDensity(density)
        .setCollisionGroups(COLLISION_GROUP_PRESETS.BALL)
        .setActiveEvents(
          host.rapier.ActiveEvents.COLLISION_EVENTS
          | host.rapier.ActiveEvents.CONTACT_FORCE_EVENTS,
        ),
      body,
    )

    host.ballBody = body
    host.ballBodies.push(body)
    host.bindings.push({ mesh: b, rigidBody: body })

    if (host.mirrorTexture?.renderList) {
      host.mirrorTexture.renderList.push(b)
    }
  } else {
    const spawn = GameConfig.ball.spawnMain
    host.ballBody!.setTranslation(new host.rapier.Vector3(spawn.x, spawn.y, spawn.z), true)
    host.ballBody!.setLinvel(new host.rapier.Vector3(0, 0, 0), true)
    host.ballBody!.setAngvel(new host.rapier.Vector3(0, 0, 0), true)
    // Gentle pop on reset so player notices the ball reappearing in the lane
    host.ballBody!.applyImpulse(new host.rapier.Vector3(0, 0, 2.5), true)
  }

  applyCampaignRewards(host)
  host.endMultiball()
  host.ballSaveSystem.onBallLaunched(nowMs())
}

/**
 * Update ball material with map-reactive color.
 * Called when switching table maps.
 */
export function updateBallMaterialColor(host: BallManagerHost, mapColorHex: string): void {
  const mainBallBinding = host.bindings.find((b) => b.mesh.name === 'ball')
  if (mainBallBinding) {
    const ballMesh = mainBallBinding.mesh
    if (ballMesh instanceof Mesh && ballMesh.material) {
      host.matLib.updateBallMaterialColor(
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

  // Also update trail color
  const mapColor = Color3.FromHexString(mapColorHex)
  for (const trailMat of host.trailMaterials.values()) {
    trailMat.emissiveColor = mapColor
  }
}

export function updateTrailEffects(host: BallManagerHost): void {
  const cyan = Color3.FromHexString('#00ffff')
  const magenta = Color3.FromHexString('#ff00ff')

  for (const [body, trailData] of host.ballTrails) {
    const vel = body.linvel()
    const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z)

    if (trailData.isFading) {
      // Fade trail when ball is hologram-caught
      trailData.material.alpha = Math.max(0, trailData.material.alpha - 0.05)
      trailData.material.emissiveColor = Color3.Lerp(
        trailData.material.emissiveColor,
        Color3.Black(),
        0.1,
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
 * Apply equipped reward skin to the main ball.
 */
export function applyBallSkin(host: BallManagerHost, skinId: string): void {
  const binding = host.bindings.find((b) => b.mesh.name === 'ball')
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
        pbrMat.emissiveIntensity = host.matLib.qualityTier === QualityTier.HIGH ? 1.1 : 0.8
        if (host.matLib.qualityTier === QualityTier.HIGH) {
          pbrMat.iridescence.isEnabled = true
          pbrMat.iridescence.intensity = 0.35
        }
      }
      if (core?.material) {
        const coreMat = core.material as PBRMaterial
        coreMat.emissiveColor = emissive(PALETTE.MAGENTA, INTENSITY.ACTIVE)
        coreMat.emissiveIntensity = host.matLib.qualityTier === QualityTier.HIGH ? 1.3 : 1.0
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
      // Keep default chrome
      break
  }
}

/**
 * Apply equipped reward trail to the main ball.
 */
export function applyBallTrail(host: BallManagerHost, trailId: string): void {
  const trailData = host.ballBody ? host.ballTrails.get(host.ballBody) : null
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
 * Clear all applied rewards (reset to default).
 */
export function clearRewards(host: BallManagerHost): void {
  // Reset ball material to default chrome
  const binding = host.bindings.find((b) => b.mesh.name === 'ball')
  if (binding) {
    const mesh = binding.mesh as Mesh
    mesh.material = host.matLib.getEnhancedChromeBallMaterial()
  }

  // Reset trail to default
  const trailData = host.ballBody ? host.ballTrails.get(host.ballBody) : null
  if (trailData) {
    trailData.material.emissiveColor = Color3.FromHexString('#00FFFF')
    trailData.baseWidth = GameConfig.ball.radius * 0.6
  }
}

export function applyCampaignRewards(host: BallManagerHost): void {
  const campaignRewards = getCampaignRewardsManager()
  const equippedBallSkin = campaignRewards?.getEquippedReward('ball-skin')
  if (equippedBallSkin) {
    host.applyBallSkin(equippedBallSkin.cosmeticId)
  }
}

/**
 * Get material for ball type.
 */
export function getMaterialForType(host: BallManagerHost, type: BallType): PBRMaterial {
  switch (type) {
    case BallType.GOLD_PLATED:
      return host.matLib.getGoldPlatedBallMaterial()
    case BallType.SOLID_GOLD:
      return host.matLib.getSolidGoldBallMaterial()
    default:
      return host.matLib.getEnhancedChromeBallMaterial()
  }
}

/**
 * Add trail for a ball with specific color.
 */
export function addTrailForBall(host: BallManagerHost, body: RAPIER.RigidBody, colorHex: string): void {
  const binding = host.bindings.find((b) => b.rigidBody === body)
  if (!binding) return

  const trailWidth = GameConfig.ball.radius * 0.6
  const trail = new TrailMesh(`trail_${body.handle}`, binding.mesh, host.scene, trailWidth, 20, true)
  const trailMat = new StandardMaterial(`trailMat_${body.handle}`, host.scene)
  trailMat.emissiveColor = Color3.FromHexString(colorHex)
  trail.material = trailMat

  host.trails.set(body, trail)
  host.trailMaterials.set(trail, trailMat)
  host.ballTrails.set(body, {
    mesh: trail,
    material: trailMat,
    baseWidth: trailWidth,
    isFading: false,
  })
}

/**
 * Create a ball with specific type.
 */
export function createBallOfType(host: BallManagerHost, type: BallType, position?: Vector3, playEffect = false): RAPIER.RigidBody {
  const config = BALL_TIERS[type]
  const spawnPos = position || GameConfig.ball.spawnMain

  // Create mesh based on type
  const diameter = GameConfig.ball.radius * 2
  const ball = MeshBuilder.CreateSphere(`ball_${type}`, {
    diameter,
    segments: 32,
    slice: 1,
  }, host.scene) as Mesh

  // Apply material based on type
  ball.material = getMaterialForType(host, type)

  // Gold balls feel heavier with more bounce
  const physics = getTunedBallPhysics()
  const isSolidGold = type === BallType.SOLID_GOLD
  const isGoldPlated = type === BallType.GOLD_PLATED
  const mass = isSolidGold ? GameConfig.ball.mass * 1.15 : (isGoldPlated ? GameConfig.ball.mass * 1.08 : GameConfig.ball.mass)
  const linearDamp = isGoldPlated ? physics.linearDamping * 0.92 : physics.linearDamping
  const angularDamp = isGoldPlated ? physics.angularDamping * 0.88 : physics.angularDamping

  // Create physics body
  const body = host.world.createRigidBody(
    host.rapier.RigidBodyDesc.dynamic()
      .setTranslation(spawnPos.x, spawnPos.y, spawnPos.z)
      .setCcdEnabled(true)
      .setCanSleep(true)
      .setLinearDamping(linearDamp)
      .setAngularDamping(angularDamp),
  )

  const density = getDensityForMass(mass, GameConfig.ball.radius)
  const restitution = isGoldPlated ? physics.restitution + 0.02 : physics.restitution
  const friction = isGoldPlated ? physics.friction * 0.95 : physics.friction

  const collider = host.world.createCollider(
    host.rapier.ColliderDesc.ball(GameConfig.ball.radius)
      .setRestitution(restitution)
      .setFriction(friction)
      .setDensity(density)
      .setCollisionGroups(COLLISION_GROUP_PRESETS.BALL)
      .setActiveEvents(
        host.rapier.ActiveEvents.COLLISION_EVENTS
        | host.rapier.ActiveEvents.CONTACT_FORCE_EVENTS,
      ),
    body,
  )

  // Enhanced ball physics: better restitution coefficients and spin response
  collider.setRestitutionCombineRule(host.rapier.CoefficientCombineRule.Max)

  // Store ball data
  host.ballDataMap.set(body, {
    type,
    spawnTime: performance.now(),
    points: config.basePoints,
    mesh: ball,
    rigidBody: body,
  })

  host.bindings.push({ mesh: ball, rigidBody: body })
  host.ballBodies.push(body)

  // Add trail with type-specific color
  host.addTrailForBall(body, config.trailColor)

  // Play effect if requested
  if (playEffect && type !== BallType.STANDARD) {
    const effectPos = position || GameConfig.ball.spawnMain
    host.playSpawnEffect(new Vector3(effectPos.x, effectPos.y, effectPos.z), type)
  }

  return body
}

/**
 * Spawn a random ball with weighted probability.
 */
export function spawnRandomBall(host: BallManagerHost, position?: Vector3): RAPIER.RigidBody {
  const rand = Math.random()
  let cumulative = 0

  for (const [typeKey, config] of Object.entries(BALL_TIERS)) {
    cumulative += config.spawnWeight
    if (rand <= cumulative) {
      const type = typeKey as BallType
      const spawnPos = position || GameConfig.ball.spawnMain

      // Gold-tier balls spawn as a chaotic swarm of small balls instead of one heavy ball
      if (type !== BallType.STANDARD && GameConfig.smallGoldBalls.enabled) {
        const swarm = host.spawnSmallGoldBallSwarm(position, type)
        if (swarm.length > 0) {
          const soundSystem = getSoundSystem()
          soundSystem.playGoldBallSpawn(type)
          return swarm[0]
        }
        // Fall through to single-ball spawn if swarm capacity is reached
      }

      // Create the ball
      const body = host.createBallOfType(type, position)

      // Play spawn effect for gold balls
      if (type !== BallType.STANDARD) {
        host.playSpawnEffect(new Vector3(spawnPos.x, spawnPos.y, spawnPos.z), type)
        const soundSystem = getSoundSystem()
        soundSystem.playGoldBallSpawn(type)
      }

      return body
    }
  }

  return host.createMainBall() // Fallback
}
