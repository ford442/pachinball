import {
  Color3,
  Mesh,
  PBRMaterial,
  Scene,
  StandardMaterial,
  TrailMesh,
  Vector3,
} from '@babylonjs/core'
import type { MirrorTexture } from '@babylonjs/core'
import type * as RAPIER from '@dimforge/rapier3d-compat'
import { BallType, GAME_TUNING } from '../config'
import { getMaterialLibrary } from '../materials'
import { BallSaveSystem } from './ball-save-system'
import {
  type BallManagerHost,
  type BallStuckTracker,
  type BallTrailData,
  type MultiballState,
  nowMs,
  type SwarmGroup,
} from './ball-manager-context'
import {
  cleanupSwarmTrackingOnRemove,
  collectBall as collectBallFromGold,
  playSpawnEffect,
  spawnSmallGoldBallSwarm,
  updateGoldBallGlow,
  updateSmallGoldBallLifetimes,
} from './ball-manager-gold'
import {
  canSaveDrain,
  endMultiball,
  getChainStats,
  getScoreMultiplier,
  registerDrain,
  startMultiball,
  triggerForcedMultiball,
} from './ball-manager-multiball'
import {
  addTrailForBall,
  applyBallSkin,
  applyBallTrail,
  clearRewards,
  createBallOfType,
  createMainBall,
  resetBall,
  spawnExtraBalls,
  spawnRandomBall,
  updateBallMaterialColor,
  updateTrailEffects,
} from './ball-manager-spawn'
import { updateStuckDetection } from './ball-manager-stuck'
import type { BallData, PhysicsBinding } from './types'

export class BallManager {
  private scene: Scene
  private world: RAPIER.World
  private rapier: typeof RAPIER
  private ballBody: RAPIER.RigidBody | null = null
  private ballBodies: RAPIER.RigidBody[] = []
  private caughtBalls: Array<{ body: RAPIER.RigidBody; targetPos: Vector3; timer: number }> = []
  private mirrorTexture: MirrorTexture | null = null
  private bindings: PhysicsBinding[] = []
  private matLib: ReturnType<typeof getMaterialLibrary>
  private trails: Map<RAPIER.RigidBody, TrailMesh> = new Map()
  private trailMaterials: Map<TrailMesh, StandardMaterial> = new Map()
  private ballTrails: Map<RAPIER.RigidBody, BallTrailData> = new Map()
  private ballDataMap: Map<RAPIER.RigidBody, BallData> = new Map()
  private goldBallCount = 0
  private onGoldBallCollected?: (type: BallType, points: number) => void
  private glowTime = 0

  private smallGoldBallLifetimes: Map<RAPIER.RigidBody, number> = new Map()
  private smallGoldBallSpawnTime: Map<RAPIER.RigidBody, number> = new Map()

  private swarmGroups: Map<number, SwarmGroup> = new Map()
  private ballSwarmId: Map<RAPIER.RigidBody, number> = new Map()
  private nextSwarmId = 1

  private ballStuckTimers: Map<RAPIER.RigidBody, BallStuckTracker> = new Map()
  private chainMultiball: MultiballState = {
    isActive: false,
    chainLevel: 0,
    ballSaveUsed: false,
    ballSaveExpiresAtMs: 0,
  }

  ballSaveSystem = new BallSaveSystem({ graceMs: GAME_TUNING.feedback.ballSaveGraceSeconds * 1000 })

  constructor(scene: Scene, world: RAPIER.World, rapier: typeof RAPIER, bindings: PhysicsBinding[]) {
    this.scene = scene
    this.world = world
    this.rapier = rapier
    this.bindings = bindings
    this.matLib = getMaterialLibrary(scene)
  }

  private asHost(): BallManagerHost {
    void [
      this.scene, this.mirrorTexture, this.matLib, this.onGoldBallCollected, this.glowTime, this.smallGoldBallLifetimes, this.smallGoldBallSpawnTime,
      this.swarmGroups, this.ballSwarmId, this.nextSwarmId, this.ballStuckTimers, this.chainMultiball, this.addTrailForBall, this.playSpawnEffect,
    ]
    return this as unknown as BallManagerHost
  }

  setMirrorTexture(texture: MirrorTexture): void {
    this.mirrorTexture = texture
  }

  getBindings(): PhysicsBinding[] {
    return this.bindings
  }

  createMainBall(): RAPIER.RigidBody {
    return createMainBall(this.asHost())
  }

  spawnExtraBalls(count: number, position?: Vector3): void {
    spawnExtraBalls(this.asHost(), count, position)
  }

  resetBall(): void {
    resetBall(this.asHost())
  }

  removeBall(body: RAPIER.RigidBody): void {
    this.ballDataMap.delete(body)
    cleanupSwarmTrackingOnRemove(this.asHost(), body)

    const idx = this.ballBodies.indexOf(body)
    if (idx !== -1) {
      this.world.removeRigidBody(body)
      this.ballBodies.splice(idx, 1)

      const bIdx = this.bindings.findIndex((b) => b.rigidBody === body)
      if (bIdx !== -1) {
        this.bindings[bIdx].mesh.dispose()
        this.bindings.splice(bIdx, 1)
      }

      const trail = this.trails.get(body)
      if (trail) {
        this.trailMaterials.delete(trail)
        trail.dispose()
        this.trails.delete(body)
      }
      this.ballTrails.delete(body)
    }

    if (this.ballBody === body) {
      this.ballBody = this.ballBodies[0] ?? null
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

    for (let i = this.bindings.length - 1; i >= 0; i--) {
      const b = this.bindings[i]
      if (!b.mesh.name.startsWith('ball')) continue
      if (b.rigidBody === this.ballBody) continue
      b.mesh.dispose()
      this.bindings.splice(i, 1)
    }
    this.endMultiball()
  }

  getScoreMultiplier(): number {
    return getScoreMultiplier(this.asHost())
  }

  canSaveDrain(currentMs: number = nowMs()): boolean {
    return canSaveDrain(this.asHost(), currentMs)
  }

  startMultiball(totalBalls: number, ballSaveMs: number = GAME_TUNING.multiball.drainGraceMs): {
    started: boolean
    spawnedBalls: number
    scoreMultiplier: number
    ballsInPlay: number
    chainLevel: number
    ballSaveRemainingMs: number
  } {
    return startMultiball(this.asHost(), totalBalls, ballSaveMs)
  }

  triggerForcedMultiball(totalBalls: number, reason: string): {
    started: boolean
    spawnedBalls: number
    scoreMultiplier: number
    ballsInPlay: number
    chainLevel: number
    ballSaveRemainingMs: number
  } {
    return triggerForcedMultiball(this.asHost(), totalBalls, reason)
  }

  registerDrain(drainedBody: RAPIER.RigidBody): {
    ballSaved: boolean
    multiballEnded: boolean
    scoreMultiplier: number
    ballsInPlay: number
    ballSaveRemainingMs: number
  } {
    return registerDrain(this.asHost(), drainedBody)
  }

  endMultiball(): void {
    endMultiball(this.asHost())
  }

  getChainStats(): {
    isActive: boolean
    chainLevel: number
    ballsInPlay: number
    scoreMultiplier: number
    ballSaveAvailable: boolean
    ballSaveRemainingMs: number
  } {
    return getChainStats(this.asHost())
  }

  activateHologramCatch(ball: RAPIER.RigidBody, targetPos: Vector3, duration: number): void {
    ball.setBodyType(this.rapier.RigidBodyType.KinematicPositionBased, true)
    this.caughtBalls.push({ body: ball, targetPos: targetPos.clone(), timer: duration })

    const mesh = this.bindings.find((b) => b.rigidBody === ball)?.mesh as Mesh
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

        const mesh = this.bindings.find((b) => b.rigidBody === catchData.body)?.mesh as Mesh
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
    // Heal stale primary pointer after removeBall races / incomplete drain paths.
    if (this.ballBody && typeof this.ballBody.isValid === 'function' && !this.ballBody.isValid()) {
      this.ballBody = this.ballBodies.find((b) => b.isValid?.() !== false) ?? null
    }
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

  updateBallMaterialColor(mapColorHex: string): void {
    updateBallMaterialColor(this.asHost(), mapColorHex)
  }

  updateGoldBallGlow(dt: number): void {
    updateGoldBallGlow(this.asHost(), dt)
  }

  updateTrailEffects(): void {
    updateTrailEffects(this.asHost())
  }

  updateSmallGoldBallLifetimes(dt: number): void {
    updateSmallGoldBallLifetimes(this.asHost(), dt)
  }

  updateStuckDetection(dt: number): RAPIER.RigidBody[] {
    return updateStuckDetection(this.asHost(), dt)
  }

  applyBallSkin(skinId: string): void {
    applyBallSkin(this.asHost(), skinId)
  }

  applyBallTrail(trailId: string): void {
    applyBallTrail(this.asHost(), trailId)
  }

  clearRewards(): void {
    clearRewards(this.asHost())
  }

  private playSpawnEffect(position: Vector3, type: BallType, swarmBurst = false): void {
    playSpawnEffect(this.asHost(), position, type, swarmBurst)
  }

  createBallOfType(type: BallType, position?: Vector3, playEffect = false): RAPIER.RigidBody {
    return createBallOfType(this.asHost(), type, position, playEffect)
  }

  spawnSmallGoldBallSwarm(position?: Vector3, baseType: BallType = BallType.GOLD_PLATED): RAPIER.RigidBody[] {
    return spawnSmallGoldBallSwarm(this.asHost(), position, baseType)
  }

  private addTrailForBall(body: RAPIER.RigidBody, colorHex: string): void {
    addTrailForBall(this.asHost(), body, colorHex)
  }

  getBallType(body: RAPIER.RigidBody): BallType {
    return this.ballDataMap.get(body)?.type || BallType.STANDARD
  }

  getBallMeshesByType(type: BallType): Mesh[] {
    const result: Mesh[] = []
    for (const binding of this.bindings) {
      const data = this.ballDataMap.get(binding.rigidBody)
      if (data?.type === type) {
        result.push(binding.mesh as Mesh)
      }
    }
    return result
  }

  getBallData(body: RAPIER.RigidBody): BallData | undefined {
    return this.ballDataMap.get(body)
  }

  collectBall(body: RAPIER.RigidBody): {
    type: BallType
    points: number
    jackpotEligible: boolean
    quickCollectBonus?: { multiplier: number; totalPoints: number }
  } | null {
    return collectBallFromGold(this.asHost(), body)
  }

  setOnGoldBallCollected(callback: (type: BallType, points: number) => void): void {
    this.onGoldBallCollected = callback
  }

  getGoldBallCount(): number {
    return this.goldBallCount
  }

  startBallSaveGraceWindow(): void {
    this.ballSaveSystem.onBallLaunched(nowMs())
  }

  spawnRandomBall(position?: Vector3): RAPIER.RigidBody {
    return spawnRandomBall(this.asHost(), position)
  }
}
