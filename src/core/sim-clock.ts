/**
 * Simulation clock — fixed physics steps taken × the fixed step.
 *
 * Anything that changes score, lives, or the ball's path must read this clock,
 * never `performance.now()`: a replay verified headless, a snapshot restore
 * (#422), or a spectator on a faster display renders frames at a different
 * rate, and wall time would accept a nudge, close a combo window, or end a
 * ball-save on one machine but not another (#441, docs/determinism-todo.md).
 *
 * Whichever engine steps the world owns the count: the C++ step counter when
 * a WASM engine is active (owner, worker *and* mirror — the mirror's Rapier
 * world never steps, so its counter would freeze), Rapier's otherwise. Hosts
 * without a step counter (unit-test stubs) fall back to wall time.
 */

/** Fixed physics timestep (s) — every engine steps the world in these increments. */
export const FIXED_TIMESTEP = 1 / 60

/** Longest render frame the sim catches up on (s); a longer stall is dropped, not replayed. */
export const MAX_FRAME_DT = 1 / 30

/**
 * Slack on the step boundary (s): a host that pins the frame to
 * `1000 / 60` ms gets exactly one step per frame even when that ms value,
 * divided back down, lands an ulp under `FIXED_TIMESTEP`.
 */
const STEP_EPSILON = 1e-9

/**
 * Render frames → whole fixed steps (#444). The game runs its gameplay once
 * per fixed step and the replay tape holds one input frame per step, so how
 * many steps a frame takes is decided here, from wall time, and nowhere else.
 * The C++ / Rapier worlds are then handed exactly one `FIXED_TIMESTEP` per
 * call and never see the render delta.
 */
export class FixedStepPacer {
  private accumulator = 0

  /** Fixed steps due for a render frame of `rawDtSeconds`. */
  stepsFor(rawDtSeconds: number): number {
    const dt = Number.isFinite(rawDtSeconds) ? Math.min(Math.max(rawDtSeconds, 0), MAX_FRAME_DT) : 0
    this.accumulator += dt
    let steps = 0
    while (this.accumulator >= FIXED_TIMESTEP - STEP_EPSILON) {
      this.accumulator -= FIXED_TIMESTEP
      steps++
    }
    return steps
  }

  /** How far the frame is into the next step, 0–1: the mesh interpolation alpha. */
  alpha(): number {
    return Math.min(Math.max(this.accumulator / FIXED_TIMESTEP, 0), 1)
  }
}

/** The slice of `PhysicsSystem` the clock reads; every member optional for stubs. */
export interface SimClockPhysics {
  isWasmActive?(): boolean
  isWasmOwnerMode?(): boolean
  getWasmEngine?(): { getStepCount(): number } | null
  getStepCount?(): number
}

/** Fixed steps the active engine has taken, or null when the host has no counter. */
export function simStepCount(physics: SimClockPhysics | null | undefined): number | null {
  if (!physics) return null
  const wasmActive = physics.isWasmActive ? physics.isWasmActive() : physics.isWasmOwnerMode?.()
  const wasm = wasmActive ? physics.getWasmEngine?.() ?? null : null
  const steps = wasm ? wasm.getStepCount() : physics.getStepCount?.()
  return typeof steps === 'number' ? steps : null
}

/** Simulation time in ms. Falls back to wall time when the host has no step counter. */
export function simNowMs(physics: SimClockPhysics | null | undefined): number {
  const steps = simStepCount(physics)
  return steps === null ? performance.now() : steps * FIXED_TIMESTEP * 1000
}

/** A gameplay clock in fixed steps and ms (see `GameSimClock`). */
export interface SimClockSource {
  steps(): number
  ms(): number
  /**
   * Steps including those the engine took since the last render-frame commit —
   * the value a fixed tick or a contact callback must read (see `GameSimClock.liveSteps`).
   * Sources without it (test fakes) fall back to `steps()`.
   */
  liveSteps?(): number
}

/**
 * The gameplay clock: simulation time accumulated frame by frame from the
 * steps the engine actually took. Unlike the raw engine counter it never jumps:
 * a snapshot restore (#422) moves the engine's counter to the recorder's value,
 * and `resync()` re-anchors without counting that jump — so an interval that
 * started before the restore (ball-save from `startGame()`, a nudge) measures
 * the same on the recorder and the spectator. Hosts without a step counter
 * (unit-test stubs) advance by the render dt they are handed.
 */
export class GameSimClock implements SimClockSource {
  private totalSteps = 0
  private totalMs = 0
  private lastEngineSteps: number | null = null
  /** The host the last `beforeStep` / `advance` / `resync` read, for `liveSteps()`. */
  private physics: SimClockPhysics | null = null

  steps(): number {
    return this.totalSteps
  }

  ms(): number {
    return this.totalMs
  }

  /**
   * `steps()` plus the steps the engine has taken since the last `advance()`.
   * `steps()` only moves once per render frame, so two viewers that group the
   * same fixed ticks into different frames read different values mid-frame;
   * anything that must land on the same step on both (the jackpot phase clock,
   * started from a contact callback and advanced once per tick) reads this.
   * A host without a counter, or one whose counter went backwards, reports
   * the committed count.
   */
  liveSteps(): number {
    const now = simStepCount(this.physics)
    const last = this.lastEngineSteps
    if (now === null || last === null || now < last) return this.totalSteps
    return this.totalSteps + (now - last)
  }

  /** Anchor to the engine's counter before a step (no-op once anchored). */
  beforeStep(physics: SimClockPhysics | null | undefined): void {
    this.physics = physics ?? null
    if (this.lastEngineSteps === null) this.lastEngineSteps = simStepCount(physics)
  }

  /**
   * Count the steps taken since the last call; returns the simulation seconds
   * advanced (`fallbackDtSeconds` when the host has no step counter). A counter
   * that went backwards (a new world) re-anchors without advancing.
   */
  advance(physics: SimClockPhysics | null | undefined, fallbackDtSeconds: number): number {
    this.physics = physics ?? null
    const now = simStepCount(physics)
    if (now === null) {
      this.totalMs += fallbackDtSeconds * 1000
      return fallbackDtSeconds
    }
    const last = this.lastEngineSteps
    const advanced = last === null || now < last ? 0 : now - last
    this.lastEngineSteps = now
    this.totalSteps += advanced
    this.totalMs += advanced * FIXED_TIMESTEP * 1000
    return advanced * FIXED_TIMESTEP
  }

  /** The engine's counter was moved under us (snapshot restore): re-anchor without counting it. */
  resync(physics: SimClockPhysics | null | undefined): void {
    this.physics = physics ?? null
    this.lastEngineSteps = simStepCount(physics)
  }
}

let installed: SimClockSource | null = null

/**
 * Install the game's clock for code with no physics host in reach — ball-save
 * grace, combo and streak windows, gold swarms, plunger charge. `Game`
 * installs the physics controller's `GameSimClock` and clears it on dispose.
 */
export function installSimClock(source: SimClockSource | null): void {
  installed = source
}

/** Gameplay clock in ms; wall time when none is installed (unit tests). */
export function simClockMs(): number {
  return installed ? installed.ms() : performance.now()
}

/** `simClockMs()` in seconds. */
export function simClockSeconds(): number {
  return simClockMs() / 1000
}

/** Gameplay clock in fixed steps; 0 when none is installed. */
export function simClockSteps(): number {
  return installed ? installed.steps() : 0
}

/**
 * Gameplay clock in fixed steps, counting the ticks of the render frame in
 * progress; 0 when none is installed. Read it where the exact step matters
 * (see `GameSimClock.liveSteps`), `simClockSteps()` everywhere a frame-granular
 * value is enough.
 */
export function simClockLiveSteps(): number {
  if (!installed) return 0
  return installed.liveSteps ? installed.liveSteps() : installed.steps()
}
