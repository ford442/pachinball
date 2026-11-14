/**
 * The start of a run, as gameplay sees it: which table it plays on and the state it starts from.
 * Shared by the game (`GameLifecycle.startGame` / `GameDelegates.applyDailyCascadeOnStart`) and the
 * headless replay runner (#528, `src/sim/headless-host.ts`), so a replay starts on the same table,
 * seed and numbers in Node as in the browser. No Babylon, no DOM.
 */

import { getDailyCascadeState } from '../cascade/daily-cascade-state'
import type { FeederKey, TableLayout } from '../cascade/daily-cascade-layout'
import { resolveStartMachine, type StartMachine } from '../cascade/start-machine'
import { initSessionRng, randomU32Seed } from '../core/seeded-rng'
import type { BallType } from '../config'
import { freshNudgeState, type NudgeState } from './physics/types'

/** What `resolveRunStart` needs to know about the run being started. */
export interface RunStartInput {
  /** The tape being replayed, or null for a live game. */
  replay: { seed: number; machine?: 'weekly'; cascade?: Parameters<ReturnType<typeof getDailyCascadeState>['beginReplay']>[0] } | null
  /** A `?challenge=` link's seed (live games only). */
  challengeSeed: number | null
  /** The campaign was selected from the menu (live games only). */
  campaign: boolean
}

/**
 * Pick the machine a run starts on and borrow (or give back) the cascade state for a replay.
 * Returns the machine; a weekly one still needs `getDailyCascadeState().loadWeekly()` awaited before
 * `startSeed` / `applyMachineOnStart`.
 */
export function resolveRunStart(input: RunStartInput): StartMachine {
  const dailyState = getDailyCascadeState()
  // A replay plays on the cascade table it was recorded on, whatever this
  // player has selected; their own next game gets their selection back (#444).
  if (input.replay) dailyState.beginReplay(input.replay.cascade ?? null)
  else dailyState.endReplay()
  return resolveStartMachine({
    mode: dailyState.getMode(),
    modeSeed: dailyState.getModeSeed(),
    replay: input.replay ? { seed: input.replay.seed, machine: input.replay.machine } : null,
    challengeSeed: input.challengeSeed,
    campaign: input.campaign,
  })
}

/** The session seed for this run (`initSessionRng` is the caller's: it runs right after). */
export function startSeed(machine: StartMachine, input: RunStartInput): number {
  const dailyState = getDailyCascadeState()
  if (input.replay) return input.replay.seed ?? randomU32Seed()
  if (machine.kind === 'weekly') return machine.seed
  if (machine.kind === 'cascade' && dailyState.getMode() === 'daily') {
    const layout = dailyState.ensureLayout()
    return layout ? layout.seed : randomU32Seed()
  }
  // `?seed=` / `?challenge=seed:target` share links (#343): the same seed
  // must give the same session RNG streams, or a challenge is not a challenge.
  return input.challengeSeed ?? randomU32Seed()
}

export { initSessionRng }

/** The table pieces a machine changes when a run starts. */
export interface MachineStartTable {
  /** Dispose and rebuild the bumpers and pachinko pins (null: the vanilla ones). */
  rebuildMutableToys(layout: TableLayout | null): void
  /** Turn each feeder's gameplay on or off (null: all on). */
  applyFeederGameplayFlags(flags: Record<FeederKey, boolean> | null): void
  /** The world changed: rebuild the physics controller's handle caches (and the C++ export). */
  rebuildHandleCaches(): void
}

/**
 * Rebuild the mutable toys (bumpers, pachinko field) and arm the feeders for the machine this game
 * starts on. Runs after the session RNG is seeded and before the first physics step, so the C++
 * world is re-exported before the frame-0 fingerprint.
 */
export function applyMachineOnStart(machine: StartMachine, table: MachineStartTable | null): void {
  const state = getDailyCascadeState()

  if (machine.kind === 'vanilla') {
    state.clearWeekly()
    if (state.wasMutatorApplied()) {
      table?.rebuildMutableToys(null)
      table?.applyFeederGameplayFlags(null)
      table?.rebuildHandleCaches()
      state.markMutatorApplied(false)
    }
    return
  }

  let layout: TableLayout | null
  if (machine.kind === 'weekly') {
    layout = state.weeklyLayout(machine.seed)
  } else {
    state.clearWeekly()
    layout = state.ensureLayout()
  }
  if (!layout || !table) return
  table.rebuildMutableToys(layout)
  table.applyFeederGameplayFlags(layout.feedersEnabled)
  table.rebuildHandleCaches()
  state.markMutatorApplied(true)
}

/** The per-run numbers a new game starts from. */
export interface RunStateHost {
  score: number
  lives: number
  comboCount: number
  comboTimer: number
  goldBallStack: Array<{ type: BallType; timestamp: number }>
  powerupActive: boolean
  powerupTimer: number
  nudgeState: NudgeState
  tiltActive: boolean
}

/**
 * Reset the run's numbers: score, lives, combo, gold stack, power-up, nudge / tilt. A new game starts
 * untilted with no nudge history; a stale cooldown or penalty from the last game must not reach this
 * one's tape.
 */
export function resetRunState(host: RunStateHost): void {
  host.score = 0
  host.lives = 3
  host.comboCount = 0
  host.comboTimer = 0
  host.goldBallStack = []
  host.powerupActive = false
  host.powerupTimer = 0
  host.nudgeState = freshNudgeState()
  host.tiltActive = false
}

/**
 * Put a fresh ball in the shooter lane (`PhysicsHost.resetBall`): plunger back to rest, multiball
 * collapsed to one ball, the ball respawned. The game adds the input manager's charge cancel, the
 * equipped rewards and the HUD around it.
 */
export function resetPlayBall(
  inputActions: { resetPlungerState(): void } | null,
  ballManager: { removeExtraBalls(): void; resetBall(): void } | null,
): void {
  inputActions?.resetPlungerState()
  ballManager?.removeExtraBalls()
  ballManager?.resetBall()
}
