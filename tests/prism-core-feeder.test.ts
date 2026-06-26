import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FEEDER_TUNABLES } from '../src/config'
import { PrismCoreFeeder, PrismCoreState } from '../src/game-elements/prism-core-feeder'
import { createMockBall, createMockRapier, createMockWorld } from './feeder-test-helpers'

vi.mock('@babylonjs/core', async () => {
  const { mockBabylonCore } = await import('./feeder-test-helpers')
  return mockBabylonCore()
})

describe('PrismCoreFeeder', () => {
  let feeder: PrismCoreFeeder
  let rapier: ReturnType<typeof createMockRapier>

  beforeEach(() => {
    rapier = createMockRapier()
    feeder = new PrismCoreFeeder({} as never, createMockWorld() as never, rapier as never, FEEDER_TUNABLES['prism-core'])
  })

  it('starts IDLE (empty lock)', () => {
    expect(feeder.getState()).toBe(PrismCoreState.IDLE)
  })

  it('LOCKED_1 → LOCKED_2 → OVERLOAD releases all balls with eject force', () => {
    const states: PrismCoreState[] = []
    feeder.onStateChange = (s) => states.push(s)

    const pos = FEEDER_TUNABLES['prism-core'].prismPosition
    const makeBall = () => createMockBall({ x: pos.x, y: pos.y, z: pos.z })

    for (let n = 0; n < FEEDER_TUNABLES['prism-core'].lockCapacity; n++) {
      const ball = makeBall()
      feeder.update(1 / 60, [ball as never])
    }

    expect(states).toContain(PrismCoreState.LOCKED_1)
    expect(states).toContain(PrismCoreState.LOCKED_2)
    expect(states).toContain(PrismCoreState.OVERLOAD)
    expect(feeder.getState()).toBe(PrismCoreState.IDLE)
  })

  it('eject impulse aims toward center (-Z from top)', () => {
    const pos = FEEDER_TUNABLES['prism-core'].prismPosition
    const balls = [1, 2, 3].map(() => createMockBall({ x: pos.x, y: pos.y, z: pos.z }))
    for (const ball of balls) {
      feeder.update(1 / 60, [ball as never])
    }

    for (const ball of balls) {
      const call = (ball.applyImpulse as ReturnType<typeof vi.fn>).mock.calls.at(-1)
      expect(call).toBeDefined()
      expect(call![0].z).toBeLessThan(0)
    }
  })

  it('does not capture during post-release cooldown', () => {
    const pos = FEEDER_TUNABLES['prism-core'].prismPosition
    for (let n = 0; n < 3; n++) {
      feeder.update(1 / 60, [createMockBall({ x: pos.x, y: pos.y, z: pos.z }) as never])
    }

    const extra = createMockBall({ x: pos.x, y: pos.y, z: pos.z })
    feeder.update(1 / 60, [extra as never])
    expect(extra.setBodyType).not.toHaveBeenCalled()
  })
})
