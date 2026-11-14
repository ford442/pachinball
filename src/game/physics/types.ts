import type { Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { TargetCamera } from '@babylonjs/core/Cameras/targetCamera'
import type { Engine } from '@babylonjs/core/Engines/engine'
import type { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine'
import type { PhysicsSystem } from '../../game-elements/physics'
import type { BallManager } from '../../game-elements/ball-manager'
import type { BallAnimator } from '../../game-elements/ball-animator'
import type { EffectsSystem } from '../../effects'
import type { DisplaySystem } from '../../display'
import type { SoundSystem } from '../../audio/sound-system'
import type { HapticManager } from '../../game-elements/haptics'
import type { GameStateManager } from '../game-state'
import type { EventBus } from '../../core/event-bus'
import type { AdventureManager } from '../game-adventure'
import type { AdventureMode } from '../../adventure'
import type { ZoneTriggerSystem } from '../../game-elements/zone-trigger-system'
import type { CameraController } from '../../game-elements/camera-controller'
import type { PhysicsBody } from '../../core/physics-api'
import type { Vec3Like } from '../../core/vec3-scalar'
import type { BumperRef, PhysicsBinding } from '../../game-elements/types'
import type { LaneSensorDef } from '../../objects/object-lane-sensors'
import type { BallType } from '../../config'
import type { CameraMode } from '../../game-elements'
import type { QualityTier } from '../../game-elements/visual-language'

/**
 * Nudge / tilt bookkeeping. Times are on the gameplay sim clock
 * (`GamePhysicsController.simClock`, ms), never wall time (#441).
 */
export interface NudgeState {
  tiltWarnings: number
  /** Sim time of the last accepted nudge; -Infinity before the first. */
  lastNudgeTime: number
  tiltActive: boolean
  tiltWarningActive: boolean
  /** Sim time the tilt penalty ends (meaningful while `tiltActive`). */
  tiltPenaltyUntilMs: number
}

export function freshNudgeState(): NudgeState {
  return { tiltWarnings: 0, lastNudgeTime: Number.NEGATIVE_INFINITY, tiltActive: false, tiltWarningActive: false, tiltPenaltyUntilMs: 0 }
}

/**
 * What `stepFixed` measured this frame, shared by the controller (writer) and the `sim` / `visuals`
 * phases (readers). One object, so the phases need no back-reference to the controller.
 */
export interface PhysicsFrameState {
  /** Frame delta the sim clock advanced by (s), capped at `MAX_FRAME_DT`. */
  dt: number
  /** False when this frame ran no step (not PLAYING): the sim and visual updates skip it. */
  stepped: boolean
  /** Alpha the meshes were last drawn with; `getBallPosition` and the camera use the same blend. */
  alpha: number
}

/**
 * The physics backend as the tick uses it: `PhysicsSystem` in the game, `HeadlessPhysics` on the
 * headless replay runner (#528).
 */
export type PhysicsSim = Pick<
  PhysicsSystem,
  | 'getLastMirrorOverheadMs'
  | 'getWasmEngine'
  | 'getWasmTableWorld'
  | 'getWorld'
  | 'isWasmActive'
  | 'isWasmOwnerMode'
  | 'setEngineSwitchListener'
  | 'setMirrorOverheadMs'
  | 'setWasmDebugColliders'
  | 'step'
>

/**
 * The table as the tick uses it: `GameObjects` in the game, `HeadlessTable` in Node (#528). Plain
 * bodies and bumper refs; meshes only through `getBindings` (empty when nothing is drawn).
 */
export interface TableObjectsSim {
  getBindings(): PhysicsBinding[]
  setBumperState(state: 'IDLE' | 'REACH' | 'FEVER' | 'JACKPOT' | 'ADVENTURE'): void
  getBumperBodies(): PhysicsBody[]
  getBumperVisuals(): readonly BumperRef[]
  getAllFlippers(): ReadonlyMap<string, { body: PhysicsBody }>
  updateTargets(dt: number): void
  updateBumpers(dt: number): void
  getWasmExportBodies(): PhysicsBody[]
  getTargetBodies(): PhysicsBody[]
  getLaneSensors(): LaneSensorDef[]
  getDeathZoneBody(): PhysicsBody | null
  deactivateTarget(body: PhysicsBody): boolean
  activateBumperHit(body: PhysicsBody): void
}

/** A feeder as the fixed step drives it. */
export interface FeederSim {
  update(dt: number, ballBodies: PhysicsBody[]): void
}

/** What contact dispatch and the step read of a toy's state (the builders' states carry meshes too). */
export interface BallTrapSimState {
  readonly body: PhysicsBody
  isOpen: boolean
  caughtBall: PhysicsBody | null
  rearmTimer: number
  trapColor: string
}
export interface LauncherSimState {
  readonly body: PhysicsBody
  cooldownTimer: number
}
export interface MovingGateSimState {
  readonly body: PhysicsBody
  isOpen: boolean
}
export interface SpinnerSimVisual {
  readonly body: PhysicsBody
}

export interface BallTrapSim {
  getBodies(): PhysicsBody[]
  catchBall(state: BallTrapSimState, ball: PhysicsBody, ballPosition?: Vec3Like): void
  updateTrap(state: BallTrapSimState, dt: number): unknown
}
export interface LauncherSim {
  getBodies(): PhysicsBody[]
  triggerLauncher(state: LauncherSimState, force?: number): Vec3Like
  updateLauncher(state: LauncherSimState, dt: number): void
}
export interface MovingGateSim {
  getBodies(): PhysicsBody[]
  openGate(state: MovingGateSimState, duration?: number): void
  updateGate(state: MovingGateSimState, dt: number): void
}
export interface SpinnerSim {
  getBodies(): PhysicsBody[]
  triggerSpin(visual: SpinnerSimVisual, impactForce: number, ballPosition?: Vec3Like): void
}

export interface PhysicsHost {
  /** Only the frame delta is read (the headless replay runner fixes it at 1/60 s). */
  readonly engine: Pick<Engine | WebGPUEngine, 'getDeltaTime'>
  readonly physics: PhysicsSim
  readonly stateManager: GameStateManager
  readonly eventBus: EventBus
  readonly ballManager: BallManager | null
  readonly gameObjects: TableObjectsSim | null
  readonly effects: EffectsSystem | null
  readonly display: DisplaySystem | null
  /** The backbox state gameplay gates on (`SimDisplayState`, #528) — never `display.getDisplayState()`. */
  readonly displayState: { get(): import('../../display/display-types').DisplayState }
  readonly ballAnimator: BallAnimator | null
  readonly hapticManager: HapticManager | null
  readonly soundSystem: Pick<SoundSystem, 'playImpact' | 'playGoldBallCollect'>
  readonly mapManager: import('../game-maps').TableMapManager | null
  readonly uiManager: import('../game-ui').GameUIManager | null
  readonly adventureMode: AdventureMode | null
  adventureManager: AdventureManager | null
  readonly zoneTriggerSystem: ZoneTriggerSystem | null
  readonly cameraController: CameraController | null
  readonly dynamicWorld: import('../../game-elements/dynamic-world').DynamicWorld | null
  readonly magSpinFeeder: (FeederSim & { getBodies(): PhysicsBody[] }) | null
  readonly nanoLoomFeeder: FeederSim | null
  readonly prismCoreFeeder: FeederSim | null
  readonly gaussCannon: FeederSim | null
  readonly quantumTunnel: FeederSim | null
  readonly tableCam: TargetCamera | null
  readonly accessibility: import('../../game-elements').AccessibilityConfig
  readonly qualityTier: QualityTier
  readonly ghostBallRenderer?: import('../../replay/ghost-ball-renderer').GhostBallRenderer | null
  /** The race ghost of the active challenge (#444 Slice D), moved every render frame. */
  readonly ghostRace?: import('../../replay/ghost-race').GhostRace | null
  /**
   * A contact handler threw inside the physics step (#503 A3); the step's other contacts still
   * dispatched. The Game treats it as a sim fault (unranked run / strict-playback rejection).
   */
  readonly onSimFault?: ((fault: import('../../core/fault-window').SimFaultReport) => void) | null
  /** Runs at the end of every fixed step: the live broadcast and spectator (#444 Slice E). */
  readonly afterFixedStep?: (() => void) | null

  readonly spinnerBuilder: SpinnerSim | null
  readonly ballTrapBuilder: BallTrapSim | null
  readonly launcherBuilder: LauncherSim | null
  readonly movingGateBuilder: MovingGateSim | null
  readonly spinnerVisuals: SpinnerSimVisual[]
  readonly trapStates: BallTrapSimState[]
  readonly launcherStates: LauncherSimState[]
  readonly gateStates: MovingGateSimState[]

  score: number
  comboCount: number
  comboTimer: number
  comboMultiplier: number
  lives: number
  tiltActive: boolean
  goldBallStack: Array<{ type: BallType; timestamp: number }>
  sessionGoldBalls: number
  powerupActive: boolean
  powerupTimer: number
  plungerChargeLevel: number
  nudgeState: NudgeState
  isCameraFollowMode: boolean
  cameraFollowTransition: number
  readonly cameraFollowTransitionSpeed: number

  updateHUD(): void
  resetBall(): void
  handlePrimaryBallDrain(): boolean
  triggerJackpot(): void
  tryActivateSlotMachine(): void
  rebuildHandleCaches(): void
  updateGoldBallDisplay(): void
  showMessage(msg: string, duration: number): void
  setGameState(state: import('../../game-elements').GameState): void
  endAdventureMode(): void
  /** Interpolated ball position (as drawn) written into `out`; null when there is no ball. */
  getBallPosition(out: Vector3): Vector3 | null
  getCameraMode(): CameraMode
  /** Adventure goal / time-limit clocks, advanced once per fixed step (#444). */
  stepAdventureProgression?(dt: number): void
}
