import { expect, test } from '@playwright/test'

test.describe('Pause menu', () => {
  test('opens via Escape, toggles reduced motion, then resumes', async ({ page }) => {
    test.setTimeout(60_000)

    await page.goto('http://localhost:5173')
    await expect(page.locator('#start-btn')).toBeVisible({ timeout: 10_000 })
    await page.locator('#start-btn').click()

    await expect.poll(async () => {
      return page.evaluate(() => (window as unknown as { game?: { stateManager?: { getState?: () => number } } }).game?.stateManager?.getState?.() ?? -1)
    }, {
      intervals: [200],
      timeout: 12_000,
    }).toBe(2)

    await page.keyboard.press('Escape')
    await expect(page.locator('[data-testid="pause-menu-panel"]')).toBeVisible()
    await expect.poll(async () => {
      return page.evaluate(() => (window as unknown as { game?: { stateManager?: { getState?: () => number } } }).game?.stateManager?.getState?.() ?? -1)
    }).toBe(1)

    const reduceMotion = page.locator('[data-testid="pause-reduced-motion"]')
    const initialState = await reduceMotion.isChecked()
    await reduceMotion.click()
    await expect(reduceMotion).toHaveJSProperty('checked', !initialState)

    await page.locator('[data-testid="pause-resume-btn"]').click()
    await expect(page.locator('[data-testid="pause-menu-panel"]')).toBeHidden()
    await expect.poll(async () => {
      return page.evaluate(() => (window as unknown as { game?: { stateManager?: { getState?: () => number } } }).game?.stateManager?.getState?.() ?? -1)
    }).toBe(2)
  })
})
