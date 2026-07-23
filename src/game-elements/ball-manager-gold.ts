import {
  Color4,
  MeshBuilder,
  ParticleSystem,
  Texture,
  Vector3,
} from '@babylonjs/core'
import type { Mesh } from '@babylonjs/core'
import type * as RAPIER from '@dimforge/rapier3d-compat'
import { BallType, GameConfig } from '../config'
import { pulse } from './visual-language'
import { getDensityForMass, type BallManagerHost } from './ball-manager-context'

/**
 * Clean up swarm group tracking. If the ball leaves play without being
 * collected (e.g. lifetime expiry), invalidate the whole swarm group so
 * the remaining members can no longer trigger a quick-collect bonus.
 */
export function cleanupSwarmTrackingOnRemove(host: BallManagerHost, body: RAPIER.RigidBody): void {
  const swarmId = host.ballSwarmId.get(body)
  if (swarmId === undefined) return

  const group = host.swarmGroups.get(swarmId)
  if (group && !group.collected.has(body)) {
    host.swarmGroups.delete(swarmId)
  }
  host.ballSwarmId.delete(body)
}

/**
 * Create a simple circular particle texture.
 */
export function createParticleTexture(host: BallManagerHost, colorHex: string): Texture {
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

  const texture = new Texture(
    canvas.toDataURL(),
    host.scene,
  )
  return texture
}

/**
 * Play visual effect when a gold ball spawns.
 */
export function playSpawnEffect(host: BallManagerHost, position: Vector3, type: BallType, swarmBurst = false): void {
  if (type === BallType.STANDARD) return

  const isSolidGold = type === BallType.SOLID_GOLD

  // Create particle system for spawn burst
  const particleSystem = new ParticleSystem(
    `spawnEffect_${type}_${Date.now()}`,
    swarmBurst ? (isSolidGold ? 90 : 60) : (isSolidGold ? 50 : 20),
    host.scene,
  )

  // Particle texture
  particleSystem.particleTexture = createParticleTexture(host, isSolidGold ? '#ffb700' : '#ffd700')

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
 * Update gentle pulsing emissive glow on gold ball materials.
 * Called once per frame from the game loop.
 */
export function updateGoldBallGlow(host: BallManagerHost, dt: number): void {
  host.glowTime += dt
  const goldPlated = host.matLib.getGoldPlatedBallMaterial()
  const solidGold = host.matLib.getSolidGoldBallMaterial()
  // Gentle slow pulse: 0.5 Hz = 2-second period
  goldPlated.emissiveIntensity = pulse(host.glowTime, 0.5, 0.15, 0.35)
  // Slightly slower and stronger for solid gold
  solidGold.emissiveIntensity = pulse(host.glowTime, 0.4, 0.25, 0.55)
}

/**
 * Update small gold ball lifetimes and cleanup.
 */
export function updateSmallGoldBallLifetimes(host: BallManagerHost, dt: number): void {
  const toRemove: RAPIER.RigidBody[] = []

  for (const [body, lifetime] of host.smallGoldBallLifetimes) {
    const remaining = lifetime - dt
    host.smallGoldBallLifetimes.set(body, remaining)

    // Remove if expired or out of bounds
    const pos = body.translation()
    if (remaining <= 0 || Math.abs(pos.y) > 50) {
      toRemove.push(body)
    }
  }

  for (const body of toRemove) {
    host.removeBall(body)
    host.smallGoldBallLifetimes.delete(body)
    host.smallGoldBallSpawnTime.delete(body)
  }
}

/**
 * Spawn a swarm of small gold balls instead of single heavy gold ball.
 * Creates chaotic, bouncy behavior for more exciting gameplay.
 */
export function spawnSmallGoldBallSwarm(host: BallManagerHost, position?: Vector3, baseType: BallType = BallType.GOLD_PLATED): RAPIER.RigidBody[] {
  if (!GameConfig.smallGoldBalls.enabled) {
    return []
  }

  const spawnPos = position || GameConfig.ball.spawnMain
  const spawnedBodies: RAPIER.RigidBody[] = []
  const cfg = GameConfig.smallGoldBalls

  // Check concurrent limit
  const smallGoldCount = Array.from(host.smallGoldBallLifetimes.keys()).length
  if (smallGoldCount >= cfg.maxConcurrentBalls) {
    return []
  }

  const swarmCount = Math.min(cfg.swarmSize, cfg.maxConcurrentBalls - smallGoldCount)
  const smallRadius = GameConfig.ball.radius * cfg.sizeMultiplier
  const smallMass = GameConfig.ball.mass * cfg.massMultiplier

  for (let i = 0; i < swarmCount; i++) {
    // Create small gold mesh
    const goldBall = MeshBuilder.CreateSphere(`smallGoldBall_${baseType}_${i}`, {
      diameter: smallRadius * 2,
      segments: 24,
      slice: 1,
    }, host.scene) as Mesh

    // Use bright gold material with strong emissive
    goldBall.material = host.matLib.getSolidGoldBallMaterial()

    // Create physics body with chaotic velocity spread
    const angleSpread = (Math.PI * 2 / swarmCount) * i + (Math.random() - 0.5) * 0.3
    const speedVariation = cfg.spawnVelocityMin + Math.random() * (cfg.spawnVelocityMax - cfg.spawnVelocityMin)
    const velocity = new host.rapier.Vector3(
      Math.cos(angleSpread) * speedVariation,
      2.0 + Math.random() * 1.5,
      Math.sin(angleSpread) * speedVariation,
    )

    const body = host.world.createRigidBody(
      host.rapier.RigidBodyDesc.dynamic()
        .setTranslation(spawnPos.x + (Math.random() - 0.5) * 0.5, spawnPos.y, spawnPos.z + (Math.random() - 0.5) * 0.5)
        .setCcdEnabled(true)
        .setCanSleep(true)
        .setLinearDamping(cfg.linearDamping)
        .setAngularDamping(cfg.angularDamping),
    )

    // Set initial velocity for chaotic spread
    body.setLinvel(velocity, true)

    const density = getDensityForMass(smallMass, smallRadius)
    host.world.createCollider(
      host.rapier.ColliderDesc.ball(smallRadius)
        .setRestitution(cfg.restitution)
        .setFriction(cfg.friction)
        .setDensity(density)
        .setActiveEvents(host.rapier.ActiveEvents.COLLISION_EVENTS),
      body,
    )

    // Store as small gold ball variant with points
    host.ballDataMap.set(body, {
      type: baseType,
      spawnTime: performance.now(),
      points: cfg.basePoints,
      mesh: goldBall,
      rigidBody: body,
    })
    host.bindings.push({ mesh: goldBall, rigidBody: body })
    host.ballBodies.push(body)

    // Track lifetime
    host.smallGoldBallLifetimes.set(body, cfg.lifetime)
    host.smallGoldBallSpawnTime.set(body, performance.now())

    // Bright gold trail
    host.addTrailForBall(body, '#ffdd00')

    spawnedBodies.push(body)
  }

  if (spawnedBodies.length > 0) {
    playSpawnEffect(host, new Vector3(spawnPos.x, spawnPos.y + 0.5, spawnPos.z), baseType, true)
    const swarmId = host.nextSwarmId++
    host.swarmGroups.set(swarmId, {
      bodies: new Set(spawnedBodies),
      collected: new Set(),
      spawnTime: performance.now(),
      baseType,
    })
    for (const body of spawnedBodies) {
      host.ballSwarmId.set(body, swarmId)
    }
  }

  return spawnedBodies
}

/**
 * Mark a ball as collected (when it drains).
 */
export function collectBall(host: BallManagerHost, body: RAPIER.RigidBody): {
  type: BallType
  points: number
  jackpotEligible: boolean
  quickCollectBonus?: { multiplier: number; totalPoints: number }
} | null {
  const data = host.ballDataMap.get(body)
  if (!data) return null

  // Update gold ball counter
  if (data.type !== BallType.STANDARD) {
    host.goldBallCount++
  }

  // Trigger callback if registered
  host.onGoldBallCollected?.(data.type, data.points)

  let quickCollectBonus: { multiplier: number; totalPoints: number } | undefined
  let jackpotEligible = data.type === BallType.SOLID_GOLD

  const swarmId = host.ballSwarmId.get(body)
  if (swarmId !== undefined) {
    // Solid-gold swarms represent one jackpot spawn event. Keep each member's
    // point tier as SOLID_GOLD, but fire jackpot treatment only on the final
    // collected member of a complete swarm.
    jackpotEligible = false
    const group = host.swarmGroups.get(swarmId)
    if (group) {
      group.collected.add(body)
      if (group.collected.size >= group.bodies.size) {
        jackpotEligible = group.baseType === BallType.SOLID_GOLD
        const elapsedSeconds = (performance.now() - group.spawnTime) / 1000
        if (elapsedSeconds <= GameConfig.smallGoldBalls.quickCollectBonusWindow) {
          const multiplier = GameConfig.smallGoldBalls.quickCollectMultiplier
          const totalPoints = GameConfig.smallGoldBalls.basePoints * group.bodies.size
          quickCollectBonus = { multiplier, totalPoints: Math.round(totalPoints * multiplier) }
        }
        host.swarmGroups.delete(swarmId)
      }
    }
    host.ballSwarmId.delete(body)
  }

  return { type: data.type, points: data.points, jackpotEligible, quickCollectBonus }
}
