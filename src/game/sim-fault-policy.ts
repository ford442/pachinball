/**
 * What a physics / sim fault does to the run (#503 A3). A fault in a phase that changes the world —
 * a `physics` / `sim` frame system, or a contact handler inside the step — may leave the world
 * different from what a replay rebuilds, so:
 *
 *  - a strict (verification) playback is rejected at once with `'sim-fault'`, whatever score it
 *    would reach; spectate and ghosts (non-strict playback) play on;
 *  - a live run is marked unranked (submitted with `ranked: false`), and when faults land on 3 of
 *    the last 8 frames the run ends (game over) instead of playing on a diverged world.
 *
 * Nothing here runs on the success path: the window is allocated on the first fault.
 */

import { createFaultWindow, recordFault, type FaultWindow, type SimFaultReport } from '../core/fault-window'
import type { ReplayRunner } from '../replay/replay-runner'

export interface SimFaultHost {
  readonly replayRunner: Pick<ReplayRunner, 'isPlaying' | 'isStrict' | 'reject'>
  /** A live run is in progress (GameState.PLAYING). */
  isRunLive(): boolean
  /** Monotonic frame tick for the fault window. */
  frame(): number
  /** The run is no longer ranked; `ended` when it is about to end because of the faults. */
  onUnranked(reason: string, ended: boolean): void
  /** End the run (game over). Called after the current task, never mid-step. */
  endRun(reason: string): void
  /** Defers `endRun` past the frame; `queueMicrotask` in the game. */
  defer(fn: () => void): void
}

export class SimFaultPolicy {
  private readonly host: SimFaultHost
  private window: FaultWindow | null = null
  private unranked = false
  private ending = false

  constructor(host: SimFaultHost) {
    this.host = host
  }

  /** This run hit a sim fault: it is submitted with `ranked: false`. */
  isUnranked(): boolean {
    return this.unranked
  }

  /** A new run starts ranked, with a clean window. */
  reset(): void {
    this.window = null
    this.unranked = false
    this.ending = false
  }

  report(fault: SimFaultReport): void {
    const reason = `${fault.phase}/${fault.name}: ${fault.message}`
    const runner = this.host.replayRunner
    if (runner.isPlaying()) {
      if (runner.isStrict()) runner.reject('sim-fault', reason)
      return
    }
    if (!this.host.isRunLive()) return
    const first = !this.unranked
    this.unranked = true
    this.window ??= createFaultWindow()
    const over = recordFault(this.window, this.host.frame())
    const ending = over && !this.ending
    if (first || ending) this.host.onUnranked(reason, ending)
    if (!ending) return
    this.ending = true
    this.host.defer(() => {
      if (this.host.isRunLive()) this.host.endRun(reason)
    })
  }
}
