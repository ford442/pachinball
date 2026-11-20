import { test, expect, type Page } from '@playwright/test'

/**
 * Weeks on Fire (#518), the first data-only machine: `/?machine=weeks-on-fire`
 * boots the classic cabinet and plays, and after one online load the service
 * worker's precache (machines/**\/*.json, #518) serves it offline.
 *
 * Runs under playwright.preview.config.ts (the built dist/): the precache only
 * exists in a production build. Service workers are allowed here.
 */
test.use({ serviceWorkers: 'allow' })

const URL = '/?machine=weeks-on-fire&renderer=webgl2'

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(err.message))
  page.on('console', (msg) => {
    const text = msg.text()
    // Chromium's generic resource-failure log carries no URL; failed responses are checked below.
    if (msg.type() === 'error' && text.startsWith('Failed to load resource')) return
    if (msg.type() === 'error' || (msg.type() === 'warning' && /machine/i.test(text))) errors.push(text)
  })
  page.on('response', (res) => {
    if (res.status() >= 400 && /\/machines\//.test(res.url())) errors.push(`HTTP ${res.status()} ${res.url()}`)
  })
  return errors
}

async function bootAndPlay(page: Page): Promise<void> {
  await expect(page.locator('#start-btn')).toBeVisible({ timeout: 30_000 })
  await expect.poll(() => page.evaluate(() => !!(window as any).game?.stateManager), { timeout: 60_000 }).toBe(true)
  const machine = await page.evaluate(() => {
    const g = (window as any).game
    return { id: g.machine?.id ?? null, cabinet: g.cabinetManager?.getCurrentType?.() ?? null }
  })
  expect(machine).toEqual({ id: 'weeks-on-fire', cabinet: 'classic' })
  await page.locator('#start-btn').click()
  await expect
    .poll(() => page.evaluate(() => (window as any).game?.stateManager?.isPlaying?.() ?? false), { timeout: 30_000 })
    .toBe(true)
}

test('?machine=weeks-on-fire boots the classic cabinet and plays', async ({ page }) => {
  test.setTimeout(120_000)
  const errors = collectErrors(page)
  await page.goto(URL)
  await bootAndPlay(page)
  expect(errors).toEqual([])
})

test('?machine=weeks-on-fire loads offline after one online visit', async ({ page, context }) => {
  test.setTimeout(180_000)
  await page.goto(URL)
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined))
  // Let the install finish precaching, and make the page controlled.
  await page.reload()
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null), { timeout: 60_000 }).toBe(true)
  const precached = await page.evaluate(async () => {
    const names = await caches.keys()
    for (const name of names) {
      const cache = await caches.open(name)
      for (const req of await cache.keys()) if (req.url.includes('/machines/weeks-on-fire.json')) return true
    }
    return false
  })
  expect(precached).toBe(true)

  await context.setOffline(true)
  const errors = collectErrors(page)
  await page.reload()
  await bootAndPlay(page)
  // Offline, only arcade / network chatter may fail; the machine itself must not.
  expect(errors.filter((e) => /machine/i.test(e))).toEqual([])
})
