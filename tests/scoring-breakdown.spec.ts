import { test, expect } from '@playwright/test'

test.describe('Scoring breakdown', () => {
  test('shows breakdown panel after a drain-triggered game over', async ({ page }) => {
    test.setTimeout(60_000)

    await page.goto('/')
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
          ballManager?: { getBallBody?: () => unknown; ballSaveSystem?: { expire: () => void } }
          physicsController?: { scoringBridge?: { handleBallLoss?: (body: unknown) => void } }
        }
      }).game
      // Fail loudly on a stale hook rather than silently skipping the drain.
      const drain = game?.physicsController?.scoringBridge
      if (!game?.ballManager?.getBallBody || !drain?.handleBallLoss) throw new Error('drain hook missing: physicsController.scoringBridge.handleBallLoss')
      const ballBody = game.ballManager.getBallBody()
      if (!ballBody) throw new Error('no ball body to drain')
      game.lives = 1
      // The launch grace window would save this drain (BALL SAVED, no game over).
      game.ballManager.ballSaveSystem?.expire()
      drain.handleBallLoss(ballBody)
    })

    const panel = page.locator('[data-testid="scoring-breakdown-panel"]')
    await expect(panel).toBeVisible({ timeout: 10_000 })
    await expect(panel).toContainText('Grand Total')
    await expect(panel).toContainText('Bumpers')
  })
})
