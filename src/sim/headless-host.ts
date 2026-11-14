/**
 * The game as a replay sees it, with nothing drawn (#528): a `PhysicsHost` (and the input actions'
 * host) built from the sim halves — `SimPhysicsController`, `BallManager`, `ZoneTriggerSystem`,
 * `GameStateManager`, `SimDisplayState`, `GameInputActions`, the headless table — and the run-start
 * code the game itself runs (`run-start.ts`). Presentation members are null; Game-level hooks that
 * only drive presentation are no-ops; the ones whose gameplay still lives in presentation classes
 * (jackpot sequence, slot machine, adventure) trip the `HeadlessGuard`.
 */

import { EventBus } from '../core/event-bus'
import type { PhysicsBody } from '../core/physics-api'
import type { SimFaultReport } from '../core/fault-window'
import { installSimClock } from '../core/sim-clock'
import type { BallType } from '../config'
import { getDailyCascadeState } from '../cascade/daily-cascade-state'
import { detectAccessibility } from '../game-elements/accessibility-config'
import { BallManager } from '../game-elements/ball-manager'
import { getScoringBreakdownManager } from '../game-elements/scoring-breakdown'
import { GameState } from '../game-elements/types'
import { QualityTier } from '../game-elements/visual-palette'
import { ZoneSensors } from '../game-elements/zone-sensors'
import { ZoneTriggerSystem } from '../game-elements/zone-trigger-system'
import { GameInputActions, type InputActionsHost } from '../game/game-input-actions'
import { GameStateManager } from '../game/game-state'
import { SimDisplayState } from '../game/sim-display-state'
import { SimFaultPolicy } from '../game/sim-fault-policy'
import { SimPhysicsController } from '../game/physics/sim-physics-controller'
import { freshNudgeState, type NudgeState, type PhysicsHost } from '../game/physics/types'
import {
  applyMachineOnStart,
  initSessionRng,
  resetPlayBall,
  resetRunState,
  resolveRunStart,
  startSeed,
  type RunStartInput,
} from '../game/run-start'
import { DisplayState } from '../display/display-types'
import type { ReplayPayload } from '../replay/replay-recorder'
import { ReplayRunner } from '../replay/replay-runner'
import type { WasmPhysicsEngine } from '../wasm/PhysicsModule'
import { HeadlessGuard } from './headless-guard'
import { HeadlessPhysics } from './headless-physics'
import { applyHeadlessFeederFlags, buildHeadlessTable, type HeadlessBallTrap, type HeadlessFeeders, type HeadlessTable } from './headless-table'

/** The frame delta the verifier harness pins (`engine.getDeltaTime = () => 1000 / 60`). */
const FRAME_MS = 1000 / 60

export class HeadlessHost implements PhysicsHost, InputActionsHost {
  readonly guard = new HeadlessGuard()
  readonly eventBus = new EventBus()
  readonly engine = { getDeltaTime: (): number => FRAME_MS }
  readonly physics: HeadlessPhysics
  readonly stateManager = new GameStateManager()
  readonly displayState = new SimDisplayState(this.eventBus)
  readonly replayRunner = new ReplayRunner()
  readonly physicsController: SimPhysicsController
  readonly ballManager: BallManager
  readonly zoneTriggerSystem = new ZoneTriggerSystem(false)
  readonly gameObjects: HeadlessTable
  readonly inputActions: GameInputActions
  readonly ballTrapBuilder: HeadlessBallTrap
  private readonly feeders: HeadlessFeeders
  private readonly simFaultPolicy: SimFaultPolicy

  // Presentation: nothing is drawn, heard or felt.
  readonly effects = null
  readonly display = null
  readonly ballAnimator = null
  readonly hapticManager = null
  readonly soundSystem = { playImpact(): void {}, playGoldBallCollect(): void {}, playSample(): void {} }
  readonly mapManager = null
  readonly uiManager = null
  readonly adventureMode = null
  adventureManager = null
  readonly cameraController = null
  readonly dynamicWorld = null
  readonly tableCam = null
  readonly ghostBallRenderer = null
  readonly ghostRace = null
  readonly afterFixedStep = null
  /** Gameplay reads `reducedMotion` only to skip cosmetics; the verifier's page has the defaults. */
  readonly accessibility = detectAccessibility()
  readonly qualityTier = QualityTier.LOW

  // Toys other than the trap never reach the C++ world (their bodies are not exported), so they can
  // never be touched; their builders are absent and their state lists empty.
  readonly spinnerBuilder = null
  readonly launcherBuilder = null
  readonly movingGateBuilder = null
  readonly spinnerVisuals = []
  readonly trapStates
  readonly launcherStates = []
  readonly gateStates = []

  // The run's numbers (`PhysicsHost`).
  score = 0
  comboCount = 0
  comboTimer = 0
  comboMultiplier = 1
  lives = 3
  tiltActive = false
  goldBallStack: Array<{ type: BallType; timestamp: number }> = []
  sessionGoldBalls = 0
  powerupActive = false
  powerupTimer = 0
  plungerChargeLevel = 0
  nudgeState: NudgeState = freshNudgeState()
  isCameraFollowMode = false
  cameraFollowTransition = 0
  readonly cameraFollowTransitionSpeed = 0

  readonly onSimFault = (fault: SimFaultReport): void => {
    this.simFaultPolicy.report(fault)
  }

  constructor(engine: WasmPhysicsEngine) {
    this.stateManager.setEventBus(this.eventBus)
    this.physics = new HeadlessPhysics(engine)
    // Game: the controller (and its sim clock) exist before the world is authored.
    this.physicsController = new SimPhysicsController(this)
    installSimClock(this.physicsController.simClock)
    this.simFaultPolicy = new SimFaultPolicy({
      replayRunner: this.replayRunner,
      isRunLive: () => this.stateManager.isPlaying(),
      frame: () => this.physicsController.simClock.liveSteps(),
      onUnranked: () => {},
      endRun: () => this.setGameState(GameState.GAME_OVER),
      defer: (fn) => queueMicrotask(fn),
    })

    const world = this.physics.getWorld()
    const api = this.physics.getPhysicsApi()
    this.ballManager = new BallManager(world, api, null)
    this.zoneTriggerSystem.setSensors(new ZoneSensors(world, api))
    const parts = buildHeadlessTable(world, api, this.zoneTriggerSystem, this.guard, () => {
      this.ballManager.createMainBall()
    })
    this.gameObjects = parts.table
    this.feeders = parts.feeders
    this.ballTrapBuilder = parts.trap
    this.trapStates = [parts.trap.state]
    this.inputActions = new GameInputActions(this)

    // Gameplay that only presentation-owned classes run today: stop the replay there.
    this.eventBus.on('display:set', (state) => {
      if (state !== DisplayState.IDLE) this.guard.fail(`the backbox entered ${state} (slot machine, fever and jackpot run in presentation)`)
    })
    this.eventBus.on('jackpot:start', () => this.guard.fail('a jackpot started'))

    this.physicsController.rebuildHandleCaches()
  }

  get magSpinFeeder(): HeadlessFeeders['magSpin'] {
    return this.feeders.magSpin
  }
  get nanoLoomFeeder(): HeadlessFeeders['nanoLoom'] {
    return this.feeders.nanoLoom
  }
  get prismCoreFeeder(): HeadlessFeeders['prismCore'] {
    return this.feeders.prismCore
  }
  get gaussCannon(): HeadlessFeeders['gaussCannon'] {
    return this.feeders.gaussCannon
  }
  get quantumTunnel(): HeadlessFeeders['quantumTunnel'] {
    return this.feeders.quantumTunnel
  }

  /**
   * `Game.playReplay` → `GameLifecycle.startGame` for a replay: load the tape, pick its machine and
   * seed, rebuild the table for it, reset the run and start playing — through `run-start.ts`, the
   * code the game runs.
   */
  async playReplay(payload: ReplayPayload): Promise<void> {
    this.replayRunner.load(payload)
    const runStart: RunStartInput = {
      replay: { seed: payload.seed, machine: payload.machine, cascade: payload.cascade ?? null },
      challengeSeed: null,
      campaign: false,
    }
    const machine = resolveRunStart(runStart)
    if (machine.kind === 'weekly') await getDailyCascadeState().loadWeekly()
    initSessionRng(startSeed(machine, runStart))
    applyMachineOnStart(machine, {
      rebuildMutableToys: (layout) => this.gameObjects.rebuildMutableToys(layout),
      applyFeederGameplayFlags: (flags) => applyHeadlessFeederFlags(this.feeders, flags),
      rebuildHandleCaches: () => this.rebuildHandleCaches(),
    })

    getScoringBreakdownManager().reset()
    this.simFaultPolicy.reset()
    resetRunState(this)
    this.gameObjects.resetTargets()
    this.ballManager.removeExtraBalls()
    this.resetBall()
    this.setGameState(GameState.PLAYING)
  }

  // ---- PhysicsHost: Game-level hooks ----

  updateHUD(): void {}
  updateGoldBallDisplay(): void {}
  showMessage(): void {}

  resetBall(): void {
    resetPlayBall(this.inputActions, this.ballManager)
  }

  /** Free-map test mode handles drains in the game; never on a replay. */
  handlePrimaryBallDrain(): boolean {
    return false
  }

  triggerJackpot(): void {
    this.guard.fail('a jackpot was triggered')
  }

  tryActivateSlotMachine(): void {
    this.guard.fail('the slot machine was activated')
  }

  rebuildHandleCaches(): void {
    this.physicsController.rebuildHandleCaches()
  }

  setGameState(state: GameState): void {
    this.stateManager.setState(state)
  }

  endAdventureMode(): void {
    this.guard.fail('adventure mode')
  }

  getBallPosition(): null {
    return null
  }

  getCameraMode(): never {
    throw new Error('HeadlessHost: no camera')
  }

  /** The bumper body `index` (the harness drops the ball onto a bumper's mesh, at the same point). */
  bumperBody(index: number): PhysicsBody | null {
    return this.gameObjects.getBumperVisuals()[index]?.body ?? null
  }
}
