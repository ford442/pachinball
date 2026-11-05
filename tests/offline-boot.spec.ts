import { test, expect } from '@playwright/test'

// Runs only under playwright.preview.config.ts (#503 A1). After one online visit the service
// worker must hold every chunk the boot needs: an offline reload has to reach `window.game`.
// A boot chunk that is modulepreloaded but `globIgnores`d from the precache fails here at module
// load; scripts/check-bundle-size.mjs catches the same thing statically (preloaded ⊆ precached).
test.use({ serviceWorkers: 'allow' })

test('the PWA boots offline after one visit', async ({ page, context }) => {
  test.setTimeout(180_000)

  await page.goto('/')
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined))
  await page.waitForFunction(() => Boolean((window as unknown as { game?: unknown }).game), null, { timeout: 120_000 })
  // Rapier is the degrade path and deliberately not precached (#412): without the C++ bundle
  // (CI's wasm=false leg, or a local build without Emscripten) there is no offline boot to test.
  const engine = await page.evaluate(() => (window as unknown as { currentPhysicsEngine?: string }).currentPhysicsEngine)
  test.skip(engine === 'rapier' || process.env.PREVIEW_EXPECT_ENGINE === 'rapier', 'no C++ physics bundle in this build')
  // clientsClaim takes the page on first install; make sure it controls it before going offline.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 30_000 })

  await context.setOffline(true)
  const failed: string[] = []
  page.on('requestfailed', (request) => {
    if (request.url().startsWith('http://localhost')) failed.push(request.url())
  })
  await page.reload()
  await page.waitForFunction(() => Boolean((window as unknown as { game?: unknown }).game), null, { timeout: 120_000 })

  const jsFailures = failed.filter((url) => /\.(js|wasm)(\?|$)/.test(url))
  expect(jsFailures, `boot assets missing from the precache: ${jsFailures.join(', ')}`).toEqual([])
})
