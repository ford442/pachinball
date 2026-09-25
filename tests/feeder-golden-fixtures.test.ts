/**
 * Golden FSM fixtures — parity gate for FEEDER_TUNABLES extraction.
 * Fixed Math.random + frame stepping must replay identically pre/post refactor.
 *
 * Every fixture runs twice (#420): against the Rapier-shaped mock ball, and on
 * the C++ owner path — WASM_PHYSICS_API + WasmTableWorld + the WasmSimEngine
 * fake — where the ball is a WasmBody and capture / steer / release must land
 * on its WASM id as setBodyType / setNextKinematicTransform / applyImpulse.
 * Same states, same impulses, either way.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { FEEDER_TUNABLES } from '../src/config'
import { MagSpinFeeder, MagSpinState } from '../src/objects/feeders/mag-spin-feeder'
import { NanoLoomFeeder, NanoLoomState } from '../src/objects/feeders/nano-loom-feeder'
import { PrismCoreFeeder, PrismCoreState } from '../src/objects/feeders/prism-core-feeder'
import { GaussCannonFeeder, GaussCannonState } from '../src/objects/feeders/gauss-cannon-feeder'
import { QuantumTunnelFeeder, QuantumTunnelState } from '../src/objects/feeders/quantum-tunnel-feeder'
import { initSessionRng } from '../src/core/seeded-rng'
import {
  createMockBall,
  createMockRapier,
  createMockWorld,
  runFeederFsmGolden,
  type GoldenRecord,
} from './feeder-test-helpers'
import { WASM_PHYSICS_API } from '../src/wasm/wasm-physics-api'
import { WasmTableWorld } from '../src/wasm/wasm-table-world'
import type { WasmBody } from '../src/wasm/wasm-body'
import { asSimEngine, makeFakeWasmEngine, type FakeWasmEngine } from './helpers/fake-wasm-engine'

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
  PALETTE: { CYAN: '#00ffff' },
  INTENSITY: { HIGH: 1.5, MED: 1.0, LOW: 0.3, FLASH: 1.0 },
}))

const DT = 1 / 60

type Vec = { x: number; y: number; z: number }

/** The physics a fixture runs on: the Rapier-shaped mock, or the C++ owner path. */
interface GoldenBackend {
  world: unknown
  api: unknown
  /** A ball at `pos` whose `applyImpulse` / `setAngvel` are spies. */
  ball(pos: Vec): ReturnType<typeof createMockBall> & { body: unknown }
  /** After each feeder update. */
  step(): void
  /** Put a (dynamic) ball somewhere, as the scripted fall in the nano-loom fixture does. */
  place(ball: ReturnType<GoldenBackend['ball']>, pos: Vec): void
  /** Owner-path checks on the C++ calls a capture made; no-op on the mock. */
  expectCaptured(ball: ReturnType<GoldenBackend['ball']>): void
}

function rapierMockBackend(opts?: { intersectionPair?: boolean }): GoldenBackend {
  return {
    world: createMockWorld(opts),
    api: createMockRapier(),
    ball: (pos) => {
      const ball = createMockBall(pos)
      return Object.assign(ball, { body: ball })
    },
    step: () => {},
    place: (ball, pos) => {
      ball.translation = () => ({ ...pos })
    },
    expectCaptured: (ball) => {
      expect(ball.setBodyType).toHaveBeenCalledWith('KinematicPositionBased', true)
      expect(ball.setBodyType).toHaveBeenLastCalledWith('Dynamic', true)
    },
  }
}

function wasmOwnerBackend(): GoldenBackend & { engine: FakeWasmEngine } {
  const engine = makeFakeWasmEngine()
  // No gravity in the fake: a ball stays where a fixture puts it until a toy moves it.
  const world = new WasmTableWorld(asSimEngine(engine), { x: 0, y: 0, z: 0 })
  const api = WASM_PHYSICS_API
  return {
    engine,
    world,
    api,
    ball: (pos) => {
      const body = world.createRigidBody(api.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z))
      world.createCollider(api.ColliderDesc.ball(0.25).setDensity(1 / ((4 / 3) * Math.PI * 0.25 ** 3)), body)
      vi.spyOn(body, 'applyImpulse')
      vi.spyOn(body, 'setAngvel')
      vi.spyOn(body, 'setBodyType')
      return Object.assign(body, { body }) as unknown as ReturnType<GoldenBackend['ball']>
    },
    step: () => {
      engine.step(DT)
      world.endStep()
    },
    place: (ball, pos) => {
      (ball.body as WasmBody).setTranslation(pos, true)
    },
    expectCaptured: (ball) => {
      const id = (ball.body as WasmBody).wasmId!
      expect(id).toBeGreaterThanOrEqual(0)
      // Capture and release are C++ body-type flips on the ball's own WASM id…
      const flips = engine.setBodyType.mock.calls.filter(([bodyId]) => bodyId === id).map(([, type]) => type)
      expect(flips[0]).toBe(2)
      expect(flips.at(-1)).toBe(0)
      // …steering is a C++ pose target on it, and the launch a C++ impulse.
      expect(engine.setNextKinematicTransform.mock.calls.some(([bodyId]) => bodyId === id)).toBe(true)
      expect(engine.applyImpulse.mock.calls.some(([bodyId]) => bodyId === id)).toBe(true)
      expect(engine.bodyTypeOf(id)).toBe(0)
    },
  }
}

const BACKENDS: Array<[string, (opts?: { intersectionPair?: boolean }) => GoldenBackend]> = [
  ['rapier mock', rapierMockBackend],
  ['wasm owner (WasmSimEngine fake)', () => wasmOwnerBackend()],
]

function expectMagSpinGolden(record: GoldenRecord): void {
  expect(record.states).toEqual([
    MagSpinState.IDLE,
    MagSpinState.CATCH,
    MagSpinState.SPIN,
    MagSpinState.RELEASE,
    MagSpinState.COOLDOWN,
  ])

  expect(record.impulses).toHaveLength(1)
  const imp = record.impulses[0]
  // Position-dependent release (feeder at x=4.5,z=15) — recompute if feederPosition moves.
  expect(imp.x).toBeCloseTo(-9.381123839678642, 10)
  expect(imp.y).toBeCloseTo(1.99363055707225, 10)
  expect(imp.z).toBeCloseTo(-23.087224881014194, 5)
  expect(record.releaseAngvel!.y).toBe(12)
  expect(record.releaseAngvel!.x).toBeCloseTo(2.8240335527807474, 10)
  expect(record.releaseAngvel!.z).toBeCloseTo(-3.3973993621766567, 10)
}

describe.each(BACKENDS)('feeder golden FSM fixtures — %s', (_name, makeBackend) => {
  let randomSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    initSessionRng(42)
    randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5)
    vi.spyOn(performance, 'now').mockReturnValue(0)
  })

  afterEach(() => {
    randomSpy.mockRestore()
    vi.restoreAllMocks()
  })

  it('mag-spin: IDLE → CATCH → SPIN → RELEASE → COOLDOWN with fixed impulse', () => {
    const backend = makeBackend()
    const feeder = new MagSpinFeeder({} as never, backend.world as never, backend.api as never, FEEDER_TUNABLES['mag-spin'])
    const pos = FEEDER_TUNABLES['mag-spin'].feederPosition
    const ball = backend.ball({ x: pos.x + 0.2, y: pos.y, z: pos.z + 0.2 })

    const record = runFeederFsmGolden({
      feeder,
      ball,
      maxFrames: 400,
      getState: () => feeder.getState(),
      stateNames: MagSpinState,
      afterFrame: () => backend.step(),
      stopWhen: (state) => state === MagSpinState.COOLDOWN,
    })

    expectMagSpinGolden(record)
    backend.expectCaptured(ball)
  })

  it('nano-loom: LIFT → WEAVE → EJECT with fixed eject impulse', () => {
    const backend = makeBackend()
    const feeder = new NanoLoomFeeder({} as never, backend.world as never, backend.api as never, FEEDER_TUNABLES['nano-loom'])
    const intake = FEEDER_TUNABLES['nano-loom'].intakePosition
    const ball = backend.ball({ x: intake.x, y: intake.y, z: intake.z })

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
          backend.place(ball, { x: loom.x, y: bottomY, z: loom.z })
        }
      },
      afterFrame: () => backend.step(),
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
    backend.expectCaptured(ball)
  })

  it('prism-core: three-ball lock chain with fixed spread eject impulses', () => {
    const backend = makeBackend()
    const feeder = new PrismCoreFeeder({} as never, backend.world as never, backend.api as never, FEEDER_TUNABLES['prism-core'])
    const pos = FEEDER_TUNABLES['prism-core'].prismPosition

    const states: PrismCoreState[] = []
    feeder.onStateChange = (s) => states.push(s)

    const balls = [1, 2, 3].map(() => backend.ball({ x: pos.x, y: pos.y, z: pos.z }))
    for (const ball of balls) {
      feeder.update(DT, [ball.body as never])
      backend.step()
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
    for (const ball of balls) backend.expectCaptured(ball)
  })

  it('gauss-cannon: LOAD → AIM → FIRE → COOLDOWN with fixed muzzle impulse', () => {
    const backend = makeBackend()
    const feeder = new GaussCannonFeeder({} as never, backend.world as never, backend.api as never, FEEDER_TUNABLES['gauss-cannon'])
    const pos = FEEDER_TUNABLES['gauss-cannon'].gaussPosition
    const ball = backend.ball({ x: pos.x, y: pos.y, z: pos.z })

    const record = runFeederFsmGolden({
      feeder,
      ball,
      maxFrames: 400,
      getState: () => feeder.getState(),
      stateNames: GaussCannonState,
      afterFrame: () => backend.step(),
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
    backend.expectCaptured(ball)
  })

  it('quantum-tunnel: CAPTURE → TRANSPORT → EJECT with fixed +X impulse', () => {
    const backend = makeBackend({ intersectionPair: true })
    const feeder = new QuantumTunnelFeeder({} as never, backend.world as never, backend.api as never, FEEDER_TUNABLES['quantum-tunnel'])
    const input = FEEDER_TUNABLES['quantum-tunnel'].inputPosition
    const ball = backend.ball({ x: input.x, y: input.y, z: input.z })

    const record = runFeederFsmGolden({
      feeder,
      ball,
      maxFrames: 250,
      getState: () => feeder.getState(),
      stateNames: QuantumTunnelState,
      afterFrame: () => backend.step(),
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
    expect(record.impulses[0].x).toBeCloseTo(25, 10)
    expect(record.impulses[0].y).toBeCloseTo(0, 10)
    expect(record.impulses[0].z).toBeCloseTo(0.36899180384352803, 10)
    backend.expectCaptured(ball)
  })
})

describe('feeder capture on the C++ owner path (#420)', () => {
  beforeEach(() => {
    initSessionRng(42)
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    vi.spyOn(performance, 'now').mockReturnValue(0)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('mag-spin: the held ball follows the well, then leaves with a non-zero launch', () => {
    const backend = wasmOwnerBackend()
    const { engine } = backend
    const config = FEEDER_TUNABLES['mag-spin']
    const feeder = new MagSpinFeeder({} as never, backend.world as never, backend.api as never, config)
    const pos = config.feederPosition
    const ball = backend.ball({ x: pos.x + 0.2, y: pos.y, z: pos.z + 0.2 })
    const body = ball.body as WasmBody
    const id = body.wasmId!
    const hold = { x: pos.x, y: pos.y + config.holdYOffset, z: pos.z }

    let spinFrames = 0
    for (let frame = 0; frame < 400 && feeder.getState() !== MagSpinState.COOLDOWN; frame++) {
      feeder.update(DT, [body])
      backend.step()
      if (feeder.getState() === MagSpinState.SPIN && ++spinFrames > 1) {
        // Held at the well (from the first full SPIN tick): the C++ body sits
        // on the hold point, kinematic.
        expect(engine.bodyTypeOf(id)).toBe(2)
        const at = engine.getPosition(id)
        expect(at.x).toBeCloseTo(hold.x, 6)
        expect(at.y).toBeCloseTo(hold.y, 6)
        expect(at.z).toBeCloseTo(hold.z, 6)
      }
    }
    expect(spinFrames).toBeGreaterThan(10)
    expect(feeder.getState()).toBe(MagSpinState.COOLDOWN)

    // Released dynamic, with the launch impulse applied to the C++ body.
    expect(engine.bodyTypeOf(id)).toBe(0)
    const v = engine.getVelocity(id)
    expect(Math.hypot(v.x, v.y, v.z)).toBeGreaterThan(5)
    const launch = engine.applyImpulse.mock.calls.filter(([bodyId]) => bodyId === id)
    expect(launch).toHaveLength(1)
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
