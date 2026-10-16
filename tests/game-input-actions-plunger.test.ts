/**
 * #441 — the launch impulse comes from the charge on the input frame, never
 * the spectator's own live `plungerChargeLevel`.
 */
import { describe, expect, it, vi } from 'vitest'
import { GameInputActions, type InputActionsHost } from '../src/game/game-input-actions'
import { applyPlungerChargeCurve, getPhysicsTuningValue } from '../src/game-elements/physics-tuning'

function makeHost(plungerChargeLevel: number) {
  const applyImpulse = vi.fn()
  const host = {
    physics: {},
    gameObjects: null,
    hapticManager: null,
    soundSystem: { playSample: vi.fn() },
    effects: null,
    stateManager: {},
    accessibility: { reducedMotion: true },
    plungerChargeLevel,
    tiltActive: false,
    ballManager: {
      getBallBody: () => ({ translation: () => ({ x: 10.5, y: 0.5, z: -8 }), applyImpulse }),
    },
  }
  return { host: host as unknown as InputActionsHost, applyImpulse }
}

function expectedImpulse(charge: number): number {
  const min = getPhysicsTuningValue('plungerMinImpulse')
  const max = getPhysicsTuningValue('plungerMaxImpulse')
  return min + (max - min) * applyPlungerChargeCurve(charge)
}

describe('GameInputActions.handlePlunger', () => {
  it('fires at the charge it is given, ignoring the host charge (replay path)', () => {
    const { host, applyImpulse } = makeHost(0)
    const actions = new GameInputActions(host)
    expect(actions.handlePlunger(0.5)).toBe(true)
    expect(applyImpulse).toHaveBeenCalledWith({ x: 0, y: 0, z: expectedImpulse(0.5) }, true)
    expect(actions.lastLaunchImpulse).toBe(expectedImpulse(0.5))
  })

  it('a taped charge of 0 is honoured even when the host holds a full charge', () => {
    const { host, applyImpulse } = makeHost(1)
    new GameInputActions(host).handlePlunger(0)
    expect(applyImpulse).toHaveBeenCalledWith({ x: 0, y: 0, z: expectedImpulse(0) }, true)
  })

  it('falls back to the host charge only for direct callers that pass none', () => {
    const { host, applyImpulse } = makeHost(1)
    new GameInputActions(host).handlePlunger()
    expect(applyImpulse).toHaveBeenCalledWith({ x: 0, y: 0, z: expectedImpulse(1) }, true)
  })
})
