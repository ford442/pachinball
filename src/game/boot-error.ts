/**
 * Boot failure / stall banner (#449, #452). The markup is static in index.html, so this only
 * fills its three text slots, reveals it, and (for a failure) marks Start as failed.
 */

import type { TimerScope } from '../core/timers'
import { setStartButtonEnabled } from './game-ui-popups'

/** Start still disabled this long after bootstrap began means the boot stalled. */
export const BOOT_STALL_MS = 30_000

export function showBootError(title: string, message: string, stage: string, failed = false): void {
  if (failed) setStartButtonEnabled(false, message)
  const banner = document.getElementById('boot-error')
  if (!banner) return
  ;[title, message, `Stage: ${stage}`].forEach((text, i) => {
    const slot = banner.children[i]
    if (slot) slot.textContent = text
  })
  banner.hidden = false
}

/**
 * After `ms`, if Start is still disabled and no failure banner is up, show which stage(s)
 * are still loading. Scheduled on `timers`, so disposing the owner cancels it.
 */
export function armBootWatchdog(timers: TimerScope, ms: number, stage: () => string): void {
  timers.setTimeout(() => {
    const start = document.getElementById('start-btn') as HTMLButtonElement | null
    const banner = document.getElementById('boot-error')
    if (!start?.disabled || !banner?.hidden) return
    const where = stage()
    console.warn(`[Bootstrap] Start still disabled after ${BOOT_STALL_MS / 1000}s; loading: ${where}`)
    showBootError('Still loading…', `Start is not ready after ${BOOT_STALL_MS / 1000} s.`, where)
  }, ms)
}
