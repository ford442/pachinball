/**
 * `mode: 'axis-pull'` force fields (the MagSpin well): the adapter routes them
 * to the dedicated Embind function, stays dormant on a bundle that predates it,
 * and leaves the directional path untouched. The compiled-bundle case is gated
 * like tests/pin-field-wasm.test.ts:
 *
 *   npm run build:wasm
 *   RUN_WASM_PARITY=1 npx vitest run tests/axis-pull-field.test.ts
 */

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { WasmPhysicsEngine } from '../src/wasm/PhysicsModule'
import { addForceField } from '../src/wasm/physics-module-adventure'
import type { WasmPhysicsModule, WasmPhysicsWorldInstance } from '../src/wasm/wasm-types'

const well = {
  center: { x: 4.5, y: 0.5, z: 15 },
  halfExtents: { x: 3, y: 2, z: 3 },
  mode: 'axis-pull' as const,
  strength: 8,
  acceleration: true,
}

function fakeWorld(overrides: Record<string, unknown> = {}): WasmPhysicsWorldInstance {
  return {
    addForceField: vi.fn(() => -7000),
    addAxisPullField: vi.fn(() => -7001),
    ...overrides,
  } as unknown as WasmPhysicsWorldInstance
}

describe('axis-pull adapter', () => {
  it('routes the well to addAxisPullField with radius, half-height and strength', () => {
    const world = fakeWorld()

    expect(addForceField(world, well)).toBe(-7001)

    expect(world.addAxisPullField).toHaveBeenCalledWith(4.5, 0.5, 15, 3, 2, 8, true)
    expect(world.addForceField).not.toHaveBeenCalled()
  })

  it('stays dormant (-1) on a bundle without the well', () => {
    const world = fakeWorld({ addAxisPullField: undefined })

    expect(addForceField(world, well)).toBe(-1)
    expect(world.addForceField).not.toHaveBeenCalled()
    expect(addForceField(null, well)).toBe(-1)
  })

  it('still sends directional fields through the original 15-argument call', () => {
    const world = fakeWorld()

    addForceField(world, {
      center: { x: 0, y: 5, z: 0 },
      halfExtents: { x: 2, y: 5, z: 2 },
      force: { x: 0, y: 20, z: 0 },
      acceleration: true,
    })

    expect(world.addForceField).toHaveBeenCalledWith(0, 5, 0, 2, 5, 2, 0, 0, 0, 1, 0, 20, 0, 0, true)
    expect(world.addAxisPullField).not.toHaveBeenCalled()
  })

  it('reaches the world through the in-process engine wrapper', () => {
    const engine = new WasmPhysicsEngine()
    const world = fakeWorld()
    ;(engine as unknown as { world: unknown }).world = world

    expect(engine.addForceField(well)).toBe(-7001)
  })
})

const bundle = resolve(__dirname, '..', process.env.WASM_MODULE_PATH ?? 'public/wasm/PhysicsModule.js')
const RUN = process.env.RUN_WASM_PARITY === '1' && existsSync(bundle)

describe.skipIf(!RUN)('axis-pull well on the compiled bundle', () => {
  it('draws a ball toward the axis and never lifts it', async () => {
    const { default: factory } = await import(/* @vite-ignore */ pathToFileURL(bundle).href) as {
      default: () => Promise<WasmPhysicsModule>
    }
    const engine = new WasmPhysicsEngine()
    await engine.load(undefined, await factory())
    expect(engine.isReady).toBe(true)
    engine.setGravity(0, 0, 0)

    const field = engine.addForceField({
      center: { x: 0, y: 0.5, z: 0 },
      halfExtents: { x: 3, y: 2, z: 3 },
      mode: 'axis-pull',
      strength: 10,
      acceleration: true,
    })
    expect(field).toBeLessThan(0)

    const ball = engine.createBody({ position: { x: 1, y: 0.5, z: 0 }, radius: 0.2, mass: 1, linearDamping: 0 })
    for (let i = 0; i < 20; i++) engine.step(1 / 60)

    const pos = engine.getPosition(ball)
    expect(pos.x).toBeLessThan(1)
    expect(Math.abs(pos.y - 0.5)).toBeLessThan(1e-3)
    expect(Math.abs(pos.z)).toBeLessThan(1e-3)

    // Disabling the field (the owner does this through collision groups) stops the pull.
    engine.setForceFieldEnabled(field, false)
    const before = engine.getVelocity(ball).x
    for (let i = 0; i < 20; i++) engine.step(1 / 60)
    expect(engine.getVelocity(ball).x).toBeCloseTo(before, 4)
    engine.dispose()
  })
})
