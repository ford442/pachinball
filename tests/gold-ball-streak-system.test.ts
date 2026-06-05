import { describe, it, expect, beforeEach } from 'vitest'
import { GoldBallStreakSystem } from '../src/game-elements/gold-ball-streak-system'

const CONFIG = {
  windowSeconds: 5,
  perBallBonus: 0.5,
  maxMultiplier: 4,
}

describe('GoldBallStreakSystem', () => {
  let system: GoldBallStreakSystem

  beforeEach(() => {
    system = new GoldBallStreakSystem(CONFIG)
  })

  it('first collect is never a streak and returns 1× multiplier', () => {
    const result = system.registerCollect(0)
    expect(result.streakCount).toBe(1)
    expect(result.multiplier).toBe(1)
    expect(result.isStreak).toBe(false)
  })

  it('second collect within window is a streak with 1.5×', () => {
    system.registerCollect(0)
    const result = system.registerCollect(3)
    expect(result.streakCount).toBe(2)
    expect(result.multiplier).toBe(1.5)
    expect(result.isStreak).toBe(true)
  })

  it('third consecutive collect escalates to 2×', () => {
    system.registerCollect(0)
    system.registerCollect(2)
    const result = system.registerCollect(4)
    expect(result.streakCount).toBe(3)
    expect(result.multiplier).toBe(2)
  })

  it('caps multiplier at maxMultiplier', () => {
    for (let i = 0; i < 10; i++) {
      system.registerCollect(i * 0.5)
    }
    const result = system.registerCollect(5)
    expect(result.multiplier).toBe(CONFIG.maxMultiplier)
  })

  it('collect outside window breaks the streak and resets to 1×', () => {
    system.registerCollect(0)
    system.registerCollect(3) // streak 2
    const result = system.registerCollect(100) // well outside 5-second window
    expect(result.streakCount).toBe(1)
    expect(result.multiplier).toBe(1)
    expect(result.isStreak).toBe(false)
  })

  it('collect exactly at the window boundary is still a streak', () => {
    system.registerCollect(0)
    const result = system.registerCollect(CONFIG.windowSeconds) // exactly at edge
    expect(result.isStreak).toBe(true)
    expect(result.streakCount).toBe(2)
  })

  it('collect just past the window boundary breaks streak', () => {
    system.registerCollect(0)
    const result = system.registerCollect(CONFIG.windowSeconds + 0.001)
    expect(result.isStreak).toBe(false)
    expect(result.streakCount).toBe(1)
  })

  it('reset() clears streak so next collect is not a streak', () => {
    system.registerCollect(0)
    system.registerCollect(1) // streak
    system.reset()
    const result = system.registerCollect(1.5)
    expect(result.streakCount).toBe(1)
    expect(result.isStreak).toBe(false)
  })

  it('getStreakCount() reflects current streak', () => {
    expect(system.getStreakCount()).toBe(0)
    system.registerCollect(0)
    expect(system.getStreakCount()).toBe(1)
    system.registerCollect(1)
    expect(system.getStreakCount()).toBe(2)
    system.reset()
    expect(system.getStreakCount()).toBe(0)
  })

  it('multiplier steps are correct for each streak level', () => {
    const counts: number[] = []
    const multipliers: number[] = []
    for (let i = 0; i < 7; i++) {
      const r = system.registerCollect(i * 0.5)
      counts.push(r.streakCount)
      multipliers.push(r.multiplier)
    }
    expect(counts).toEqual([1, 2, 3, 4, 5, 6, 7])
    // 1× 1.5× 2× 2.5× 3× 3.5× 4× (cap)
    expect(multipliers).toEqual([1, 1.5, 2, 2.5, 3, 3.5, 4])
  })
})
