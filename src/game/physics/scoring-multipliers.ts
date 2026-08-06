/**
 * Scoring multiplier helpers — small, stateless functions for fever and gold-ball
 * point adjustments. Kept separate from ScoringBridge so the bridge file stays
 * focused on combo/score state.
 */

import { BallType, BALL_SPAWN_CONFIG } from '../../config'
import { DisplayState } from '../../game-elements'

/** Fever gold-ball multiplier from BALL_SPAWN_CONFIG when display is in FEVER state. */
export function getFeverScoreMultiplier(
  displayState: DisplayState | undefined,
  ballType: BallType,
): number {
  if (displayState !== DisplayState.FEVER) return 1
  return BALL_SPAWN_CONFIG.feverMultipliers[ballType]
}

export function applyFeverGoldMultiplier(
  displayState: DisplayState | undefined,
  ballType: BallType,
  points: number,
): number {
  return Math.round(points * getFeverScoreMultiplier(displayState, ballType))
}
