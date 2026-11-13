/**
 * Frame-scheduler `visuals` phase: camera, effects, trails and the backbox — everything the coming
 * `scene.render()` shows, computed from this frame's sim state.
 *
 * Split out of `physics-controller.ts`; `GamePhysicsController.updateVisuals()` calls `update()`.
 */

import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { PhysicsFrameState, PhysicsHost } from './types'
import type { MeshInterpolationSystem } from './mesh-interpolation'
import type { PhysicsBody } from '../../core/physics-api'
import { BallType } from '../../config'
import { CameraMode } from '../../game-elements'
import { QualityTier } from '../../game-elements/visual-language'

interface TrailInfo {
  body: PhysicsBody
  mesh: Mesh
  type: BallType
}

/** Shared empty list for "no ball manager", so the fallback allocates nothing. Never mutated. */
const NO_BODIES: PhysicsBody[] = []

// Scratch vectors for the per-frame path. Every consumer copies what it keeps (checked:
// CameraController clones, the atmosphere only reads).
const scratchBallPos = new Vector3()
const scratchBallVel = new Vector3()

export class VisualPhase {
  /** Reused per frame (#488 §5): the camera policy, the trail list and its records. */
  private readonly cameraPolicy: { reducedMotion: boolean; photosensitiveMode: boolean; qualityTier: QualityTier } = {
    reducedMotion: false,
    photosensitiveMode: false,
    qualityTier: QualityTier.MEDIUM,
  }
  private readonly trailInfos: TrailInfo[] = []
  private readonly trailInfoPool: TrailInfo[] = []
  private readonly trailMeshByBody = new Map<PhysicsBody, Mesh>()

  constructor(
    private readonly host: PhysicsHost,
    private readonly meshInterpolation: MeshInterpolationSystem,
    private readonly frame: PhysicsFrameState,
  ) {}

  update(): void {
    if (!this.frame.stepped) return
    const dt = this.frame.dt
    const { effects } = this.host
    const ballManager = this.host.ballManager
    const ballBody = ballManager?.getBallBody() ?? null
    // The camera, atmosphere and follow target use the position the ball mesh is drawn at.
    const ballPos = ballBody ? this.meshInterpolation.getInterpolatedPosition(ballBody, this.frame.alpha, scratchBallPos) : undefined

    // Camera controller
    if (this.host.cameraController && ballBody && ballPos) {
      const lifecycleMode = this.host.getCameraMode()
      const cameraMode = this.host.isCameraFollowMode ? CameraMode.BALL_FOLLOW : lifecycleMode

      if (cameraMode === CameraMode.ADVENTURE) {
        this.host.cameraController.resetDynamicState()
      } else {
        const vel = ballBody.linvel()
        this.cameraPolicy.reducedMotion = this.host.accessibility.reducedMotion
        this.cameraPolicy.photosensitiveMode = this.host.accessibility.maxCameraShakeIntensity <= 0
        this.cameraPolicy.qualityTier = this.host.qualityTier
        this.host.cameraController.update(
          dt,
          ballPos,
          scratchBallVel.set(vel.x, vel.y, vel.z),
          cameraMode,
          this.cameraPolicy,
        )
      }
      if (this.host.isCameraFollowMode && this.host.tableCam) {
        const targetY = ballPos.y + 2.5
        this.host.tableCam.target.y += (targetY - this.host.tableCam.target.y) * dt * 5
      }
    }

    this.host.gameObjects?.updateBumpers(dt)

    effects?.updateShards(dt)
    effects?.updateBloom()
    effects?.updateCabinetLighting()
    effects?.updateSlotLighting()
    effects?.updateAtmosphere(dt, ballPos)

    ballManager?.updateTrailEffects()
    ballManager?.updateGoldBallGlow(dt)

    const ballBodies = ballManager?.getBallBodies() ?? NO_BODIES
    const isFever = effects?.currentLightingMode === 'fever'
    effects?.update(dt, ballBodies, isFever)
    if (effects) effects.updateTrails(this.collectTrailInfos(ballBodies))

    const jackpotPhase = effects?.jackpotPhase || 0
    this.host.display?.update(dt, jackpotPhase)

    // Drive bumper JACKPOT visuals during the Cyber-Shock sequence (especially phase 3 meltdown)
    if (effects?.isJackpotActive) {
      this.host.gameObjects?.setBumperState('JACKPOT')
    }
  }

  /**
   * The balls that have a mesh, with their type, for the trail effect. One reused array and one
   * reused record per slot; the bindings are walked once (a map from body to mesh), not once per ball.
   */
  private collectTrailInfos(ballBodies: readonly PhysicsBody[]): TrailInfo[] {
    const out = this.trailInfos
    out.length = 0
    const ballManager = this.host.ballManager
    if (!ballManager) return out
    const meshByBody = this.trailMeshByBody
    meshByBody.clear()
    for (const binding of ballManager.getBindings()) {
      if (binding.mesh) meshByBody.set(binding.rigidBody, binding.mesh as Mesh)
    }
    for (const body of ballBodies) {
      const mesh = meshByBody.get(body)
      if (!mesh) continue
      let record = this.trailInfoPool[out.length]
      if (!record) {
        record = { body, mesh, type: BallType.STANDARD }
        this.trailInfoPool.push(record)
      }
      record.body = body
      record.mesh = mesh
      record.type = ballManager.getBallType(body) || BallType.STANDARD
      out.push(record)
    }
    meshByBody.clear()
    return out
  }
}
