import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { TrailMesh } from '@babylonjs/core/Meshes/trailMesh'
import { Scene } from '@babylonjs/core/scene'
import type { PhysicsApi, PhysicsBody, PhysicsWorldSink } from '../core/physics-api'
import { CapturedBall } from '../core/captured-ball'
import { BallType, GAME_TUNING } from '../config'
import { getMaterialLibrary } from '../materials'
import { TrailMaterialPool } from '../materials/material-trail'
import { BallSaveSystem } from './ball-save-system'
import { getSessionRngFork, RNG_FORK } from '../core/seeded-rng'
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
import type { StaticSceneGate } from '../core/static-scene-gate'
import type { BallData, PhysicsBinding } from './types'

/**
 * Ball spawning, collection and per-frame ball effects. The state the `ball-manager-*` helper
 * modules read and write is the public `BallManagerHost` surface (the class passes `this`);
 * everything else should go through the methods.
 */
export class BallManager implements BallManagerHost {
  scene: Scene
  world: PhysicsWorldSink
  rapier: PhysicsApi
  private readonly capture: CapturedBall
  ballBody: PhysicsBody | null = null
  ballBodies: PhysicsBody[] = []
  caughtBalls: Array<{ body: PhysicsBody; targetPos: Vector3; timer: number }> = []
  private staticSceneGate: Pick<StaticSceneGate, 'invalidate'> | null = null
  bindings: PhysicsBinding[] = []
  matLib: ReturnType<typeof getMaterialLibrary>
  trails: Map<PhysicsBody, TrailMesh> = new Map()
  trailMaterials: Map<TrailMesh, StandardMaterial> = new Map()
  trailMaterialPool: TrailMaterialPool
  ballTrails: Map<PhysicsBody, BallTrailData> = new Map()
  ballDataMap: Map<PhysicsBody, BallData> = new Map()
  goldBallCount = 0
  onGoldBallCollected?: (type: BallType, points: number) => void
  glowTime = 0

  smallGoldBallLifetimes: Map<PhysicsBody, number> = new Map()
  smallGoldBallSpawnTime: Map<PhysicsBody, number> = new Map()

  swarmGroups: Map<number, SwarmGroup> = new Map()
  ballSwarmId: Map<PhysicsBody, number> = new Map()
  nextSwarmId = 1

  ballStuckTimers: Map<PhysicsBody, BallStuckTracker> = new Map()
  readonly stuckBallsScratch: PhysicsBody[] = []
  chainMultiball: MultiballState = {
    isActive: false,
    chainLevel: 0,
    ballSaveUsed: false,
    ballSaveExpiresAtMs: 0,
  }

  ballSaveSystem = new BallSaveSystem({ graceMs: GAME_TUNING.feedback.ballSaveGraceSeconds * 1000 })

  constructor(scene: Scene, world: PhysicsWorldSink, rapier: PhysicsApi, bindings: PhysicsBinding[]) {
    this.scene = scene
    this.world = world
    this.rapier = rapier
    this.capture = new CapturedBall(rapier)
    this.bindings = bindings
    this.matLib = getMaterialLibrary(scene)
    this.trailMaterialPool = new TrailMaterialPool(scene)
  }

  /** Balls come and go in a scene the gate may have frozen; every spawn / removal thaws it. */
  setStaticSceneGate(gate: Pick<StaticSceneGate, 'invalidate'> | null): void {
    this.staticSceneGate = gate
  }

  getBindings(): PhysicsBinding[] {
    return this.bindings
  }

  createMainBall(): PhysicsBody {
    this.staticSceneGate?.invalidate('ball:spawn')
    return createMainBall(this)
  }

  spawnExtraBalls(count: number, position?: Vector3): void {
    this.staticSceneGate?.invalidate('ball:spawn')
    spawnExtraBalls(this, count, position)
  }

  resetBall(): void {
    this.staticSceneGate?.invalidate('ball:spawn')
    resetBall(this)
  }

  removeBall(body: PhysicsBody): void {
    this.staticSceneGate?.invalidate('ball:collect')
    this.ballDataMap.delete(body)
    cleanupSwarmTrackingOnRemove(this, body)

    const idx = this.ballBodies.indexOf(body)
    if (idx !== -1) {
      this.world.removeRigidBody(body)
      this.ballBodies.splice(idx, 1)

      const bIdx = this.bindings.findIndex((b) => b.rigidBody === body)
      const binding = this.bindings[bIdx]
      if (binding) {
        binding.mesh.dispose()
        this.bindings.splice(bIdx, 1)
      }

      this.disposeTrail(body)
    }

    if (this.ballBody === body) {
      this.ballBody = this.ballBodies[0] ?? null
    }
  }

  /** Dispose a ball's ribbon trail and hand its material back to the pool. */
  private disposeTrail(body: PhysicsBody): void {
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

  removeExtraBalls(): void {
    this.staticSceneGate?.invalidate('ball:collect')
    for (let i = this.ballBodies.length - 1; i >= 0; i--) {
      const rb = this.ballBodies[i]
      if (rb && rb !== this.ballBody) {
        this.world.removeRigidBody(rb)
        this.ballBodies.splice(i, 1)
        // Their trails used to outlive them (and their materials never went away).
        this.disposeTrail(rb)
      }
    }

    for (let i = this.bindings.length - 1; i >= 0; i--) {
      const b = this.bindings[i]
      if (!b || !b.mesh.name.startsWith('ball')) continue
      if (b.rigidBody === this.ballBody) continue
      b.mesh.dispose()
      this.bindings.splice(i, 1)
    }
    this.endMultiball()
  }

  getScoreMultiplier(): number {
    return getScoreMultiplier(this)
  }

  canSaveDrain(currentMs: number = nowMs()): boolean {
    return canSaveDrain(this, currentMs)
  }

  startMultiball(totalBalls: number, ballSaveMs: number = GAME_TUNING.multiball.drainGraceMs): {
    started: boolean
    spawnedBalls: number
    scoreMultiplier: number
    ballsInPlay: number
    chainLevel: number
    ballSaveRemainingMs: number
  } {
    return startMultiball(this, totalBalls, ballSaveMs)
  }

  triggerForcedMultiball(totalBalls: number, reason: string): {
    started: boolean
    spawnedBalls: number
    scoreMultiplier: number
    ballsInPlay: number
    chainLevel: number
    ballSaveRemainingMs: number
  } {
    return triggerForcedMultiball(this, totalBalls, reason)
  }

  registerDrain(drainedBody: PhysicsBody): {
    ballSaved: boolean
    multiballEnded: boolean
    scoreMultiplier: number
    ballsInPlay: number
    ballSaveRemainingMs: number
  } {
    return registerDrain(this, drainedBody)
  }

  endMultiball(): void {
    endMultiball(this)
  }

  getChainStats(): {
    isActive: boolean
    chainLevel: number
    ballsInPlay: number
    scoreMultiplier: number
    ballSaveAvailable: boolean
    ballSaveRemainingMs: number
  } {
    return getChainStats(this)
  }

  activateHologramCatch(ball: PhysicsBody, targetPos: Vector3, duration: number): void {
    this.capture.capture(ball)
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

  updateCaughtBalls(dt: number, onRelease: (ball: PhysicsBody) => void): void {
    for (let i = this.caughtBalls.length - 1; i >= 0; i--) {
      const catchData = this.caughtBalls[i]
      if (!catchData) continue
      catchData.timer -= dt

      const current = catchData.body.translation()
      const target = catchData.targetPos
      // Improved kinematic following: exponential decay for frame-rate independence
      const lerpFactor = 1 - Math.exp(-5 * dt)
      const nextX = current.x + (target.x - current.x) * lerpFactor
      const nextY = current.y + (target.y - current.y) * lerpFactor
      const nextZ = current.z + (target.z - current.z) * lerpFactor
      this.capture.steer(catchData.body, { translation: { x: nextX, y: nextY, z: nextZ } })

      if (catchData.timer <= 0) {
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

        this.capture.release(catchData.body, {
          impulse: { x: (getSessionRngFork(RNG_FORK.SPAWN).next() - 0.5) * 5, y: 5, z: 5 },
        })
        onRelease(catchData.body)
        this.caughtBalls.splice(i, 1)
      }
    }
  }

  getBallBody(): PhysicsBody | null {
    // Heal stale primary pointer after removeBall races / incomplete drain paths.
    if (this.ballBody && typeof this.ballBody.isValid === 'function' && !this.ballBody.isValid()) {
      this.ballBody = this.ballBodies.find((b) => b.isValid?.() !== false) ?? null
    }
    return this.ballBody
  }

  getBallBodies(): PhysicsBody[] {
    return this.ballBodies
  }

  setBallBody(body: PhysicsBody | null): void {
    this.ballBody = body
  }

  hasBalls(): boolean {
    return this.ballBodies.length > 0
  }

  updateBallMaterialColor(mapColorHex: string): void {
    updateBallMaterialColor(this, mapColorHex)
  }

  updateGoldBallGlow(dt: number): void {
    updateGoldBallGlow(this, dt)
  }

  updateTrailEffects(): void {
    updateTrailEffects(this)
  }

  updateSmallGoldBallLifetimes(dt: number): void {
    updateSmallGoldBallLifetimes(this, dt)
  }

  updateStuckDetection(dt: number): readonly PhysicsBody[] {
    return updateStuckDetection(this, dt)
  }

  applyBallSkin(skinId: string): void {
    applyBallSkin(this, skinId)
  }

  applyBallTrail(trailId: string): void {
    applyBallTrail(this, trailId)
  }

  clearRewards(): void {
    clearRewards(this)
  }

  playSpawnEffect(position: Vector3, type: BallType, swarmBurst = false): void {
    playSpawnEffect(this, position, type, swarmBurst)
  }

  createBallOfType(type: BallType, position?: Vector3, playEffect = false): PhysicsBody {
    this.staticSceneGate?.invalidate('ball:spawn')
    return createBallOfType(this, type, position, playEffect)
  }

  spawnSmallGoldBallSwarm(position?: Vector3, baseType: BallType = BallType.GOLD_PLATED): PhysicsBody[] {
    this.staticSceneGate?.invalidate('ball:spawn')
    return spawnSmallGoldBallSwarm(this, position, baseType)
  }

  addTrailForBall(body: PhysicsBody, colorHex: string): void {
    addTrailForBall(this, body, colorHex)
  }

  getBallType(body: PhysicsBody): BallType {
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

  getBallData(body: PhysicsBody): BallData | undefined {
    return this.ballDataMap.get(body)
  }

  collectBall(body: PhysicsBody): {
    type: BallType
    points: number
    jackpotEligible: boolean
    quickCollectBonus?: { multiplier: number; totalPoints: number }
  } | null {
    return collectBallFromGold(this, body)
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

  spawnRandomBall(position?: Vector3): PhysicsBody {
    return spawnRandomBall(this, position)
  }
}
