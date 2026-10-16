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

  steps(): number {
    return this.totalSteps
  }

  ms(): number {
    return this.totalMs
  }

  /** Anchor to the engine's counter before a step (no-op once anchored). */
  beforeStep(physics: SimClockPhysics | null | undefined): void {
    if (this.lastEngineSteps === null) this.lastEngineSteps = simStepCount(physics)
  }

  /**
   * Count the steps taken since the last call; returns the simulation seconds
   * advanced (`fallbackDtSeconds` when the host has no step counter). A counter
   * that went backwards (a new world) re-anchors without advancing.
   */
  advance(physics: SimClockPhysics | null | undefined, fallbackDtSeconds: number): number {
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
