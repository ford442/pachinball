/**
 * Adventure Mode Types and Interfaces
 * 
 * Contains all type definitions, enums, and interfaces for the adventure mode system.
 */

import type { Vector3, Quaternion, Mesh } from '@babylonjs/core'
import type * as RAPIER from '@dimforge/rapier3d-compat'

// Event callback signature for communicating with Game.ts
export type AdventureCallback = (event: string, data?: unknown) => void

/**
 * Available track types for adventure mode
 */
export enum AdventureTrackType {
  NEON_HELIX = 'NEON_HELIX',
  CYBER_CORE = 'CYBER_CORE',
  QUANTUM_GRID = 'QUANTUM_GRID',
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
export const GROUP_RED = 0x0002
export const GROUP_GREEN = 0x0004
export const GROUP_BLUE = 0x0008

export const MASK_ALL = 0xFFFF
export const MASK_RED = GROUP_UNIVERSAL | GROUP_RED
export const MASK_GREEN = GROUP_UNIVERSAL | GROUP_GREEN
export const MASK_BLUE = GROUP_UNIVERSAL | GROUP_BLUE

/**
 * Gravity well configuration
 */
export interface GravityWell {
  sensor: RAPIER.RigidBody
  center: Vector3
  strength: number
}

/**
 * Damping zone configuration for slowing balls
 */
export interface DampingZone {
  sensor: RAPIER.RigidBody
  damping: number
}

/**
 * Binding between physics body and visual mesh
 */
export interface KinematicBinding {
  body: RAPIER.RigidBody
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
  sensor: RAPIER.RigidBody
  force: Vector3
}

/**
 * Chroma gate that changes ball color state
 */
export interface ChromaGate {
  sensor: RAPIER.RigidBody
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

/**
 * Track builder context passed to track creation functions
 */
export interface TrackBuilderContext {
  scene: import('@babylonjs/core').Scene
  world: RAPIER.World
  rapier: typeof RAPIER
  currentStartPos: Vector3
  adventureTrack: import('@babylonjs/core').Mesh[]
  materials: import('@babylonjs/core').StandardMaterial[]
  adventureBodies: RAPIER.RigidBody[]
  kinematicBindings: KinematicBinding[]
  animatedObstacles: AnimatedObstacle[]
  conveyorZones: ConveyorZone[]
  gravityWells: GravityWell[]
  dampingZones: DampingZone[]
  chromaGates: ChromaGate[]
  resetSensors: RAPIER.RigidBody[]
  adventureSensor: RAPIER.RigidBody | null
  getTrackMaterial: (colorHex: string) => import('@babylonjs/core').StandardMaterial
  addStraightRamp: (
    startPos: Vector3,
    heading: number,
    width: number,
    length: number,
    inclineRad: number,
    material: import('@babylonjs/core').StandardMaterial,
    wallHeight?: number,
    friction?: number
  ) => Vector3
  addCurvedRamp: (
    startPos: Vector3,
    startHeading: number,
    radius: number,
    totalAngle: number,
    inclineRad: number,
    width: number,
    wallHeight: number,
    material: import('@babylonjs/core').StandardMaterial,
    segments?: number,
    bankingAngle?: number,
    friction?: number
  ) => Vector3
  createBasin: (pos: Vector3, material: import('@babylonjs/core').StandardMaterial) => void
  createRotatingPlatform: (
    center: Vector3,
    radius: number,
    angVelY: number,
    material: import('@babylonjs/core').StandardMaterial,
    hasTeeth?: boolean
  ) => void
  createStaticCylinder: (
    pos: Vector3,
    diameter: number,
    height: number,
    material: import('@babylonjs/core').StandardMaterial
  ) => void
  createDynamicBlock: (
    pos: Vector3,
    size: number,
    mass: number,
    material: import('@babylonjs/core').StandardMaterial
  ) => void
  createChromaGate: (pos: Vector3, color: 'RED' | 'GREEN' | 'BLUE') => void
  createArcPylon: (pos: Vector3, mat: import('@babylonjs/core').StandardMaterial) => void
}
