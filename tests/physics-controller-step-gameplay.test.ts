/**
 * #519 A1: gameplay that reads or moves the ball runs once per fixed step, inside `stepFixed`.
 * The headless replay verifier calls only `stepFixed`; when the feeders ticked in the render-frame
 * `sim` phase instead, a MagSpin capture happened live and never on verification.
 */
import { describe, expect, it, vi } from 'vitest'
import { GamePhysicsController } from '../src/game/physics/physics-controller'
import { FIXED_TIMESTEP, GameSimClock } from '../src/core/sim-clock'
import type { PhysicsHost } from '../src/game/physics/types'
import { makeBallManagerStub, makeGameObjectsStub, makePhysicsHostShell } from './helpers/make-physics-host'

function makeTable(frameMs: number) {
  let engineSteps = 0
  const physics = {
    step: vi.fn(() => { engineSteps++; return 1 }),
    getStepCount: () => engineSteps,
    getWorld: () => null,
    isWasmActive: () => false,
    isWasmOwnerMode: () => false,
  }
  const ball = { translation: () => ({ x: 0, y: 0, z: 0 }), linvel: () => ({ x: 0, y: 0, z: 0 }) }
  const feeder = () => ({ update: vi.fn() })
  const host = makePhysicsHostShell({
    physics,
    ballManager: makeBallManagerStub({ getBallBody: vi.fn(() => ball) }),
    gameObjects: makeGameObjectsStub(),
  })
  const feeders = {
    magSpinFeeder: feeder(),
    nanoLoomFeeder: feeder(),
    prismCoreFeeder: feeder(),
    gaussCannon: feeder(),
    quantumTunnel: feeder(),
  }
  Object.assign(host, feeders)
  ;(host.engine.getDeltaTime as ReturnType<typeof vi.fn>).mockReturnValue(frameMs)
  const controller = new GamePhysicsController(host as PhysicsHost)
  return { host, controller, feeders, engineSteps: () => engineSteps }
}

describe('per-step gameplay (#519 A1)', () => {
  it('stepFixed alone ticks every feeder once per fixed step with the fixed dt', () => {
    // A 30 Hz render delta: each stepFixed call runs two fixed steps.
    const t = makeTable(1000 / 30)
    for (let i = 0; i < 5; i++) t.controller.stepFixed(null, null, null, null)
    expect(t.engineSteps()).toBe(10)
    for (const f of Object.values(t.feeders)) {
      expect(f.update).toHaveBeenCalledTimes(10)
      for (const [dt] of f.update.mock.calls) expect(dt).toBeCloseTo(FIXED_TIMESTEP, 12)
    }
  })

  it('the render-frame sim phase does not tick them again', () => {
    const t = makeTable(1000 / 60)
    t.controller.stepFixed(null, null, null, null)
    t.controller.updateSim()
    expect(t.feeders.magSpinFeeder.update).toHaveBeenCalledTimes(1)
  })

  it('the feeders see the same steps whatever the refresh rate groups them into', () => {
    const at60 = makeTable(1000 / 60)
    const at30 = makeTable(1000 / 30)
    for (let i = 0; i < 12; i++) at60.controller.stepPhysics(null, null, null, null)
    for (let i = 0; i < 6; i++) at30.controller.stepPhysics(null, null, null, null)
    expect(at60.engineSteps()).toBe(12)
    expect(at30.engineSteps()).toBe(12)
    expect(at30.feeders.magSpinFeeder.update.mock.calls).toEqual(at60.feeders.magSpinFeeder.update.mock.calls)
  })
})

describe('plunger spring per tick (determinism-todo item 7)', () => {
  for (const hz of [30, 60, 144]) {
    it(`at ${hz} Hz the spring advances once per fixed step, ahead of the engine step`, () => {
      const t = makeTable(1000 / hz)
      const order: string[] = []
      const actions = {
        handleFlipperLeft: vi.fn(),
        handleFlipperRight: vi.fn(),
        handlePlunger: vi.fn(),
        updatePlungerFrame: vi.fn(() => { order.push('plunger') }),
      }
      t.host.physics.step = vi.fn(() => { order.push('step'); return 1 }) as never
      for (let i = 0; i < hz; i++) t.controller.stepFixed(null, actions as never, null, null)
      const steps = order.filter((o) => o === 'step').length
      expect(steps).toBeGreaterThanOrEqual(59)
      expect(actions.updatePlungerFrame).toHaveBeenCalledTimes(steps)
      for (const [dt] of actions.updatePlungerFrame.mock.calls as unknown as number[][]) expect(dt).toBeCloseTo(FIXED_TIMESTEP, 12)
      for (let i = 0; i < order.length; i += 2) expect(order.slice(i, i + 2)).toEqual(['plunger', 'step'])
    })
  }
})

describe('GameSimClock.liveMs', () => {
  it('counts the steps taken since the last advance, like liveSteps', () => {
    let steps = 0
    const physics = { getStepCount: () => steps, isWasmActive: () => true }
    const clock = new GameSimClock()
    clock.beforeStep(physics)
    steps = 3
    expect(clock.ms()).toBe(0)
    expect(clock.liveMs()).toBeCloseTo(3 * FIXED_TIMESTEP * 1000, 9)
    clock.advance(physics, 0)
    expect(clock.ms()).toBeCloseTo(clock.liveMs(), 9)
  })
})
