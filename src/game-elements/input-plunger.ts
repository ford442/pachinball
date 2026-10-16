import type { PlungerChargeState } from './types'
import { FIXED_TIMESTEP } from '../core/sim-clock'

/**
 * Pure charge-curve math shared by keyboard, touch, and gamepad plunger
 * input. State mutation stays in these functions so InputHandler's guard
 * logic (menu-hold, adventure-mode cancellation, etc.) is unaffected.
 *
 * Charge is the number of fixed physics steps the plunger was held for, not
 * wall time: two 60 fps recordings of the same hold must launch identically,
 * and charge must not grow while the sim is paused (#441). `step` is the sim
 * step count (`simStepCount()`).
 */

export function computePlungerChargeLevel(state: PlungerChargeState, step: number): number {
  if (!state.isHeld) return state.chargeLevel
  const heldMs = (step - state.chargeStartStep) * FIXED_TIMESTEP * 1000
  return Math.min(Math.max(heldMs / state.maxChargeTime, 0), 1.0)
}

export function beginPlungerCharge(state: PlungerChargeState, step: number): void {
  state.isHeld = true
  state.chargeStartStep = step
  state.chargeLevel = 0
}

export function finishPlungerCharge(state: PlungerChargeState, step: number): number {
  const level = computePlungerChargeLevel(state, step)
  state.chargeLevel = level
  state.isHeld = false
  return level
}

/** Zero out charge state without signalling a release (used by cancelPlungerCharge). */
export function wipePlungerCharge(state: PlungerChargeState): void {
  state.isHeld = false
  state.chargeStartStep = 0
  state.chargeLevel = 0
}

/** Touch/mouse cancel-without-firing: drop the hold but keep chargeStartStep untouched. */
export function softCancelPlungerCharge(state: PlungerChargeState): void {
  if (!state.isHeld) return
  state.isHeld = false
  state.chargeLevel = 0
}
