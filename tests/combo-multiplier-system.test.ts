import { describe, expect, it } from 'vitest'
import { ComboMultiplierSystem } from '../src/game-elements/combo-multiplier-system'

const testSystem = (): ComboMultiplierSystem =>
  new ComboMultiplierSystem({
    windowSeconds: 2.5,
    hitsPerMultiplier: 2,
    maxMultiplier: 5,
  })

describe('ComboMultiplierSystem', () => {
  it('starts at 1x with zero combo', () => {
    const system = testSystem()
    expect(system.getState().comboCount).toBe(0)
    expect(system.getState().multiplier).toBe(1)
    expect(system.getState().windowRemaining).toBe(0)
  })

  it('increments combo on first hit and stays at 1x', () => {
    const system = testSystem()
    const result = system.registerHit(0)
    expect(result.comboCount).toBe(1)
    expect(result.multiplier).toBe(1)
    expect(result.changed).toBe(false)
  })

  it('jumps to 2x after the second hit', () => {
    const system = testSystem()
    system.registerHit(0)
    const result = system.registerHit(0.5)
    expect(result.comboCount).toBe(2)
    expect(result.multiplier).toBe(2)
    expect(result.changed).toBe(true)
  })

  it('reaches 3x after four hits', () => {
    const system = testSystem()
    system.registerHit(0)
    system.registerHit(0.5)
    system.registerHit(1.0)
    const result = system.registerHit(1.5)
    expect(result.comboCount).toBe(4)
    expect(result.multiplier).toBe(3)
  })

  it('caps at maxMultiplier', () => {
    const system = testSystem()
    for (let i = 0; i < 12; i++) {
      system.registerHit(i * 0.1)
    }
    expect(system.getState().multiplier).toBe(5)
  })

  it('refreshes window on each hit', () => {
    const system = testSystem()
    system.registerHit(0)
    system.update(2.0)
    // Window still has 0.5s left
    expect(system.getState().windowRemaining).toBeCloseTo(0.5, 1)
    system.registerHit(2.0)
    // Window refreshed back to 2.5s
    expect(system.getState().windowRemaining).toBeCloseTo(2.5, 1)
  })

  it('expires and resets after window elapses', () => {
    const system = testSystem()
    system.registerHit(0)
    system.registerHit(0.5)
    const expired = system.update(3.0)
    expect(expired).not.toBeNull()
    expect(expired!.expired).toBe(true)
    expect(expired!.comboCount).toBe(2)
    expect(system.getState().comboCount).toBe(0)
    expect(system.getState().multiplier).toBe(1)
  })

  it('tracks peak combo across multiple windows', () => {
    const system = testSystem()
    system.registerHit(0)
    system.registerHit(0.5)
    system.registerHit(1.0)
    expect(system.getState().peakCombo).toBe(3)
    system.update(3.0)
    expect(system.getState().peakCombo).toBe(3)
    system.registerHit(4.0)
    expect(system.getState().peakCombo).toBe(3)
  })

  it('reset returns peak and final count then clears state', () => {
    const system = testSystem()
    system.registerHit(0)
    system.registerHit(0.5)
    const result = system.reset()
    expect(result.peakCombo).toBe(2)
    expect(result.comboCount).toBe(2)
    expect(system.getState().comboCount).toBe(0)
    expect(system.getState().multiplier).toBe(1)
  })

  it('clearPeak resets only the peak counter', () => {
    const system = testSystem()
    system.registerHit(0)
    system.registerHit(0.5)
    system.clearPeak()
    expect(system.getState().peakCombo).toBe(0)
    expect(system.getState().comboCount).toBe(2)
  })
})
