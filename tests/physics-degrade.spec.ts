import { test, expect } from '@playwright/test'

const PHYSICS_DEGRADE_MARKER = '[Bootstrap][physics-degrade]'

test.use({
  launchOptions: { args: ['--no-sandbox', '--disable-setuid-sandbox'] },
})

/**
 * Fail-closed degrade path: production build without WASM bundle must boot Rapier
 * and log the greppable physics-degrade marker.
 *
 * Runs against `vite preview` (see playwright.degrade.config.ts) so dist/ has no
 * PhysicsModule.* when CI builds with `npx vite build` only.
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
