import type { PBRMaterial, Scene, StandardMaterial, TrailMesh, Vector3 } from '@babylonjs/core'
import type { MirrorTexture } from '@babylonjs/core'
import type * as RAPIER from '@dimforge/rapier3d-compat'
import type { BallType } from '../config'
import { getPhysicsTuningValue } from './physics-tuning'
import type { BallSaveSystem } from './ball-save-system'
import type { PhysicsBinding, BallData } from './types'
import type { QualityTier } from './visual-language'

export interface BallTrailData {
  mesh: TrailMesh
  material: StandardMaterial
  baseWidth: number
  isFading: boolean
}

export interface MultiballState {
  isActive: boolean
  chainLevel: number
  ballSaveUsed: boolean
  ballSaveExpiresAtMs: number
}

export interface SwarmGroup {
  bodies: Set<RAPIER.RigidBody>
  collected: Set<RAPIER.RigidBody>
  spawnTime: number
  baseType: BallType
}

export interface BallStuckTracker {
  lastPos: { x: number; y: number; z: number }
  stuckTime: number
}

export interface BallMaterialLibrary {
  qualityTier: QualityTier
  getEnhancedChromeBallMaterial(): PBRMaterial
  getExtraBallMaterial(): PBRMaterial
  getGoldPlatedBallMaterial(): PBRMaterial
  getSolidGoldBallMaterial(): PBRMaterial
  updateBallMaterialColor(material: PBRMaterial, mapColorHex: string): void
}

export interface BallManagerHost {
  scene: Scene
  world: RAPIER.World
  rapier: typeof RAPIER
  ballBody: RAPIER.RigidBody | null
  ballBodies: RAPIER.RigidBody[]
  caughtBalls: Array<{ body: RAPIER.RigidBody; targetPos: Vector3; timer: number }>
  mirrorTexture: MirrorTexture | null
  bindings: PhysicsBinding[]
  matLib: BallMaterialLibrary
  trails: Map<RAPIER.RigidBody, TrailMesh>
  trailMaterials: Map<TrailMesh, StandardMaterial>
  ballTrails: Map<RAPIER.RigidBody, BallTrailData>
  ballDataMap: Map<RAPIER.RigidBody, BallData>
  goldBallCount: number
  onGoldBallCollected?: (type: BallType, points: number) => void
  glowTime: number
  smallGoldBallLifetimes: Map<RAPIER.RigidBody, number>
  smallGoldBallSpawnTime: Map<RAPIER.RigidBody, number>
  swarmGroups: Map<number, SwarmGroup>
  ballSwarmId: Map<RAPIER.RigidBody, number>
  nextSwarmId: number
  ballStuckTimers: Map<RAPIER.RigidBody, BallStuckTracker>
  chainMultiball: MultiballState
  ballSaveSystem: BallSaveSystem

  removeBall(body: RAPIER.RigidBody): void
  createMainBall(): RAPIER.RigidBody
  createBallOfType(type: BallType, position?: Vector3, playEffect?: boolean): RAPIER.RigidBody
  spawnRandomBall(position?: Vector3): RAPIER.RigidBody
  spawnSmallGoldBallSwarm(position?: Vector3, baseType?: BallType): RAPIER.RigidBody[]
  addTrailForBall(body: RAPIER.RigidBody, colorHex: string): void
  playSpawnEffect(position: Vector3, type: BallType, swarmBurst?: boolean): void
  applyBallSkin(skinId: string): void
  endMultiball(): void
}

export interface TunedBallPhysics {
  restitution: number
  friction: number
  linearDamping: number
  angularDamping: number
}

export function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
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
