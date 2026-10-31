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
import { FIXED_TIMESTEP, GameSimClock } from '../../core/sim-clock'

import { type InputFrame, type ReplayRecorder, type ReplayRunner } from '../../game-elements'
import { BallType, GAME_TUNING, GameConfig } from '../../config'
import { getPhysicsTuningValue } from '../../game-elements/physics-tuning'
import { DisplayState } from '../../display/display-types'
import { CameraMode } from '../../game-elements'
import { QualityTier } from '../../game-elements/visual-language'

/** Shared surface for mirror and owner WASM bridges. */
import type { WasmContactBridge } from './collision-dispatch'
import { createTimerScope } from '../../core/timers'
import { isFixedStepReplay } from '../../replay/replay-recorder'
import {
  applyReplaySnapshot,
  captureReplayFingerprint,
  linkedBodyIds,
  NO_SNAPSHOT_ENGINE,
  showReplayDivergenceToast,
  type ReplaySnapshotResult,
} from '../../replay/replay-snapshot'

export type StepInputActions = {
  handleFlipperLeft: (p: boolean) => void
  handleFlipperRight: (p: boolean) => void
  handlePlunger: (charge?: number | null) => unknown
  updatePlungerFrame?: (dt: number) => void
}

interface TrailInfo {
  body: PhysicsBody
  mesh: Mesh
  type: BallType
}

/** Shared empty list for "no ball manager", so the fallback allocates nothing. Never mutated. */
const NO_BODIES: PhysicsBody[] = []

// Scratch vectors for the per-frame paths. Every consumer copies what it keeps (checked:
// CameraController clones, DynamicWorld and the atmosphere only read).
const scratchBallPos = new Vector3()
const scratchBallVel = new Vector3()

function copyTranslation(body: PhysicsBody, out: Vector3): Vector3 {
  const t = body.translation()
  return out.set(t.x, t.y, t.z)
}

/** The row a tick records when no input arrived: every field "no change". */
const IDLE_INPUT_FRAME: InputFrame = {
  flipperLeft: null,
  flipperRight: null,
  plungerCharge: null,
  plunger: false,
  nudge: null,
  timestamp: 0,
}

export class GamePhysicsController {
  private readonly timers = createTimerScope()
  private readonly host: PhysicsHost

  /** WASM bridge for mirror or owner mode. */
  private wasmBridge: WasmContactBridge | null = null
  private wasmMirror: WasmMirror | null = null
  private wasmOwner: WasmOwner | null = null
  private lastReplaySnapshot: ReplaySnapshotResult | null = null

  private readonly scoringBridge: ScoringBridge
  private readonly collisionDispatcher: CollisionDispatcher
  private readonly meshInterpolation = new MeshInterpolationSystem()
  /**
   * Gameplay clock (#441): nudge cooldown, tilt, ball-save, combo / streak
   * windows, gold swarms and plunger charge all read this, never wall time.
   */
  readonly simClock = new GameSimClock()
  /** Render time not yet consumed by a fixed step (s); its fraction of a step is the mesh alpha. */
  private stepAccumulator = 0
  /** What `stepFixed` measured this frame, for `updateSim` / `updateVisuals`. */
  private frameDt = 0
  private frameSimDt = 0
  /** False when this frame ran no step (not PLAYING): the sim and visual updates skip it. */
  private frameStepped = false
  /** Reused per frame (#488 §5): the camera policy, the trail list and its records. */
  private readonly cameraPolicy: { reducedMotion: boolean; photosensitiveMode: boolean; qualityTier: QualityTier } = {
    reducedMotion: false,
    photosensitiveMode: false,
    qualityTier: QualityTier.MEDIUM,
  }
  private readonly trailInfos: TrailInfo[] = []
  private readonly trailInfoPool: TrailInfo[] = []
  private readonly trailMeshByBody = new Map<PhysicsBody, Mesh>()
  private readonly onCaughtBallBeep = (): void => {
    this.host.effects?.playBeep(440)
  }
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

    // Route WASM contacts to the same dispatcher used for Rapier collisions, as one batch per
    // drained buffer (#488 §5): with no per-contact subscriber left, the engines build no
    // per-contact payloads at all. The dispatcher maps WASM ids back to the bodies scoring expects.
    this.eventBusUnsubscribers.push(
      host.eventBus.on('wasm:physics:contacts', (batch) => {
        this.collisionDispatcher.onWasmContactBatch(batch)
      })
    )
  }

  /** Clean up EventBus subscriptions. Must be called when the controller is torn down. */
  dispose(): void {
    this.timers.dispose()
    this.collisionDispatcher.dispose()
    this.scoringBridge.dispose()
    for (const unsub of this.eventBusUnsubscribers) {
      unsub()
    }
    this.eventBusUnsubscribers = []
  }

  /**
   * The C++ flipper hinges the owner drives, or null when physics does not run an owner mode.
   * In an owner mode these hinges are the only thing that moves a flipper (there is no Rapier
   * joint motor to fall back on), and they exist only once `rebuildHandleCaches()` has run.
   */
  getWasmFlipperHingeCount(): number | null {
    if (!(this.host.physics.isWasmOwnerMode?.() ?? false)) return null
    return this.wasmOwner?.getFlipperHinges().length ?? 0
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
            this.wasmOwner.setTableScope(() => [
              ...(this.host.gameObjects?.getWasmExportBodies() ?? []),
              // Ball traps (#420): the funnel is a C++ cone and the chamber a
              // sensor sphere; the trap sits well clear of the plunger lane.
              ...(this.host.ballTrapBuilder?.getBodies() ?? []),
              // MagSpin's well (#420 leftover): a C++ axis-pull field, not geometry.
              ...(this.host.magSpinFeeder?.getBodies() ?? []),
              // Zone volumes (scenario zones, obstacle footprints): C++ sensor volumes
              // that report ball begin/end contacts to ZoneTriggerSystem.
              ...(this.host.zoneTriggerSystem?.getSensorBodies() ?? []),
            ])
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
   * Register an exit-portal sensor body handle so it never reaches the
   * obstacle handlers; its begin/end contacts go to ZoneTriggerSystem (see
   * `CollisionDispatcher.registerPortalSensor`).
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

  /** Outcome of the last replay's frame-0 snapshot check (null until a replay plays). */
  getLastReplaySnapshotResult(): ReplaySnapshotResult | null {
    return this.lastReplaySnapshot
  }

  /**
   * Frame-0 world snapshot (#422), taken and restored at the same point: after
   * this frame's inputs have driven flippers / movers, right before the step.
   * Recording fingerprints the world once frame 0 is on the tape; playback
   * restores that snapshot, and says so on screen when it cannot.
   */
  private syncReplaySnapshot(isOwner: boolean, runner: ReplayRunner | null, recorder: ReplayRecorder | null): void {
    const engine = isOwner ? this.host.physics.getWasmEngine?.() ?? null : null
    const world = isOwner ? this.host.physics.getWasmTableWorld?.() ?? null : null
    if (recorder?.isRecording() && recorder.getFrameCount() > 0 && !recorder.hasWorldFingerprint()) {
      recorder.attachWorldFingerprint(captureReplayFingerprint(engine, world))
    }
    const check = runner?.isPlaying() ? runner.takeSnapshotCheck() : null
    if (!check) return
    // The spectator's ids were allocated by its own earlier games; when they
    // differ from the recording's, the restore renames the C++ bodies and the
    // TS links follow (#441).
    const live = { bodyIds: linkedBodyIds(world), hinges: this.wasmOwner?.getFlipperHinges() ?? [] }
    const res = applyReplaySnapshot(engine ?? NO_SNAPSHOT_ENGINE, live, check, (remap) => {
      world?.renameLinkedIds(remap.bodies)
      this.wasmOwner?.renameIds(remap.bodies, remap.hinges)
    })
    this.lastReplaySnapshot = res
    // The restore moved the engine's step counter to the recorder's; the
    // gameplay clock carries on from where it was. (The worker client already
    // reports the snapshot's counter while its restore is in flight.)
    if (res.outcome === 'restored') this.simClock.resync(this.host.physics)
    showReplayDivergenceToast(res)
    // Worker path: the status arrives with the worker's reply.
    void res.settled?.then((final) => {
      if (this.lastReplaySnapshot !== res) return
      this.lastReplaySnapshot = final
      if (final.outcome !== 'restored') {
        // Refused: the world (and its counter) were left as they were.
        this.simClock.resync(this.host.physics)
        showReplayDivergenceToast(final)
      }
    })
  }

  applyInputFrame(frame: InputFrame): void {
    if (frame.flipperLeft !== null) {
      // Delegated to input actions
    }
    if (frame.flipperRight !== null) {
      // Delegated to input actions
    }
    if (frame.plungerCharge !== null) {
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

  /** Drain the live input once (`update()` first: it re-queues held keys). */
  private pollInput(inputManager: { update: () => void; processBufferedInputs: () => InputFrame | null } | null): InputFrame | null {
    inputManager?.update()
    return inputManager?.processBufferedInputs() ?? null
  }

  /** Route a frame to the input actions; a `null` field means "no change". */
  private applyFrameActions(frame: InputFrame, inputActions: StepInputActions | null): void {
    const adventureActive = this.host.adventureMode?.isActive() ?? false
    if (!adventureActive) {
      if (frame.flipperLeft !== null) inputActions?.handleFlipperLeft(frame.flipperLeft)
      if (frame.flipperRight !== null) inputActions?.handleFlipperRight(frame.flipperRight)
      if (frame.plungerCharge !== null) inputActions?.handlePlunger(frame.plungerCharge)
    }
    this.applyInputFrame(frame)
  }

  /**
   * One physics tick: apply `frame`, drive the movers, step the engine once
   * with `physicsDt`. On a schema-3 tick `physicsDt` is exactly
   * `FIXED_TIMESTEP`, so every engine takes exactly one substep. On the worker
   * the flipper motors and movers ride in the same command batch as the
   * `step`, ahead of it, so the step they are applied to is this tick's.
   */
  private runTick(
    frame: InputFrame | null,
    driveDt: number,
    physicsDt: number,
    inputActions: StepInputActions | null,
    owner: WasmOwner | null,
    wasmActive: boolean,
    runner: ReplayRunner | null,
    recorder: ReplayRecorder | null,
  ): number {
    if (frame) this.applyFrameActions(frame, inputActions)

    if (wasmActive && !owner) {
      const syncT0 = performance.now()
      this.wasmMirror?.syncToWasm()
      const prev = this.host.physics.getLastMirrorOverheadMs?.() ?? 0
      this.host.physics.setMirrorOverheadMs?.(prev + (performance.now() - syncT0))
    }
    if (owner) {
      owner.driveFlippers(frame, driveDt)
      // Push the plunger, gates, pistons, platters and mills into their C++
      // movers (captured balls are C++ kinematic bodies already).
      owner.beginStep(driveDt)
    }

    this.syncReplaySnapshot(owner !== null, runner, recorder)

    const alpha = this.host.physics.step(physicsDt, (h1, h2, start) => {
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
    this.tickJackpot()
    this.tickStepMechanisms(driveDt)
    this.host.afterFixedStep?.()
    return alpha
  }

  /** Gates, traps, launchers and adventure clocks: once per physics tick, at that tick's dt. */
  private tickStepMechanisms(dt: number): void {
    const { host } = this
    for (const state of host.trapStates) host.ballTrapBuilder?.updateTrap(state, dt)
    for (const state of host.launcherStates) host.launcherBuilder?.updateLauncher(state, dt)
    for (const state of host.gateStates) host.movingGateBuilder?.updateGate(state, dt)
    host.stepAdventureProgression?.(dt)
  }

  /**
   * Advance the jackpot phase clock by this tick. It runs here, once per fixed
   * step, so a phase change (and the end of the sequence) lands on its own sim
   * step on every client — not on whichever render frame happens to follow it.
   */
  private tickJackpot(): void {
    const effects = this.host.effects
    if (!effects) return
    if (effects.isJackpotActive) effects.advanceJackpotToStep(this.simClock.liveSteps())
    // Also catches a JACKPOT display state raised with no sequence behind it
    // (the solid-gold pulse): it ends on the tick that raised it.
    this.finishJackpotIfDone()
  }

  /**
   * Leave the JACKPOT display state once the sequence is over. The display
   * state gates hologram catches and fever (`handleBumperCollision`), so this
   * is gameplay and runs on the step the sequence ends; the render-frame call
   * only catches a sequence that ended outside a tick.
   */
  private finishJackpotIfDone(): void {
    const effects = this.host.effects
    if (!effects || effects.isJackpotActive || this.host.display?.getDisplayState() !== DisplayState.JACKPOT) return
    this.host.eventBus.emit('jackpot:end')
    this.host.eventBus.emit('display:set', DisplayState.IDLE)
    effects.setAtmosphereState('IDLE')
    // Restore bumpers to normal lighting after sequence
    this.host.gameObjects?.setBumperState('IDLE')
  }

  /**
   * One render frame of the table: the fixed step, then the sim and visual updates that follow it.
   * The frame scheduler runs the three parts in its `physics`, `sim` and `visuals` phases
   * (`stepFixed`, `updateSim`, `updateVisuals`); this composition keeps the old single entry point
   * for callers that drive the table directly (tests, tools).
   */
  stepPhysics(
    inputManager: { update: () => void; processBufferedInputs: () => InputFrame | null } | null,
    inputActions: StepInputActions | null,
    replayRunner?: ReplayRunner | null,
    replayRecorder?: ReplayRecorder | null
  ): void {
    this.stepFixed(inputManager, inputActions, replayRunner, replayRecorder)
    this.updateSim()
    this.updateVisuals()
  }

  /**
   * Frame-scheduler `physics` phase: drain input, run the fixed steps this frame owes, interpolate
   * the meshes. Outside PLAYING no step runs, and `updateSim` / `updateVisuals` skip the frame.
   */
  stepFixed(
    inputManager: { update: () => void; processBufferedInputs: () => InputFrame | null } | null,
    inputActions: StepInputActions | null,
    replayRunner?: ReplayRunner | null,
    replayRecorder?: ReplayRecorder | null
  ): void {
    const replaying = replayRunner?.isPlaying() ?? false
    if (replaying) {
      const pos = this.getBallPosition()
      if (pos && this.host.ghostBallRenderer?.isVisible()) {
        this.host.ghostBallRenderer.updatePosition(pos)
      }
    }

    if (!this.host.stateManager.isPlaying()) {
      // No step runs: live input still reaches the input actions (they gate
      // themselves on game state). A replay must not consume a frame here —
      // playback waits until the game is PLAYING (#444).
      const frame = replaying ? null : this.pollInput(inputManager)
      if (frame) this.applyFrameActions(frame, inputActions)
      // Mesh sync runs unconditionally so dynamic bodies (ball, flippers) appear at their
      // physics-body positions even during MENU state before the game starts. No physics
      // step has run, so render at the raw pose (alpha=1, i.e. no interpolation).
      this.syncMeshes(1)
      this.frameStepped = false
      return
    }

    const rawDt = this.host.engine.getDeltaTime() / 1000
    // Advance plunger spring animation each frame (before physics step so kinematic body
    // is at the correct position when Rapier integrates contacts).
    inputActions?.updatePlungerFrame?.(Math.min(rawDt, 1 / 30))

    const wasmActive = this.host.physics.isWasmActive?.() ?? false
    const isOwner = this.host.physics.isWasmOwnerMode?.() ?? false
    const owner = isOwner ? this.wasmOwner : null
    if (owner) {
      // Pick up a track switch or a table edit before the step.
      owner.syncAdventureTrack(this.adventureTrackState(this.host.adventureMode?.isActive() ?? false))
      owner.syncStatics()
      this.host.physics.setMirrorOverheadMs?.(0)
    } else if (wasmActive) {
      this.host.physics.setMirrorOverheadMs?.(0)
    }

    this.simClock.beforeStep(this.host.physics)
    let alpha: number
    if (replaying && !isFixedStepReplay(replayRunner!.getPayload()!)) {
      // Schema 1–2 tape: one row per render frame, stepped with the viewer's dt
      // (exact only when the viewer runs at the recorder's refresh rate).
      const frame = replayRunner!.getNextFrame()
      // A null frame is the end of the tape: do not step past the recording.
      alpha = frame
        ? this.runTick(frame, Math.min(rawDt, 1 / 30), rawDt, inputActions, owner, wasmActive, replayRunner ?? null, null)
        : 1
    } else {
      // Schema 3: this controller owns the fixed-step accumulator. Every 1/60 s
      // tick applies exactly one InputFrame, then steps the engine exactly once
      // — on the recorder that frame is the tape row, on playback the tape row
      // is that frame, so the viewer's refresh rate only decides how many ticks
      // a render frame runs, never what a tick does.
      this.stepAccumulator += Math.min(rawDt, 1 / 30)
      const recording = !replaying && (replayRecorder?.isRecording() ?? false)
      let tick = 0
      while (this.stepAccumulator >= FIXED_TIMESTEP) {
        this.stepAccumulator -= FIXED_TIMESTEP
        let frame: InputFrame | null
        if (replaying) {
          // A live stream with no chunk yet is still playing: wait, don't step.
          if (replayRunner!.isStarved()) {
            this.stepAccumulator += FIXED_TIMESTEP
            break
          }
          if (!replayRunner!.peekNextFrame()) {
            // End of tape: stop here rather than step past the recording.
            replayRunner!.getNextFrame()
            this.stepAccumulator += FIXED_TIMESTEP
            break
          }
          frame = replayRunner!.getNextFrame()
        } else {
          // Live input is drained once per render frame, by its first tick; a
          // frame that runs no tick leaves it buffered for the next one.
          frame = tick === 0 ? this.pollInput(inputManager) : null
          if (recording) replayRecorder!.recordFrame(frame ?? IDLE_INPUT_FRAME)
        }
        this.runTick(frame, FIXED_TIMESTEP, FIXED_TIMESTEP, inputActions, owner, wasmActive, replayRunner ?? null, replayRecorder ?? null)
        tick++
      }
      if (tick === 0 && !replaying) inputManager?.update()
      alpha = this.stepAccumulator / FIXED_TIMESTEP
    }

    // Skip interpolation on LOW quality tier — render at the raw post-step pose.
    this.syncMeshes(this.host.qualityTier === QualityTier.LOW ? 1 : alpha)

    const dt = Math.min(rawDt, 1 / 30)
    this.frameDt = dt
    // Gameplay timers advance with the simulation, not the display: the steps
    // the engine actually took this frame (render dt only for stub hosts).
    this.frameSimDt = this.simClock.advance(this.host.physics, dt)
    this.frameStepped = true
  }

  /**
   * Frame-scheduler `sim` phase: gameplay that runs once per frame after the fixed step — feeders,
   * captures, stuck balls, combo / tilt / power-up windows. Reads the dt `stepFixed` measured.
   */
  updateSim(): void {
    if (!this.frameStepped) return
    const dt = this.frameDt
    const simDt = this.frameSimDt
    const ballManager = this.host.ballManager

    // Dynamic world
    const mainBall = ballManager?.getBallBody()
    if (this.host.dynamicWorld && mainBall) {
      this.host.dynamicWorld.update(copyTranslation(mainBall, scratchBallPos), dt)
    }

    const currentBallBodies = ballManager?.getBallBodies() ?? NO_BODIES
    this.host.adventureMode?.update(dt, currentBallBodies)

    this.host.gameObjects?.updateTargets(dt)

    this.host.magSpinFeeder?.update(dt, currentBallBodies)
    this.host.nanoLoomFeeder?.update(dt, currentBallBodies)
    this.host.prismCoreFeeder?.update(dt, currentBallBodies)
    this.host.gaussCannon?.update(dt, currentBallBodies)
    this.host.quantumTunnel?.update(dt, currentBallBodies)

    ballManager?.updateCaughtBalls(dt, this.onCaughtBallBeep)

    this.host.mapManager?.update(dt)

    const stuckBalls = ballManager?.updateStuckDetection(simDt) ?? NO_BODIES
    for (const stuckBall of stuckBalls) {
      if (stuckBall === ballManager?.getBallBody()) {
        ballManager?.resetBall()
      } else {
        ballManager?.removeBall(stuckBall)
      }
    }
    if (stuckBalls.length > 0) {
      this.rebuildHandleCaches()
    }

    // Update small gold ball lifetimes (cleanup expired)
    ballManager?.updateSmallGoldBallLifetimes(simDt)

    this.finishJackpotIfDone()

    this.scoringBridge.updateCombo(simDt)
    this.tickTilt(simDt)

    if (this.host.powerupActive) {
      this.host.powerupTimer -= simDt
      if (this.host.powerupTimer <= 0) this.host.powerupActive = false
    }
  }

  /**
   * Frame-scheduler `visuals` phase: camera, effects, trails and the backbox — everything the
   * coming `scene.render()` shows, computed from this frame's sim state.
   */
  updateVisuals(): void {
    if (!this.frameStepped) return
    const dt = this.frameDt
    const { effects } = this.host
    const ballManager = this.host.ballManager
    const ballBody = ballManager?.getBallBody() ?? null
    const ballPos = ballBody ? copyTranslation(ballBody, scratchBallPos) : undefined

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

    const now = this.simClock.ms()
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
    // The penalty ends on the sim clock (`tickTilt`), never a timer: a replay
    // must lock and release the flippers on the same step the live run did.
    this.host.nudgeState.tiltPenaltyUntilMs = this.simClock.ms() + GameConfig.nudge.tiltPenaltyTime
    this.host.tiltActive = true
    this.host.effects?.setBloomEnergy(3.0)
    // Cosmetic only — the bloom pulse may stay on wall time.
    this.timers.setTimeout(() => this.host.effects?.setBloomEnergy(1.0), GAME_TUNING.timing.tiltBloomResetMs)
    this.host.effects?.playBeep(150)
    this.host.hapticManager?.tiltWarning()
  }

  /**
   * Per-frame tilt bookkeeping on the sim clock: release the tilt penalty once
   * it has run, and bleed off warnings (one per sim second) after
   * `tiltDecayTime` without a nudge.
   */
  private tickTilt(simDt: number): void {
    const state = this.host.nudgeState
    const now = this.simClock.ms()
    if (state.tiltActive && now >= state.tiltPenaltyUntilMs) {
      state.tiltActive = false
      state.tiltWarnings = 0
      this.host.tiltActive = false
    }
    if (now - state.lastNudgeTime > GameConfig.nudge.tiltDecayTime && state.tiltWarnings > 0) {
      state.tiltWarnings = Math.max(0, state.tiltWarnings - simDt)
    }
  }
}
