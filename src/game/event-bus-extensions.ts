/**
 * EventBus Extensions
 * Helper types and utilities for Pachinball events.
 *
 * NOTE: All event type definitions have been merged into the core
 * PachinballEventMap in ./event-bus.ts. This file now provides
 * only shared payload helpers and utility types.
 */

import type { PachinballEventMap } from './event-bus'

/**
 * Re-export the canonical event map for consumers that previously
 * imported ExtendedPachinballEventMap.
 * @deprecated Import PachinballEventMap directly from './event-bus'
 */
export type ExtendedPachinballEventMap = PachinballEventMap

/** 3D position payload helper */
export interface Position3D {
  x: number
  y: number
  z: number
}

/** 3D velocity payload helper */
export interface Velocity3D {
  x: number
  y: number
  z: number
}

/**
 * Helper function to create event payloads with type safety
 */
export function createEventPayload<K extends keyof PachinballEventMap>(
  _event: K,
  payload: PachinballEventMap[K]
): PachinballEventMap[K] {
  return payload
}
