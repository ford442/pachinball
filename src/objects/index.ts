export { GameObjects } from './object-core'
export { FlipperBuilder } from './object-flippers'
export { BumperBuilder } from './object-bumpers'
export { WallBuilder } from './object-walls'
export { RailBuilder } from './object-rails'
export { PachinkoBuilder } from './object-pachinko'
export { DecorationBuilder } from './object-decoration'

// New obstacle systems
export { SpinnerBumperBuilder } from './object-spinner-bumpers'
export { BallTrapBuilder } from './object-ball-traps'
export { LauncherBuilder } from './object-launchers'
export { MovingGateBuilder } from './object-moving-gates'

export type {
  FlipperConfig,
  BumperConfig,
  WallConfig,
  RailConfig,
  GameObjectRefs
} from './object-types'

export type {
  SpinnerBumperVisual
} from './object-spinner-bumpers'

export type {
  BallTrapState
} from './object-ball-traps'

export type {
  LauncherState
} from './object-launchers'

export type {
  MovingGateState,
  GateAnimationType
} from './object-moving-gates'
