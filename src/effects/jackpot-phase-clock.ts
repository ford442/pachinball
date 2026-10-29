/**
 * Jackpot phase clock — the Cyber-Shock sequence (docs/PLAN.md §8) counted in
 * fixed physics steps, never render dt or `setTimeout`.
 *
 * The sequence decides when the display returns to IDLE, and the display state
 * gates hologram catches and fever (`handleBumperCollision`), so its length is
 * gameplay. Counting it in render dt made a 30 Hz recorder and a 144 Hz
 * spectator end it on different steps; counting it in sim steps makes the
 * phase a pure function of `step - startStep`, so a tape replays the same phase
 * at the same step on any display (docs/determinism-todo.md).
 *
 * Pure TS, no Babylon: the owner (`JackpotSequenceController`) turns the
 * transitions it reports into events, particles and audio.
 */

import { FIXED_TIMESTEP } from '../core/sim-clock'

/** 0 idle · 1 breach · 2 critical · 3 meltdown — the `uPhase` of the jackpot shader. */
export type JackpotPhase = 0 | 1 | 2 | 3

export const JACKPOT_PHASE_NAMES = ['idle', 'breach', 'critical', 'meltdown'] as const
export type JackpotPhaseName = (typeof JACKPOT_PHASE_NAMES)[number]

const stepsFor = (seconds: number): number => Math.round(seconds / FIXED_TIMESTEP)

/** Phase boundaries in steps after the sequence starts (2 s / 5 s / 10 s at 60 Hz). */
export const JACKPOT_TIMELINE = {
  criticalAt: stepsFor(2),
  meltdownAt: stepsFor(5),
  endAt: stepsFor(10),
} as const

/** A one-shot sound cue, due `atStep` steps after the sequence starts. */
export interface JackpotCue {
  atStep: number
  kind: 'beep'
  freq: number
}

/** The "countdown" beeps of the critical phase: 0.3 s, 0.9 s and 1.5 s after it begins. */
export const JACKPOT_CUES: readonly JackpotCue[] = [
  { atStep: JACKPOT_TIMELINE.criticalAt + stepsFor(0.3), kind: 'beep', freq: 880 },
  { atStep: JACKPOT_TIMELINE.criticalAt + stepsFor(0.9), kind: 'beep', freq: 880 },
  { atStep: JACKPOT_TIMELINE.criticalAt + stepsFor(1.5), kind: 'beep', freq: 660 },
]

/** The phase `elapsedSteps` after the sequence started; 0 before it and from its end on. */
export function jackpotPhaseAt(elapsedSteps: number): JackpotPhase {
  if (elapsedSteps < 0) return 0
  if (elapsedSteps < JACKPOT_TIMELINE.criticalAt) return 1
  if (elapsedSteps < JACKPOT_TIMELINE.meltdownAt) return 2
  if (elapsedSteps < JACKPOT_TIMELINE.endAt) return 3
  return 0
}

/** One phase change, stamped with the absolute sim step it took effect on. */
export interface JackpotPhaseLogEntry {
  step: number
  phase: JackpotPhase
}

/** What `advanceTo` reports, in step order; `phase` 0 is the end of the sequence. */
export interface JackpotClockHandlers {
  onPhase?(phase: JackpotPhase, step: number): void
  onCue?(cue: JackpotCue, step: number): void
}

/** The log keeps the most recent phase changes (a jackpot is four): enough to compare a run, bounded for a long session. */
const LOG_LIMIT = 64

export class JackpotPhaseClock {
  private startStep = 0
  /** Elapsed steps already reported; every step in (cursor, elapsed] is still to come. */
  private cursor = 0
  private running = false
  private currentPhase: JackpotPhase = 0
  private entries: JackpotPhaseLogEntry[] = []

  get active(): boolean {
    return this.running
  }

  get phase(): JackpotPhase {
    return this.currentPhase
  }

  /** The sim step the sequence started on (meaningful while `active`). */
  get startedAt(): number {
    return this.startStep
  }

  /** Every phase change since construction or `reset()`, for replay verification. */
  get log(): readonly JackpotPhaseLogEntry[] {
    return this.entries
  }

  /** Steps since the sequence started at `step`, 0 when idle. */
  elapsedSteps(step: number): number {
    return this.running ? Math.max(0, step - this.startStep) : 0
  }

  /** Seconds of sim time since the sequence started. */
  elapsedSeconds(step: number): number {
    return this.elapsedSteps(step) * FIXED_TIMESTEP
  }

  /**
   * Start (or restart) the sequence on sim step `step`. Phase 1 begins at once;
   * a start during a running sequence restarts it, as the old controller did.
   */
  start(step: number, handlers: JackpotClockHandlers = {}): void {
    this.startStep = step
    this.cursor = 0
    this.running = true
    this.currentPhase = 1
    this.record({ step, phase: 1 })
    handlers.onPhase?.(1, step)
  }

  /**
   * Report everything due up to sim step `step`. Called once per fixed tick it
   * lands on each transition's own step; a caller that skipped steps still gets
   * every cue and phase change, in order, each stamped with its own step.
   */
  advanceTo(step: number, handlers: JackpotClockHandlers = {}): void {
    if (!this.running) return
    const elapsed = step - this.startStep
    for (let e = this.cursor + 1; e <= elapsed; e++) {
      const at = this.startStep + e
      for (const cue of JACKPOT_CUES) {
        if (cue.atStep === e) handlers.onCue?.(cue, at)
      }
      const phase = jackpotPhaseAt(e)
      if (phase !== this.currentPhase) {
        this.currentPhase = phase
        this.record({ step: at, phase })
        if (phase === 0) this.running = false
        handlers.onPhase?.(phase, at)
        if (!this.running) {
          this.cursor = e
          return
        }
      }
      this.cursor = e
    }
  }

  private record(entry: JackpotPhaseLogEntry): void {
    this.entries.push(entry)
    if (this.entries.length > LOG_LIMIT) this.entries.splice(0, this.entries.length - LOG_LIMIT)
  }

  /** Back to idle with an empty log. */
  reset(): void {
    this.running = false
    this.currentPhase = 0
    this.cursor = 0
    this.startStep = 0
    this.entries = []
  }
}
