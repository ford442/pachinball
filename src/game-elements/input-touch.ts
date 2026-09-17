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
  }, { passive: false })

  leftBtn?.addEventListener('touchend', (e) => {
    e.preventDefault()
    setActive(leftBtn, false)
    host.queueInput('flipperLeft', false, { source: 'touch', eventTimestamp: e.timeStamp })
  }, { passive: false })

  leftBtn?.addEventListener('touchcancel', (e) => {
    e.preventDefault()
    setActive(leftBtn, false)
    host.queueInput('flipperLeft', false, { source: 'touch', eventTimestamp: e.timeStamp })
  }, { passive: false })

  // Also handle mouse events for desktop testing of touch controls
  leftBtn?.addEventListener('mousedown', (e) => {
    e.preventDefault()
    if (host.getAdventureActive()) return
    if (host.getTiltActive()) return
    setActive(leftBtn, true)
    host.queueInput('flipperLeft', true, { source: 'touch', eventTimestamp: e.timeStamp })
  })

  leftBtn?.addEventListener('mouseup', (e) => {
    e.preventDefault()
    setActive(leftBtn, false)
    host.queueInput('flipperLeft', false, { source: 'touch', eventTimestamp: e.timeStamp })
  })

  leftBtn?.addEventListener('mouseleave', () => {
    setActive(leftBtn, false)
    host.queueInput('flipperLeft', false, { source: 'touch' })
  })

  // Right flipper touch
  rightBtn?.addEventListener('touchstart', (e) => {
    e.preventDefault()
    if (host.getAdventureActive()) return
    if (host.getTiltActive()) return
    setActive(rightBtn, true)
    host.queueInput('flipperRight', true, { source: 'touch', eventTimestamp: e.timeStamp })
  }, { passive: false })

  rightBtn?.addEventListener('touchend', (e) => {
    e.preventDefault()
    setActive(rightBtn, false)
    host.queueInput('flipperRight', false, { source: 'touch', eventTimestamp: e.timeStamp })
  }, { passive: false })

  rightBtn?.addEventListener('touchcancel', (e) => {
    e.preventDefault()
    setActive(rightBtn, false)
    host.queueInput('flipperRight', false, { source: 'touch', eventTimestamp: e.timeStamp })
  }, { passive: false })

  // Mouse events for right flipper
  rightBtn?.addEventListener('mousedown', (e) => {
    e.preventDefault()
    if (host.getAdventureActive()) return
    if (host.getTiltActive()) return
    setActive(rightBtn, true)
    host.queueInput('flipperRight', true, { source: 'touch', eventTimestamp: e.timeStamp })
  })

  rightBtn?.addEventListener('mouseup', (e) => {
    e.preventDefault()
    setActive(rightBtn, false)
    host.queueInput('flipperRight', false, { source: 'touch', eventTimestamp: e.timeStamp })
  })

  rightBtn?.addEventListener('mouseleave', () => {
    setActive(rightBtn, false)
    host.queueInput('flipperRight', false, { source: 'touch' })
  })

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
  }, { passive: false })

  plungerBtn?.addEventListener('touchend', (e) => {
    e.preventDefault()
    setActive(plungerBtn, false)
    if (host.getAdventureActive()) {
      host.cancelPlungerCharge()
      return
    }
    if (host.isPlungerHeld()) {
      host.releasePlungerCharge()
      host.queueInput('plunger', true, { source: 'touch', eventTimestamp: e.timeStamp })
    }
  }, { passive: false })

  plungerBtn?.addEventListener('touchcancel', (e) => {
    e.preventDefault()
    setActive(plungerBtn, false)
    if (host.getAdventureActive()) {
      host.cancelPlungerCharge()
      return
    }
    host.softCancelPlungerCharge()
  }, { passive: false })

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
  })

  plungerBtn?.addEventListener('mouseup', (e) => {
    e.preventDefault()
    setActive(plungerBtn, false)
    if (host.getAdventureActive()) {
      host.cancelPlungerCharge()
      return
    }
    if (host.isPlungerHeld()) {
      host.releasePlungerCharge()
      host.queueInput('plunger', true, { source: 'touch', eventTimestamp: e.timeStamp })
    }
  })

  plungerBtn?.addEventListener('mouseleave', () => {
    setActive(plungerBtn, false)
    if (host.getAdventureActive()) {
      host.cancelPlungerCharge()
      return
    }
    host.softCancelPlungerCharge()
  })

  // Nudge touch (trigger action - queues once per press)
  nudgeBtn?.addEventListener('touchstart', (e) => {
    e.preventDefault()
    setActive(nudgeBtn, true)
    host.queueInput('nudge', { x: 0, y: 0, z: 1 }, { source: 'touch', eventTimestamp: e.timeStamp })
    // Auto-remove active class after short delay for nudge
    setTimeout(() => setActive(nudgeBtn, false), 150)
  }, { passive: false })

  nudgeBtn?.addEventListener('touchend', (e) => {
    e.preventDefault()
    setActive(nudgeBtn, false)
  }, { passive: false })

  nudgeBtn?.addEventListener('touchcancel', (e) => {
    e.preventDefault()
    setActive(nudgeBtn, false)
  }, { passive: false })

  // Mouse events for nudge
  nudgeBtn?.addEventListener('mousedown', (e) => {
    e.preventDefault()
    setActive(nudgeBtn, true)
    host.queueInput('nudge', { x: 0, y: 0, z: 1 }, { source: 'touch', eventTimestamp: e.timeStamp })
    setTimeout(() => setActive(nudgeBtn, false), 150)
  })

  nudgeBtn?.addEventListener('mouseup', (e) => {
    e.preventDefault()
    setActive(nudgeBtn, false)
  })

  nudgeBtn?.addEventListener('mouseleave', () => {
    setActive(nudgeBtn, false)
  })
}
