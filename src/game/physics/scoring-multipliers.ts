/**
 * Scoring multiplier helpers — small, stateless functions for fever and gold-ball
 * point adjustments. Kept separate from ScoringBridge so the bridge file stays
 * focused on combo/score state.
 */

import { BallType, BALL_SPAWN_CONFIG } from '../../config'
import { DisplayState } from '../../display/display-types'

/** Gold-ball multipliers by ball type while the backbox is in FEVER (the run's `rules.balls.feverMultipliers`). */
export type FeverMultipliers = Readonly<Record<BallType, number>>

/** Fever gold-ball multiplier when display is in FEVER state (default: `BALL_SPAWN_CONFIG`, the vanilla rules'). */
export function getFeverScoreMultiplier(
  displayState: DisplayState | undefined,
  ballType: BallType,
  multipliers: FeverMultipliers = BALL_SPAWN_CONFIG.feverMultipliers,
): number {
  if (displayState !== DisplayState.FEVER) return 1
  return multipliers[ballType]
}

export function applyFeverGoldMultiplier(
  displayState: DisplayState | undefined,
  ballType: BallType,
  points: number,
  multipliers: FeverMultipliers = BALL_SPAWN_CONFIG.feverMultipliers,
): number {
  return Math.round(points * getFeverScoreMultiplier(displayState, ballType, multipliers))
}
