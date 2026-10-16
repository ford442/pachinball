/**
 * preloadPhysicsSystem (#412): the bootstrap hands `Game` a ready `PhysicsSystem`
 * so neither `main.ts` nor `Game` names a Rapier type. The owner modes warm only
 * the C++ bundle; `rapier` / `wasm-mirror` warm Rapier and pass it through.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const loadRapier = vi.fn()
vi.mock('../src/game-elements/rapier-loader', () => ({ loadRapier: () => loadRapier() }))

const preloadWasmPhysicsNow = vi.fn()
vi.mock('../src/engine/wasm-idle-preload', () => ({
  preloadWasmPhysicsNow: () => preloadWasmPhysicsNow(),
  getPreloadedWasmModule: async () => null,
}))

import { preloadPhysicsSystem } from '../src/game-elements/physics-preload'
import { PhysicsSystem } from '../src/game-elements/physics'

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

describe('preloadPhysicsSystem', () => {
  beforeEach(() => {
    loadRapier.mockReset()
    preloadWasmPhysicsNow.mockReset()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each(['wasm-owner', 'wasm-worker'])('%s warms only the C++ bundle', async (mode) => {
    setPreference(mode)
    const physics = await preloadPhysicsSystem()

    expect(physics).toBeInstanceOf(PhysicsSystem)
    expect(preloadWasmPhysicsNow).toHaveBeenCalledTimes(1)
    expect(loadRapier).not.toHaveBeenCalled()
  })

  it.each(['rapier', 'wasm-mirror'])('%s warms Rapier and hands it to the system', async (mode) => {
    const rapier = fakeRapier()
    loadRapier.mockResolvedValue(rapier)
    setPreference(mode)

    const physics = await preloadPhysicsSystem()

    expect(physics).toBeInstanceOf(PhysicsSystem)
    expect(loadRapier).toHaveBeenCalledTimes(1)
    expect(preloadWasmPhysicsNow).not.toHaveBeenCalled()

    // The preloaded namespace is what init() builds the world from — no second load.
    await physics.init()
    expect(physics.getRapier()).toBe(rapier)
    expect(loadRapier).toHaveBeenCalledTimes(1)
  })
})
