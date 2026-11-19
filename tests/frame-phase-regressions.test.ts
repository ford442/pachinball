/**
 * Regressions found in the 2026-11-17 audit:
 *  - B1: the `visuals` phase advanced shards, bloom, cabinet and slot lighting twice per frame
 *    (once directly, once again inside `EffectsSystem.update()`).
 *  - B2: nothing called `GhostRace.update()` after merge 908a4c56, so the race ghost never moved.
 *  - B3: slot-machine activation read `performance.now()`, so whether the `slot` RNG fork was
 *    consumed (and a jackpot could fire) depended on wall time, not the sim clock.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { EffectsSystem } from '../src/effects/effects-core'
import { VisualPhase } from '../src/game/physics/visual-phase'
import { updateSimPhase } from '../src/game/physics/sim-phase'
import type { MeshInterpolationSystem } from '../src/game/physics/mesh-interpolation'
import type { PhysicsFrameState, PhysicsHost } from '../src/game/physics/types'
import { installSimClock } from '../src/core/sim-clock'
import { EventBus } from '../src/core/event-bus'
import { SlotMachine } from '../src/display/slot-machine'
import { SlotActivationMode } from '../src/display/slot-types'
import type { DisplayReelsLayer } from '../src/display/display-reels'

/** Any property is a spy (methods) or a nested spy bag (sub-controllers). */
function spyBag(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const cache = new Map<PropertyKey, unknown>(Object.entries(overrides))
  return new Proxy({} as Record<string, unknown>, {
    get(_target, key) {
      if (key === 'then') return undefined
      if (!cache.has(key)) {
        const fn = vi.fn()
        cache.set(key, new Proxy(fn, { get: (f, k) => (k in f ? (f as never)[k] : spyBag()[k as string]) }))
      }
      return cache.get(key)
    },
  })
}

const meshInterpolation = {
  getInterpolatedPosition: (_body: unknown, _alpha: number, out: Vector3) => out,
} as unknown as MeshInterpolationSystem

afterEach(() => installSimClock(null))

describe('B1: visuals phase advances each effect once per frame', () => {
  it('updateShards / updateBloom / updateCabinetLighting / updateSlotLighting run once per tick', () => {
    // The real EffectsSystem.update() on a stub `this`: what it calls internally is what the game runs.
    const realUpdate = vi.fn((...args: Parameters<EffectsSystem['update']>) => {
      EffectsSystem.prototype.update.apply(effects as unknown as EffectsSystem, args)
    })
    const effects = spyBag({ update: realUpdate }) as Record<string, ReturnType<typeof vi.fn>>
    const host = { effects, ballManager: null, cameraController: null, gameObjects: null, display: null } as unknown as PhysicsHost
    const frame: PhysicsFrameState = { dt: 1 / 60, stepped: true, alpha: 1 }

    new VisualPhase(host, meshInterpolation, frame).update()

    expect(realUpdate).toHaveBeenCalledTimes(1)
    for (const name of ['updateShards', 'updateBloom', 'updateCabinetLighting', 'updateSlotLighting'] as const) {
      expect(effects[name], name).toHaveBeenCalledTimes(1)
    }
  })
})

describe('B2: the race ghost moves', () => {
  it('the sim phase updates the ghost race once per stepped frame', () => {
    const ghostRace = { update: vi.fn() }
    const host = { ghostRace, ballManager: null, dynamicWorld: null, mapManager: null } as unknown as PhysicsHost
    updateSimPhase(host, meshInterpolation, { dt: 1 / 60, stepped: true, alpha: 1 })
    expect(ghostRace.update).toHaveBeenCalledTimes(1)
    updateSimPhase(host, meshInterpolation, { dt: 1 / 60, stepped: false, alpha: 1 })
    expect(ghostRace.update).toHaveBeenCalledTimes(1)
  })
})

describe('B3: slot activation reads the sim clock', () => {
  function makeSlot() {
    let onStopped: ((symbols: string[]) => void) | null = null
    const reels = {
      startSpin: vi.fn(),
      stopReel: vi.fn(),
      setSymbols: vi.fn(),
      setOnStopped: vi.fn((cb: (symbols: string[]) => void) => { onStopped = cb }),
      setVisible: vi.fn(),
    } as unknown as DisplayReelsLayer
    const slot = new SlotMachine(reels, new EventBus(), { activationMode: SlotActivationMode.ALWAYS, cooldownSeconds: 10 })
    /** Settle the reels on a losing line and let the result clear back to IDLE. */
    const finish = () => {
      onStopped?.(['7', 'BELL', 'CHERRY'])
      slot.update(5)
    }
    return { slot, finish }
  }

  it('the cooldown follows sim time, whatever the wall clock does', () => {
    let steps = 0
    installSimClock({ steps: () => steps, ms: () => steps * (1000 / 60) })
    const wall = vi.spyOn(performance, 'now')
    const { slot, finish } = makeSlot()

    wall.mockReturnValue(0)
    expect(slot.tryActivate(0)).toBe(true)
    finish()

    // An hour of wall time, one second of sim time: still cooling down.
    steps = 60
    wall.mockReturnValue(3_600_000)
    expect(slot.tryActivate(0)).toBe(false)

    // Ten sim seconds later the cooldown has passed even with the wall clock frozen.
    steps = 60 * 11
    wall.mockReturnValue(0)
    expect(slot.tryActivate(0)).toBe(true)
    wall.mockRestore()
  })
})
