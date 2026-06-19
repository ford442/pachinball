import { describe, it, expect } from 'vitest'
import { DisplayStateMachine } from '../src/display/display-state-machine'
import { DisplayState } from '../src/game-elements/display-config'

describe('DisplayStateMachine', () => {
  it('starts in IDLE with full blend', () => {
    const sm = new DisplayStateMachine(0.3)
    const snap = sm.update(0)
    expect(snap.current).toBe(DisplayState.IDLE)
    expect(snap.blend).toBe(1)
    expect(snap.isTransitioning).toBe(false)
  })

  it('transitions through blend on state change', () => {
    const sm = new DisplayStateMachine(0.3)
    expect(sm.requestState(DisplayState.REACH)).toBe(true)

    const mid = sm.update(0.15)
    expect(mid.current).toBe(DisplayState.REACH)
    expect(mid.isTransitioning).toBe(true)
    expect(mid.blend).toBeGreaterThan(0)
    expect(mid.blend).toBeLessThan(1)
    expect(mid.lightingMode).toBe('reach')

    const done = sm.update(0.2)
    expect(done.isTransitioning).toBe(false)
    expect(done.blend).toBe(1)
  })

  it('ignores duplicate state requests', () => {
    const sm = new DisplayStateMachine(0.3)
    sm.requestState(DisplayState.FEVER)
    expect(sm.requestState(DisplayState.FEVER)).toBe(false)
  })

  it('maps jackpot to jackpot lighting mode', () => {
    const sm = new DisplayStateMachine(0.2)
    sm.requestState(DisplayState.JACKPOT)
    const snap = sm.update(0.2)
    expect(snap.lightingMode).toBe('jackpot')
  })
})
