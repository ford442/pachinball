import { test, expect } from '@playwright/test'
import {
  assertWasmOwnerReady,
  bootWasmOwner,
  startPlaying,
  type GameHooks,
} from './helpers/wasm-owner-boot'

/**
 * The pachinko pins on the C++ owner path (#421): the whole lattice is ONE
 * pin-field handle (-10000) holding exactly the pins the scene renders, no
 * static handle was dropped, and a ball dropped into the field hits it.
 */

type Vec = { x: number; y: number; z: number }

type PinFieldHooks = GameHooks & {
  game?: GameHooks['game'] & {
    ballManager?: {
      getBallBody?: () => {
        setTranslation: (v: Vec, w: boolean) => void
        setLinvel: (v: Vec, w: boolean) => void
        setAngvel: (v: Vec, w: boolean) => void
      }
    }
  }
}

type InProcessEngine = {
  getPinFieldPinCount?: (id: number) => number
  world?: {
    getDroppedStaticCount: () => number
    getContactCount: () => number
    getContactBufferPtr: () => number
  }
  module?: { HEAPF32?: Float32Array }
}

test.describe('wasm-owner pin field', () => {
  test('the table lattice is one C++ pin field that the ball hits', async ({ page }) => {
    test.setTimeout(180_000)
    const boot = await bootWasmOwner(page)
    assertWasmOwnerReady(boot)
    await startPlaying(page)

    const run = await page.evaluate(() => {
      const g = (window as unknown as PinFieldHooks).game
      const engine = g?.physics?.getWasmEngine?.() as unknown as InProcessEngine | undefined
      const ball = g?.ballManager?.getBallBody?.()
      if (!g?.physicsController || !g.engine || !engine?.world || !engine.getPinFieldPinCount || !ball) {
        return { ok: false, reason: 'hooks missing' }
      }
      const pinMeshes = (g.scene?.meshes ?? []) as Array<{ name: string; position?: Vec }>
      const renderedPins = pinMeshes.filter((m) => /^pin_(seed_)?\d+_\d+$/.test(m.name)).length
      // Aim straight down at a rendered pin in the upper lattice (row 8, col 3).
      const target = pinMeshes.find((m) => m.name === 'pin_8_3')?.position
      const fieldPins = engine.getPinFieldPinCount(-10000)
      const secondField = engine.getPinFieldPinCount(-10001)
      const droppedStatics = engine.world.getDroppedStaticCount()

      if (!target) return { ok: false, reason: 'pin_8_3 not rendered' }
      ball.setTranslation({ x: target.x + 0.05, y: 0.5, z: target.z + 2.5 }, true)
      ball.setLinvel({ x: 0, y: 0, z: 0 }, true)
      ball.setAngvel({ x: 0, y: 0, z: 0 }, true)
      g.physicsController.rebuildHandleCaches?.()

      let fieldContacts = 0
      const origDt = g.engine.getDeltaTime.bind(g.engine)
      g.engine.getDeltaTime = () => 1000 / 60
      try {
        for (let i = 0; i < 180 && fieldContacts === 0; i++) {
          g.physicsController.stepPhysics(g.inputManager, g.inputActions, null, null)
          const count = engine.world.getContactCount()
          const heap = engine.module?.HEAPF32
          if (!count || !heap) continue
          const start = engine.world.getContactBufferPtr() >> 2
          for (let c = 0; c < count; c++) {
            if (heap[start + c * 12 + 1] === -10000) fieldContacts++
          }
        }
      } finally {
        g.engine.getDeltaTime = origDt
      }
      return { ok: true, reason: '', renderedPins, fieldPins, secondField, droppedStatics, fieldContacts }
    })

    expect(run.ok, run.reason).toBe(true)
    expect(run.fieldPins).toBeGreaterThan(80)
    expect(run.fieldPins).toBe(run.renderedPins)
    expect(run.secondField, 'one field for the whole lattice').toBe(-1)
    expect(run.droppedStatics).toBe(0)
    expect(run.fieldContacts).toBeGreaterThan(0)
  })

  test('wasm-worker: the pin field crosses the worker as one command and deflects the ball', async ({ page }) => {
    test.setTimeout(180_000)
    const boot = await bootWasmOwner(page, 'wasm-worker')
    assertWasmOwnerReady(boot, 'wasm-worker')
    await startPlaying(page)

    const run = await page.evaluate(async () => {
      const g = (window as unknown as PinFieldHooks).game
      const ball = g?.ballManager?.getBallBody?.() as unknown as {
        wasmId?: number | null
        setTranslation: (v: Vec, w: boolean) => void
        setLinvel: (v: Vec, w: boolean) => void
        setAngvel: (v: Vec, w: boolean) => void
      } | undefined
      const engine = g?.physics?.getWasmEngine?.() as unknown as { getPosition: (id: number) => Vec } | undefined
      const pin = ((g?.scene?.meshes ?? []) as Array<{ name: string; position?: Vec }>)
        .find((m) => m.name === 'pin_8_3')?.position
      if (!ball || !engine || ball.wasmId == null || !pin) return { ok: false, reason: 'hooks missing', maxDx: 0 }
      const id = ball.wasmId

      // Worker snapshots arrive between frames, so let the game's own loop step.
      const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      const startX = pin.x + 0.05
      ball.setTranslation({ x: startX, y: 0.5, z: pin.z + 2.5 }, true)
      ball.setLinvel({ x: 0, y: 0, z: 0 }, true)
      ball.setAngvel({ x: 0, y: 0, z: 0 }, true)

      // The ball rolls straight down -z until the pin knocks it sideways;
      // stop above the bumper row so nothing else can be the cause.
      // The snapshot trails the teleport by a frame or two: measure from the
      // first frame that shows the ball above the pin.
      let maxDx = 0
      let arrived = false
      for (let i = 0; i < 600; i++) {
        await frame()
        const t = engine.getPosition(id)
        if (!arrived) {
          arrived = t.z > pin.z + 1 && Math.abs(t.x - startX) < 0.05
          continue
        }
        if (t.z < pin.z - 0.8) break
        maxDx = Math.max(maxDx, Math.abs(t.x - startX))
      }
      return { ok: arrived, reason: arrived ? '' : 'teleport never reached the snapshot', maxDx }
    })

    expect(run.ok, run.reason).toBe(true)
    expect(run.maxDx, 'the pin should push the ball sideways').toBeGreaterThan(0.1)
  })
})
