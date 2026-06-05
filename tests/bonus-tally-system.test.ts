import { describe, expect, it } from 'vitest'
import { BonusTallySystem } from '../src/game-elements/bonus-tally-system'

const testSystem = (): BonusTallySystem =>
  new BonusTallySystem({ comboPeakBase: 250 })

describe('BonusTallySystem', () => {
  it('starts with zero bonus', () => {
    const system = testSystem()
    expect(system.getTotalBonus()).toBe(0)
    expect(Object.keys(system.getBreakdown())).toHaveLength(0)
  })

  it('accumulates scores from multiple sources', () => {
    const system = testSystem()
    system.recordScore('chain-bonus', 250)
    system.recordScore('gold-ball', 1000)
    system.recordScore('chain-bonus', 180)
    expect(system.getTotalBonus()).toBe(1430)
    const breakdown = system.getBreakdown()
    expect(breakdown['chain-bonus']).toBe(430)
    expect(breakdown['gold-ball']).toBe(1000)
  })

  it('adds combo-peak bonus based on highest combo', () => {
    const system = testSystem()
    system.recordScore('chain-bonus', 250)
    system.recordComboPeak(4)
    expect(system.getTotalBonus()).toBe(250 + 4 * 250)
    const breakdown = system.getBreakdown()
    expect(breakdown['combo-peak']).toBe(1000)
  })

  it('updates peak combo only when higher', () => {
    const system = testSystem()
    system.recordComboPeak(3)
    system.recordComboPeak(2)
    system.recordComboPeak(5)
    expect(system.getBreakdown()['combo-peak']).toBe(5 * 250)
  })

  it('sweep returns total, breakdown, and clears the bucket', () => {
    const system = testSystem()
    system.recordScore('gold-ball', 5000)
    system.recordComboPeak(6)
    const result = system.sweep()
    expect(result.total).toBe(5000 + 6 * 250)
    expect(result.breakdown['gold-ball']).toBe(5000)
    expect(result.breakdown['combo-peak']).toBe(1500)
    expect(result.peakCombo).toBe(6)
    expect(system.getTotalBonus()).toBe(0)
    expect(Object.keys(system.getBreakdown())).toHaveLength(0)
  })

  it('reset clears everything without returning data', () => {
    const system = testSystem()
    system.recordScore('chain-bonus', 250)
    system.recordComboPeak(4)
    system.reset()
    expect(system.getTotalBonus()).toBe(0)
    expect(system.getBreakdown()).toEqual({})
  })

  it('handles negative or zero combo peak gracefully', () => {
    const system = testSystem()
    system.recordComboPeak(0)
    expect(system.getBreakdown()['combo-peak']).toBeUndefined()
    expect(system.getTotalBonus()).toBe(0)
  })
})
