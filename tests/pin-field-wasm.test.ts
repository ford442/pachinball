/**
 * Pin field against the real compiled bundle (#421): the TS resolver and the
 * C++ field agree on the table's actual pins, through the in-process
 * `WasmPhysicsEngine` heap upload the owner uses.
 *
 * Gated like tests/wasm-physics-parity.test.ts (bundle: tests/helpers/wasm-bundle.ts):
 *   npm run build:wasm:assert
 *   RUN_WASM_PARITY=1 npx vitest run tests/pin-field-wasm.test.ts
 */

import { describe, expect, it } from 'vitest'
import { WasmPhysicsEngine } from '../src/wasm/PhysicsModule'
import { decodeContactBuffer } from '../src/wasm/contact-buffer'
import { resolvePinField } from '../src/core/pin-field'
import { pachinkoPinFieldSpec } from '../src/objects/pachinko-pin-field'
import { generateTableLayout } from '../src/cascade/daily-cascade-layout'
import { loadWasmTestModule, runWasmParity as RUN } from './helpers/wasm-bundle'

async function loadEngine(): Promise<WasmPhysicsEngine> {
  const engine = new WasmPhysicsEngine()
  await engine.load(undefined, await loadWasmTestModule())
  expect(engine.isReady).toBe(true)
  return engine
}

describe.skipIf(!RUN)('pin field on the compiled bundle (#421)', () => {
  const center = { x: 0, z: 6 }

  it('C++ holds exactly the pins TS places, vanilla and seeded', async () => {
    const engine = await loadEngine()
    const specs = [
      pachinkoPinFieldSpec(center, 24, 22)!,
      ...[3, 17, 430].map((seed) => {
        const layout = generateTableLayout({ seed, seedId: `wasm${seed}` })
        return pachinkoPinFieldSpec(center, 24, 22, layout.pins, layout.pinLattice)!
      }),
    ]
    specs.forEach((spec, i) => {
      const id = engine.addPinField(spec)
      expect(id).toBe(-10000 - i)
      expect(engine.getPinFieldPinCount(id)).toBe(resolvePinField(spec).length)
    })
    engine.dispose()
  })

  it('a ball dropped into the vanilla field reports resolved pins as contact sub-indices', async () => {
    const engine = await loadEngine()
    engine.setGravity(0, 0, -9.81)
    const spec = pachinkoPinFieldSpec(center, 24, 22)!
    const field = engine.addPinField(spec)
    const present = new Set(resolvePinField(spec).map((p) => p.index))

    const world = (engine as unknown as { world: { getContactCount(): number; getContactBufferPtr(): number } }).world
    const heap = (engine as unknown as { module: WasmPhysicsModule }).module
    engine.createBody({ position: { x: -6.1, y: 0.4, z: 16.5 }, radius: 0.35, mass: 1 })
    const touched = new Set<number>()
    for (let i = 0; i < 240; i++) {
      engine.step(1 / 60)
      const count = world.getContactCount()
      if (!count) continue
      const f32 = heap.HEAPF32!
      const start = world.getContactBufferPtr() >> 2
      for (const c of decodeContactBuffer(f32.subarray(start, start + count * 12), count)) {
        if (c.bodyId2 === field) touched.add(c.subIndex ?? -1)
      }
    }
    expect(touched.size).toBeGreaterThan(0)
    for (const index of touched) expect(present.has(index)).toBe(true)
    engine.dispose()
  })
})
