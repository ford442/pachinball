import { test, expect } from '@playwright/test'

/**
 * wasm-owner flipper smoke: native hinge raises a blade and can launch a ball
 * without Rapier world.step() on the table path (lastRapierStepMs === 0).
 * Skips when the C++ WASM bundle is not loaded.
 */
test.describe('wasm-owner native flipper hinge', () => {
  test('raise/lower launches a ball and skips Rapier step', async ({ page }) => {
    test.setTimeout(120_000)

    await page.addInitScript(() => {
      localStorage.setItem('pachinball:physics-engine', 'wasm-owner')
    })
    await page.goto('/?renderer=webgl2')
    await expect(page.locator('#start-btn')).toBeVisible({ timeout: 10_000 })

    await expect.poll(async () => {
      return page.evaluate(() => !!(window as unknown as { game?: { stateManager?: unknown } }).game?.stateManager)
    }, { timeout: 15_000 }).toBe(true)

    const wasmReady = await page.evaluate(() => {
      const g = (window as unknown as { game?: { physics?: { isWasmOwnerMode?: () => boolean; getWasmEngine?: () => { isReady?: boolean } } } }).game
      return !!(g?.physics?.isWasmOwnerMode?.() && g?.physics?.getWasmEngine?.()?.isReady)
    })
    if (!wasmReady) {
      test.skip(true, 'WASM owner engine not loaded in this environment')
    }

    const started = await page.evaluate(async () => {
      const g = (window as unknown as {
        game?: { startGame?: () => Promise<void>; stateManager?: { isPlaying?: () => boolean } }
      }).game
      try {
        await g?.startGame?.()
        return { ok: g?.stateManager?.isPlaying?.() === true, error: null as string | null }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    })
    expect(started.error, started.error ?? 'startGame failed').toBeNull()
    expect(started.ok).toBe(true)

    const placed = await page.evaluate(() => {
      const g = (window as unknown as {
        game?: {
          ballManager?: { getBallBody?: () => { setTranslation: (v: unknown, w: boolean) => void; setLinvel: (v: unknown, w: boolean) => void } }
          physics?: { getRapier?: () => { Vector3: new (x: number, y: number, z: number) => unknown } }
          physicsController?: { rebuildHandleCaches?: () => void }
        }
      }).game
      const rapier = g?.physics?.getRapier?.()
      const ball = g?.ballManager?.getBallBody?.()
      if (!rapier || !ball) return false
      g.physicsController?.rebuildHandleCaches?.()
      // Left blade at hinge-angle 0 lies along -X from the pivot (-4, -0.25, -7).
      ball.setTranslation(new rapier.Vector3(-5.5, 0.45, -7.0), true)
      ball.setLinvel(new rapier.Vector3(0, 0, 0), true)
      g.physicsController?.rebuildHandleCaches?.()
      return true
    })
    expect(placed).toBe(true)

    // Digit1 is the left flipper. Wasm-owner motors follow InputFrame, not Rapier
    // configureMotorPosition, so a real key hold is required.
    await page.keyboard.down('Digit1')

    const launched = await page.evaluate(() => {
      const g = (window as unknown as {
        game?: {
          engine?: { getDeltaTime: () => number }
          inputManager?: unknown
          inputActions?: unknown
          ballManager?: { getBallBody?: () => { linvel: () => { z: number } } }
          physics?: { getLastRapierStepMs?: () => number }
          physicsController?: {
            stepPhysics: (
              inputManager: unknown,
              inputActions: unknown,
              replayRunner: null,
              replayRecorder: null
            ) => void
          }
        }
      }).game
      if (!g?.physicsController || !g.engine) {
        return { ok: false, vz: 0, rapierMs: -1 }
      }
      const origDt = g.engine.getDeltaTime.bind(g.engine)
      g.engine.getDeltaTime = () => 1000 / 60
      try {
        for (let i = 0; i < 45; i++) {
          g.physicsController.stepPhysics(g.inputManager, g.inputActions, null, null)
        }
      } finally {
        g.engine.getDeltaTime = origDt
      }
      const vz = g.ballManager?.getBallBody?.()?.linvel().z ?? 0
      const rapierMs = g.physics?.getLastRapierStepMs?.() ?? -1
      return { ok: true, vz, rapierMs }
    })

    await page.keyboard.up('Digit1')

    expect(launched.ok).toBe(true)
    expect(launched.rapierMs).toBe(0)
    expect(Math.abs(launched.vz)).toBeGreaterThan(0.5)
  })
})
