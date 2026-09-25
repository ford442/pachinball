import { test, expect, devices, type Browser, type BrowserContextOptions, type Page } from '@playwright/test'

/**
 * Menu reachability — the Start Game button must be the top-most element at
 * its own centre in MENU state, i.e. nothing (cabinet / map / levels
 * selectors, touch controls) sits on top of it.
 *
 * Regression for the red smoke gate: at 1280x720 #cabinet-selector covered
 * #start-btn, and on Pixel 7 #touch-controls did.
 *
 * Each case builds its own context so desktop and mobile emulation can live in
 * one spec without a per-file test.use() (see mobile-touch-smoke.spec.ts).
 */

const pixel7 = devices['Pixel 7']

const CASES: Array<[string, BrowserContextOptions]> = [
  ['desktop 1280x720', { viewport: { width: 1280, height: 720 } }],
  ['desktop 1366x768', { viewport: { width: 1366, height: 768 } }],
  ['desktop 1920x1080', { viewport: { width: 1920, height: 1080 } }],
  ['Pixel 7 portrait', { ...pixel7, hasTouch: true, isMobile: true }],
  [
    'Pixel 7 landscape',
    {
      ...pixel7,
      viewport: { width: pixel7.viewport.height, height: pixel7.viewport.width },
      hasTouch: true,
      isMobile: true,
    },
  ],
]

async function openMenu(browser: Browser, options: BrowserContextOptions): Promise<Page> {
  const context = await browser.newContext(options)
  const page = await context.newPage()
  await page.goto('/?renderer=webgl2')
  const startBtn = page.locator('#start-btn')
  await expect(startBtn).toBeVisible({ timeout: 60_000 })
  await expect(startBtn).toBeEnabled({ timeout: 60_000 })
  return page
}

/** id of the element hit-tested at #start-btn's centre (after scrolling it into view). */
async function topElementAtStartBtn(page: Page): Promise<string | null> {
  await page.locator('#start-btn').scrollIntoViewIfNeeded()
  return page.evaluate(() => {
    const btn = document.getElementById('start-btn')
    if (!btn) return null
    const r = btn.getBoundingClientRect()
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
    if (!hit) return null
    return btn.contains(hit) ? 'start-btn' : hit.id || `.${hit.className}`
  })
}

test.describe('Menu reachability', () => {
  for (const [name, options] of CASES) {
    test(`start button is not occluded — ${name}`, async ({ browser }) => {
      test.setTimeout(90_000)
      const page = await openMenu(browser, options)
      try {
        expect(await topElementAtStartBtn(page)).toBe('start-btn')
      } finally {
        await page.context().close()
      }
    })
  }

  test('in-play selectors come back after Start (1280x720)', async ({ browser }) => {
    test.setTimeout(90_000)
    const page = await openMenu(browser, { viewport: { width: 1280, height: 720 } })
    try {
      await expect(page.locator('#cabinet-selector')).toBeHidden()
      await expect(page.locator('#map-selector')).toBeHidden()
      await expect(page.locator('#levels-selector')).toBeHidden()

      await page.locator('#start-btn').click()
      await expect(page.locator('#menu-overlay')).toBeHidden({ timeout: 30_000 })

      await expect(page.locator('#cabinet-selector')).toBeVisible()
      await expect(page.locator('#map-selector')).toBeVisible()
      await expect(page.locator('#levels-selector')).toBeVisible()
    } finally {
      await page.context().close()
    }
  })
})
