import { describe, expect, it } from 'vitest'
import { ComboSystem } from '../src/game-elements/combo-system'

const testSystem = (): ComboSystem => new ComboSystem({
  expirySeconds: 1.5,
  chainWindowSeconds: 4,
  chainDistinctThreshold: 3,
  chainMultiplier: 1.5,
  chainCooldownSeconds: 0.8,
  namedChains: [
    {
      name: 'SPIN LAUNCH SLAM',
      sequence: ['spinner', 'launcher', 'bumper'],
      bonusPoints: 250,
      multiplierBonus: 0.2,
    },
  ],
})

describe('ComboSystem', () => {
  it('triggers a distinct-type chain within the chain window', () => {
    const system = testSystem()

    system.registerBumperHit(0)
    system.registerChainHit('spinner', 0.4)
    const result = system.registerChainHit('launcher', 0.7)

    expect(result.chain.triggered).toBe(true)
    expect(result.chain.chainLength).toBe(3)
    expect(result.chain.chainMultiplier).toBeGreaterThan(1)
  })

  it('does not count duplicate obstacle type as distinct chain progress', () => {
    const system = testSystem()

    system.registerBumperHit(0)
    system.registerChainHit('spinner', 0.3)
    const duplicate = system.registerChainHit('spinner', 0.6)

    expect(duplicate.chain.triggered).toBe(false)
    expect(system.getSnapshot().chainProgress).toBe(2)
  })

  it('expires combo and returns broken state when timer runs out', () => {
    const system = testSystem()
    system.registerBumperHit(0)
    const broken = system.update(2)

    expect(broken).not.toBeNull()
    expect(broken?.finalComboCount).toBe(1)
    expect(system.getSnapshot().comboCount).toBe(0)
  })

  it('applies named-chain bonus when sequence matches', () => {
    const system = testSystem()

    system.registerBumperHit(0)
    system.registerChainHit('spinner', 0.2)
    system.registerChainHit('launcher', 0.4)
    const finisher = system.registerBumperHit(1.4)

    expect(finisher.chain.triggered).toBe(true)
    expect(finisher.chain.namedChain?.name).toBe('SPIN LAUNCH SLAM')
    expect(finisher.chain.bonusPoints).toBe(250)
    expect(finisher.chain.chainMultiplier).toBeCloseTo(1.7)
  })
})
