import { GameState } from './types'
import type { PendingInputFrame } from './types'

export const PLUNGER_KEYS = new Set(['Enter', 'NumpadEnter', 'Space'])
// Digit1/Digit0 — never Shift. Holding Shift five times trips Windows Sticky Keys.
export const LEFT_FLIPPER_KEYS = new Set(['Digit1'])
export const RIGHT_FLIPPER_KEYS = new Set(['Digit0'])

/** Everything handleKeyDown/handleKeyUp need from InputHandler, kept narrow on purpose. */
export interface KeyboardInputHost {
  isReady(): boolean
  getState(): GameState
  getTiltActive(): boolean
  getAdventureActive(): boolean
  queueInput<T extends keyof PendingInputFrame>(type: T, value: PendingInputFrame[T]): void
  onPause(): void
  onReset(): void
  onStart(): void
  onAdventureToggle(): void
  onTrackNext?(): void
  onTrackPrev?(): void
  onJackpotTrigger?(): void
  setFlipperLeftHeld(held: boolean): void
  setFlipperRightHeld(held: boolean): void
  armMenuPlungerHold(): void
  disarmMenuPlungerHold(): void
  isMenuPlungerHoldPending(): boolean
  isPlungerHeld(): boolean
  startPlungerCharge(): void
  releasePlungerCharge(): number
  cancelPlungerCharge(): void
}

export function handleKeyDown(host: KeyboardInputHost, event: KeyboardEvent): void {
  // console.log('Key down:', event.code, event.key, host.getState())
  if (!host.isReady()) return

  if (event.code === 'KeyP' || event.code === 'Escape') {
    event.preventDefault()
    host.onPause()
    return
  }

  if (event.code === 'KeyR' && host.getState() === GameState.PLAYING) {
    host.onReset()
    return
  }

  if ((event.code === 'Space' || PLUNGER_KEYS.has(event.code)) && host.getState() === GameState.MENU) {
    event.preventDefault()
    host.armMenuPlungerHold()
    host.onStart()
    return
  }

  if (host.getState() !== GameState.PLAYING) return
  const adventureActive = host.getAdventureActive()
  if (adventureActive) {
    host.cancelPlungerCharge()
  }

  if (!adventureActive && LEFT_FLIPPER_KEYS.has(event.code)) {
    if (host.getTiltActive()) return
    event.preventDefault()
    host.setFlipperLeftHeld(true)
    host.queueInput('flipperLeft', true)
  }

  if (!adventureActive && RIGHT_FLIPPER_KEYS.has(event.code)) {
    if (host.getTiltActive()) return
    event.preventDefault()
    host.setFlipperRightHeld(true)
    host.queueInput('flipperRight', true)
  }

  if (!adventureActive && PLUNGER_KEYS.has(event.code)) {
    // Start plunger charge on key down
    event.preventDefault()
    if (!host.isPlungerHeld()) {
      host.startPlungerCharge()
    }
  }

  if (event.code === 'KeyZ') {
    host.queueInput('nudge', { x: -0.6, y: 0, z: 0.3 })
  }

  if (event.code === 'Slash') {
    host.queueInput('nudge', { x: 0.6, y: 0, z: 0.3 })
  }

  if (event.code === 'KeyW') {
    event.preventDefault()
    host.queueInput('nudge', { x: 0, y: 0, z: 0.8 })
  }

  if (event.code === 'KeyH') {
    host.onAdventureToggle()
  }

  if (event.code === 'BracketRight' && host.onTrackNext) {
    host.onTrackNext()
  }

  if (event.code === 'BracketLeft' && host.onTrackPrev) {
    host.onTrackPrev()
  }

  if (event.code === 'KeyJ' && host.onJackpotTrigger) {
    host.onJackpotTrigger()
  }
}

export function handleKeyUp(host: KeyboardInputHost, event: KeyboardEvent): void {
  if (!host.isReady()) return

  if (PLUNGER_KEYS.has(event.code) && host.isMenuPlungerHoldPending()) {
    host.disarmMenuPlungerHold()
  }

  if (host.getState() !== GameState.PLAYING) return
  const adventureActive = host.getAdventureActive()
  if (adventureActive) {
    host.cancelPlungerCharge()
  }

  if (!adventureActive && LEFT_FLIPPER_KEYS.has(event.code)) {
    host.setFlipperLeftHeld(false)
    host.queueInput('flipperLeft', false)
  }

  if (!adventureActive && RIGHT_FLIPPER_KEYS.has(event.code)) {
    host.setFlipperRightHeld(false)
    host.queueInput('flipperRight', false)
  }

  if (!adventureActive && PLUNGER_KEYS.has(event.code)) {
    // Release plunger on key up
    if (host.isPlungerHeld()) {
      host.releasePlungerCharge()
      host.queueInput('plunger', true)
    }
  }
}
