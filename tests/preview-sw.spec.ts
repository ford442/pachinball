import { test, expect } from '@playwright/test'

// Runs only under playwright.preview.config.ts. The one spec that lets Workbox run: a precached
// response that loses COOP/COEP would silently drop the production default to wasm-owner.
test.use({ serviceWorkers: 'allow' })

test('service-worker-served document stays cross-origin isolated', async ({ page }) => {
  test.setTimeout(120_000)

  await page.goto('/')
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined))
  // workbox.clientsClaim takes the page on first install; one reload makes that certain.
  await page.reload()

  const state = await page.evaluate(() => ({
    controlled: navigator.serviceWorker.controller !== null,
    isolated: window.crossOriginIsolated,
  }))

  expect(state.controlled).toBe(true)
  expect(state.isolated).toBe(true)
})
