import { test, expect } from '@playwright/test'
import { generateTableLayout } from '../src/cascade/daily-cascade-layout'
import { deriveMachineIdentity } from '../src/cascade/machine-identity'

// Daily Cascade start screen: a named machine (not a seed row), share links
// that open the exact layout, and coexistence with challenge links.
test.setTimeout(180_000)

const expectedTitle = (seed: number) =>
  deriveMachineIdentity(generateTableLayout({ seed, seedId: `free-${seed.toString(16)}` })).title

test('a ?cascade=<hex> link opens that free machine by name', async ({ page }) => {
  await page.goto('/?renderer=webgl2&cascade=1a2b3c4d')
  await expect(page.locator('#cascade-mode')).toHaveValue('free', { timeout: 90_000 })
  await expect(page.locator('#todays-machine-heading')).toHaveText('Free machine')
  await expect(page.locator('#cascade-machine-name')).toHaveText(expectedTitle(0x1a2b3c4d))
  await expect(page.locator('#cascade-machine-traits')).toContainText('feeders:')
  await expect(page.locator('#cascade-seed-label')).toHaveText('Seed: 1a2b3c4d')
  await expect(page.locator('#cascade-share-btn')).toBeVisible()
})

test('daily mode names today’s machine; vanilla hides the card', async ({ page }) => {
  await page.goto('/?renderer=webgl2')
  await expect(page.locator('#cascade-machine-name')).toBeHidden({ timeout: 90_000 })
  await expect(page.locator('#todays-machine-heading')).toHaveText('Classic table')
  await expect(page.locator('#cascade-share-btn')).toBeHidden()

  await page.locator('#cascade-mode').selectOption('daily')
  await expect(page.locator('#todays-machine-heading')).toHaveText('Today’s machine')
  await expect(page.locator('#cascade-machine-name')).toHaveText(/^[A-Z][a-z]+ [A-Z][a-z]+ #\d{3}$/)
  await expect(page.locator('#cascade-seed-label')).toHaveText(/^Daily: \d{4}-\d{2}-\d{2}$/)
})

test('a cascade link and a challenge seed coexist', async ({ page }) => {
  await page.goto('/?renderer=webgl2&seed=123&cascade=ff')
  await expect(page.locator('#cascade-mode')).toHaveValue('free', { timeout: 90_000 })
  await expect(page.locator('#cascade-machine-name')).toHaveText(expectedTitle(0xff))
  // The challenge system comes up with the game: start one and both apply.
  await expect(page.locator('#start-btn')).toBeEnabled({ timeout: 90_000 })
  await page.locator('#start-btn').click()
  await expect(page.locator('#challenge-hud-banner')).toBeAttached({ timeout: 60_000 })
  const seedId = await page.evaluate(async () => {
    const m = await import('/src/cascade/index.ts')
    return m.getDailyCascadeState().getSeedId()
  })
  expect(seedId).toBe('free-ff')
})
