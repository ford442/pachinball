import { test, expect } from '@playwright/test'

const PHYSICS_DEGRADE_MARKER = '[Bootstrap][physics-degrade]'

test.use({
  launchOptions: { args: ['--no-sandbox', '--disable-setuid-sandbox'] },
})

/**
 * Fail-closed degrade path: a boot without the WASM bundle must reach Rapier
 * and log the greppable physics-degrade marker on every rung.
 *
 * Runs against the Vite dev server with `public/wasm` removed (see
 * playwright.degrade.config.ts). The dev server is cross-origin isolated, so
 * the default is `wasm-worker` and the ladder is worker → in-process owner →
 * Rapier (#439).
 */
test('missing WASM bundle degrades to Rapier with marker', async ({ page }) => {
  test.setTimeout(120_000)

  const degradeLogs: string[] = []
  page.on('console', (msg) => {
    const text = msg.text()
    if (text.includes(PHYSICS_DEGRADE_MARKER)) degradeLogs.push(text)
  })

  await page.goto('/?renderer=webgl2')
  await expect(page.locator('#start-btn')).toBeVisible({ timeout: 15_000 })

  await expect.poll(async () => {
    return page.evaluate(() => !!(window as unknown as { game?: { stateManager?: unknown } }).game?.stateManager)
  }, { timeout: 20_000 }).toBe(true)

  const boot = await page.evaluate(() => ({
    engine: (window as unknown as { currentPhysicsEngine?: string }).currentPhysicsEngine ?? null,
    degradeReason: (window as unknown as { physicsDegradeReason?: string }).physicsDegradeReason ?? null,
  }))

  expect(boot.engine).toBe('rapier')
  expect(
    boot.degradeReason?.includes(PHYSICS_DEGRADE_MARKER) ||
      degradeLogs.some((line) => line.includes(PHYSICS_DEGRADE_MARKER)),
  ).toBe(true)
  // Both rungs, in order: the worker gives way to the owner, then the owner to Rapier.
  const workerRung = degradeLogs.findIndex((line) => /worker failed/i.test(line))
  const rapierRung = degradeLogs.findIndex((line) => /falling back to Rapier/i.test(line))
  expect(workerRung, `worker rung missing from ${JSON.stringify(degradeLogs)}`).toBeGreaterThanOrEqual(0)
  expect(rapierRung, 'the owner rung must follow the worker rung').toBeGreaterThan(workerRung)

  const started = await page.evaluate(async () => {
    const g = (window as unknown as {
      game?: {
        startGame?: () => Promise<void>
        stateManager?: { isPlaying?: () => boolean }
      }
    }).game
    try {
      await g?.startGame?.()
      return g?.stateManager?.isPlaying?.() === true
    } catch {
      return false
    }
  })
  expect(started, 'gameplay must still start after physics degrade').toBe(true)
})
