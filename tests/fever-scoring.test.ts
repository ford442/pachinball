import { describe, it, expect } from 'vitest'
import { BallType, BALL_SPAWN_CONFIG, GameConfig } from '../src/config'
import { DisplayState } from '../src/game-elements'
import { applyFeverGoldMultiplier, getFeverScoreMultiplier } from '../src/game/game-physics-controller'

describe('getFeverScoreMultiplier', () => {
  it('returns 1× for gold-plated when display is IDLE', () => {
    expect(getFeverScoreMultiplier(DisplayState.IDLE, BallType.GOLD_PLATED)).toBe(1)
  })

  it('returns 1× for solid-gold when display is IDLE', () => {
    expect(getFeverScoreMultiplier(DisplayState.IDLE, BallType.SOLID_GOLD)).toBe(1)
  })

  it('returns 1× when display state is undefined', () => {
    expect(getFeverScoreMultiplier(undefined, BallType.GOLD_PLATED)).toBe(1)
  })

  it('returns 1× for standard balls even during FEVER', () => {
    expect(getFeverScoreMultiplier(DisplayState.FEVER, BallType.STANDARD)).toBe(1)
  })

  it('returns config fever multiplier for gold-plated during FEVER', () => {
    expect(getFeverScoreMultiplier(DisplayState.FEVER, BallType.GOLD_PLATED)).toBe(
      BALL_SPAWN_CONFIG.feverMultipliers[BallType.GOLD_PLATED],
    )
    expect(getFeverScoreMultiplier(DisplayState.FEVER, BallType.GOLD_PLATED)).toBe(2)
  })

  it('returns config fever multiplier for solid-gold during FEVER', () => {
    expect(getFeverScoreMultiplier(DisplayState.FEVER, BallType.SOLID_GOLD)).toBe(
      BALL_SPAWN_CONFIG.feverMultipliers[BallType.SOLID_GOLD],
    )
    expect(getFeverScoreMultiplier(DisplayState.FEVER, BallType.SOLID_GOLD)).toBe(5)
  })

  it('does not apply fever multiplier during REACH or JACKPOT', () => {
    expect(getFeverScoreMultiplier(DisplayState.REACH, BallType.GOLD_PLATED)).toBe(1)
    expect(getFeverScoreMultiplier(DisplayState.JACKPOT, BallType.SOLID_GOLD)).toBe(1)
  })

  it('gold-plated collect during FEVER awards base × 2 before combo stacking', () => {
    const base = BALL_SPAWN_CONFIG.points[BallType.GOLD_PLATED]
    const feverAdjusted = Math.round(base * getFeverScoreMultiplier(DisplayState.FEVER, BallType.GOLD_PLATED))
    expect(feverAdjusted).toBe(2000)
  })

  it('solid-gold collect during FEVER awards base × 5 before combo stacking', () => {
    const base = BALL_SPAWN_CONFIG.points[BallType.SOLID_GOLD]
    const feverAdjusted = Math.round(base * getFeverScoreMultiplier(DisplayState.FEVER, BallType.SOLID_GOLD))
    expect(feverAdjusted).toBe(25000)
  })

  it('gold-plated small-ball swarm during FEVER applies fever to members and quick-collect bonus before combo stacking', () => {
    const memberBase = GameConfig.smallGoldBalls.basePoints
    const swarmSize = GameConfig.smallGoldBalls.swarmSize
    const feverAdjustedMember = applyFeverGoldMultiplier(DisplayState.FEVER, BallType.GOLD_PLATED, memberBase)
    const quickCollectBase = Math.round(
      memberBase * swarmSize * GameConfig.smallGoldBalls.quickCollectMultiplier,
    )
    const feverAdjustedQuickCollect = applyFeverGoldMultiplier(
      DisplayState.FEVER,
      BallType.GOLD_PLATED,
      quickCollectBase,
    )

    expect(feverAdjustedMember).toBe(600)
    expect(feverAdjustedMember * swarmSize).toBe(3000)
    expect(quickCollectBase).toBe(3000)
    expect(feverAdjustedQuickCollect).toBe(6000)
    expect((feverAdjustedMember * swarmSize) + feverAdjustedQuickCollect).toBe(9000)
  })
})
