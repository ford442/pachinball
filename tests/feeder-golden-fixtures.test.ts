/**
 * Golden FSM fixtures — parity gate for FEEDER_TUNABLES extraction.
 * Fixed Math.random + frame stepping must replay identically pre/post refactor.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { FEEDER_TUNABLES } from '../src/config'
import { MagSpinFeeder, MagSpinState } from '../src/game-elements/mag-spin-feeder'
import { NanoLoomFeeder, NanoLoomState } from '../src/game-elements/nano-loom-feeder'
import { PrismCoreFeeder, PrismCoreState } from '../src/game-elements/prism-core-feeder'
import { GaussCannonFeeder, GaussCannonState } from '../src/game-elements/gauss-cannon-feeder'
import { QuantumTunnelFeeder, QuantumTunnelState } from '../src/game-elements/quantum-tunnel-feeder'
import {
  createMockBall,
  createMockRapier,
  createMockWorld,
  runFeederFsmGolden,
} from './feeder-test-helpers'

vi.mock('@babylonjs/core', async () => {
  const { mockBabylonCore } = await import('./feeder-test-helpers')
  return mockBabylonCore()
})

vi.mock('../src/game-elements/visual-language', () => ({
  color: (_hex: string) => ({ r: 0, g: 1, b: 1, scale: () => ({ r: 0, g: 1, b: 1 }) }),
  emissive: () => ({ r: 0, g: 0.5, b: 1 }),
  FEEDER_STYLES: {
    MAG_SPIN: {
      base: '#00aaff',
      active: '#00ffff',
      locked: '#aa00ff',
      release: '#ff00aa',
    },
  },
  INTENSITY: { LOW: 0.3, FLASH: 1.0 },
}))

const DT = 1 / 60

describe('feeder golden FSM fixtures', () => {
  let randomSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5)
    vi.spyOn(performance, 'now').mockReturnValue(0)
  })

  afterEach(() => {
    randomSpy.mockRestore()
    vi.restoreAllMocks()
  })

  it('mag-spin: IDLE → CATCH → SPIN → RELEASE → COOLDOWN with fixed impulse', () => {
    const rapier = createMockRapier()
    const feeder = new MagSpinFeeder({} as never, createMockWorld() as never, rapier as never, FEEDER_TUNABLES['mag-spin'])
    const ball = createMockBall({ x: 9.5, y: 0.5, z: 12.2 })

    const record = runFeederFsmGolden({
      feeder,
      ball,
      maxFrames: 400,
      getState: () => feeder.getState(),
      stateNames: MagSpinState,
      stopWhen: (state) => state === MagSpinState.COOLDOWN,
    })

    expect(record.states).toEqual([
      MagSpinState.IDLE,
      MagSpinState.CATCH,
      MagSpinState.SPIN,
      MagSpinState.RELEASE,
      MagSpinState.COOLDOWN,
    ])

    expect(record.impulses).toHaveLength(1)
    const imp = record.impulses[0]
    expect(imp.x).toBeCloseTo(-19.87167170926644, 10)
    expect(imp.y).toBeCloseTo(1.9936305570722506, 10)
    expect(imp.z).toBeCloseTo(-15.03802183403947, 10)
    expect(record.releaseAngvel).toEqual({ x: 0, y: 12, z: 0 })
  })

  it('nano-loom: LIFT → WEAVE → EJECT with fixed eject impulse', () => {
    const rapier = createMockRapier()
    const feeder = new NanoLoomFeeder({} as never, createMockWorld() as never, rapier as never, FEEDER_TUNABLES['nano-loom'])
    const intake = FEEDER_TUNABLES['nano-loom'].intakePosition
    const ball = createMockBall({ x: intake.x, y: intake.y, z: intake.z })

    const record = runFeederFsmGolden({
      feeder,
      ball,
      maxFrames: 500,
      getState: () => feeder.getState(),
      stateNames: NanoLoomState,
      onFrame: (frame) => {
        const loom = FEEDER_TUNABLES['nano-loom'].loomPosition
        const bottomY = loom.y - FEEDER_TUNABLES['nano-loom'].height / 2
        if (frame > 200) {
          ball.translation = () => ({ x: loom.x, y: bottomY, z: loom.z })
        }
      },
      stopWhen: (state) => state === NanoLoomState.EJECT,
    })

    expect(record.states).toEqual([
      NanoLoomState.IDLE,
      NanoLoomState.LIFT,
      NanoLoomState.WEAVE,
      NanoLoomState.EJECT,
    ])

    const ejectImpulse = record.impulses.find((i) => i.x === 8 && i.y === 2)
    expect(ejectImpulse).toEqual({ x: 8, y: 2, z: 0 })
  })

  it('prism-core: three-ball lock chain with fixed spread eject impulses', () => {
    const rapier = createMockRapier()
    const feeder = new PrismCoreFeeder({} as never, createMockWorld() as never, rapier as never, FEEDER_TUNABLES['prism-core'])
    const pos = FEEDER_TUNABLES['prism-core'].prismPosition

    const states: PrismCoreState[] = []
    feeder.onStateChange = (s) => states.push(s)

    const balls = [1, 2, 3].map(() => createMockBall({ x: pos.x, y: pos.y, z: pos.z }))
    for (const ball of balls) {
      feeder.update(DT, [ball as never])
    }

    expect(states).toEqual([
      PrismCoreState.LOCKED_1,
      PrismCoreState.LOCKED_2,
      PrismCoreState.OVERLOAD,
      PrismCoreState.IDLE,
    ])

    const impulses = balls.map((ball) => {
      const call = (ball.applyImpulse as ReturnType<typeof vi.fn>).mock.calls.at(-1)
      return call![0]
    })

    expect(impulses[0].x).toBeCloseTo(-7.653668647301796, 10)
    expect(impulses[0].z).toBeCloseTo(-18.477590650225736, 10)
    expect(impulses[1]).toEqual({ x: 0, y: 0, z: -20 })
    expect(impulses[2].x).toBeCloseTo(7.653668647301796, 10)
    expect(impulses[2].z).toBeCloseTo(-18.477590650225736, 10)
  })

  it('gauss-cannon: LOAD → AIM → FIRE → COOLDOWN with fixed muzzle impulse', () => {
    const rapier = createMockRapier()
    const feeder = new GaussCannonFeeder({} as never, createMockWorld() as never, rapier as never, FEEDER_TUNABLES['gauss-cannon'])
    const pos = FEEDER_TUNABLES['gauss-cannon'].gaussPosition
    const ball = createMockBall({ x: pos.x, y: pos.y, z: pos.z })

    const record = runFeederFsmGolden({
      feeder,
      ball,
      maxFrames: 400,
      getState: () => feeder.getState(),
      stateNames: GaussCannonState,
      stopWhen: (state) => state === GaussCannonState.COOLDOWN,
    })

    expect(record.states).toEqual([
      GaussCannonState.IDLE,
      GaussCannonState.LOAD,
      GaussCannonState.AIM,
      GaussCannonState.FIRE,
      GaussCannonState.COOLDOWN,
    ])

    expect(record.impulses).toHaveLength(1)
    expect(record.impulses[0].x).toBeCloseTo(19.417001174292928, 10)
    expect(record.impulses[0].y).toBe(0)
    expect(record.impulses[0].z).toBeCloseTo(22.86875740825258, 10)
  })

  it('quantum-tunnel: CAPTURE → TRANSPORT → EJECT with fixed +X impulse', () => {
    const rapier = createMockRapier()
    const world = createMockWorld({ intersectionPair: true })
    const feeder = new QuantumTunnelFeeder({} as never, world as never, rapier as never, FEEDER_TUNABLES['quantum-tunnel'])
    const input = FEEDER_TUNABLES['quantum-tunnel'].inputPosition
    const ball = createMockBall({ x: input.x, y: input.y, z: input.z })

    const record = runFeederFsmGolden({
      feeder,
      ball,
      maxFrames: 250,
      getState: () => feeder.getState(),
      stateNames: QuantumTunnelState,
      stopWhen: (state) => state === QuantumTunnelState.COOLDOWN,
    })

    expect(record.states).toEqual([
      QuantumTunnelState.IDLE,
      QuantumTunnelState.CAPTURE,
      QuantumTunnelState.TRANSPORT,
      QuantumTunnelState.EJECT,
      QuantumTunnelState.COOLDOWN,
    ])

    expect(record.impulses).toHaveLength(1)
    expect(record.impulses[0]).toEqual({ x: 25, y: 0, z: 0 })
  })
})

describe('FEEDER_TUNABLES invariants', () => {
  const FEEDER_IDS = ['mag-spin', 'nano-loom', 'prism-core', 'gauss-cannon', 'quantum-tunnel'] as const

  it('has all five feeder entries with finite positive core scalars', () => {
    for (const id of FEEDER_IDS) {
      expect(FEEDER_TUNABLES[id]).toBeDefined()
      const entry = FEEDER_TUNABLES[id]
      const walk = (obj: Record<string, unknown>, path = '') => {
        for (const [key, val] of Object.entries(obj)) {
          const p = path ? `${path}.${key}` : key
          if (typeof val === 'number') {
            expect(Number.isFinite(val), `${id}.${p}`).toBe(true)
            if (key.includes('Radius') || key.includes('Duration') || key.includes('Force') ||
                key.includes('Speed') || key.includes('Impulse') || key.includes('Velocity') ||
                key.includes('cooldown') || key.includes('Cooldown') || key.includes('Delay')) {
              expect(val, `${id}.${p}`).toBeGreaterThan(0)
            }
          } else if (val && typeof val === 'object' && !Array.isArray(val)) {
            walk(val as Record<string, unknown>, p)
          }
        }
      }
      walk(entry as unknown as Record<string, unknown>)
    }
  })
})
