/**
 * Ball spawning — the sim half: bodies, colliders, ball data and the spawn RNG. What each ball
 * looks like is `BallView`'s (`ball-presentation.ts`), told through `host.view?.spawned(...)`
 * after the body exists. No Babylon import: the headless replay runner (#528) spawns balls here.
 *
 * The physics calls and their order are the ones the golden tapes were recorded with; a body's
 * C++ id is assigned when its sphere collider is attached, so moving a call moves ids.
 */

import type { PhysicsBody } from '../core/physics-api'
import type { Vec3Like } from '../core/vec3-scalar'
import { BALL_TIERS, BallType, GameConfig } from '../config'
import { COLLISION_GROUP_PRESETS } from '../core/collision-groups'
import { getSessionRngFork, RNG_FORK, type SeededRng } from '../core/seeded-rng'
import { getDensityForMass, getTunedBallPhysics, nowMs, type BallManagerHost } from './ball-manager-context'

export function createMainBall(host: BallManagerHost): PhysicsBody {
  // Use Config for Spawn Point
  const spawn = GameConfig.ball.spawnMain
  const physics = getTunedBallPhysics()

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

  host.ballBody = ballBody
  host.ballBodies.push(ballBody)
  host.view?.spawned(ballBody, { kind: 'main', position: spawn })

  return ballBody
}

export function spawnExtraBalls(host: BallManagerHost, count: number, position?: Vec3Like): void {
  const spawn = position ? { x: position.x, y: position.y, z: position.z } : GameConfig.ball.spawnPachinko
  const density = getDensityForMass(GameConfig.ball.mass, GameConfig.ball.radius)
  const physics = getTunedBallPhysics()
  const rng = getSessionRngFork(RNG_FORK.SPAWN)

  for (let i = 0; i < count; i++) {
    // Offset slightly to avoid stacking
    const at = { x: spawn.x + (rng.next() - 0.5), y: spawn.y + (i * 2), z: spawn.z }

    const body = host.world.createRigidBody(
      host.rapier.RigidBodyDesc.dynamic()
        .setTranslation(at.x, at.y, at.z)
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

    host.ballBodies.push(body)
    host.view?.spawned(body, { kind: 'extra', index: i, position: at })
  }
}

export function resetBall(host: BallManagerHost): void {
  const density = getDensityForMass(GameConfig.ball.mass, GameConfig.ball.radius)

  if (host.ballBodies.length === 0) {
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
    host.view?.spawned(body, { kind: 'reset' })

  } else {
    const spawn = GameConfig.ball.spawnMain
    host.ballBody!.setTranslation(new host.rapier.Vector3(spawn.x, spawn.y, spawn.z), true)
    host.ballBody!.setLinvel(new host.rapier.Vector3(0, 0, 0), true)
    host.ballBody!.setAngvel(new host.rapier.Vector3(0, 0, 0), true)
    // Gentle pop on reset so player notices the ball reappearing in the lane
    host.ballBody!.applyImpulse(new host.rapier.Vector3(0, 0, 2.5), true)
  }

  host.view?.applyCampaignRewards()
  host.endMultiball()
  host.ballSaveSystem.onBallLaunched(nowMs())
}

/**
 * Create a ball with specific type.
 */
export function createBallOfType(host: BallManagerHost, type: BallType, position?: Vec3Like, playEffect = false): PhysicsBody {
  const config = BALL_TIERS[type]
  const spawnPos = position || GameConfig.ball.spawnMain

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
  collider?.setRestitutionCombineRule?.(host.rapier.CoefficientCombineRule.Max)

  // Store ball data
  host.ballDataMap.set(body, {
    type,
    spawnTime: nowMs(),
    points: config.basePoints,
    rigidBody: body,
  })

  host.ballBodies.push(body)
  // Mesh, binding and the trail in the tier's colour.
  host.view?.spawned(body, { kind: 'typed', type, trailColor: config.trailColor })

  // Play effect if requested
  if (playEffect && type !== BallType.STANDARD) {
    const effectPos = position || GameConfig.ball.spawnMain
    host.view?.spawnEffect({ x: effectPos.x, y: effectPos.y, z: effectPos.z }, type, false)
  }

  return body
}

/**
 * Select a ball type using weighted tiers from a single [0, 1) draw.
 */
export function selectWeightedBallType(rng: SeededRng = getSessionRngFork(RNG_FORK.SPAWN)): BallType {
  const rand = rng.next()
  let cumulative = 0

  for (const [typeKey, config] of Object.entries(BALL_TIERS)) {
    cumulative += config.spawnWeight
    if (rand <= cumulative) {
      return typeKey as BallType
    }
  }

  return BallType.STANDARD
}

/**
 * Spawn a random ball with weighted probability.
 */
export function spawnRandomBall(host: BallManagerHost, position?: Vec3Like): PhysicsBody {
  const type = selectWeightedBallType()
  const spawnPos = position || GameConfig.ball.spawnMain

  // Gold-tier balls spawn as a chaotic swarm of small balls instead of one heavy ball
  if (type !== BallType.STANDARD && GameConfig.smallGoldBalls.enabled) {
    const [leader] = host.spawnSmallGoldBallSwarm(position, type)
    if (leader) {
      host.view?.goldBallSpawned(type)
      return leader
    }
    // Fall through to single-ball spawn if swarm capacity is reached
  }

  // Create the ball
  const body = host.createBallOfType(type, position)

  // Play spawn effect for gold balls
  if (type !== BallType.STANDARD) {
    host.view?.spawnEffect({ x: spawnPos.x, y: spawnPos.y, z: spawnPos.z }, type, false)
    host.view?.goldBallSpawned(type)
  }

  return body
}
