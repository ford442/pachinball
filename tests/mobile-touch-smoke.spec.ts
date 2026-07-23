import { test, expect, devices } from '@playwright/test'

/**
 * Mobile touch smoke — Pixel 7–class viewport (#300).
 * Requires the Vite dev server on PLAYWRIGHT_BASE_URL (default localhost:5173).
 */
test.describe('Mobile touch smoke', () => {
  test.use({
    ...devices['Pixel 7'],
    // Prefer WebGL2 for automation canvas readability
    hasTouch: true,
    isMobile: true,
  })

  test('touch controls visible in portrait and landscape; reduced-motion starts', async ({
    page,
  }) => {
    test.setTimeout(90_000)

    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/?renderer=webgl2')

    const startBtn = page.locator('#start-btn')
    await expect(startBtn).toBeVisible({ timeout: 60_000 })
    await startBtn.click()

    // Wait for scene init
    await page.waitForTimeout(1500)

    const touchRoot = page.locator('#touch-controls')
    const left = page.locator('#touch-left')
    const right = page.locator('#touch-right')
    const plunger = page.locator('#touch-plunger')
    const nudge = page.locator('#touch-nudge')

    await expect(touchRoot).toBeVisible()
    await expect(left).toBeVisible()
    await expect(right).toBeVisible()
    await expect(plunger).toBeVisible()
    await expect(nudge).toBeVisible()

    // Portrait: buttons should not share the same center (non-overlapping layout)
    const portraitBoxes = await Promise.all([
      left.boundingBox(),
      right.boundingBox(),
      plunger.boundingBox(),
    ])
    expect(portraitBoxes.every(Boolean)).toBe(true)
    const [l, r, p] = portraitBoxes as NonNullable<(typeof portraitBoxes)[0]>[]
    expect(l.x + l.width).toBeLessThan(r.x)
    expect(p.y).toBeGreaterThan(Math.min(l.y, r.y) - 20)

    // Landscape stress (Pixel 7 landscape)
    await page.setViewportSize({ width: 915, height: 412 })
    await page.waitForTimeout(300)

    await expect(touchRoot).toBeVisible()
    await expect(left).toBeVisible()
    await expect(right).toBeVisible()
    await expect(plunger).toBeVisible()

    const landscapeBoxes = await Promise.all([
      left.boundingBox(),
      right.boundingBox(),
      plunger.boundingBox(),
    ])
    expect(landscapeBoxes.every(Boolean)).toBe(true)
    const [ll, rr] = landscapeBoxes as NonNullable<(typeof landscapeBoxes)[0]>[]
    expect(ll.x + ll.width).toBeLessThan(rr.x)

    // Game object should exist after start (reduced-motion path)
    const hasGame = await page.evaluate(() => Boolean((window as unknown as { game?: unknown }).game))
    expect(hasGame).toBe(true)
  })
})
