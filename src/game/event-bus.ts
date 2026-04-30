/**
 * Event Bus - Lightweight typed pub/sub layer for Pachinball
 *
 * Replaces scattered direct calls between systems with clean event-driven communication.
 * GameStateManager emits lifecycle events; DisplaySystem, EffectsSystem, and audio
 * subscribe to the events they care about without game.ts needing to coordinate them.
 */

import type { DisplayState } from '../game-elements/display-config'
import type { GameState } from '../game-elements/types'

/**
 * Typed event map for all Pachinball game events.
 * Each key is the event name; the value is the payload type (use void for no payload).
 */
export interface PachinballEventMap {
  // Game state transitions
  'game:start': void
  'game:over': void
  'game:pause': void
  'game:resume': void
  'menu:enter': void
  'menu:exit': void

  // Display state changes
  'display:set': DisplayState

  // Gameplay events
  'fever:start': void
  'fever:end': void
  'jackpot:start': void
  'jackpot:end': void
  'reach:start': void
  'reach:end': void
  'adventure:start': void
  'adventure:end': void

  // Generic state change (for backward-compat logging / instrumentation)
  'state:change': { oldState: GameState; newState: GameState }
}

/** Event name derived from the event map keys */
export type PachinballEventName = keyof PachinballEventMap

/** Handler type for a given event name */
export type PachinballEventHandler<K extends PachinballEventName> = (
  payload: PachinballEventMap[K]
) => void

/**
 * Lightweight typed EventBus.
 * No external dependencies. Uses Map<string, Set<Function>> internally.
 */
export class EventBus {
  private listeners = new Map<string, Set<(...args: unknown[]) => void>>()

  /**
   * Subscribe to an event.
   * @returns An unsubscribe function that removes this handler.
   */
  on<K extends PachinballEventName>(
    event: K,
    handler: PachinballEventHandler<K>
  ): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event)!.add(handler as (...args: unknown[]) => void)

    return () => {
      this.off(event, handler)
    }
  }

  /**
   * Unsubscribe from an event.
   */
  off<K extends PachinballEventName>(
    event: K,
    handler: PachinballEventHandler<K>
  ): void {
    this.listeners.get(event)?.delete(handler as (...args: unknown[]) => void)
  }

  /**
   * Emit an event with optional payload.
   */
  emit<K extends PachinballEventName>(
    event: K,
    ...args: PachinballEventMap[K] extends void
      ? []
      : [payload: PachinballEventMap[K]]
  ): void {
    const handlers = this.listeners.get(event)
    if (!handlers) return

    // Clone the set so that a handler calling off() during emit doesn't break iteration
    const snapshot = Array.from(handlers)
    for (const handler of snapshot) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
      ;(handler as Function)(...(args as unknown[]))
    }
  }

  /**
   * Remove all listeners for a given event, or all events if no event is specified.
   */
  clear(event?: PachinballEventName): void {
    if (event) {
      this.listeners.delete(event)
    } else {
      this.listeners.clear()
    }
  }
}
