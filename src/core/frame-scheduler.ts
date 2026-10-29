/**
 * Frame scheduler — the one owner of `engine.runRenderLoop` (#488 §4).
 *
 * A frame runs its phases in a fixed order:
 *
 *   input → physics (fixed step) → sim → visuals → render → hud → idle
 *
 * so everything a frame shows was computed in that frame: visuals (cabinet lighting, spinners)
 * update *before* `scene.render()`, never one frame late after it.
 *
 * Systems register `{ phase, update(dt), dispose? }` and get an unregister function back; passing
 * `{ signal }` unregisters (and disposes) them when that signal aborts, so a Game-scoped system
 * needs no teardown of its own. Within a phase, systems run in registration order.
 *
 * Pause / resume stop and restart this scheduler's own loop only — the engine is shared, so the
 * scheduler never calls a bare `engine.stopRenderLoop()`. A disposed scheduler never restarts.
 *
 * Per-phase CPU time is measured every frame (two `now()` reads per phase that has systems) and
 * smoothed, for the debug HUD and `perf:baseline`.
 */

export const FRAME_PHASES = ['input', 'physics', 'sim', 'visuals', 'render', 'hud', 'idle'] as const
export type FramePhase = (typeof FRAME_PHASES)[number]

export interface FrameSystem {
  readonly phase: FramePhase
  /** Shown in timing reports; optional. */
  readonly name?: string
  /** `dt` is the engine's frame delta in seconds, unclamped: each system clamps it as it needs. */
  update(dt: number): void
  /** Called once, when the system is unregistered or the scheduler is disposed. */
  dispose?(): void
}

/** The part of a Babylon engine the scheduler drives (injectable for tests). */
export interface FrameSchedulerEngine {
  runRenderLoop(fn: () => void): void
  stopRenderLoop(fn?: () => void): void
  /** Milliseconds since the previous frame. */
  getDeltaTime(): number
}

export interface FrameSchedulerOptions {
  /** Aborting it disposes the scheduler. */
  signal?: AbortSignal
  /** Clock for phase timings (ms); defaults to `performance.now`. */
  now?: () => number
  /** Smoothing factor of the per-phase averages, 0..1 (weight of the newest frame). */
  timingSmoothing?: number
  /**
   * What the render loop calls each frame; defaults to `tick()`. A host passes a function that ends
   * in `tick()` (the Game passes `() => this.renderFrame()`, so a perf harness can wrap that method).
   */
  frame?: () => void
}

export interface FramePhaseTimings {
  /** Smoothed CPU milliseconds per phase. */
  readonly phases: Readonly<Record<FramePhase, number>>
  /** Smoothed CPU milliseconds of the whole frame (sum of phases). */
  readonly total: number
  /** Frames run since the scheduler was created. */
  readonly frames: number
}

interface Entry {
  readonly system: FrameSystem
  removed: boolean
  detachSignal: (() => void) | null
}

const defaultNow = (): number =>
  typeof performance !== 'undefined' ? performance.now() : Date.now()

function zeroPhases(): Record<FramePhase, number> {
  return { input: 0, physics: 0, sim: 0, visuals: 0, render: 0, hud: 0, idle: 0 }
}

export class FrameScheduler {
  private readonly engine: FrameSchedulerEngine
  private readonly now: () => number
  private readonly smoothing: number
  /**
   * One array per phase, in `FRAME_PHASES` order. Copy-on-write: register / unregister replace the
   * array, so a frame iterates a stable snapshot and allocates nothing.
   */
  private readonly lists: Entry[][] = FRAME_PHASES.map(() => [])
  private readonly phaseMs = zeroPhases()
  private totalMs = 0
  private frames = 0
  private running = false
  private disposed = false
  /** Stable reference: the engine removes exactly this loop. */
  private readonly loop: () => void

  constructor(engine: FrameSchedulerEngine, options: FrameSchedulerOptions = {}) {
    this.engine = engine
    this.now = options.now ?? defaultNow
    this.smoothing = options.timingSmoothing ?? 0.1
    const frame = options.frame
    this.loop = frame ? () => frame() : () => this.tick()
    const { signal } = options
    if (signal) {
      if (signal.aborted) this.dispose()
      else signal.addEventListener('abort', () => this.dispose(), { once: true })
    }
  }

  get isRunning(): boolean {
    return this.running
  }

  get isDisposed(): boolean {
    return this.disposed
  }

  /**
   * Add a system. Returns its unregister function (idempotent). With `signal`, the system is also
   * unregistered when that signal aborts. A disposed scheduler disposes the system at once.
   */
  register(system: FrameSystem, options: { signal?: AbortSignal } = {}): () => void {
    const entry: Entry = { system, removed: false, detachSignal: null }
    const unregister = (): void => this.remove(entry)
    if (this.disposed || options.signal?.aborted) {
      entry.removed = true
      system.dispose?.()
      return unregister
    }
    const index = FRAME_PHASES.indexOf(system.phase)
    if (index < 0) throw new Error(`[FrameScheduler] Unknown phase "${String(system.phase)}"`)
    this.lists[index] = [...(this.lists[index] ?? []), entry]
    const { signal } = options
    if (signal) {
      signal.addEventListener('abort', unregister, { once: true })
      entry.detachSignal = () => signal.removeEventListener('abort', unregister)
    }
    return unregister
  }

  /** Start the loop (Babylon ignores a duplicate registration). A disposed scheduler stays stopped. */
  start(): void {
    if (this.disposed || this.running) return
    this.running = true
    this.engine.runRenderLoop(this.loop)
  }

  /** Stop this scheduler's loop only; the engine's other loops (if any) keep running. */
  pause(): void {
    if (!this.running) return
    this.running = false
    this.engine.stopRenderLoop(this.loop)
  }

  /** Restart after `pause()`. A disposed scheduler stays stopped. */
  resume(): void {
    this.start()
  }

  /** Run one frame: every phase in order. The render loop calls this; tests may call it directly. */
  tick(): void {
    if (this.disposed) return
    const dt = this.engine.getDeltaTime() / 1000
    const a = this.smoothing
    let total = 0
    for (let p = 0; p < FRAME_PHASES.length; p++) {
      const list = this.lists[p]
      if (!list || list.length === 0) continue
      const start = this.now()
      for (let i = 0; i < list.length; i++) {
        const entry = list[i]
        // Unregistered by an earlier system this frame: the snapshot still holds it.
        if (!entry || entry.removed) continue
        entry.system.update(dt)
        if (this.disposed) return
      }
      const ms = this.now() - start
      const phase = FRAME_PHASES[p] as FramePhase
      this.phaseMs[phase] = this.frames === 0 ? ms : this.phaseMs[phase] + (ms - this.phaseMs[phase]) * a
      total += ms
    }
    this.totalMs = this.frames === 0 ? total : this.totalMs + (total - this.totalMs) * a
    this.frames++
  }

  /** Smoothed per-phase CPU time (a fresh object; call it from the HUD, not per frame from hot code). */
  getTimings(): FramePhaseTimings {
    return { phases: { ...this.phaseMs }, total: this.totalMs, frames: this.frames }
  }

  /** Registered system names per phase (debug HUD, tests). */
  describe(): Record<FramePhase, string[]> {
    const out = {} as Record<FramePhase, string[]>
    FRAME_PHASES.forEach((phase, p) => {
      out[phase] = (this.lists[p] ?? []).map((e) => e.system.name ?? '(anonymous)')
    })
    return out
  }

  /** Stop the loop and dispose every system. Idempotent. */
  dispose(): void {
    if (this.disposed) return
    this.pause()
    this.disposed = true
    for (let p = 0; p < this.lists.length; p++) {
      const list = this.lists[p] ?? []
      this.lists[p] = []
      for (const entry of list) this.release(entry)
    }
  }

  private remove(entry: Entry): void {
    if (entry.removed) return
    const index = FRAME_PHASES.indexOf(entry.system.phase)
    const list = this.lists[index]
    if (list) this.lists[index] = list.filter((e) => e !== entry)
    this.release(entry)
  }

  private release(entry: Entry): void {
    if (entry.removed) return
    entry.removed = true
    entry.detachSignal?.()
    entry.detachSignal = null
    entry.system.dispose?.()
  }
}
