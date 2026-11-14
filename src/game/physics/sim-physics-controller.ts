/**
 * Sim Physics Controller — the fixed step, its pacer and everything one tick runs, with no
 * presentation (#528).
 *
 * One tick is one input row, one engine `step`, one TypeScript gameplay tick: flippers and plunger,
 * the C++ step, contact dispatch and scoring (`ScoringBridge`), toys, feeders and timers
 * (`StepGameplay`). Nothing here imports Babylon, so the headless replay runner
 * (`src/sim/node-replay.ts`) runs this exact class in Node. `GamePhysicsController`
 * (`physics-controller.ts`) extends it with what only a rendered game needs — mesh interpolation,
 * the `sim` / `visuals` phases and the ghost — through the three presentation hooks below.
 *
 * - `step-gameplay.ts` — what runs once per fixed step after the engine step.
 * - `nudge-tilt.ts` — nudge, tilt warnings and the tilt penalty.
 * - `wasm-bridges.ts` — the mirror / owner bridge and its rebuild.
 * - `replay-snapshot-sync.ts` — the frame-0 world snapshot.
 */

import type { PhysicsFrameState, PhysicsHost } from './types'
import type { WasmMirror } from './wasm-mirror'
import type { WasmOwner } from './wasm-owner'
import { WasmBridges } from './wasm-bridges'
import { ScoringBridge } from './scoring-bridge'
import { CollisionDispatcher, reportContactFault } from './collision-dispatch'
import { NudgeTilt } from './nudge-tilt'
import { StepGameplay } from './step-gameplay'
import { ReplaySnapshotSync } from './replay-snapshot-sync'
import { routePhysicsEvents } from './physics-event-routes'
import { FIXED_TIMESTEP, GameSimClock } from '../../core/sim-clock'

import type { InputFrame, ReplayRecorder, ReplayRunner } from '../../game-elements'
import { createTimerScope } from '../../core/timers'
import { isFixedStepReplay } from '../../replay/replay-recorder'
import type { ReplaySnapshotResult } from '../../replay/replay-snapshot'

export type StepInputActions = {
  handleFlipperLeft: (p: boolean) => void
  handleFlipperRight: (p: boolean) => void
  handlePlunger: (charge?: number | null) => unknown
  updatePlungerFrame?: (dt: number) => void
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

export class SimPhysicsController {
  protected readonly timers = createTimerScope()
  protected readonly host: PhysicsHost

  /** The mirror / owner WASM bridge and its rebuild (`wasm-bridges.ts`). */
  private readonly wasm: WasmBridges
  /** The C++ owner, or null (also read by the e2e specs as `physicsController.wasmOwner`). */
  private get wasmOwner(): WasmOwner | null {
    return this.wasm.owner
  }
  private get wasmMirror(): WasmMirror | null {
    return this.wasm.mirror
  }
  private readonly replaySnapshots: ReplaySnapshotSync

  private readonly scoringBridge: ScoringBridge
  protected readonly collisionDispatcher: CollisionDispatcher
  private readonly nudgeTilt: NudgeTilt
  private readonly gameplay: StepGameplay
  /**
   * Gameplay clock (#441): nudge cooldown, tilt, ball-save, combo / streak
   * windows, gold swarms and plunger charge all read this, never wall time.
   */
  readonly simClock = new GameSimClock()
  /** Render time not yet consumed by a fixed step (s); its fraction of a step is the mesh alpha. */
  private stepAccumulator = 0
  /** What `stepFixed` measured this frame, for `updateSim` / `updateVisuals` (and the mesh alpha). */
  protected readonly frame: PhysicsFrameState = { dt: 0, stepped: false, alpha: 1 }
  // Bound once: step() takes them every tick (#505 §D). Per-contact isolation (#503 A3): a throw
  // on one Rapier event must not drop the rest of that step's events.
  private readonly onCollision = (h1: number, h2: number, started: boolean): void => {
    try {
      this.collisionDispatcher.processCollision(h1, h2, started)
    } catch (error) {
      reportContactFault(this.host, error)
    }
  }
  private readonly onContactForce = (h1: number, h2: number, maxForce: number): void => {
    try {
      this.collisionDispatcher.processContactForce(h1, h2, maxForce)
    } catch (error) {
      reportContactFault(this.host, error)
    }
  }

  private eventBusUnsubscribers: Array<() => void>

  constructor(host: PhysicsHost) {
    this.host = host
    this.wasm = new WasmBridges(host)
    this.replaySnapshots = new ReplaySnapshotSync(host, this.simClock, () => this.wasm.owner)
    this.scoringBridge = new ScoringBridge(host)
    this.collisionDispatcher = new CollisionDispatcher(host, this.scoringBridge, () => this.wasm.bridge)
    this.nudgeTilt = new NudgeTilt(host, this.simClock, this.timers)
    this.gameplay = new StepGameplay(host, this.simClock, this.scoringBridge, this.nudgeTilt, () => this.rebuildHandleCaches())

    this.eventBusUnsubscribers = routePhysicsEvents(host, this.collisionDispatcher)
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

  /** The C++ flipper hinges the owner drives, or null off an owner mode (see `WasmBridges`). */
  getWasmFlipperHingeCount(): number | null {
    return this.wasm.getFlipperHingeCount()
  }

  rebuildHandleCaches(): void {
    this.wasm.rebuild()

    // Built last so owner mode keys every set on the WASM ids the rebuild just assigned.
    this.collisionDispatcher.rebuildHandleCaches()

    // Portal sensor handles are registered/unregistered dynamically via
    // registerPortalSensor / unregisterPortalSensor and are intentionally NOT
    // reset here — portals may already be active when the cache is rebuilt.
  }

  /** Whether WASM owns the active adventure track, and what stopped it if not (E2E cutover check, debug HUD). */
  getAdventureOwnership(): {
    owned: boolean
    unsupported: ReadonlyArray<{ reason: string; index?: number; label?: string }>
  } {
    return this.wasm.getAdventureOwnership()
  }

  /** Table colliders the C++ world is not simulating, each with a reason; empty off the owner path (debug HUD). */
  getTableUnexported(): ReadonlyArray<{ bodyHandle: number; colliderIndex: number; shape: string; reason: string }> {
    return this.wasm.getTableUnexported()
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
    return this.replaySnapshots.getLast()
  }

  /** Flippers and plunger are driven by the input actions; only the nudge is applied here. */
  applyInputFrame(frame: InputFrame): void {
    if (frame.nudge) {
      this.applyNudge({ x: frame.nudge.x, y: frame.nudge.y, z: frame.nudge.z })
    }
  }

  /**
   * Self-test seam (the replay verifier's, #503 A3): the next contact pair dispatched throws, as a
   * contact handler that faults inside the step. The strict playback must reject the tape.
   */
  injectContactFaultOnce(): void {
    this.collisionDispatcher.injectFaultOnce()
  }

  // ---- Presentation hooks (no-ops here; `GamePhysicsController` draws) ----

  /** Before each tick: snapshot the pose the render blend starts from. */
  protected capturePreStep(): void {}

  /**
   * After the frame's ticks: record the blend factor, and (rendered game) place the meshes. `snap`
   * makes the stored pose the live one (no step ran, the world may have been repositioned).
   */
  protected syncMeshes(alpha: number, _snap = false): void {
    this.frame.alpha = alpha
  }

  /** While a replay plays: put the ghost ball where the primary ball is drawn. */
  protected placeGhost(): void {}

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
    // Plunger spring: once per tick at the tick's dt, before this tick's input and before the
    // engine step, so the kinematic body's next pose is set when contacts integrate (and, on the
    // C++ owner, before `beginStep` pushes it). Per render frame it made a launch depend on the
    // viewer's refresh rate (determinism-todo item 7).
    // Snapshot the pose before this tick; the render blend runs from it. Taken per tick, so a frame
    // with several ticks keeps the pose before the last one, and a frame with none keeps the old one.
    this.capturePreStep()
    inputActions?.updatePlungerFrame?.(driveDt)
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

    this.replaySnapshots.sync(owner !== null, runner, recorder)

    const alpha = this.host.physics.step(physicsDt, this.onCollision, this.onContactForce)

    if (owner) {
      owner.endStep()
    } else if (wasmActive) {
      const syncT0 = performance.now()
      this.wasmMirror?.syncFromWasm()
      const prev = this.host.physics.getLastMirrorOverheadMs?.() ?? 0
      this.host.physics.setMirrorOverheadMs?.(prev + (performance.now() - syncT0))
    }
    this.gameplay.tickJackpot()
    this.gameplay.tickStepMechanisms(driveDt)
    this.gameplay.stepGameplay(driveDt)
    this.host.afterFixedStep?.()
    return alpha
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

    if (!this.host.stateManager.isPlaying()) {
      // No step runs: live input still reaches the input actions (they gate
      // themselves on game state). A replay must not consume a frame here —
      // playback waits until the game is PLAYING (#444).
      const frame = replaying ? null : this.pollInput(inputManager)
      if (frame) this.applyFrameActions(frame, inputActions)
      // Mesh sync runs unconditionally so dynamic bodies (ball, flippers) appear at their
      // physics-body positions even during MENU state before the game starts. No physics
      // step has run, so render at the raw pose (alpha=1, i.e. no interpolation) and snap the
      // stored pose to it, so a body repositioned here does not blend from a stale pose.
      this.syncMeshes(1, true)
      if (replaying) this.placeGhost()
      this.frame.stepped = false
      return
    }

    const rawDt = this.host.engine.getDeltaTime() / 1000

    const wasmActive = this.host.physics.isWasmActive?.() ?? false
    const isOwner = this.host.physics.isWasmOwnerMode?.() ?? false
    const owner = isOwner ? this.wasmOwner : null
    if (owner) {
      // Pick up a track switch or a table edit before the step.
      owner.syncAdventureTrack(this.wasm.adventureTrackState(this.host.adventureMode?.isActive() ?? false))
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

    // Every tier blends: lerp(pose before the last tick, live pose, alpha) is one lerp per dynamic body.
    this.syncMeshes(alpha)
    if (replaying) this.placeGhost()

    const dt = Math.min(rawDt, 1 / 30)
    this.frame.dt = dt
    // Commit the steps the engine took this frame to the sim clock (simClockSteps(), debounce);
    // per-step gameplay already ran with the fixed dt in `StepGameplay`.
    this.simClock.advance(this.host.physics, dt)
    this.frame.stepped = true
  }

  applyNudge(direction: { x: number; y: number; z: number }): void {
    this.nudgeTilt.applyNudge(direction)
  }

  triggerTilt(): void {
    this.nudgeTilt.triggerTilt()
  }
}
