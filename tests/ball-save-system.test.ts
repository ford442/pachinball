import { describe, expect, it } from 'vitest'
import { BallSaveSystem } from '../src/game-elements/ball-save-system'

const testSystem = (): BallSaveSystem =>
  new BallSaveSystem({ graceMs: 7000 })

describe('BallSaveSystem', () => {
  it('is inactive before launch', () => {
    const system = testSystem()
    expect(system.isActive()).toBe(false)
    expect(system.canSave(1000)).toBe(false)
    expect(system.getRemainingMs(1000)).toBe(0)
  })

  it('can save within grace window after launch', () => {
    const system = testSystem()
    system.onBallLaunched(1000)
    expect(system.isActive()).toBe(true)
    expect(system.canSave(2000)).toBe(true)
    expect(system.getRemainingMs(2000)).toBe(6000)
  })

  it('cannot save after grace window expires', () => {
    const system = testSystem()
    system.onBallLaunched(1000)
    expect(system.canSave(9000)).toBe(false)
    expect(system.getRemainingMs(9000)).toBe(0)
  })

  it('cannot save exactly at boundary', () => {
    const system = testSystem()
    system.onBallLaunched(1000)
    expect(system.canSave(8000)).toBe(true)
    expect(system.canSave(8001)).toBe(false)
  })

  it('consumeSave marks save as used', () => {
    const system = testSystem()
    system.onBallLaunched(1000)
    system.consumeSave()
    expect(system.isActive()).toBe(false)
    expect(system.canSave(2000)).toBe(false)
  })

  it('expire force-ends the window', () => {
    const system = testSystem()
    system.onBallLaunched(1000)
    system.expire()
    expect(system.isActive()).toBe(false)
    expect(system.canSave(2000)).toBe(false)
  })

  it('handles multiple launches by restarting the window', () => {
    const system = testSystem()
    system.onBallLaunched(1000)
    system.onBallLaunched(5000)
    expect(system.canSave(11000)).toBe(true)
    expect(system.canSave(12001)).toBe(false)
  })
})
