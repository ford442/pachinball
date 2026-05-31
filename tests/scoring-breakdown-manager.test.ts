import { describe, expect, it, beforeEach } from 'vitest'
import { ScoringBreakdownManager } from '../src/game-elements/scoring-breakdown'

const storage = new Map<string, string>()

Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value)
    },
    clear: () => {
      storage.clear()
    },
  },
  configurable: true,
})

describe('ScoringBreakdownManager', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('tallies a mixed run into expected categories and total', () => {
    const manager = new ScoringBreakdownManager()
    manager.reset()

    manager.recordScore(150, 'bumper-hit')
    manager.recordScore(75, 'launcher-triggered')
    manager.recordScore(300, 'gold-ball-collect')
    manager.recordScore(90, 'combo-chain-bonus')
    manager.recordScore(1200, 'adventure-end-bonus')
    manager.recordScore(500, 'jackpot')
    manager.recordScore(50, 'mystery-source')

    expect(manager.getSnapshot()).toEqual({
      bumpers: 150,
      specialObstacles: 75,
      goldBalls: 300,
      comboBonus: 90,
      timeGoalBonus: 1200,
      premiumBonus: 500,
      other: 50,
      total: 2365,
    })
  })

  it('loads persisted state and can be reset', () => {
    const managerA = new ScoringBreakdownManager()
    managerA.reset()
    managerA.recordScore(200, 'target-hit')
    managerA.recordScore(100, 'slot-win')

    const managerB = new ScoringBreakdownManager()
    expect(managerB.getSnapshot().total).toBe(300)

    managerB.reset()
    expect(managerB.getSnapshot().total).toBe(0)
  })
})
