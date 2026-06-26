import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FEEDER_TUNABLES } from '../src/config'
import { GaussCannonFeeder, GaussCannonState } from '../src/game-elements/gauss-cannon-feeder'
import { createMockBall, createMockRapier, createMockWorld } from './feeder-test-helpers'

vi.mock('@babylonjs/core', async () => {
  const { mockBabylonCore } = await import('./feeder-test-helpers')
  return mockBabylonCore()
})

describe('GaussCannonFeeder', () => {
  let feeder: GaussCannonFeeder
  let rapier: ReturnType<typeof createMockRapier>

  beforeEach(() => {
    rapier = createMockRapier()
    feeder = new GaussCannonFeeder({} as never, createMockWorld() as never, rapier as never, FEEDER_TUNABLES['gauss-cannon'])
  })

  it('starts IDLE with configured intake radius behavior', () => {
    expect(feeder.getState()).toBe(GaussCannonState.IDLE)
  })

  it('LOAD → AIM → FIRE → COOLDOWN → IDLE on ball intake', () => {
    const states: GaussCannonState[] = []
    feeder.onStateChange = (s) => states.push(s)

    const pos = FEEDER_TUNABLES['gauss-cannon'].gaussPosition
    const ball = createMockBall({ x: pos.x, y: pos.y, z: pos.z })
    feeder.update(1 / 60, [ball as never])

    expect(feeder.getState()).toBe(GaussCannonState.LOAD)
    expect(ball.setBodyType).toHaveBeenCalledWith('KinematicPositionBased', true)

    for (let i = 0; i < 120; i++) feeder.update(1 / 60, [ball as never])
    expect(states).toContain(GaussCannonState.AIM)

    const aimFrames = Math.ceil(FEEDER_TUNABLES['gauss-cannon'].aimDuration * 60) + 5
    for (let i = 0; i < aimFrames; i++) feeder.update(1 / 60, [ball as never])

    expect(states).toContain(GaussCannonState.FIRE)
    expect(states).toContain(GaussCannonState.COOLDOWN)
    expect(ball.applyImpulse).toHaveBeenCalled()
    expect(ball.setBodyType).toHaveBeenLastCalledWith('Dynamic', true)
  })

  it('ignores balls outside intake radius during IDLE', () => {
    const ball = createMockBall({ x: 0, y: 0, z: 0 })
    feeder.update(1 / 60, [ball as never])
    expect(feeder.getState()).toBe(GaussCannonState.IDLE)
    expect(ball.setBodyType).not.toHaveBeenCalled()
  })

  it('applies muzzle impulse toward positive X (center field from left wall)', () => {
    const pos = FEEDER_TUNABLES['gauss-cannon'].gaussPosition
    const ball = createMockBall({ x: pos.x, y: pos.y, z: pos.z })
    feeder.update(1 / 60, [ball as never])
    for (let i = 0; i < 300; i++) feeder.update(1 / 60, [ball as never])

    const call = (ball.applyImpulse as ReturnType<typeof vi.fn>).mock.calls.at(-1)
    expect(call).toBeDefined()
    expect(call![0].x).toBeGreaterThan(0)
  })

  it('does not re-capture during COOLDOWN', () => {
    const pos = FEEDER_TUNABLES['gauss-cannon'].gaussPosition
    const ball = createMockBall({ x: pos.x, y: pos.y, z: pos.z })
    feeder.update(1 / 60, [ball as never])

    const aimFrames = Math.ceil(FEEDER_TUNABLES['gauss-cannon'].aimDuration * 60) + 30
    for (let i = 0; i < aimFrames; i++) feeder.update(1 / 60, [ball as never])

    expect(feeder.getState()).toBe(GaussCannonState.COOLDOWN)

    const second = createMockBall({ x: pos.x, y: pos.y, z: pos.z })
    feeder.update(1 / 60, [second as never])
    expect(second.setBodyType).not.toHaveBeenCalled()
  })
})
