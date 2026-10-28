import { test, expect, type Page } from '@playwright/test'

/**
 * Campaign front door: the campaign is reachable from the start screen with the
 * mouse alone — the Campaign start mode and the Stage Map — and the cabinet
 * selector offers every preset.
 */

test.setTimeout(180_000)

interface FrontDoorGame {
  adventureMode?: { isActive(): boolean; getCurrentZone(): string | null }
}

async function openMenu(page: Page): Promise<void> {
  await page.goto('/?renderer=webgl2')
  await expect(page.locator('#start-btn')).toBeEnabled({ timeout: 90_000 })
}

async function waitForCampaignStage(page: Page, trackId: string): Promise<void> {
  await page.waitForFunction((id) => {
    const g = (window as unknown as { game?: FrontDoorGame }).game
    return g?.adventureMode?.isActive() === true && g.adventureMode.getCurrentZone() === id
  }, trackId, { timeout: 30_000 })
}

test('Campaign start mode enters the first stage', async ({ page }) => {
  await openMenu(page)
  await page.locator('#cascade-mode').selectOption('campaign')
  await expect(page.locator('#cascade-seed-label')).toHaveText('Starts at Neon Helix')

  await page.locator('#start-btn').click()
  await expect(page.locator('#menu-overlay')).toBeHidden({ timeout: 30_000 })
  await waitForCampaignStage(page, 'NEON_HELIX')
})

test('Stage Map shows the spine and its branches, and starts a reached stage', async ({ page }) => {
  await openMenu(page)
  await page.locator('#campaign-map-btn').click()

  const map = page.locator('[data-testid="campaign-map"]')
  // The map is a lazy chunk; the dev server compiles it on first request.
  await expect(map).toBeVisible({ timeout: 30_000 })
  await expect(map.locator('[data-testid="campaign-spine"] > li > .campaign-stage')).toHaveCount(14)
  await expect(map.locator('[data-testid="campaign-branch-NEON_HELIX"]')).toBeVisible()
  await expect(map.locator('[data-testid="campaign-branch-FIREWALL_BREACH"]')).toBeVisible()
  await expect(map.locator('[data-testid="campaign-stage-CYBER_CORE"]')).toBeDisabled()

  await map.locator('[data-testid="campaign-stage-NEON_HELIX"]').click()
  await expect(map).toBeHidden()
  await expect(page.locator('#menu-overlay')).toBeHidden({ timeout: 30_000 })
  await expect(page.locator('#cascade-mode')).toHaveValue('campaign')
  await waitForCampaignStage(page, 'NEON_HELIX')
})

test('cabinet selector offers every preset, including wide', async ({ page }) => {
  await openMenu(page)
  await page.locator('#start-btn').click()
  await expect(page.locator('#menu-overlay')).toBeHidden({ timeout: 30_000 })

  const buttons = page.locator('#cabinet-selector .cabinet-btn')
  await expect(buttons).toHaveCount(4)
  expect(await buttons.evaluateAll((els) => els.map((el) => el.getAttribute('data-cabinet')))).toEqual([
    'classic', 'neo', 'vertical', 'wide',
  ])
})
