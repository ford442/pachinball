import type { PlungerChargeState } from './types'

/**
 * Pure charge-curve math shared by keyboard, touch, and gamepad plunger
 * input. State mutation stays in these functions so InputHandler's guard
 * logic (menu-hold, adventure-mode cancellation, etc.) is unaffected.
 */

export function computePlungerChargeLevel(state: PlungerChargeState): number {
  if (!state.isHeld) return state.chargeLevel
  const heldTime = performance.now() - state.chargeStartTime
  return Math.min(Math.max(heldTime / state.maxChargeTime, 0), 1.0)
}

export function beginPlungerCharge(state: PlungerChargeState): void {
  state.isHeld = true
  state.chargeStartTime = performance.now()
  state.chargeLevel = 0
}

export function finishPlungerCharge(state: PlungerChargeState): number {
  const level = computePlungerChargeLevel(state)
  state.chargeLevel = level
  state.isHeld = false
  return level
}

/** Zero out charge state without signalling a release (used by cancelPlungerCharge). */
export function wipePlungerCharge(state: PlungerChargeState): void {
  state.isHeld = false
  state.chargeStartTime = 0
  state.chargeLevel = 0
}

/** Touch/mouse cancel-without-firing: drop the hold but keep chargeStartTime untouched. */
export function softCancelPlungerCharge(state: PlungerChargeState): void {
  if (!state.isHeld) return
  state.isHeld = false
  state.chargeLevel = 0
}
