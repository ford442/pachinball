import { test, expect } from '@playwright/test'

test.describe('Scoring breakdown', () => {
  test('shows breakdown panel after a drain-triggered game over', async ({ page }) => {
    test.setTimeout(60_000)

    await page.goto('http://localhost:5173')
    await expect(page.locator('#start-btn')).toBeVisible({ timeout: 10_000 })
    await page.locator('#start-btn').click()

    await expect.poll(async () => {
      return page.evaluate(() => (window as unknown as { game?: { stateManager?: { isPlaying?: () => boolean } } }).game?.stateManager?.isPlaying?.() ?? false)
    }, {
      intervals: [200],
      timeout: 10_000,
    }).toBe(true)

    await page.evaluate(() => {
      const game = (window as unknown as {
        game?: {
          lives: number
          ballManager?: { getBallBody?: () => unknown }
          physicsController?: { handleBallLoss?: (body: unknown) => void }
        }
      }).game
      if (!game?.ballManager?.getBallBody || !game.physicsController?.handleBallLoss) return
      const ballBody = game.ballManager.getBallBody()
      if (!ballBody) return
      game.lives = 1
      game.physicsController.handleBallLoss(ballBody)
    })

    const panel = page.locator('[data-testid="scoring-breakdown-panel"]')
    await expect(panel).toBeVisible({ timeout: 10_000 })
    await expect(panel).toContainText('Grand Total')
    await expect(panel).toContainText('Bumpers')
  })
})
