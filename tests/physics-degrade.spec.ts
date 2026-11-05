import { test, expect, type Page } from '@playwright/test'

const PHYSICS_DEGRADE_MARKER = '[Bootstrap][physics-degrade]'

test.use({
  launchOptions: { args: ['--no-sandbox', '--disable-setuid-sandbox'] },
})

/**
 * Fail-closed degrade path: a boot without the WASM bundle must reach Rapier
 * and log the greppable physics-degrade marker on every rung.
 *
 * Runs against the Vite dev server with `public/wasm` removed (see
 * playwright.degrade.config.ts). The default engine is the in-process
 * `wasm-owner` everywhere (#471, src/config/physics.ts), so the default ladder
 * is owner → Rapier. The opt-in `?physics=wasm-worker` ladder is
 * worker → owner → Rapier (#439) and is covered by the second test.
 */

async function bootAndCollect(page: Page, url: string): Promise<{
  degradeLogs: string[]
  engine: string | null
  degradeReason: string | null
}> {
  const degradeLogs: string[] = []
  page.on('console', (msg) => {
    const text = msg.text()
    if (text.includes(PHYSICS_DEGRADE_MARKER)) degradeLogs.push(text)
  })

  await page.goto(url)
  await expect(page.locator('#start-btn')).toBeVisible({ timeout: 15_000 })

  await expect.poll(async () => {
    return page.evaluate(() => !!(window as unknown as { game?: { stateManager?: unknown } }).game?.stateManager)
  }, { timeout: 20_000 }).toBe(true)

  const boot = await page.evaluate(() => ({
    engine: (window as unknown as { currentPhysicsEngine?: string }).currentPhysicsEngine ?? null,
    degradeReason: (window as unknown as { physicsDegradeReason?: string }).physicsDegradeReason ?? null,
  }))
  return { degradeLogs, ...boot }
}

function expectMarker(boot: { degradeLogs: string[]; degradeReason: string | null }): void {
  expect(
    boot.degradeReason?.includes(PHYSICS_DEGRADE_MARKER) ||
      boot.degradeLogs.some((line) => line.includes(PHYSICS_DEGRADE_MARKER)),
  ).toBe(true)
}

async function expectGameplayStarts(page: Page): Promise<void> {
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
}

test('missing WASM bundle: default wasm-owner degrades to Rapier with marker', async ({ page }) => {
  test.setTimeout(120_000)
  const boot = await bootAndCollect(page, '/?renderer=webgl2')

  expect(boot.engine).toBe('rapier')
  expectMarker(boot)
  // One rung: the default never starts a worker, so the owner gives way to Rapier.
  const workerRung = boot.degradeLogs.findIndex((line) => /worker failed/i.test(line))
  const rapierRung = boot.degradeLogs.findIndex((line) => /falling back to Rapier/i.test(line))
  expect(rapierRung, `owner rung missing from ${JSON.stringify(boot.degradeLogs)}`).toBeGreaterThanOrEqual(0)
  expect(workerRung, 'the default engine must not try the worker').toBe(-1)

  await expectGameplayStarts(page)
})

test('missing WASM bundle: ?physics=wasm-worker degrades worker → owner → Rapier', async ({ page }) => {
  test.setTimeout(120_000)
  const boot = await bootAndCollect(page, '/?renderer=webgl2&physics=wasm-worker')

  expect(boot.engine).toBe('rapier')
  expectMarker(boot)
  // Both rungs, in order: the worker gives way to the owner, then the owner to Rapier.
  const workerRung = boot.degradeLogs.findIndex((line) => /worker failed/i.test(line))
  const rapierRung = boot.degradeLogs.findIndex((line) => /falling back to Rapier/i.test(line))
  expect(workerRung, `worker rung missing from ${JSON.stringify(boot.degradeLogs)}`).toBeGreaterThanOrEqual(0)
  expect(rapierRung, 'the owner rung must follow the worker rung').toBeGreaterThan(workerRung)

  await expectGameplayStarts(page)
})
