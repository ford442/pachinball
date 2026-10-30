/**
 * Adventure Mode Types and Interfaces
 * 
 * Contains all type definitions, enums, and interfaces for the adventure mode system.
 */

import type { Vector3, Quaternion } from '@babylonjs/core/Maths/math.vector'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { PhysicsBody } from '../core/physics-api'

// Event callback signature for communicating with Game.ts
export type AdventureCallback = (event: string, data?: unknown) => void

/** Campaign mode type — alternates A/B across the progression sequence. */
export type TrackModeType = 'EXTENDED_MAP' | 'STATIONARY_TABLE'

/**
 * Available track types for adventure mode
 */
export enum AdventureTrackType {
  NEON_HELIX = 'NEON_HELIX',
  /** Campaign hub — neon parlor pin-lane corridor (EXTENDED_MAP). */
  PACHINKO_HALL = 'PACHINKO_HALL',
  CYBER_CORE = 'CYBER_CORE',
  QUANTUM_GRID = 'QUANTUM_GRID',
  /** Schema-only C++ toy arena: native pin lattice + force-field storm (#424). */
  STORM_LATTICE = 'STORM_LATTICE',
  SINGULARITY_WELL = 'SINGULARITY_WELL',
  GLITCH_SPIRE = 'GLITCH_SPIRE',
  RETRO_WAVE_HILLS = 'RETRO_WAVE_HILLS',
  CHRONO_CORE = 'CHRONO_CORE',
  HYPER_DRIFT = 'HYPER_DRIFT',
  PACHINKO_SPIRE = 'PACHINKO_SPIRE',
  ORBITAL_JUNKYARD = 'ORBITAL_JUNKYARD',
  FIREWALL_BREACH = 'FIREWALL_BREACH',
  CPU_CORE = 'CPU_CORE',
  CRYO_CHAMBER = 'CRYO_CHAMBER',
  BIO_HAZARD_LAB = 'BIO_HAZARD_LAB',
  GRAVITY_FORGE = 'GRAVITY_FORGE',
  TIDAL_NEXUS = 'TIDAL_NEXUS',
  DIGITAL_ZEN_GARDEN = 'DIGITAL_ZEN_GARDEN',
  SYNTHWAVE_SURF = 'SYNTHWAVE_SURF',
  SOLAR_FLARE = 'SOLAR_FLARE',
  PRISM_PATHWAY = 'PRISM_PATHWAY',
  MAGNETIC_STORAGE = 'MAGNETIC_STORAGE',
  NEURAL_NETWORK = 'NEURAL_NETWORK',
  NEON_STRONGHOLD = 'NEON_STRONGHOLD',
  CASINO_HEIST = 'CASINO_HEIST',
  TESLA_TOWER = 'TESLA_TOWER',
  NEON_SKYLINE = 'NEON_SKYLINE',
  POLYCHROME_VOID = 'POLYCHROME_VOID',
}

/**
 * Track configuration for difficulty and progression
 */
export interface TrackConfig {
  type: AdventureTrackType
  name: string
  difficulty: 'easy' | 'medium' | 'hard' | 'insane'
  timeLimit: number
  checkpoints: number
}

/**
 * Player progress for a specific track
 */
export interface TrackProgress {
  completed: boolean
  bestTime: number
  attempts: number
  unlocked: boolean
}

/**
 * Physics collision groups for color-based filtering
 */
export const GROUP_UNIVERSAL = 0x0001
export const GROUP_RED = 0x0200
export const GROUP_GREEN = 0x0400
export const GROUP_BLUE = 0x0800

export const MASK_ALL = 0xFFFF
export const MASK_RED = GROUP_UNIVERSAL | GROUP_RED
export const MASK_GREEN = GROUP_UNIVERSAL | GROUP_GREEN
export const MASK_BLUE = GROUP_UNIVERSAL | GROUP_BLUE

/**
 * Gravity well configuration
 */
export interface GravityWell {
  sensor: PhysicsBody
  center: Vector3
  strength: number
}

/**
 * Damping zone configuration for slowing balls
 */
export interface DampingZone {
  sensor: PhysicsBody
  damping: number
}

/**
 * Binding between physics body and visual mesh
 */
export interface KinematicBinding {
  body: PhysicsBody
  mesh: Mesh
}

/**
 * Animated obstacle configuration
 */
export interface AnimatedObstacle extends KinematicBinding {
  type: 'PISTON' | 'OSCILLATOR' | 'ROTATING_OSCILLATOR'
  basePos: Vector3
  baseRot?: Quaternion
  frequency: number
  amplitude: number
  phase: number
  axis?: Vector3
}

/**
 * Conveyor zone that applies force to balls
 */
export interface ConveyorZone {
  sensor: PhysicsBody
  force: Vector3
}

/**
 * Chroma gate that changes ball color state
 */
export interface ChromaGate {
  sensor: PhysicsBody
  colorType: 'RED' | 'GREEN' | 'BLUE'
}

/**
 * Camera preset configuration for track-specific visibility
 */
export interface CameraPreset {
  alpha: number
  beta: number
  radius: number
  fov: number
  lookAheadTime: number
  trackingSmoothing: number
  speedRadiusFactor: number
  speedFOVFactor: number
  maxRadiusExtension: number
  minBeta: number
  maxBeta: number
  minRadius: number
  maxRadius: number
}
