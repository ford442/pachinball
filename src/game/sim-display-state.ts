/**
 * The backbox state gameplay reads (#528): IDLE / REACH / FEVER / JACKPOT / ….
 *
 * Gameplay gates on it — a hologram catch and fever start only from IDLE, a drain ends fever, and
 * gold collected in FEVER pays more — so it is sim state, not presentation. It used to be read back
 * from `DisplaySystem.getDisplayState()`, which tied scoring to the rendered backbox (and left the
 * headless replay runner with no state at all). This is the same state machine with no Babylon:
 * the state is the last `display:set` request (initially IDLE), exactly the value
 * `DisplaySystem.setDisplayState` adopts, so the backbox and gameplay agree by construction.
 */

import type { EventBus } from '../core/event-bus'
import { DisplayState } from '../display/display-types'

export class SimDisplayState {
  private state: DisplayState = DisplayState.IDLE
  private readonly unsubscribe: (() => void) | null

  /** Follows `display:set` on `bus` (pass null and call `set` to drive it by hand). */
  constructor(bus: EventBus | null) {
    this.unsubscribe = bus ? bus.on('display:set', (state) => this.set(state)) : null
  }

  get(): DisplayState {
    return this.state
  }

  /** A state requested without the event (adventure zones set the backbox directly). */
  set(state: DisplayState): void {
    this.state = state
  }

  dispose(): void {
    this.unsubscribe?.()
  }
}
