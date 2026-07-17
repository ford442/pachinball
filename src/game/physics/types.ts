import type { Vector3 } from '@babylonjs/core'
import type { Engine, WebGPUEngine, TargetCamera } from '@babylonjs/core'

import type { PhysicsSystem } from '../../game-elements/physics'
import type { BallManager } from '../../game-elements/ball-manager'
import type { BallAnimator } from '../../game-elements/ball-animator'
import type { GameObjects } from '../../objects'
import type { EffectsSystem } from '../../effects'
import type { DisplaySystem } from '../../display'
import type { SoundSystem } from '../../game-elements/sound-system'
import type { HapticManager } from '../../game-elements/haptics'
import type { GameStateManager } from '../game-state'
import type { EventBus } from '../event-bus'
import type { AdventureState } from '../../game-elements/adventure-state'
import type { AdventureManager } from '../game-adventure'
import type { AdventureMode } from '../../adventure'
import type { ZoneTriggerSystem } from '../../game-elements/zone-trigger-system'
import type { CameraController } from '../../game-elements/camera-controller'
import type { MagSpinFeeder } from '../../game-elements/mag-spin-feeder'
import type { NanoLoomFeeder } from '../../game-elements/nano-loom-feeder'
import type { PrismCoreFeeder } from '../../game-elements/prism-core-feeder'
import type { GaussCannonFeeder } from '../../game-elements/gauss-cannon-feeder'
import type { QuantumTunnelFeeder } from '../../game-elements/quantum-tunnel-feeder'
import type { SpinnerBumperBuilder, SpinnerBumperVisual, BallTrapBuilder, BallTrapState, LauncherBuilder, LauncherState, MovingGateBuilder, MovingGateState } from '../../objects'
import type { BallType } from '../../config'
import type { CameraMode } from '../../game-elements'
import type { QualityTier } from '../../game-elements/visual-language'

export interface PhysicsHost {
  readonly engine: Engine | WebGPUEngine
  readonly physics: PhysicsSystem
  readonly stateManager: GameStateManager
  readonly eventBus: EventBus
  readonly ballManager: BallManager | null
  readonly gameObjects: GameObjects | null
  readonly effects: EffectsSystem | null
  readonly display: DisplaySystem | null
  readonly ballAnimator: BallAnimator | null
  readonly hapticManager: HapticManager | null
  readonly soundSystem: SoundSystem
  readonly mapManager: import('../game-maps').TableMapManager | null
  readonly uiManager: import('../game-ui').GameUIManager | null
  readonly adventureState: AdventureState
  readonly adventureMode: AdventureMode | null
  adventureManager: AdventureManager | null
  readonly zoneTriggerSystem: ZoneTriggerSystem | null
  readonly cameraController: CameraController | null
  readonly dynamicWorld: import('../../game-elements/dynamic-world').DynamicWorld | null
  readonly magSpinFeeder: MagSpinFeeder | null
  readonly nanoLoomFeeder: NanoLoomFeeder | null
  readonly prismCoreFeeder: PrismCoreFeeder | null
  readonly gaussCannon: GaussCannonFeeder | null
  readonly quantumTunnel: QuantumTunnelFeeder | null
  readonly tableCam: TargetCamera | null
  readonly accessibility: import('../../game-elements').AccessibilityConfig
  readonly qualityTier: QualityTier

  readonly spinnerBuilder: SpinnerBumperBuilder | null
  readonly ballTrapBuilder: BallTrapBuilder | null
  readonly launcherBuilder: LauncherBuilder | null
  readonly movingGateBuilder: MovingGateBuilder | null
  readonly spinnerVisuals: SpinnerBumperVisual[]
  readonly trapStates: BallTrapState[]
  readonly launcherStates: LauncherState[]
  readonly gateStates: MovingGateState[]

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
  nudgeState: { tiltWarnings: number; lastNudgeTime: number; tiltActive: boolean; tiltWarningActive: boolean }
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
  getBallPosition(): Vector3 | null
  getCameraMode(): CameraMode
}
