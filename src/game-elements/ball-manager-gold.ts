/**
 * Gold balls — the sim half: swarm spawns, lifetimes and collection. Their particles and glow are
 * `BallView`'s (`ball-presentation.ts`). No Babylon import (#528).
 */
import type { PhysicsBody } from '../core/physics-api'
import type { Vec3Like } from '../core/vec3-scalar'
import { BallType, GameConfig } from '../config'
import { getSessionRngFork, RNG_FORK } from '../core/seeded-rng'
import { getDensityForMass, nowMs, type BallManagerHost } from './ball-manager-context'

/**
 * Clean up swarm group tracking. If the ball leaves play without being
 * collected (e.g. lifetime expiry), invalidate the whole swarm group so
 * the remaining members can no longer trigger a quick-collect bonus.
 */
export function cleanupSwarmTrackingOnRemove(host: BallManagerHost, body: PhysicsBody): void {
  const swarmId = host.ballSwarmId.get(body)
  if (swarmId === undefined) return

  const group = host.swarmGroups.get(swarmId)
  if (group && !group.collected.has(body)) {
    host.swarmGroups.delete(swarmId)
  }
  host.ballSwarmId.delete(body)
}

/**
 * Update small gold ball lifetimes and cleanup.
 */
export function updateSmallGoldBallLifetimes(host: BallManagerHost, dt: number): void {
  const toRemove: PhysicsBody[] = []

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
export function spawnSmallGoldBallSwarm(host: BallManagerHost, position?: Vec3Like, baseType: BallType = BallType.GOLD_PLATED): PhysicsBody[] {
  if (!GameConfig.smallGoldBalls.enabled) {
    return []
  }

  const spawnPos = position || GameConfig.ball.spawnMain
  const spawnedBodies: PhysicsBody[] = []
  const cfg = GameConfig.smallGoldBalls

  // Check concurrent limit
  const smallGoldCount = Array.from(host.smallGoldBallLifetimes.keys()).length
  if (smallGoldCount >= cfg.maxConcurrentBalls) {
    return []
  }

  const smallRadius = GameConfig.ball.radius * cfg.sizeMultiplier
  const smallMass = GameConfig.ball.mass * cfg.massMultiplier

  const swarmCount = Math.min(cfg.swarmSize, cfg.maxConcurrentBalls - smallGoldCount)
  const rng = getSessionRngFork(RNG_FORK.GOLD_SWARM)
  for (let i = 0; i < swarmCount; i++) {
    // Create physics body with chaotic velocity spread
    const angleSpread = (Math.PI * 2 / swarmCount) * i + (rng.next() - 0.5) * 0.3
    const speedVariation = cfg.spawnVelocityMin + rng.next() * (cfg.spawnVelocityMax - cfg.spawnVelocityMin)
    const velocity = new host.rapier.Vector3(
      Math.cos(angleSpread) * speedVariation,
      2.0 + rng.next() * 1.5,
      Math.sin(angleSpread) * speedVariation,
    )

    const body = host.world.createRigidBody(
      host.rapier.RigidBodyDesc.dynamic()
        .setTranslation(spawnPos.x + (rng.next() - 0.5) * 0.5, spawnPos.y, spawnPos.z + (rng.next() - 0.5) * 0.5)
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
      spawnTime: nowMs(),
      points: cfg.basePoints,
      rigidBody: body,
    })
    host.ballBodies.push(body)

    // Track lifetime
    host.smallGoldBallLifetimes.set(body, cfg.lifetime)
    host.smallGoldBallSpawnTime.set(body, nowMs())

    // Mesh, binding and its bright gold trail.
    host.view?.spawned(body, { kind: 'swarm', type: baseType, index: i, radius: smallRadius })

    spawnedBodies.push(body)
  }

  if (spawnedBodies.length > 0) {
    host.view?.spawnEffect({ x: spawnPos.x, y: spawnPos.y + 0.5, z: spawnPos.z }, baseType, true)
    const swarmId = host.nextSwarmId++
    host.swarmGroups.set(swarmId, {
      bodies: new Set(spawnedBodies),
      collected: new Set(),
      spawnTime: nowMs(),
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
export function collectBall(host: BallManagerHost, body: PhysicsBody): {
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
        const elapsedSeconds = (nowMs() - group.spawnTime) / 1000
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
