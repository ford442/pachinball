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

let installed: (() => number) | null = null

/**
 * Install the game's sim clock (ms) for code with no physics host in reach —
 * ball-save grace, combo and streak windows, gold swarms. `Game` installs it
 * at construction and clears it (`null`) on dispose.
 */
export function installSimClock(source: (() => number) | null): void {
  installed = source
}

/** Installed sim clock in ms; wall time when none is installed (unit tests). */
export function simClockMs(): number {
  return installed ? installed() : performance.now()
}

/** `simClockMs()` in seconds. */
export function simClockSeconds(): number {
  return simClockMs() / 1000
}
