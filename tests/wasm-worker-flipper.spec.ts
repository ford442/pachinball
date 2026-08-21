import { test, expect } from '@playwright/test'

/**
 * wasm-worker flipper smoke: C++ world in a Dedicated Worker, same owner path.
 * Skips when the worker/WASM bundle is not ready.
 */
test.describe('wasm-worker physics mode', () => {
  test('owner path launches a ball, reports wasm-worker, skips Rapier step', async ({ page }) => {
    test.setTimeout(120_000)

    await page.addInitScript(() => {
      localStorage.setItem('pachinball:physics-engine', 'wasm-worker')
    })
    await page.goto('/?renderer=webgl2')
    await expect(page.locator('#start-btn')).toBeVisible({ timeout: 10_000 })

    await expect.poll(async () => {
      return page.evaluate(() => !!(window as unknown as { game?: { stateManager?: unknown } }).game?.stateManager)
    }, { timeout: 15_000 }).toBe(true)

    const wasmReady = await page.evaluate(() => {
      const g = (window as unknown as {
        game?: {
          physics?: {
            isWasmOwnerMode?: () => boolean
            getWasmMode?: () => string
            getWasmEngine?: () => { isReady?: boolean }
          }
        }
      }).game
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
        const g = (window as unknown as { game?: { stateManager?: { isPlaying?: () => boolean } } }).game
        return g?.stateManager?.isPlaying?.() === true
      })
    }, { timeout: 30_000 }).toBe(true)

    const launched = await page.evaluate(async () => {
      const g = (window as unknown as {
        game?: {
          ballManager?: { getBallBody?: () => { setTranslation: (v: unknown, w: boolean) => void; setLinvel: (v: unknown, w: boolean) => void; linvel: () => { z: number } } }
          physics?: {
            getRapier?: () => { Vector3: new (x: number, y: number, z: number) => unknown }
            getLastRapierStepMs?: () => number
            getWasmMode?: () => string
          }
          inputActions?: { handleFlipperLeft: (p: boolean) => void }
          physicsController?: { rebuildHandleCaches?: () => void }
        }
      }).game
      const rapier = g?.physics?.getRapier?.()
      const ball = g?.ballManager?.getBallBody?.()
      if (!rapier || !ball) return { ok: false, vz: 0, rapierMs: -1, mode: g?.physics?.getWasmMode?.() ?? '' }

      g.physicsController?.rebuildHandleCaches?.()
      ball.setTranslation(new rapier.Vector3(-2.5, 0.4, -6.2), true)
      ball.setLinvel(new rapier.Vector3(0, 0, -1.5), true)
      g.physicsController?.rebuildHandleCaches?.()

      const waitFrames = (n: number) => new Promise<void>((resolve) => {
        let i = 0
        const tick = () => { if (++i >= n) resolve(); else requestAnimationFrame(tick) }
        requestAnimationFrame(tick)
      })

      g.inputActions?.handleFlipperLeft(true)
      await waitFrames(45)
      g.inputActions?.handleFlipperLeft(false)
      await waitFrames(15)

      const vz = ball.linvel().z
      const rapierMs = g.physics?.getLastRapierStepMs?.() ?? -1
      return { ok: true, vz, rapierMs, mode: g.physics?.getWasmMode?.() ?? '' }
    })

    expect(launched.ok).toBe(true)
    expect(launched.mode).toBe('wasm-worker')
    expect(launched.rapierMs).toBe(0)
    expect(Math.abs(launched.vz)).toBeGreaterThan(0.5)
  })
})
