import { describe, it, expect, vi } from 'vitest'
import { PhysicsConfig, GameConfig } from '../src/config'

// BumperBuilder only needs *a* material per getter; the real library needs a live Scene.
vi.mock('../src/materials', () => {
  const library = new Proxy({}, {
    get: () => vi.fn(() => ({ emissiveColor: null, albedoColor: null, clearCoat: {}, alpha: 1 })),
  })
  return { getMaterialLibrary: vi.fn(() => library) }
})

describe('physics config — single source of truth', () => {
  it('has no leftover GameConfig.physics duplicate', () => {
    expect('physics' in GameConfig).toBe(false)
  })

  it('keeps PhysicsConfig.bumper.restitution and surfaces.bumper.restitution identical', () => {
    expect(PhysicsConfig.surfaces.bumper.restitution).toBe(PhysicsConfig.bumper.restitution)
  })

  it('keeps PhysicsConfig.flipper restitution/friction identical to surfaces.flipper', () => {
    expect(PhysicsConfig.surfaces.flipper.restitution).toBe(PhysicsConfig.flipper.restitution)
    expect(PhysicsConfig.surfaces.flipper.friction).toBe(PhysicsConfig.flipper.friction)
  })
})

describe('owner-mode bumpers carry PhysicsConfig surface physics into C++', () => {
  it('exports the authored bumper sphere with PhysicsConfig.surfaces.bumper values', async () => {
    const { BumperBuilder } = await import('../src/objects/object-bumpers')
    const { WasmTableWorld } = await import('../src/wasm/wasm-table-world')
    const { WASM_PHYSICS_API } = await import('../src/wasm/wasm-physics-api')
    const { WasmOwner } = await import('../src/game/physics/wasm-owner')
    const { makeFakeWasmEngine, asSimEngine } = await import('./helpers/fake-wasm-engine')

    const engine = makeFakeWasmEngine()
    const world = new WasmTableWorld(asSimEngine(engine), { x: 0, y: -9.81, z: -5 })
    const builder = new BumperBuilder({} as never, world, WASM_PHYSICS_API)
    const { bumperBodies } = builder.createBumpers([{ x: 0, z: 8, color: '#00ffff', scale: 1 }])

    const owner = new WasmOwner(asSimEngine(engine), world)
    owner.setTableScope(() => bumperBodies)
    owner.rebuild([])

    // Authored as a fixed body → a C++ static sphere, not a Rapier-shaped proxy.
    expect(engine.addStaticSphere).toHaveBeenCalledWith(
      expect.objectContaining({ x: 0, z: 8 }),
      0.4,
      PhysicsConfig.surfaces.bumper.restitution,
      PhysicsConfig.surfaces.bumper.friction,
    )
    expect(engine.createBody).not.toHaveBeenCalled()
  })
})
