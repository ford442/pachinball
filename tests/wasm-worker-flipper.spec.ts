import { test, expect } from '@playwright/test'

/**
 * wasm-worker flipper smoke: C++ world in a Dedicated Worker, same owner path.
 * Skips when the worker/WASM bundle is not ready.
 */
test.describe('wasm-worker physics mode', () => {
  test('owner path swings the flipper hinge, reports wasm-worker, skips Rapier step', async ({ page }) => {
    test.setTimeout(120_000)

    await page.addInitScript(() => {
      localStorage.setItem('pachinball:physics-engine', 'wasm-worker')
    })
    await page.goto('/?renderer=webgl2')
    await expect(page.locator('#start-btn')).toBeVisible({ timeout: 30_000 })

    await expect.poll(async () => {
      return page.evaluate(() => !!window.game?.stateManager)
    }, { timeout: 60_000 }).toBe(true)

    const wasmReady = await page.evaluate(() => {
      const g = window.game
      return !!(
        g?.physics?.isWasmOwnerMode?.() &&
        g?.physics?.getWasmMode?.() === 'wasm-worker' &&
        g?.physics?.getWasmEngine?.()?.isReady
      )
    })
    if (!wasmReady) {
      test.skip(true, 'WASM worker engine not loaded in this environment')
    }

    await page.evaluate(() => document.getElementById('start-btn')?.click())
    await expect.poll(async () => {
      return page.evaluate(() => {
        const g = window.game
        return g?.stateManager?.isPlaying?.() === true
      })
    }, { timeout: 30_000 }).toBe(true)

    // Drive the flipper through the real keyboard path (Digit1 = left flipper). A
    // `handleFlipperLeft(true)` from page.evaluate does not stick under the live render loop:
    // the held-key poll releases it on the next frame (see tests/wasm-owner-flipper.spec.ts,
    // which steps by hand instead). The hinge must swing the body from its rest angle
    // towards the active one, with every step in the worker and none in Rapier.
    type FlipperHooks = {
      game?: {
        gameObjects?: { getFlipper?: (name: string) => { body: { rotation: () => { y: number } } } | undefined }
        physics?: { getLastRapierStepMs?: () => number; getWasmMode?: () => string }
      }
    }
    const flipperYaw = () => page.evaluate(() => {
      const q = (window as unknown as FlipperHooks).game?.gameObjects?.getFlipper?.('left')?.body.rotation()
      return q ? q.y : NaN
    })

    const rest = await flipperYaw()
    expect(Number.isFinite(rest), 'left flipper body').toBe(true)
    await page.keyboard.down('Digit1')
    // Under SwiftShader a frame can take a second: wait for the swing, not a fixed delay.
    await expect.poll(async () => Math.abs((await flipperYaw()) - rest), { timeout: 30_000, intervals: [100] }).toBeGreaterThan(0.2)
    const held = Math.abs((await flipperYaw()) - rest)
    await page.keyboard.up('Digit1')
    // Released, the (damped) hinge swings back towards rest.
    await expect.poll(async () => Math.abs((await flipperYaw()) - rest), { timeout: 30_000, intervals: [100] }).toBeLessThan(held * 0.8)

    const physics = await page.evaluate(() => {
      const g = (window as unknown as FlipperHooks).game
      return { rapierMs: g?.physics?.getLastRapierStepMs?.() ?? -1, mode: g?.physics?.getWasmMode?.() ?? '' }
    })
    expect(physics.mode).toBe('wasm-worker')
    expect(physics.rapierMs).toBe(0)
  })
})
