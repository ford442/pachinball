/**
 * MagSpin on the C++ owner path: the well is an axis-pull force field, not the
 * Rapier-era bowl (whose wall ring would shut balls out of the capture radius
 * on the owner's y = 0 plane). The field draws idle-state balls in, is gated off
 * while a ball is held or the toy cools down, and is exported through the table
 * scope like a pin field. Rapier / wasm-mirror keep the bowl.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { FEEDER_TUNABLES } from '../src/config'
import { MagSpinFeeder, MagSpinState } from '../src/objects/feeders/mag-spin-feeder'
import { initSessionRng } from '../src/core/seeded-rng'
import { createMockRapier, createMockWorld } from './feeder-test-helpers'
import { WASM_PHYSICS_API } from '../src/wasm/wasm-physics-api'
import { WasmTableWorld } from '../src/wasm/wasm-table-world'
import type { WasmBody } from '../src/wasm/wasm-body'
import { exportTableBodiesToWasm } from '../src/game/physics/wasm-static-export'
import { asSimEngine, makeFakeWasmEngine } from './helpers/fake-wasm-engine'

vi.mock('@babylonjs/core', async () => {
  const { mockBabylonCore } = await import('./feeder-test-helpers')
  return mockBabylonCore()
})

vi.mock('../src/game-elements/visual-language', () => ({
  color: (_hex: string) => ({ r: 0, g: 1, b: 1, scale: () => ({ r: 0, g: 1, b: 1 }) }),
  emissive: () => ({ r: 0, g: 0.5, b: 1 }),
  FEEDER_STYLES: {
    MAG_SPIN: { base: '#00aaff', active: '#00ffff', locked: '#aa00ff', release: '#ff00aa' },
  },
  PALETTE: { CYAN: '#00ffff' },
  INTENSITY: { HIGH: 1.5, MED: 1.0, LOW: 0.3, FLASH: 1.0 },
}))

const DT = 1 / 60
const CONFIG = FEEDER_TUNABLES['mag-spin']

function ownerRig() {
  const engine = makeFakeWasmEngine()
  const world = new WasmTableWorld(asSimEngine(engine), { x: 0, y: 0, z: 0 })
  const feeder = new MagSpinFeeder({} as never, world, WASM_PHYSICS_API, CONFIG)
  const ball = world.createRigidBody(WASM_PHYSICS_API.RigidBodyDesc.dynamic()
    .setTranslation(CONFIG.feederPosition.x + 0.2, CONFIG.feederPosition.y, CONFIG.feederPosition.z + 0.2))
  world.createCollider(
    WASM_PHYSICS_API.ColliderDesc.ball(0.25).setDensity(1 / ((4 / 3) * Math.PI * 0.25 ** 3)),
    ball,
  )
  const tick = (): void => {
    feeder.update(DT, [ball])
    engine.step(DT)
    world.endStep()
  }
  return { engine, world, feeder, ball, tick }
}

describe('MagSpin pull field (owner path)', () => {
  beforeEach(() => {
    initSessionRng(42)
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    vi.spyOn(performance, 'now').mockReturnValue(0)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('authors one axis-pull field from the tunables and none of the Rapier-era bowl', () => {
    const { world, feeder } = ownerRig()

    const [body, ...rest] = feeder.getBodies() as WasmBody[]
    expect(rest).toHaveLength(0)
    expect(body.colliders).toHaveLength(1)
    const shape = body.colliders[0].desc.shape
    expect(shape).toEqual({
      kind: 'axisPullField',
      field: {
        center: { ...CONFIG.feederPosition },
        radius: CONFIG.pullRadius,
        halfHeight: CONFIG.pullHalfHeight,
        strength: CONFIG.pullAcceleration,
        acceleration: true,
      },
    })
    // The well plus the (unrelated) ball: no floor cylinder, no eight wall cuboids.
    expect(world.allBodies().filter((b) => b.colliders.some((c) => c.desc.shape.kind === 'box'))).toHaveLength(0)
  })

  it('keeps the pull clear of the plunger lane that checkProximity skips', () => {
    expect(CONFIG.feederPosition.x + CONFIG.pullRadius).toBeLessThan(8.5)
    expect(CONFIG.pullRadius).toBeGreaterThan(CONFIG.catchRadius)
  })

  it('exports as a C++ axis-pull force field the owner can gate through collision groups', () => {
    const { engine, feeder } = ownerRig()

    const result = exportTableBodiesToWasm(feeder.getBodies() as WasmBody[], asSimEngine(engine))

    expect(engine.addForceField).toHaveBeenCalledTimes(1)
    expect(engine.addForceField).toHaveBeenCalledWith({
      center: { ...CONFIG.feederPosition },
      halfExtents: { x: CONFIG.pullRadius, y: CONFIG.pullHalfHeight, z: CONFIG.pullRadius },
      mode: 'axis-pull',
      strength: CONFIG.pullAcceleration,
      acceleration: true,
    })
    expect(result.unsupported).toEqual([])
    const [ids] = [...result.idsByBody.values()]
    expect(ids).toEqual([-7000])
  })

  it('reports a bundle without the well as unsupported, not as a full static family', () => {
    const { engine, feeder } = ownerRig()
    engine.addForceField.mockReturnValue(-1)

    const result = exportTableBodiesToWasm(feeder.getBodies() as WasmBody[], asSimEngine(engine))

    expect(result.idsByBody.size).toBe(0)
    expect(result.unsupported).toHaveLength(1)
    expect(result.unsupported[0].reason).toMatch(/axis-pull/)
  })

  it('pulls only while idle and in play', () => {
    const { feeder, ball, tick } = ownerRig()
    const [well] = feeder.getBodies() as WasmBody[]
    expect(well.isEnabled()).toBe(true)

    // A ball inside the capture radius: CATCH switches the well off.
    tick()
    expect(feeder.getState()).toBe(MagSpinState.CATCH)
    expect(well.isEnabled()).toBe(false)

    // Held through SPIN, RELEASE and the whole cooldown, then it re-arms.
    const seen = new Set<MagSpinState>()
    for (let frame = 0; frame < 600 && feeder.getState() !== MagSpinState.IDLE; frame++) {
      tick()
      seen.add(feeder.getState())
      if (feeder.getState() !== MagSpinState.IDLE) expect(well.isEnabled()).toBe(false)
    }
    expect(seen).toContain(MagSpinState.COOLDOWN)
    expect(feeder.getState()).toBe(MagSpinState.IDLE)
    expect(well.isEnabled()).toBe(true)
    expect((ball as WasmBody).isDynamic()).toBe(true)
  })

  it('setGameplayEnabled(false) switches the well off and back on', () => {
    const { feeder } = ownerRig()
    const [well] = feeder.getBodies() as WasmBody[]
    // The Babylon mock's meshes and light carry no setEnabled; this test is about the well.
    const scene = feeder as unknown as { ringMeshes: unknown[]; floorMesh: unknown; light: unknown }
    for (const node of [feeder._mesh, scene.floorMesh, scene.light, ...scene.ringMeshes]) {
      Object.assign(node as object, { setEnabled: vi.fn() })
    }

    feeder.setGameplayEnabled(false)
    expect(well.isEnabled()).toBe(false)

    feeder.setGameplayEnabled(true)
    expect(well.isEnabled()).toBe(true)
  })
})

describe('MagSpin on the Rapier path', () => {
  it('still builds the bowl (a floor cylinder and eight wall cuboids) and no field', () => {
    const world = createMockWorld()
    const feeder = new MagSpinFeeder({} as never, world as never, createMockRapier() as never, CONFIG)

    expect(world.createCollider).toHaveBeenCalledTimes(9)
    expect(feeder.getBodies()).toHaveLength(1)
  })
})
