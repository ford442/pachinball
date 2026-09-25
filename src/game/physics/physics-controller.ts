/**
 * Game Physics Controller — Physics stepping, collision processing, nudge/tilt, ball loss.
 *
 * This file is now a thin orchestrator. Fixed-step order, collision dispatch,
 * scoring hooks, mesh interpolation, and the WASM mirror each live in focused
 * modules under `src/game/physics/`.
 */

import type { PhysicsHost } from './types'
import { MeshInterpolationSystem } from './mesh-interpolation'
import { WasmMirror } from './wasm-mirror'
import { WasmOwner, type AdventureTrackState } from './wasm-owner'
import { ScoringBridge } from './scoring-bridge'
import { CollisionDispatcher } from './collision-dispatch'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { PhysicsBody } from '../../core/physics-api'

import { type InputFrame, type ReplayRecorder, type ReplayRunner } from '../../game-elements'
import { BallType, GAME_TUNING, GameConfig } from '../../config'
import { getPhysicsTuningValue } from '../../game-elements/physics-tuning'
import { DisplayState } from '../../game-elements'
import { CameraMode } from '../../game-elements'
import { QualityTier } from '../../game-elements/visual-language'
import type { WasmContactEvent } from '../../wasm'

/** Shared surface for mirror and owner WASM bridges. */
import type { WasmContactBridge } from './collision-dispatch'

export class GamePhysicsController {
  private readonly host: PhysicsHost

  /** WASM bridge for mirror or owner mode. */
  private wasmBridge: WasmContactBridge | null = null
  private wasmMirror: WasmMirror | null = null
  private wasmOwner: WasmOwner | null = null

  private readonly scoringBridge: ScoringBridge
  private readonly collisionDispatcher: CollisionDispatcher
  private readonly meshInterpolation = new MeshInterpolationSystem()
  private eventBusUnsubscribers: Array<() => void> = []

  constructor(host: PhysicsHost) {
    this.host = host
    this.scoringBridge = new ScoringBridge(host)
    this.collisionDispatcher = new CollisionDispatcher(host, this.scoringBridge, () => this.wasmBridge)

    // Route 'effect:flash' to EffectsSystem (respects accessibility guards internally)
    this.eventBusUnsubscribers.push(
      host.eventBus.on('effect:flash', (data) => {
        if (data.color) {
          this.host.effects?.flashVignette(data.color, data.duration * 1000)
        }
      })
    )

    // Route 'effect:shake' to EffectsSystem
    this.eventBusUnsubscribers.push(
      host.eventBus.on('effect:shake', (data) => {
        if (!this.host.accessibility.reducedMotion) {
          this.host.effects?.addCameraShake(data.amount)
        }
      })
    )

    // Route WASM contact events to the same dispatcher used for Rapier collisions.
    // The wrapper already emits these on the EventBus; we just map WASM IDs back to
    // the Rapier bodies that the scoring/effects code expects.
    this.eventBusUnsubscribers.push(
      host.eventBus.on('wasm:physics:contact', (evt: WasmContactEvent) => {
        this.collisionDispatcher.onWasmContact(evt)
      })
    )
  }

  /** Clean up EventBus subscriptions. Must be called when the controller is torn down. */
  dispose(): void {
    this.collisionDispatcher.dispose()
    this.scoringBridge.dispose()
    for (const unsub of this.eventBusUnsubscribers) {
      unsub()
    }
    this.eventBusUnsubscribers = []
  }

  rebuildHandleCaches(): void {
    const wasmActive = this.host.physics.isWasmActive?.() ?? false
    const isOwner = this.host.physics.isWasmOwnerMode?.() ?? false

    if (wasmActive) {
      const engine = this.host.physics.getWasmEngine?.()
      if (engine) {
        engine.init(this.host.eventBus)
        if (isOwner) {
          this.wasmMirror?.clear()
          this.wasmMirror = null
          // PhysicsSystem builds the table world whenever it runs an owner mode.
          const tableWorld = this.host.physics.getWasmTableWorld?.() ?? null
          if (!this.wasmOwner && tableWorld) {
            this.wasmOwner = new WasmOwner(engine, tableWorld)
            this.wasmOwner.setTableScope(() => this.host.gameObjects?.getWasmExportBodies() ?? [])
          }
          this.wasmBridge = this.wasmOwner
          if (this.wasmOwner) {
            const adventureActive = this.host.adventureMode?.isActive() ?? false
            this.wasmOwner.rebuild(
              [...(this.host.gameObjects?.getAllFlippers?.().values() ?? [])].map((f) => f.body),
              this.adventureTrackState(adventureActive),
            )
            this.attachAdventureBridge()
            this.host.physics.setWasmDebugColliders?.(this.wasmOwner.getDebugColliders())
          }
        } else {
          this.wasmOwner?.dispose()
          this.wasmOwner = null
          this.host.physics.setWasmDebugColliders?.([])
          if (!this.wasmMirror) {
            this.wasmMirror = new WasmMirror(engine)
          }
          this.wasmBridge = this.wasmMirror
          this.wasmMirror.rebuild(
            this.host.ballManager?.getBallBodies() || [],
            this.host.gameObjects?.getBumperBodies() || [],
            this.host.gameObjects?.getBumperVisuals() || []
          )
        }
      }
    } else {
      this.wasmMirror?.clear()
      this.wasmOwner?.dispose()
      this.wasmMirror = null
      this.wasmOwner = null
      this.wasmBridge = null
      this.host.physics.setWasmDebugColliders?.([])
    }

    // Built last so owner mode keys every set on the WASM ids the rebuild just assigned.
    this.collisionDispatcher.rebuildHandleCaches()

    // Portal sensor handles are registered/unregistered dynamically via
    // registerPortalSensor / unregisterPortalSensor and are intentionally NOT
    // reset here — portals may already be active when the cache is rebuilt.
  }

  /**
   * Whether WASM owns the active adventure track, and what stopped it if not.
   * Exposed for the E2E cutover check and the debug HUD.
   */
  getAdventureOwnership(): {
    owned: boolean
    unsupported: ReadonlyArray<{ reason: string; index?: number; label?: string }>
  } {
    return {
      owned: this.wasmOwner?.isAdventureOwned() ?? false,
      unsupported: this.wasmOwner?.getAdventureUnsupported() ?? [],
    }
  }

  /**
   * Table colliders the C++ world is not simulating, each with a reason
   * (shape it cannot represent, or outside the owner table scope). Empty off
   * the owner path. Exposed for the debug HUD.
   */
  getTableUnexported(): ReadonlyArray<{ bodyHandle: number; colliderIndex: number; shape: string; reason: string }> {
    return this.wasmOwner?.getTableUnsupported() ?? []
  }

  /**
   * Install the WASM-backed overlap/impulse bridge on a running adventure
   * track so zone effects read C++ sensor contacts. Without it AdventureMode
   * answers overlaps analytically through `world.intersectionPair`.
   *
   * Called from rebuildHandleCaches, which already runs on adventure start,
   * end and track switch — exactly the moments the static world changes.
   */
  private attachAdventureBridge(): void {
    const adventureMode = this.host.adventureMode
    const owner = this.wasmOwner
    if (!owner || !adventureMode) return
    adventureMode.setPhysicsBridge(adventureMode.isActive() && owner.isAdventureOwned() ? owner.getPhysicsBridge() : null)
  }

  /**
   * Register an exit-portal sensor body handle so the collision dispatcher
   * can skip it cleanly.  Portal contact is detected by the sensor-overlap
   * test inside AdventureMode.updateExitPortal() (Rapier or WASM, via the
   * physics bridge); contact events for the sensor body are redundant and
   * must not reach other handlers.
   *
   * Call this immediately after AdventureMode.activateExitPortal() succeeds.
   */
  registerPortalSensor(handle: number): void {
    this.collisionDispatcher.registerPortalSensor(handle)
  }

  /**
   * Unregister a portal sensor handle when the portal is deactivated.
   * Safe to call with -1 or an unknown handle (no-op).
   */
  unregisterPortalSensor(handle: number): void {
    this.collisionDispatcher.unregisterPortalSensor(handle)
  }

  /** Number of registered exit-portal sensor handles — debug HUD diagnostics. */
  getPortalSensorHandleSetSize(): number {
    return this.collisionDispatcher.getPortalSensorHandleSetSize()
  }

  // Instrumentation getters for scoring audit
  getBumperHitsThisBall(): number {
    return this.scoringBridge.getBumperHitsThisBall()
  }
  getPointsThisBall(): number {
    return this.scoringBridge.getPointsThisBall()
  }
  getZoneEntriesThisBall(): number {
    return this.scoringBridge.getZoneEntriesThisBall()
  }
  getRawCollisionEvents(): number {
    return this.collisionDispatcher.getRawCollisionEvents()
  }
  getKnownObstacleMatches(): number {
    return this.collisionDispatcher.getKnownObstacleMatches()
  }
  getBumperMatches(): number {
    return this.collisionDispatcher.getBumperMatches()
  }
  getAwardScoreCalls(): number {
    return this.scoringBridge.getAwardScoreCalls()
  }
  getLastLaneHit(): string | null {
    return this.collisionDispatcher.getLastLaneHit()
  }
  getLaneSensorHandleMapSize(): number {
    return this.collisionDispatcher.getLaneSensorHandleMapSize()
  }
  resetBallScoreCounters(): void {
    this.collisionDispatcher.resetCollisionCounters()
    this.scoringBridge.resetBallScoreCounters()
  }

  applyInputFrame(frame: InputFrame): void {
    if (frame.flipperLeft !== null) {
      // Delegated to input actions
    }
    if (frame.flipperRight !== null) {
      // Delegated to input actions
    }
    if (frame.plunger) {
      // Delegated to input actions
    }
    if (frame.nudge) {
      this.applyNudge({ x: frame.nudge.x, y: frame.nudge.y, z: frame.nudge.z })
    }
  }

  /** Delegates mesh interpolation to MeshInterpolationSystem. */
  private syncMeshes(alpha: number): void {
    this.meshInterpolation.syncMeshes(alpha, this.host.gameObjects?.getBindings() || [])
  }


  /** Snapshot of the built adventure track for the C++ exporter, or null when adventure is not running. */
  private adventureTrackState(adventureActive: boolean): AdventureTrackState | null {
    const adventure = this.host.adventureMode
    if (!adventureActive || !adventure) return null
    return {
      epoch: adventure.getColliderEpoch(),
      descriptors: adventure.getColliderDescriptors(),
      unexported: adventure.getUnexportedColliders(),
      bodyForDescriptor: (index) => adventure.getBodyForDescriptor(index),
    }
  }

  stepPhysics(
    inputManager: { update: () => void; processBufferedInputs: () => InputFrame | null } | null,
    inputActions: { handleFlipperLeft: (p: boolean) => void; handleFlipperRight: (p: boolean) => void; handlePlunger: () => void; updatePlungerFrame?: (dt: number) => void } | null,
    replayRunner?: ReplayRunner | null,
    replayRecorder?: ReplayRecorder | null
  ): void {
    let inputFrame: InputFrame | null = null

    if (replayRunner && replayRunner.isPlaying()) {
      inputFrame = replayRunner.getNextFrame()
      const pos = this.getBallPosition()
      if (pos && this.host.ghostBallRenderer?.isVisible()) {
        this.host.ghostBallRenderer.updatePosition(pos)
      }
    } else {
      inputManager?.update()
      inputFrame = inputManager?.processBufferedInputs() ?? null
    }

    if (inputFrame) {
      if (replayRecorder && replayRecorder.isRecording() && (!replayRunner || !replayRunner.isPlaying()) && this.host.stateManager.isPlaying()) {
        replayRecorder.recordFrame(inputFrame)
      }
      const adventureActive = this.host.adventureMode?.isActive() ?? false
      if (!adventureActive) {
        if (inputFrame.flipperLeft !== null) inputActions?.handleFlipperLeft(inputFrame.flipperLeft)
        if (inputFrame.flipperRight !== null) inputActions?.handleFlipperRight(inputFrame.flipperRight)
        if (inputFrame.plunger) inputActions?.handlePlunger()
      }
      this.applyInputFrame(inputFrame)
    }

    if (!this.host.stateManager.isPlaying()) {
      // Mesh sync runs unconditionally so dynamic bodies (ball, flippers) appear at their
      // physics-body positions even during MENU state before the game starts. No physics
      // step has run, so render at the raw pose (alpha=1, i.e. no interpolation).
      this.syncMeshes(1)
      return
    }

    const rawDt = this.host.engine.getDeltaTime() / 1000
    // Advance plunger spring animation each frame (before physics step so kinematic body
    // is at the correct position when Rapier integrates contacts).
    inputActions?.updatePlungerFrame?.(Math.min(rawDt, 1 / 30))

    const wasmActive = this.host.physics.isWasmActive?.() ?? false
    const isOwner = this.host.physics.isWasmOwnerMode?.() ?? false
    const owner = isOwner ? this.wasmOwner : null

    if (wasmActive && !isOwner) {
      const syncT0 = performance.now()
      this.wasmMirror?.syncToWasm()
      this.host.physics.setMirrorOverheadMs?.(performance.now() - syncT0)
    }
    if (owner) {
      const stepDt = Math.min(rawDt, 1 / 30)
      // Pick up a track switch or a table edit before the step.
      owner.syncAdventureTrack(this.adventureTrackState(this.host.adventureMode?.isActive() ?? false))
      owner.syncStatics()
      owner.driveFlippers(inputFrame, stepDt)
      // Pin held balls; push the plunger, gates, pistons, platters and mills
      // into their C++ movers.
      owner.beginStep(stepDt)
      this.host.physics.setMirrorOverheadMs?.(0)
    }

    const alpha = this.host.physics.step(rawDt, (h1, h2, start) => {
      this.collisionDispatcher.processCollision(h1, h2, start)
    }, (h1, h2, maxForce) => {
      this.collisionDispatcher.processContactForce(h1, h2, maxForce)
    })

    if (owner) {
      owner.endStep()
    } else if (wasmActive) {
      const syncT0 = performance.now()
      this.wasmMirror?.syncFromWasm()
      const prev = this.host.physics.getLastMirrorOverheadMs?.() ?? 0
      this.host.physics.setMirrorOverheadMs?.(prev + (performance.now() - syncT0))
    }

    // Skip interpolation on LOW quality tier — render at the raw post-step pose.
    this.syncMeshes(this.host.qualityTier === QualityTier.LOW ? 1 : alpha)

    const dt = Math.min(rawDt, 1 / 30)

    // Camera controller
    if (this.host.cameraController && this.host.ballManager?.getBallBody()) {
      const ballBody = this.host.ballManager.getBallBody()!
      const pos = ballBody.translation()
      const vel = ballBody.linvel()
      const lifecycleMode = this.host.getCameraMode()
      const cameraMode = this.host.isCameraFollowMode ? CameraMode.BALL_FOLLOW : lifecycleMode

      if (cameraMode === CameraMode.ADVENTURE) {
        this.host.cameraController.resetDynamicState()
      } else {
        this.host.cameraController.update(
          dt,
          new Vector3(pos.x, pos.y, pos.z),
          new Vector3(vel.x, vel.y, vel.z),
          cameraMode,
          {
            reducedMotion: this.host.accessibility.reducedMotion,
            photosensitiveMode: this.host.accessibility.maxCameraShakeIntensity <= 0,
            qualityTier: this.host.qualityTier,
          }
        )
      }
      if (this.host.isCameraFollowMode && this.host.tableCam) {
        const targetY = pos.y + 2.5
        this.host.tableCam.target.y += (targetY - this.host.tableCam.target.y) * dt * 5
      }
    }

    // Dynamic world
    if (this.host.dynamicWorld && this.host.ballManager?.getBallBody()) {
      const ballBody = this.host.ballManager.getBallBody()!
      const pos = ballBody.translation()
      this.host.dynamicWorld.update(new Vector3(pos.x, pos.y, pos.z), dt)
    }

    // Debug HUD
    // (delegated to caller)

    // Adventure mode update
    const currentBallBodies = this.host.ballManager?.getBallBodies() || []
    this.host.adventureMode?.update(dt, currentBallBodies)
    this.host.zoneTriggerSystem?.update(currentBallBodies)

    this.host.gameObjects?.updateBumpers(dt)
    this.host.gameObjects?.updateTargets(dt)

    if (this.host.magSpinFeeder) {
      this.host.magSpinFeeder.update(dt, currentBallBodies)
    }
    if (this.host.nanoLoomFeeder) {
      this.host.nanoLoomFeeder.update(dt, currentBallBodies)
    }
    if (this.host.prismCoreFeeder) {
      this.host.prismCoreFeeder.update(dt, currentBallBodies)
    }
    if (this.host.gaussCannon) {
      this.host.gaussCannon.update(dt, currentBallBodies)
    }
    if (this.host.quantumTunnel) {
      this.host.quantumTunnel.update(dt, currentBallBodies)
    }

    this.host.ballManager?.updateCaughtBalls(dt, () => {
      this.host.effects?.playBeep(440)
    })

    this.host.effects?.updateShards(dt)
    this.host.effects?.updateBloom()
    this.host.effects?.updateCabinetLighting()
    this.host.effects?.updateSlotLighting()
    this.host.mapManager?.update(dt)
    this.host.zoneTriggerSystem?.update(currentBallBodies)
    this.host.adventureState.updateGoal('survive-time', dt)

    {
      const ballBody = this.host.ballManager?.getBallBody()
      const ballPos = ballBody ? (() => {
        const t = ballBody.translation()
        return new Vector3(t.x, t.y, t.z)
      })() : undefined
      this.host.effects?.updateAtmosphere(dt, ballPos)
    }

    this.host.ballManager?.updateTrailEffects()
    this.host.ballManager?.updateGoldBallGlow(dt)

    const ballBodies = this.host.ballManager?.getBallBodies() || []
    const isFever = this.host.effects?.currentLightingMode === 'fever'
    this.host.effects?.update(dt, ballBodies, isFever)

    const trailInfos = ballBodies
      .map((body) => {
        const binding = this.host.ballManager?.getBindings().find((b) => b.rigidBody === body)
        const mesh = binding?.mesh as Mesh | undefined
        const type = this.host.ballManager?.getBallType(body) || BallType.STANDARD
        return mesh ? { body, mesh, type } : null
      })
      .filter((info): info is NonNullable<typeof info> => info !== null)
    this.host.effects?.updateTrails(trailInfos)

    const stuckBalls = this.host.ballManager?.updateStuckDetection(dt) || []
    for (const stuckBall of stuckBalls) {
      if (stuckBall === this.host.ballManager?.getBallBody()) {
        this.host.ballManager?.resetBall()
      } else {
        this.host.ballManager?.removeBall(stuckBall)
      }
    }
    if (stuckBalls.length > 0) {
      this.rebuildHandleCaches()
    }

    // Update small gold ball lifetimes (cleanup expired)
    this.host.ballManager?.updateSmallGoldBallLifetimes(dt)

    const jackpotPhase = this.host.effects?.jackpotPhase || 0
    this.host.display?.update(dt, jackpotPhase)

    // Drive bumper JACKPOT visuals during the Cyber-Shock sequence (especially phase 3 meltdown)
    if (this.host.effects?.isJackpotActive) {
      this.host.gameObjects?.setBumperState('JACKPOT')
    }

    if (this.host.effects && !this.host.effects.isJackpotActive && this.host.display?.getDisplayState() === DisplayState.JACKPOT) {
      this.host.eventBus.emit('jackpot:end')
      this.host.eventBus.emit('display:set', DisplayState.IDLE)
      this.host.effects.setAtmosphereState('IDLE')
      // Restore bumpers to normal lighting after sequence
      this.host.gameObjects?.setBumperState('IDLE')
    }

    this.scoringBridge.updateCombo(dt)
    this.updateTiltDecay(dt)

    if (this.host.powerupActive) {
      this.host.powerupTimer -= dt
      if (this.host.powerupTimer <= 0) this.host.powerupActive = false
    }
  }

  getBallMeshForBody(body: PhysicsBody): Mesh | null {
    return this.collisionDispatcher.getBallMeshForBody(body)
  }

  getBallPosition(): Vector3 | null {
    const body = this.host.ballManager?.getBallBody()
    if (!body) return null
    const t = body.translation()
    return new Vector3(t.x, t.y, t.z)
  }

  applyNudge(direction: { x: number; y: number; z: number }): void {
    if (this.host.nudgeState.tiltActive) {
      this.host.hapticManager?.tiltWarning()
      return
    }
    const ballBody = this.host.ballManager?.getBallBody()
    if (!ballBody) return

    const now = performance.now()
    if (now - this.host.nudgeState.lastNudgeTime < GAME_TUNING.timing.nudgeCooldownMs) {
      this.host.nudgeState.tiltWarnings++
      if (this.host.nudgeState.tiltWarnings >= GameConfig.nudge.maxTiltWarnings) {
        this.triggerTilt()
        return
      }
    }
    this.host.nudgeState.lastNudgeTime = now

    const impulse = {
      x: direction.x * getPhysicsTuningValue('nudgeForce'),
      y: getPhysicsTuningValue('nudgeVerticalBoost'),
      z: direction.z * getPhysicsTuningValue('nudgeForce'),
    }
    ballBody.applyImpulse(impulse, true)

    const nudgeDirection = direction.x > 0 ? 'right' : direction.x < 0 ? 'left' : 'up'
    this.host.hapticManager?.nudge(nudgeDirection)

    if (!this.host.accessibility.reducedMotion) {
      this.host.effects?.addCameraShake(0.03)
    }
  }

  triggerTilt(): void {
    this.host.nudgeState.tiltActive = true
    this.host.nudgeState.tiltWarningActive = false
    this.host.tiltActive = true
    this.host.effects?.setBloomEnergy(3.0)
    setTimeout(() => this.host.effects?.setBloomEnergy(1.0), GAME_TUNING.timing.tiltBloomResetMs)
    this.host.effects?.playBeep(150)
    this.host.hapticManager?.tiltWarning()
    setTimeout(() => {
      this.host.nudgeState.tiltActive = false
      this.host.nudgeState.tiltWarnings = 0
      this.host.tiltActive = false
    }, GameConfig.nudge.tiltPenaltyTime)
  }

  private updateTiltDecay(dt: number): void {
    const now = performance.now()
    if (now - this.host.nudgeState.lastNudgeTime > GameConfig.nudge.tiltDecayTime && this.host.nudgeState.tiltWarnings > 0) {
      this.host.nudgeState.tiltWarnings = Math.max(0, this.host.nudgeState.tiltWarnings - dt)
    }
  }
}
