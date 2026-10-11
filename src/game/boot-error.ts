/**
 * Boot stall watchdog and the stage label for a failed boot (#449, #452). Loaded with a dynamic
 * import from main.ts: only a failed or stalled boot needs it, and the entry chunk is at its size
 * budget. Nothing here is required to *show* a failure: main.ts reveals the static #boot-error
 * banner itself (`revealBootFailure`), so a failed chunk fetch cannot hide it.
 */

import { bootWarn } from '../boot-log'
import { createTimerScope, type TimerScope } from '../core/timers'
import { DEBUG_STAGES, type CheckpointDebugController, type DebugStageKey } from './checkpoint-debug'
import { BOOT_PRELOAD_STAGE, revealBootBanner, revealBootFailure } from './game-ui-popups'

/** Start still disabled this long after the page started loading means the boot stalled. */
export const BOOT_STALL_MS = 30_000

/** Where a stalled or failed boot was: the stages still `loading`, else the last one that began. */
export function describeProgress(debug: CheckpointDebugController): string {
  const keys = Object.keys(DEBUG_STAGES) as DebugStageKey[]
  const loading = keys.filter((k) => debug.getStageSnapshot(k).status === 'loading')
  const last = keys.filter((k) => debug.getStageSnapshot(k).status !== 'idle').slice(-1)
  return (loading.length > 0 ? loading : last).map((k) => `${k} (${DEBUG_STAGES[k].label})`).join(', ') || 'no stage started'
}

/**
 * main.ts already revealed the failure from static markup; this refines the stage line, which
 * needs the checkpoint snapshots (and so this chunk). Idempotent.
 */
export function showBootFailure(err: unknown, game?: { checkpointDebug: CheckpointDebugController }): void {
  revealBootFailure(err, game ? describeProgress(game.checkpointDebug) : BOOT_PRELOAD_STAGE)
}

/**
 * Once BOOT_STALL_MS have passed since the page began loading, if Start is still disabled and
 * no failure banner is up, show which stage(s) are still loading. Scheduled on `timers`, so
 * disposing the owner cancels it.
 */
export function armBootWatchdog(timers: TimerScope, stage: () => string = () => BOOT_PRELOAD_STAGE): void {
  timers.setTimeout(() => {
    const start = document.getElementById('start-btn') as HTMLButtonElement | null
    const banner = document.getElementById('boot-error')
    if (!start?.disabled || !banner?.hidden) return
    const where = stage()
    bootWarn(`[Bootstrap] Start still disabled after ${BOOT_STALL_MS / 1000}s; loading: ${where}`)
    revealBootBanner('Still loading…', `Start is not ready after ${BOOT_STALL_MS / 1000} s.`, where)
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
