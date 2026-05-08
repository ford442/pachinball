/**
 * EventBus Extensions
 * Type definitions for new obstacle, adventure, and gameplay events
 */

import type { PachinballEventMap } from './event-bus'

/**
 * Extended event map for new gameplay systems
 */
export interface ExtendedPachinballEventMap extends PachinballEventMap {
  // Spinner Bumper events
  'bumper:spinner:hit': {
    spinnerId: string
    position: { x: number; y: number; z: number }
    force: number
  }
  'bumper:spinner:rotation': {
    spinnerId: string
    rotationSpeed: number
    progress: number // 0-1 for rotation progress
  }
  'bumper:spinner:full-rotation': {
    spinnerId: string
    completions: number
  }

  // Ball Trap events
  'trap:ball:captured': {
    trapId: string
    ballId: string
    position: { x: number; y: number; z: number }
  }
  'trap:ball:released': {
    trapId: string
    ballId: string
    exitVelocity: { x: number; y: number; z: number }
  }

  // Launcher events
  'launcher:charged': {
    launcherId: string
    chargeLevel: number // 0-1
  }
  'launcher:fired': {
    launcherId: string
    ballId: string
    force: { x: number; y: number; z: number }
    chargeRatio: number // 0-1
  }
  'launcher:triggered': {
    launcherId: string
    ballId: string
  }

  // Moving Gate events
  'gate:triggered': {
    gateId: string
    position: { x: number; y: number; z: number }
  }
  'gate:opened': {
    gateId: string
    duration: number
  }
  'gate:closed': {
    gateId: string
  }
  'gate:state-changed': {
    gateId: string
    isOpen: boolean
  }

  // Drop Target events
  'drop-target:hit': {
    targetId: string
    bankId: string
    position: { x: number; y: number; z: number }
  }
  'drop-target:bank-complete': {
    bankId: string
    targetCount: number
  }
  'drop-target:bank-reset': {
    bankId: string
  }

  // Adventure Goal events
  'goal:progress': {
    goalId: string
    trackId: string
    current: number
    target: number
    progress: number // 0-1
    title: string
  }
  'goal:completed': {
    goalId: string
    trackId: string
    title: string
    reward: number
  }
  'track:progress': {
    trackId: string
    completedGoals: number
    totalGoals: number
    progress: number // 0-1
  }
  'track:completed': {
    trackId: string
    totalReward: number
    duration: number // seconds
  }
  'track:unlocked': {
    trackId: string
    name: string
  }

  // Cinematic events
  'cinematic:started': {
    cinematicType: 'track-start' | 'goal-complete' | 'track-complete' | 'jackpot' | 'special-moment'
    duration: number
  }
  'cinematic:finished': {
    cinematicType: string
  }

  // Score and feedback events
  'points:awarded': {
    amount: number
    source: string
    position?: { x: number; y: number; z: number }
    multiplier?: number
  }
  'combo:started': {
    comboCount: number
  }
  'combo:extended': {
    comboCount: number
  }
  'combo:broken': {
    finalComboCount: number
  }

  // Lighting and effects events
  'effect:flash': {
    color?: string
    intensity: number
    duration: number
  }
  'effect:bloom': {
    intensity: number
    duration?: number
  }
  'effect:shake': {
    amount: number
    duration?: number
  }

  // Sound and audio events
  'sound:play': {
    soundKey: string
    volume?: number
    pitch?: number
  }
  'music:intensity': {
    intensity: number // 0-2
    duration?: number
  }
  'music:transition': {
    fromIntensity: number
    toIntensity: number
    duration: number
  }
}

/**
 * Payload types for common event categories
 */
export interface Position3D {
  x: number
  y: number
  z: number
}

export interface Velocity3D {
  x: number
  y: number
  z: number
}

/**
 * Helper function to create event payloads with type safety
 */
export function createEventPayload<K extends keyof ExtendedPachinballEventMap>(
  _event: K,
  payload: ExtendedPachinballEventMap[K]
): ExtendedPachinballEventMap[K] {
  return payload
}
