/**
 * Which table a game starts on. One pure decision, made in `startGame` before
 * the session RNG is seeded, so a recorder, a spectator and a friend who opens
 * a share link all land on the same machine for the same inputs.
 *
 *   - A replay that was recorded on a weekly machine rebuilds it from its seed
 *     (`machine: 'weekly'` in the payload); any other replay never inherits the
 *     spectator's weekly mode.
 *   - The Weekly start mode plays this ISO week's machine.
 *   - Daily Cascade and Free Play keep their pin-lattice layouts.
 *   - A vanilla start that arrives with a `?seed=` / `?challenge=` link plays
 *     the weekly machine for that seed — the seed picks the table, not only the
 *     RNG — unless the campaign is the start mode.
 */

import type { DailyCascadeMode } from './daily-cascade-state'

export type StartMachine =
  | { kind: 'vanilla' }
  /** Daily Cascade / Free Play: `DailyCascadeState.ensureLayout()`. */
  | { kind: 'cascade' }
  | { kind: 'weekly'; seed: number }

export interface StartMachineInput {
  mode: DailyCascadeMode
  /** The state's seed (the ISO-week seed in weekly mode). */
  modeSeed: number
  /** The payload being replayed, or null for a live game. */
  replay: { seed: number; machine?: 'weekly' } | null
  /** The active `?seed=` / `?challenge=` seed, or null. */
  challengeSeed: number | null
  /** The campaign rides on the vanilla table; a share link does not mutate it. */
  campaign: boolean
}

export function resolveStartMachine(input: StartMachineInput): StartMachine {
  const { mode, replay } = input
  if (replay) {
    if (replay.machine === 'weekly') return { kind: 'weekly', seed: replay.seed >>> 0 }
    return mode === 'daily' || mode === 'free' ? { kind: 'cascade' } : { kind: 'vanilla' }
  }
  if (mode === 'weekly') return { kind: 'weekly', seed: input.modeSeed >>> 0 }
  if (mode === 'daily' || mode === 'free') return { kind: 'cascade' }
  if (input.challengeSeed !== null && !input.campaign) return { kind: 'weekly', seed: input.challengeSeed >>> 0 }
  return { kind: 'vanilla' }
}
