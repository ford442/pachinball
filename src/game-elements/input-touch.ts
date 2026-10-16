import { GameState } from './types'
import type { PendingInputFrame } from './types'

/** Everything setupTouchControls needs from InputHandler, kept narrow on purpose. */
export interface TouchInputHost {
  isReady(): boolean
  getState(): GameState
  getTiltActive(): boolean
  getAdventureActive(): boolean
  queueInput<T extends keyof PendingInputFrame>(
    type: T,
    value: PendingInputFrame[T],
    meta?: { source?: 'touch'; eventTimestamp?: number },
  ): void
  onStart(): void
  isPlungerHeld(): boolean
  startPlungerCharge(): void
  releasePlungerCharge(): number
  cancelPlungerCharge(): void
  softCancelPlungerCharge(): void
}

export function setupTouchControls(
  host: TouchInputHost,
  leftBtn: HTMLElement | null,
  rightBtn: HTMLElement | null,
  plungerBtn: HTMLElement | null,
  nudgeBtn: HTMLElement | null,
  /** Aborting removes every listener registered below. */
  signal?: AbortSignal,
): void {
  if (!host.isReady()) return

  // Helper to add/remove active class for visual feedback
  const setActive = (btn: HTMLElement | null, active: boolean) => {
    if (btn) {
      if (active) {
        btn.classList.add('active')
      } else {
        btn.classList.remove('active')
      }
    }
  }

  // Left flipper touch
  leftBtn?.addEventListener('touchstart', (e) => {
    e.preventDefault()
    if (host.getAdventureActive()) return
    if (host.getTiltActive()) return
    setActive(leftBtn, true)
    host.queueInput('flipperLeft', true, { source: 'touch', eventTimestamp: e.timeStamp })
  }, { passive: false, signal })

  leftBtn?.addEventListener('touchend', (e) => {
    e.preventDefault()
    setActive(leftBtn, false)
    host.queueInput('flipperLeft', false, { source: 'touch', eventTimestamp: e.timeStamp })
  }, { passive: false, signal })

  leftBtn?.addEventListener('touchcancel', (e) => {
    e.preventDefault()
    setActive(leftBtn, false)
    host.queueInput('flipperLeft', false, { source: 'touch', eventTimestamp: e.timeStamp })
  }, { passive: false, signal })

  // Also handle mouse events for desktop testing of touch controls
  leftBtn?.addEventListener('mousedown', (e) => {
    e.preventDefault()
    if (host.getAdventureActive()) return
    if (host.getTiltActive()) return
    setActive(leftBtn, true)
    host.queueInput('flipperLeft', true, { source: 'touch', eventTimestamp: e.timeStamp })
  }, { signal })

  leftBtn?.addEventListener('mouseup', (e) => {
    e.preventDefault()
    setActive(leftBtn, false)
    host.queueInput('flipperLeft', false, { source: 'touch', eventTimestamp: e.timeStamp })
  }, { signal })

  leftBtn?.addEventListener('mouseleave', () => {
    setActive(leftBtn, false)
    host.queueInput('flipperLeft', false, { source: 'touch' })
  }, { signal })

  // Right flipper touch
  rightBtn?.addEventListener('touchstart', (e) => {
    e.preventDefault()
    if (host.getAdventureActive()) return
    if (host.getTiltActive()) return
    setActive(rightBtn, true)
    host.queueInput('flipperRight', true, { source: 'touch', eventTimestamp: e.timeStamp })
  }, { passive: false, signal })

  rightBtn?.addEventListener('touchend', (e) => {
    e.preventDefault()
    setActive(rightBtn, false)
    host.queueInput('flipperRight', false, { source: 'touch', eventTimestamp: e.timeStamp })
  }, { passive: false, signal })

  rightBtn?.addEventListener('touchcancel', (e) => {
    e.preventDefault()
    setActive(rightBtn, false)
    host.queueInput('flipperRight', false, { source: 'touch', eventTimestamp: e.timeStamp })
  }, { passive: false, signal })

  // Mouse events for right flipper
  rightBtn?.addEventListener('mousedown', (e) => {
    e.preventDefault()
    if (host.getAdventureActive()) return
    if (host.getTiltActive()) return
    setActive(rightBtn, true)
    host.queueInput('flipperRight', true, { source: 'touch', eventTimestamp: e.timeStamp })
  }, { signal })

  rightBtn?.addEventListener('mouseup', (e) => {
    e.preventDefault()
    setActive(rightBtn, false)
    host.queueInput('flipperRight', false, { source: 'touch', eventTimestamp: e.timeStamp })
  }, { signal })

  rightBtn?.addEventListener('mouseleave', () => {
    setActive(rightBtn, false)
    host.queueInput('flipperRight', false, { source: 'touch' })
  }, { signal })

  // Plunger touch with charge support — MENU starts the game (audio unlock)
  plungerBtn?.addEventListener('touchstart', (e) => {
    e.preventDefault()
    if (host.getState() === GameState.MENU) {
      host.onStart()
      return
    }
    if (host.getAdventureActive()) return
    setActive(plungerBtn, true)
    if (!host.isPlungerHeld()) {
      host.startPlungerCharge()
    }
  }, { passive: false, signal })

  plungerBtn?.addEventListener('touchend', (e) => {
    e.preventDefault()
    setActive(plungerBtn, false)
    if (host.getAdventureActive()) {
      host.cancelPlungerCharge()
      return
    }
    if (host.isPlungerHeld()) {
      host.queueInput('plungerCharge', host.releasePlungerCharge(), { source: 'touch', eventTimestamp: e.timeStamp })
    }
  }, { passive: false, signal })

  plungerBtn?.addEventListener('touchcancel', (e) => {
    e.preventDefault()
    setActive(plungerBtn, false)
    if (host.getAdventureActive()) {
      host.cancelPlungerCharge()
      return
    }
    host.softCancelPlungerCharge()
  }, { passive: false, signal })

  // Mouse events for plunger
  plungerBtn?.addEventListener('mousedown', (e) => {
    e.preventDefault()
    if (host.getState() === GameState.MENU) {
      host.onStart()
      return
    }
    if (host.getAdventureActive()) return
    setActive(plungerBtn, true)
    if (!host.isPlungerHeld()) {
      host.startPlungerCharge()
    }
  }, { signal })

  plungerBtn?.addEventListener('mouseup', (e) => {
    e.preventDefault()
    setActive(plungerBtn, false)
    if (host.getAdventureActive()) {
      host.cancelPlungerCharge()
      return
    }
    if (host.isPlungerHeld()) {
      host.queueInput('plungerCharge', host.releasePlungerCharge(), { source: 'touch', eventTimestamp: e.timeStamp })
    }
  }, { signal })

  plungerBtn?.addEventListener('mouseleave', () => {
    setActive(plungerBtn, false)
    if (host.getAdventureActive()) {
      host.cancelPlungerCharge()
      return
    }
    host.softCancelPlungerCharge()
  }, { signal })

  // Nudge touch (trigger action - queues once per press)
  nudgeBtn?.addEventListener('touchstart', (e) => {
    e.preventDefault()
    setActive(nudgeBtn, true)
    host.queueInput('nudge', { x: 0, y: 0, z: 1 }, { source: 'touch', eventTimestamp: e.timeStamp })
    // Auto-remove active class after short delay for nudge
    // eslint-disable-next-line no-restricted-syntax -- toggles a CSS class on a static button; touches no Game state
    setTimeout(() => setActive(nudgeBtn, false), 150)
  }, { passive: false, signal })

  nudgeBtn?.addEventListener('touchend', (e) => {
    e.preventDefault()
    setActive(nudgeBtn, false)
  }, { passive: false, signal })

  nudgeBtn?.addEventListener('touchcancel', (e) => {
    e.preventDefault()
    setActive(nudgeBtn, false)
  }, { passive: false, signal })

  // Mouse events for nudge
  nudgeBtn?.addEventListener('mousedown', (e) => {
    e.preventDefault()
    setActive(nudgeBtn, true)
    host.queueInput('nudge', { x: 0, y: 0, z: 1 }, { source: 'touch', eventTimestamp: e.timeStamp })
    // eslint-disable-next-line no-restricted-syntax -- toggles a CSS class on a static button; touches no Game state
    setTimeout(() => setActive(nudgeBtn, false), 150)
  }, { signal })

  nudgeBtn?.addEventListener('mouseup', (e) => {
    e.preventDefault()
    setActive(nudgeBtn, false)
  }, { signal })

  nudgeBtn?.addEventListener('mouseleave', () => {
    setActive(nudgeBtn, false)
  }, { signal })
}
