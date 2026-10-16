import type { PointLight } from '@babylonjs/core/Lights/pointLight'
import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import type { Color3 } from '@babylonjs/core/Maths/math.color'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { PhysicsBody } from '../core/physics-api'

export interface PhysicsBinding {
  mesh: TransformNode
  rigidBody: PhysicsBody
}

export interface BumperVisual {
  mesh: Mesh
  body: PhysicsBody
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

export interface CabinetLight {
  mesh: Mesh
  material: StandardMaterial | PBRMaterial
  pointLight: PointLight
}

export interface ShardParticle {
  mesh: Mesh
  vel: import('@babylonjs/core/Maths/math.vector').Vector3
  rotVel: import('@babylonjs/core/Maths/math.vector').Vector3        // Angular velocity for tumbling
  life: number
  maxLife: number        // For normalized life calculations
  material: StandardMaterial | PBRMaterial
  initialScale: number   // Size variation (0.8-1.2x)
}

export interface CaughtBall {
  body: PhysicsBody
  targetPos: import('@babylonjs/core/Maths/math.vector').Vector3
  timer: number
}

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
  /**
   * Plunger launch this frame: the 0–1 charge the impulse is scaled by, or
   * null when the plunger did not fire. This is what replay fires with — the
   * spectator's own live charge is never read (#441).
   */
  plungerCharge: number | null
  /**
   * @deprecated Convenience alias for `plungerCharge != null`; kept for one
   * release so older readers keep working, then removed.
   */
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
export type InputLatencySource = 'keyboard' | 'touch' | 'gamepad'

export interface LatencyMetrics {
  /** Array of latency samples in milliseconds (all sources) */
  samples: number[]
  /** Per-source sample buffers */
  samplesBySource: Record<InputLatencySource, number[]>
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
  /** Optional source this report was computed for */
  source?: InputLatencySource
}

// ============================================================================
// PLUNGER CHARGE TYPES
// ============================================================================

/** Plunger charge state for analog skill-based control */
export interface PlungerChargeState {
  /** Whether the plunger is currently being held/charged */
  isHeld: boolean
  /** Sim step count when the charge started — charge counts fixed steps held, not wall time */
  chargeStartStep: number
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

export interface UnlockedReward {
  kind: 'ball-skin' | 'cabinet-theme' | 'flipper-style' | 'backbox-tint'
  id: string
  label: string
  rarity: 'common' | 'rare' | 'legendary'
  scope: 'track' | 'campaign-complete'
}

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
  rigidBody?: PhysicsBody
}
