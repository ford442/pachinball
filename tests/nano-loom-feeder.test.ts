import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FEEDER_TUNABLES } from '../src/config'
import { NanoLoomFeeder, NanoLoomState } from '../src/game-elements/nano-loom-feeder'
import { createMockBall, createMockRapier, createMockWorld } from './feeder-test-helpers'

vi.mock('@babylonjs/core', async () => {
  const { mockBabylonCore } = await import('./feeder-test-helpers')
  return mockBabylonCore()
})

describe('NanoLoomFeeder', () => {
  let feeder: NanoLoomFeeder
  let rapier: ReturnType<typeof createMockRapier>

  beforeEach(() => {
    rapier = createMockRapier()
    feeder = new NanoLoomFeeder({} as never, createMockWorld() as never, rapier as never, FEEDER_TUNABLES['nano-loom'])
  })

  it('starts IDLE', () => {
    expect(feeder.getState()).toBe(NanoLoomState.IDLE)
  })

  it('LIFT → WEAVE → EJECT → IDLE on intake', () => {
    const states: NanoLoomState[] = []
    feeder.onStateChange = (s) => states.push(s)

    const intake = FEEDER_TUNABLES['nano-loom'].intakePosition
    const ball = createMockBall({ x: intake.x, y: intake.y, z: intake.z })
    feeder.update(1 / 60, [ball as never])

    expect(feeder.getState()).toBe(NanoLoomState.LIFT)
    expect(ball.setBodyType).toHaveBeenCalledWith('KinematicPositionBased', true)

    const liftFrames = Math.ceil((FEEDER_TUNABLES['nano-loom'].height / FEEDER_TUNABLES['nano-loom'].liftSpeed) * 60) + 60
    for (let i = 0; i < liftFrames; i++) feeder.update(1 / 60, [ball as never])
    expect(states).toContain(NanoLoomState.WEAVE)

    const loom = FEEDER_TUNABLES['nano-loom'].loomPosition
    const bottomY = loom.y - FEEDER_TUNABLES['nano-loom'].height / 2
    ball.translation = () => ({ x: loom.x, y: bottomY, z: loom.z })
    feeder.update(1 / 60, [ball as never])
    expect(states).toContain(NanoLoomState.EJECT)
    expect(ball.applyImpulse).toHaveBeenCalled()

    const cooldownFrames = Math.ceil(FEEDER_TUNABLES['nano-loom'].ejectCooldown * 60) + 5
    for (let i = 0; i < cooldownFrames; i++) feeder.update(1 / 60, [])
    expect(feeder.getState()).toBe(NanoLoomState.IDLE)
  })

  it('ejects toward center (+X from left wall)', () => {
    const intake = FEEDER_TUNABLES['nano-loom'].intakePosition
    const ball = createMockBall({ x: intake.x, y: intake.y, z: intake.z })
    feeder.update(1 / 60, [ball as never])
    for (let i = 0; i < 400; i++) feeder.update(1 / 60, [ball as never])

    const loom = FEEDER_TUNABLES['nano-loom'].loomPosition
    const bottomY = loom.y - FEEDER_TUNABLES['nano-loom'].height / 2
    ball.translation = () => ({ x: loom.x, y: bottomY, z: loom.z })
    for (let i = 0; i < 120; i++) feeder.update(1 / 60, [ball as never])

    const calls = (ball.applyImpulse as ReturnType<typeof vi.fn>).mock.calls
    const ejectCall = calls.find((c) => c[0].x > 0)
    expect(ejectCall).toBeDefined()
  })

  it('ignores balls outside intake radius', () => {
    const ball = createMockBall({ x: 0, y: 0, z: 0 })
    feeder.update(1 / 60, [ball as never])
    expect(feeder.getState()).toBe(NanoLoomState.IDLE)
  })
})
