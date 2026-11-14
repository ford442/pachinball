import type { PhysicsApi, PhysicsBody, PhysicsWorldSink } from '../core/physics-api'
import { CapturedBall } from '../core/captured-ball'
import type { Vec3Like } from '../core/vec3-scalar'
import { BallType, GAME_TUNING } from '../config'
import { BallSaveSystem } from './ball-save-system'
import { getSessionRngFork, RNG_FORK } from '../core/seeded-rng'
import {
  type BallManagerHost,
  type BallStuckTracker,
  type BallView,
  type MultiballState,
  nowMs,
  type SwarmGroup,
} from './ball-manager-context'
import {
  cleanupSwarmTrackingOnRemove,
  collectBall as collectBallFromGold,
  spawnSmallGoldBallSwarm,
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
  createBallOfType,
  createMainBall,
  resetBall,
  spawnExtraBalls,
  spawnRandomBall,
} from './ball-manager-spawn'
import { updateStuckDetection } from './ball-manager-stuck'
import type { StaticSceneGate } from '../core/static-scene-gate'
import type { BallData, PhysicsBinding } from './types'
import type { BallPresentation } from './ball-presentation'

/** A mesh as the cosmetic API hands it out (`getBallMeshesByType`); typed without Babylon. */
type BallMesh = ReturnType<BallPresentation['getBallMeshesByType']>[number]

/**
 * Ball spawning, collection, multiball, captures and stuck detection — the sim half. The state the
 * `ball-manager-*` helper modules read and write is the public `BallManagerHost` surface (the class
 * passes `this`); everything else should go through the methods.
 *
 * Meshes, trails, lights and particles are the `view`'s (`BallPresentation` in the game, `null` on
 * the headless replay runner, #528): this file imports no Babylon. The cosmetic methods below
 * (`updateTrailEffects`, `applyBallSkin`, …) forward to the view and do nothing without one.
 */
export class BallManager implements BallManagerHost {
  world: PhysicsWorldSink
  rapier: PhysicsApi
  readonly view: BallView | null
  private readonly presentation: BallPresentation | null
  private readonly capture: CapturedBall
  ballBody: PhysicsBody | null = null
  ballBodies: PhysicsBody[] = []
  caughtBalls: Array<{ body: PhysicsBody; targetPos: Vec3Like; timer: number }> = []
  private staticSceneGate: Pick<StaticSceneGate, 'invalidate'> | null = null
  ballDataMap: Map<PhysicsBody, BallData> = new Map()
  goldBallCount = 0
  onGoldBallCollected?: (type: BallType, points: number) => void

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

  /** `presentation` draws the balls; null runs the sim alone (headless replay, unit tests). */
  constructor(world: PhysicsWorldSink, rapier: PhysicsApi, presentation: BallPresentation | null = null) {
    this.world = world
    this.rapier = rapier
    this.capture = new CapturedBall(rapier)
    this.presentation = presentation
    this.view = presentation
    presentation?.attach(this)
  }

  /** Balls come and go in a scene the gate may have frozen; every spawn / removal thaws it. */
  setStaticSceneGate(gate: Pick<StaticSceneGate, 'invalidate'> | null): void {
    this.staticSceneGate = gate
  }

  getBindings(): PhysicsBinding[] {
    return this.presentation?.bindings ?? []
  }

  createMainBall(): PhysicsBody {
    this.staticSceneGate?.invalidate('ball:spawn')
    return createMainBall(this)
  }

  spawnExtraBalls(count: number, position?: Vec3Like): void {
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
      this.view?.removed(body)
    }

    if (this.ballBody === body) {
      this.ballBody = this.ballBodies[0] ?? null
    }
  }

  removeExtraBalls(): void {
    this.staticSceneGate?.invalidate('ball:collect')
    for (let i = this.ballBodies.length - 1; i >= 0; i--) {
      const rb = this.ballBodies[i]
      if (rb && rb !== this.ballBody) {
        this.world.removeRigidBody(rb)
        this.ballBodies.splice(i, 1)
        // Their trails used to outlive them (and their materials never went away).
        this.view?.disposeTrail(rb)
      }
    }

    this.view?.removedExtras(this.ballBody)
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

  activateHologramCatch(ball: PhysicsBody, targetPos: Vec3Like, duration: number): void {
    this.capture.capture(ball)
    this.caughtBalls.push({ body: ball, targetPos: { x: targetPos.x, y: targetPos.y, z: targetPos.z }, timer: duration })
    this.view?.caught(ball)
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
        this.view?.released(catchData.body)

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
    this.presentation?.updateBallMaterialColor(mapColorHex)
  }

  updateGoldBallGlow(dt: number): void {
    this.presentation?.updateGoldBallGlow(dt)
  }

  updateTrailEffects(): void {
    this.presentation?.updateTrailEffects()
  }

  updateSmallGoldBallLifetimes(dt: number): void {
    updateSmallGoldBallLifetimes(this, dt)
  }

  updateStuckDetection(dt: number): readonly PhysicsBody[] {
    return updateStuckDetection(this, dt)
  }

  applyBallSkin(skinId: string): void {
    this.presentation?.applyBallSkin(skinId)
  }

  applyBallTrail(trailId: string): void {
    this.presentation?.applyBallTrail(trailId)
  }

  clearRewards(): void {
    this.presentation?.clearRewards()
  }

  playSpawnEffect(position: Vec3Like, type: BallType, swarmBurst = false): void {
    this.view?.spawnEffect(position, type, swarmBurst)
  }

  createBallOfType(type: BallType, position?: Vec3Like, playEffect = false): PhysicsBody {
    this.staticSceneGate?.invalidate('ball:spawn')
    return createBallOfType(this, type, position, playEffect)
  }

  spawnSmallGoldBallSwarm(position?: Vec3Like, baseType: BallType = BallType.GOLD_PLATED): PhysicsBody[] {
    this.staticSceneGate?.invalidate('ball:spawn')
    return spawnSmallGoldBallSwarm(this, position, baseType)
  }

  addTrailForBall(body: PhysicsBody, colorHex: string): void {
    this.presentation?.addTrailForBall(body, colorHex)
  }

  getBallType(body: PhysicsBody): BallType {
    return this.ballDataMap.get(body)?.type || BallType.STANDARD
  }

  getBallMeshesByType(type: BallType): BallMesh[] {
    return this.presentation?.getBallMeshesByType(type) ?? []
  }

  /** Whether the sim tracks a tier for this body (the presentation's `getBallMeshesByType`). */
  hasBallData(body: PhysicsBody): boolean {
    return this.ballDataMap.has(body)
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

  spawnRandomBall(position?: Vec3Like): PhysicsBody {
    return spawnRandomBall(this, position)
  }
}
