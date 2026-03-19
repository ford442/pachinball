import type { TransformNode, Mesh, StandardMaterial, PBRMaterial, PointLight, Color3 } from '@babylonjs/core'
import type * as RAPIER from '@dimforge/rapier3d-compat'

export interface PhysicsBinding {
  mesh: TransformNode
  rigidBody: RAPIER.RigidBody
}

export interface BumperVisual {
  mesh: Mesh
  body: RAPIER.RigidBody
  hologram?: Mesh
  hitTime: number
  sweep: number
  /** Target emissive color for smooth interpolation */
  targetEmissive?: Color3
  /** Current interpolated emissive color */
  currentEmissive?: Color3
  /** Flash timer for state entry white flash */
  flashTimer?: number
}

export enum GameState {
  MENU,
  PAUSED,
  PLAYING,
  GAME_OVER,
}

// DisplayState is now defined in display-config.ts for consistency
// Re-export here for backward compatibility
export { DisplayState } from './display-config'

export interface CabinetLight {
  mesh: Mesh
  material: StandardMaterial | PBRMaterial
  pointLight: PointLight
}

export interface ShardParticle {
  mesh: Mesh
  vel: import('@babylonjs/core').Vector3
  rotVel: import('@babylonjs/core').Vector3
  life: number
  maxLife: number
  material: StandardMaterial | PBRMaterial
  initialScale: number
}

export interface CaughtBall {
  body: RAPIER.RigidBody
  targetPos: import('@babylonjs/core').Vector3
  timer: number
}

// ============================================================================
// SLOT MACHINE TYPES
// ============================================================================

/** Slot machine activation modes */
export enum SlotActivationMode {
  /** Always activate on REACH state */
  ALWAYS = 'always',
  /** Random chance (30%) on REACH */
  CHANCE = 'chance',
  /** Score threshold based */
  SCORE = 'score',
  /** Hybrid: chance + score */
  HYBRID = 'hybrid',
}

/** Slot machine spin states */
export enum SlotSpinState {
  /** Idle, not spinning */
  IDLE = 'idle',
  /** Spinning up */
  STARTING = 'starting',
  /** Spinning at full speed */
  SPINNING = 'spinning',
  /** Stopping, individual reels */
  STOPPING = 'stopping',
  /** All reels stopped */
  STOPPED = 'stopped',
  /** Jackpot win animation */
  JACKPOT = 'jackpot',
}

/** Reel configuration for variable speeds */
export interface ReelConfig {
  /** Base spin speed */
  baseSpeed: number
  /** Speed variance for dynamic animation */
  speedVariance: number
  /** Individual stop delay */
  stopDelay: number
}

/** Winning combination definition */
export interface WinCombination {
  /** Symbol to match */
  symbol: string
  /** Number of matching symbols needed (2 or 3) */
  count: number
  /** Multiplier for score */
  multiplier: number
  /** Whether this triggers jackpot */
  isJackpot: boolean
  /** Display name for UI */
  name: string
}

/** Slot machine configuration */
export interface SlotMachineConfig {
  /** Activation mode */
  activationMode: SlotActivationMode
  /** Chance percentage (0-1) for CHANCE/HYBRID modes */
  chancePercent: number
  /** Score threshold for SCORE/HYBRID modes */
  scoreThreshold: number
  /** Minimum spin duration in seconds */
  minSpinDuration: number
  /** Maximum spin duration in seconds */
  maxSpinDuration: number
  /** Individual reel configs */
  reels: ReelConfig[]
  /** Winning combinations */
  winCombinations: WinCombination[]
  /** Enable sound effects */
  enableSounds: boolean
  /** Enable cabinet light sync */
  enableLightEffects: boolean
}

/** Current slot machine state */
export interface SlotMachineState {
  /** Current spin state */
  spinState: SlotSpinState
  /** Time spent in current state */
  stateTimer: number
  /** Total spin duration for this spin */
  spinDuration: number
  /** Current speeds for each reel */
  reelSpeeds: number[]
  /** Target stop positions for each reel */
  targetPositions: number[]
  /** Whether each reel has stopped */
  reelsStopped: boolean[]
  /** Final symbols showing on each reel */
  finalSymbols: string[]
  /** Last win result if any */
  lastWin: WinCombination | null
  /** Number of spins since last jackpot */
  spinsSinceJackpot: number
  /** Cumulative score from slot wins */
  slotScore: number
}

/** Slot machine event types for callbacks */
export type SlotEventType = 
  | 'spin-start'
  | 'spin-stop'
  | 'reel-stop'
  | 'win'
  | 'jackpot'
  | 'near-miss'
  | 'activation-chance'
  | 'activation-denied'
