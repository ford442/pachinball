import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FEEDER_TUNABLES } from '../src/config'
import { QuantumTunnelFeeder, QuantumTunnelState } from '../src/game-elements/quantum-tunnel-feeder'
import { createMockBall, createMockRapier, createMockWorld } from './feeder-test-helpers'

vi.mock('@babylonjs/core', async () => {
  const { mockBabylonCore } = await import('./feeder-test-helpers')
  return mockBabylonCore()
})

describe('QuantumTunnelFeeder', () => {
  let feeder: QuantumTunnelFeeder
  let rapier: ReturnType<typeof createMockRapier>
  let world: ReturnType<typeof createMockWorld>

  beforeEach(() => {
    rapier = createMockRapier()
    world = createMockWorld({ intersectionPair: true })
    feeder = new QuantumTunnelFeeder({} as never, world as never, rapier as never, FEEDER_TUNABLES['quantum-tunnel'])
  })

  it('starts IDLE', () => {
    expect(feeder.getState()).toBe(QuantumTunnelState.IDLE)
  })

  it('CAPTURE → TRANSPORT → EJECT → COOLDOWN → IDLE', () => {
    const states: QuantumTunnelState[] = []
    feeder.onStateChange = (s) => states.push(s)

    const input = FEEDER_TUNABLES['quantum-tunnel'].inputPosition
    const ball = createMockBall({ x: input.x, y: input.y, z: input.z })
    feeder.update(1 / 60, [ball as never])

    expect(feeder.getState()).toBe(QuantumTunnelState.CAPTURE)
    expect(ball.setBodyType).toHaveBeenCalledWith('KinematicPositionBased', true)

    const pullFrames = Math.ceil(FEEDER_TUNABLES['quantum-tunnel'].capturePullDuration * 60) + 5
    for (let i = 0; i < pullFrames; i++) feeder.update(1 / 60, [ball as never])
    expect(states).toContain(QuantumTunnelState.TRANSPORT)

    const transportFrames = Math.ceil(FEEDER_TUNABLES['quantum-tunnel'].transportDelay * 60) + 5
    for (let i = 0; i < transportFrames; i++) feeder.update(1 / 60, [ball as never])

    expect(states).toContain(QuantumTunnelState.EJECT)
    expect(states).toContain(QuantumTunnelState.COOLDOWN)
    expect(ball.applyImpulse).toHaveBeenCalled()
    expect(ball.setBodyType).toHaveBeenCalledWith('Dynamic', true)

    const cooldownFrames = Math.ceil(FEEDER_TUNABLES['quantum-tunnel'].cooldown * 60) + 2
    for (let i = 0; i < cooldownFrames; i++) feeder.update(1 / 60, [])
    expect(feeder.getState()).toBe(QuantumTunnelState.IDLE)
  })

  it('ejects with +X impulse toward center from left output wall', () => {
    const input = FEEDER_TUNABLES['quantum-tunnel'].inputPosition
    const ball = createMockBall({ x: input.x, y: input.y, z: input.z })
    feeder.update(1 / 60, [ball as never])
    for (let i = 0; i < 200; i++) feeder.update(1 / 60, [ball as never])

    const call = (ball.applyImpulse as ReturnType<typeof vi.fn>).mock.calls.at(-1)
    expect(call).toBeDefined()
    expect(call![0].x).toBe(FEEDER_TUNABLES['quantum-tunnel'].ejectImpulse)
    expect(call![0].x).toBeGreaterThan(0)
  })

  it('does not capture when sensor reports no intersection', () => {
    const idleWorld = createMockWorld({ intersectionPair: false })
    const idleFeeder = new QuantumTunnelFeeder({} as never, idleWorld as never, rapier as never, FEEDER_TUNABLES['quantum-tunnel'])
    const input = FEEDER_TUNABLES['quantum-tunnel'].inputPosition
    const ball = createMockBall({ x: input.x, y: input.y, z: input.z })
    idleFeeder.update(1 / 60, [ball as never])
    expect(idleFeeder.getState()).toBe(QuantumTunnelState.IDLE)
  })
})
