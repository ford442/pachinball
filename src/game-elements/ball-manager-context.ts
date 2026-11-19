import { simClockMs } from '../core/sim-clock'
import type { PhysicsApi, PhysicsBody, PhysicsWorldSink } from '../core/physics-api'
import type { Vec3Like } from '../core/vec3-scalar'
import { BALL_TIERS, BallType } from '../config'
import { getPhysicsTuningValue } from './physics-tuning'
import type { BallSaveSystem } from './ball-save-system'
import type { BallData } from './types'

/**
 * What a ball looks like when it joins play. The sim (`BallManager` and its helpers) decides the
 * body; the view (`BallPresentation`, never loaded by the headless replay runner, #528) builds the
 * mesh, binding, trail and light from this.
 */
export type BallVisualSpec =
  /** The boot-time main ball: chrome sphere, core, ring, light and trail. */
  | { kind: 'main'; position: Vec3Like }
  /** A multiball extra ball (`index` within the spawn batch). */
  | { kind: 'extra'; index: number; position: Vec3Like }
  /** The main ball rebuilt by `resetBall` when no ball is left. */
  | { kind: 'reset' }
  /** A ball of a tier (`createBallOfType`), with the tier's trail colour. */
  | { kind: 'typed'; type: BallType; trailColor: string }
  /** One small ball of a gold swarm. */
  | { kind: 'swarm'; type: BallType; index: number; radius: number }

/**
 * The presentation half of the ball manager. Every method is cosmetic: none may move a body or
 * change what the sim reads. `null` on the headless replay runner.
 */
export interface BallView {
  /** A body joined play: create its mesh and binding (and trail / light as the spec says). */
  spawned(body: PhysicsBody, spec: BallVisualSpec): void
  /** A ball left play (its body is already removed): dispose its mesh, binding and trail. */
  removed(body: PhysicsBody): void
  /** `removeExtraBalls`: drop the extra balls' leftover main-ball bindings, keeping `keep`'s. */
  removedExtras(keep: PhysicsBody | null): void
  /** Dispose the trail of a body that left play without its binding (extra-ball sweep). */
  disposeTrail(body: PhysicsBody): void
  /** A hologram bumper caught the ball / let it go. */
  caught(body: PhysicsBody): void
  released(body: PhysicsBody): void
  /** Burst of particles where a gold ball (or swarm) appeared. */
  spawnEffect(position: Vec3Like, type: BallType, swarmBurst: boolean): void
  /** Gold ball spawn chime. */
  goldBallSpawned(type: BallType): void
  /** Equipped campaign skin, applied whenever the ball is reset. */
  applyCampaignRewards(): void
}

export interface MultiballState {
  isActive: boolean
  chainLevel: number
  ballSaveUsed: boolean
  ballSaveExpiresAtMs: number
}

export interface SwarmGroup {
  bodies: Set<PhysicsBody>
  collected: Set<PhysicsBody>
  spawnTime: number
  baseType: BallType
}

/**
 * The ball economy a run plays under (#556): spawn weights and points per ball type, from the run's
 * `rules.balls`. The default is the vanilla one (`BALL_TIERS`).
 */
export interface BallEconomy {
  readonly weights: Readonly<Record<BallType, number>>
  readonly points: Readonly<Record<BallType, number>>
}

/** Ball types in the order the spawn draw accumulates their weights. */
export const BALL_TYPE_ORDER = [BallType.STANDARD, BallType.GOLD_PLATED, BallType.SOLID_GOLD] as const

export const VANILLA_BALL_ECONOMY: BallEconomy = {
  weights: {
    [BallType.STANDARD]: BALL_TIERS[BallType.STANDARD].spawnWeight,
    [BallType.GOLD_PLATED]: BALL_TIERS[BallType.GOLD_PLATED].spawnWeight,
    [BallType.SOLID_GOLD]: BALL_TIERS[BallType.SOLID_GOLD].spawnWeight,
  },
  points: {
    [BallType.STANDARD]: BALL_TIERS[BallType.STANDARD].basePoints,
    [BallType.GOLD_PLATED]: BALL_TIERS[BallType.GOLD_PLATED].basePoints,
    [BallType.SOLID_GOLD]: BALL_TIERS[BallType.SOLID_GOLD].basePoints,
  },
}

export interface BallStuckTracker {
  stuckTime: number
}

export interface BallManagerHost {
  world: PhysicsWorldSink
  rapier: PhysicsApi
  /** The presentation half, or null when nothing is drawn (headless replay, #528). */
  readonly view: BallView | null
  ballBody: PhysicsBody | null
  ballBodies: PhysicsBody[]
  caughtBalls: Array<{ body: PhysicsBody; targetPos: Vec3Like; timer: number }>
  ballDataMap: Map<PhysicsBody, BallData>
  goldBallCount: number
  onGoldBallCollected?: (type: BallType, points: number) => void
  smallGoldBallLifetimes: Map<PhysicsBody, number>
  smallGoldBallSpawnTime: Map<PhysicsBody, number>
  swarmGroups: Map<number, SwarmGroup>
  ballSwarmId: Map<PhysicsBody, number>
  nextSwarmId: number
  ballStuckTimers: Map<PhysicsBody, BallStuckTracker>
  /** Result buffer `updateStuckDetection` refills each step. */
  readonly stuckBallsScratch: PhysicsBody[]
  chainMultiball: MultiballState
  ballSaveSystem: BallSaveSystem
  /** Spawn weights and points (the run's rules). */
  readonly economy: BallEconomy

  removeBall(body: PhysicsBody): void
  createMainBall(): PhysicsBody
  createBallOfType(type: BallType, position?: Vec3Like, playEffect?: boolean): PhysicsBody
  spawnRandomBall(position?: Vec3Like): PhysicsBody
  spawnSmallGoldBallSwarm(position?: Vec3Like, baseType?: BallType): PhysicsBody[]
  endMultiball(): void
}

export interface TunedBallPhysics {
  restitution: number
  friction: number
  linearDamping: number
  angularDamping: number
}

export function nowMs(): number {
  // Ball-save grace decides whether a drain costs a life: gameplay clock, not wall time (#441).
  return simClockMs()
}

/**
 * Helper to calculate density required to achieve target mass for a given radius.
 * Volume = (4/3) * pi * r^3
 * Density = Mass / Volume
 */
export function getDensityForMass(mass: number, radius: number): number {
  const volume = (4 / 3) * Math.PI * Math.pow(radius, 3)
  return mass / volume
}

export function getTunedBallPhysics(): TunedBallPhysics {
  return {
    restitution: getPhysicsTuningValue('ballRestitution'),
    friction: getPhysicsTuningValue('ballFriction'),
    linearDamping: getPhysicsTuningValue('ballLinearDamping'),
    angularDamping: getPhysicsTuningValue('ballAngularDamping'),
  }
}
