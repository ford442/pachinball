/**
 * PhysicsSystem boot (#412): the owner path never imports Rapier or builds a
 * Rapier World; Rapier is loaded lazily only for the explicit `rapier` mode
 * and for the fail-closed degrade when the C++ bundle does not load.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const loadRapier = vi.fn()
vi.mock('../src/game-elements/rapier-loader', () => ({ loadRapier: () => loadRapier() }))

let bundleLoads = true
vi.mock('../src/wasm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/wasm')>()
  class FakeWasmPhysicsEngine {
    isReady = false
    async load(): Promise<void> {
      this.isReady = bundleLoads
    }
    setGravity(): void {}
    setRollingResistance(): void {}
    dispose(): void {}
  }
  return { ...actual, WasmPhysicsEngine: FakeWasmPhysicsEngine }
})

import { PhysicsSystem } from '../src/game-elements/physics'
import { WASM_PHYSICS_API } from '../src/wasm/wasm-physics-api'
import { WasmTableWorld } from '../src/wasm/wasm-table-world'

function fakeRapier() {
  class World {
    integrationParameters: Record<string, number> = {}
    constructor(readonly gravity: unknown) {}
    free(): void {}
  }
  class EventQueue {}
  return { World, EventQueue } as unknown as typeof import('@dimforge/rapier3d-compat')
}

function setPreference(value: string | null): void {
  vi.stubGlobal('localStorage', { getItem: () => value })
}

describe('PhysicsSystem boot', () => {
  beforeEach(() => {
    bundleLoads = true
    loadRapier.mockReset()
    loadRapier.mockResolvedValue(fakeRapier())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('boots wasm-owner with no Rapier import, module or World', async () => {
    setPreference(null) // the default engine
    const physics = new PhysicsSystem()
    await physics.init()

    expect(loadRapier).not.toHaveBeenCalled()
    expect(physics.getRapier()).toBeNull()
    expect(physics.getRapierWorld()).toBeNull()
    expect(physics.getWasmMode()).toBe('wasm-owner')
    expect(physics.isReady()).toBe(true)
    expect(physics.getWorld()).toBeInstanceOf(WasmTableWorld)
    expect(physics.getPhysicsApi()).toBe(WASM_PHYSICS_API)
  })

  it('degrades fail-closed to a lazily loaded Rapier when the C++ bundle is missing', async () => {
    setPreference('wasm-owner')
    bundleLoads = false
    const physics = new PhysicsSystem()
    await physics.init()

    expect(loadRapier).toHaveBeenCalledTimes(1)
    expect(physics.getWasmMode()).toBe('rapier')
    expect(physics.getWasmTableWorld()).toBeNull()
    expect(physics.getRapierWorld()).not.toBeNull()
    expect(physics.getPhysicsApi()).toBe(physics.getRapier())
  })

  it('builds the Rapier world from the bootstrap-preloaded module on the explicit rapier path', async () => {
    setPreference('rapier')
    const preloaded = fakeRapier()
    const physics = new PhysicsSystem(preloaded)
    await physics.init()

    expect(loadRapier).not.toHaveBeenCalled()
    expect(physics.getRapier()).toBe(preloaded)
    expect(physics.getWorld()).toBe(physics.getRapierWorld())
    expect(physics.getWasmTableWorld()).toBeNull()
  })
})
