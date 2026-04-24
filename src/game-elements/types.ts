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
  /** Bumper base color for particle matching */
  color?: string
  /** Thin wireframe hologram ring floating above the bumper */
  wireframeRing?: Mesh
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
  rotVel: import('@babylonjs/core').Vector3        // Angular velocity for tumbling
  life: number
  maxLife: number        // For normalized life calculations
  material: StandardMaterial | PBRMaterial
  initialScale: number   // Size variation (0.8-1.2x)
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

// ============================================================================
// INPUT BUFFERING TYPES
// ============================================================================

/** Input frame for buffered input processing
 * 
 * This structure aligns input events with physics frames to eliminate
 * jitter (±16ms) and prevent dropped inputs. Each field represents
 * the input state change for a single frame.
 */
export interface InputFrame {
  /** Left flipper state change - null means no change from previous frame */
  flipperLeft: boolean | null
  /** Right flipper state change - null means no change from previous frame */
  flipperRight: boolean | null
  /** Plunger trigger (true = fired this frame) */
  plunger: boolean
  /** Nudge direction vector - null means no nudge this frame */
  nudge: { x: number; y: number; z: number } | null
  /** Source of the nudge (for tracking/debugging) */
  nudgeSource?: 'keyboard' | 'orientation' | 'touch'
  /** Timestamp when this input frame was processed */
  timestamp: number
}

/** Partial input frame for accumulating inputs during a frame */
export type PendingInputFrame = Partial<Omit<InputFrame, 'timestamp'>> & { timestamp?: number }

// ============================================================================
// LATENCY TRACKING TYPES
// ============================================================================

/** Latency metrics for input-to-response timing */
export interface LatencyMetrics {
  /** Array of latency samples in milliseconds */
  samples: number[]
  /** Last time a report was generated (ms) */
  lastReportTime: number
  /** Maximum number of samples to keep */
  maxSamples: number
  /** Whether latency tracking is enabled */
  enabled: boolean
}

/** Latency report with statistics */
export interface LatencyReport {
  /** Average latency in milliseconds */
  avg: number
  /** Minimum latency in milliseconds */
  min: number
  /** Maximum latency in milliseconds */
  max: number
  /** 95th percentile latency in milliseconds */
  p95: number
  /** Number of samples in the report */
  sampleCount: number
}

// ============================================================================
// PLUNGER CHARGE TYPES
// ============================================================================

/** Plunger charge state for analog skill-based control */
export interface PlungerChargeState {
  /** Whether the plunger is currently being held/charged */
  isHeld: boolean
  /** Timestamp when charge started (ms) */
  chargeStartTime: number
  /** Current charge level 0.0 to 1.0 */
  chargeLevel: number
  /** Max charge time in milliseconds */
  maxChargeTime: number
  /** Minimum impulse magnitude */
  minImpulse: number
  /** Maximum impulse magnitude */
  maxImpulse: number
}

/** Plunger input events */
export type PlungerInputEvent = 
  | { type: 'start' }
  | { type: 'release' }
  | { type: 'update'; chargeLevel: number }

// ============================================================================
// BALL TYPE SYSTEM
// ============================================================================

// Re-export BallType and BallTierConfig from config.ts for convenience
export { BallType, type BallTierConfig } from '../config'

/**
 * BallData interface
 * Tracks ball type, spawn time, and accumulated points for each ball
 * Used by BallManager for multiball and gold ball tracking
 */
export interface BallData {
  /** Ball type (standard, gold_plated, solid_gold) */
  type: import('../config').BallType
  /** Timestamp when the ball was spawned (ms) */
  spawnTime: number
  /** Accumulated points for this ball */
  points: number
  /** Babylon.js mesh reference (optional, for tracking) */
  mesh?: Mesh
  /** Rapier rigid body reference (optional, for tracking) */
  rigidBody?: RAPIER.RigidBody
}
