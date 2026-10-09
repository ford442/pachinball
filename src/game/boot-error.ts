/**
 * Boot failure / stall banner (#449, #452). The markup is static in index.html, so this only
 * fills its three text slots, reveals it, and (for a failure) marks Start as failed.
 *
 * Loaded with a dynamic import from main.ts: only a failed or stalled boot needs it, and the
 * entry chunk is at its size budget.
 */

import { bootError, bootWarn } from '../boot-log'
import { createTimerScope, type TimerScope } from '../core/timers'
import { DEBUG_STAGES, type CheckpointDebugController, type DebugStageKey } from './checkpoint-debug'
import { setStartButtonEnabled } from './game-ui-popups'

/** Start still disabled this long after the page started loading means the boot stalled. */
export const BOOT_STALL_MS = 30_000

const PRELOAD = 'engine + physics preload'

/** Where a stalled or failed boot was: the stages still `loading`, else the last one that began. */
export function describeProgress(debug: CheckpointDebugController): string {
  const keys = Object.keys(DEBUG_STAGES) as DebugStageKey[]
  const loading = keys.filter((k) => debug.getStageSnapshot(k).status === 'loading')
  const last = keys.filter((k) => debug.getStageSnapshot(k).status !== 'idle').slice(-1)
  return (loading.length > 0 ? loading : last).map((k) => `${k} (${DEBUG_STAGES[k].label})`).join(', ') || 'no stage started'
}

function reveal(title: string, message: string, stage: string): void {
  const banner = document.getElementById('boot-error')
  if (!banner) return
  ;[title, message, `Stage: ${stage}`].forEach((text, i) => {
    const slot = banner.children[i]
    if (slot) slot.textContent = text
  })
  banner.hidden = false
}

/** bootstrap() threw: show why and where, and put Start in its failed state. */
export function showBootFailure(err: unknown, game?: { checkpointDebug: CheckpointDebugController }): void {
  bootError('Failed to bootstrap game', err) // console.* is stripped from prod builds
  const message = err instanceof Error ? err.message : String(err)
  setStartButtonEnabled(false, message)
  reveal('Game failed to start', message, game ? describeProgress(game.checkpointDebug) : PRELOAD)
}

/**
 * Once BOOT_STALL_MS have passed since the page began loading, if Start is still disabled and
 * no failure banner is up, show which stage(s) are still loading. Scheduled on `timers`, so
 * disposing the owner cancels it.
 */
export function armBootWatchdog(timers: TimerScope, stage: () => string = () => PRELOAD): void {
  timers.setTimeout(() => {
    const start = document.getElementById('start-btn') as HTMLButtonElement | null
    const banner = document.getElementById('boot-error')
    if (!start?.disabled || !banner?.hidden) return
    const where = stage()
    bootWarn(`[Bootstrap] Start still disabled after ${BOOT_STALL_MS / 1000}s; loading: ${where}`)
    reveal('Still loading…', `Start is not ready after ${BOOT_STALL_MS / 1000} s.`, where)
  }, Math.max(0, BOOT_STALL_MS - performance.now()))
}

/** Watchdog for the pre-Game phase (engine + physics preload); disarmed once `loading` settles. */
export function watchPreGame(loading: Promise<unknown>): void {
  const timers = createTimerScope()
  armBootWatchdog(timers)
  const disarm = (): void => timers.dispose()
  void loading.then(disarm, disarm)
}

/** Watchdog for the Game phase: on the Game's own timers, so `Game.dispose()` cancels it. */
export function watchGame(game: { timers: TimerScope; checkpointDebug: CheckpointDebugController }): void {
  armBootWatchdog(game.timers, () => describeProgress(game.checkpointDebug))
}
