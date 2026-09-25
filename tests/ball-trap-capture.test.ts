/**
 * Ball traps on the C++ owner path (#420): the funnel cone exports as a C++
 * cone, and a caught ball is held in the chamber through the CapturedBall
 * driver — a C++ kinematic body — then launched with the tuned boost and kept
 * from being re-caught on the spot.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BallTrapBuilder, TRAP_REARM_SECONDS } from '../src/objects/object-ball-traps'
import { getPhysicsTuningValue } from '../src/game-elements/physics-tuning'
import { initSessionRng } from '../src/core/seeded-rng'
import { WASM_PHYSICS_API as api } from '../src/wasm/wasm-physics-api'
import { WasmTableWorld } from '../src/wasm/wasm-table-world'
import { exportTableBodiesToWasm } from '../src/game/physics/wasm-static-export'
import { asSimEngine, makeFakeWasmEngine } from './helpers/fake-wasm-engine'

// No material: the hit-flash path (Babylon colour maths) is not under test here.
vi.mock('../src/materials', () => ({
  getMaterialLibrary: () => ({
    getEnhancedBumperBodyMaterial: () => null,
  }),
}))

const DT = 1 / 60

function setup() {
  const engine = makeFakeWasmEngine()
  const world = new WasmTableWorld(asSimEngine(engine), { x: 0, y: 0, z: 0 })
  const traps = new BallTrapBuilder({} as never, world, api)
  const { state } = traps.createBallTrap(-5, 10, '#ff00ff', 1.0)
  const ball = world.createRigidBody(api.RigidBodyDesc.dynamic().setTranslation(-5, 0.5, 9.3))
  world.createCollider(api.ColliderDesc.ball(0.5), ball)
  const step = () => {
    traps.updateTrap(state, DT)
    engine.step(DT)
    world.endStep()
  }
  return { engine, world, traps, state, ball, step }
}

describe('ball trap capture (#420)', () => {
  beforeEach(() => {
    initSessionRng(7)
  })

  it('exports the funnel as a C++ cone and the chamber as a sensor', () => {
    const { engine, world, traps } = setup()
    const result = exportTableBodiesToWasm(traps.getBodies() as never, asSimEngine(engine))
    expect(result.unsupported).toEqual([])
    expect(engine.addStaticCone).toHaveBeenCalledWith({ x: -5, y: 0.5, z: 10 }, 0.2, 0.6, { x: 0, y: 0, z: 0, w: 1 }, 0.6, 0.3)
    expect(engine.addSensorVolume).toHaveBeenCalledTimes(1)
    expect(result.idsByBody.get(traps.getBodies()[0] as never)).toEqual([-9000, -4000])
    expect(world.allBodies()).toContain(traps.getBodies()[0])
  })

  it('holds a caught ball in the chamber, then launches it with the boost', () => {
    const { engine, traps, state, ball, step } = setup()
    const id = ball.wasmId!
    traps.catchBall(state, ball)
    expect(state.caughtBall).toBe(ball)
    expect(engine.bodyTypeOf(id)).toBe(2)

    const holdFrames = Math.ceil(state.holdDuration / DT)
    for (let i = 0; i < holdFrames - 2; i++) step()
    // Drawn down into the chamber and held there.
    expect(state.caughtBall).toBe(ball)
    const held = engine.getPosition(id)
    expect(held.x).toBeCloseTo(state.chamber.x, 3)
    expect(held.y).toBeCloseTo(state.chamber.y, 3)
    expect(held.z).toBeCloseTo(state.chamber.z, 3)

    for (let i = 0; i < 4; i++) step()
    expect(state.caughtBall).toBeNull()
    expect(engine.bodyTypeOf(id)).toBe(0)
    // Launched up out of the chamber at the tuned boost.
    expect(engine.getVelocity(id).y).toBeCloseTo(getPhysicsTuningValue('trapReleaseBoost') * 0.8, 6)
  })

  it('does not re-catch the ball it just released until the trap re-arms', () => {
    const { traps, state, ball, step } = setup()
    traps.catchBall(state, ball)
    for (let i = 0; i < Math.ceil(state.holdDuration / DT) + 1; i++) step()
    expect(state.caughtBall).toBeNull()
    expect(state.rearmTimer).toBeGreaterThan(0)

    traps.catchBall(state, ball)
    expect(state.caughtBall).toBeNull()

    for (let i = 0; i < Math.ceil(TRAP_REARM_SECONDS / DT) + 1; i++) step()
    expect(state.rearmTimer).toBe(0)
    traps.catchBall(state, ball)
    expect(state.caughtBall).toBe(ball)
  })
})
