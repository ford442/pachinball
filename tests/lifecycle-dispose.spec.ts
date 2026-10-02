import { test, expect, type CDPSession, type Page } from '@playwright/test'

/**
 * #441 — a Game must tear itself down completely.
 *
 * Counts the event listeners left on window / document / the game canvas (via CDP
 * DOMDebugger.getEventListeners), disposes the page's Game twice, builds and disposes a
 * second Game on the same engine, and asserts the second teardown leaves exactly the
 * same listeners behind as the first. A leak per Game would show up as a growing count.
 */

type ListenerCounts = Record<'window' | 'document' | 'canvas', Record<string, number>>

const TARGETS: Record<keyof ListenerCounts, string> = {
  window: 'window',
  document: 'document',
  canvas: 'document.querySelector("canvas")',
}

async function countListeners(cdp: CDPSession): Promise<ListenerCounts> {
  const counts = {} as ListenerCounts
  for (const [name, expression] of Object.entries(TARGETS) as Array<[keyof ListenerCounts, string]>) {
    const { result } = await cdp.send('Runtime.evaluate', { expression, objectGroup: 'lifecycle-dispose' })
    const byType: Record<string, number> = {}
    if (result.objectId) {
      const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId })
      for (const listener of listeners) byType[listener.type] = (byType[listener.type] ?? 0) + 1
    }
    counts[name] = byType
  }
  await cdp.send('Runtime.releaseObjectGroup', { objectGroup: 'lifecycle-dispose' })
  return counts
}

const total = (counts: ListenerCounts): number =>
  Object.values(counts).reduce((sum, byType) => sum + Object.values(byType).reduce((a, b) => a + b, 0), 0)

async function bootGame(page: Page): Promise<void> {
  await page.goto('/?renderer=webgl2')
  await expect(page.locator('#start-btn')).toBeVisible({ timeout: 10_000 })
  await expect
    .poll(() => page.evaluate(() => !!(window as any).game?.ready), { intervals: [200], timeout: 30_000 })
    .toBe(true)
}

test.describe('Game lifecycle', () => {
  test('dispose() twice, then a new Game, leaves no listeners behind', async ({ page }) => {
    test.setTimeout(180_000)

    const pageErrors: string[] = []
    page.on('pageerror', (err) => pageErrors.push(err.message))

    await bootGame(page)
    const cdp = await page.context().newCDPSession(page)
    const live = await countListeners(cdp)

    // First teardown. The second call must be a harmless no-op.
    await page.evaluate(() => {
      const game = (window as any).game
      game.dispose()
      game.dispose()
    })
    const floor1 = await countListeners(cdp)
    expect(total(floor1), 'dispose() should remove listeners').toBeLessThan(total(live))

    // A second Game on the same engine, then its teardown.
    await page.evaluate(async () => {
      const { Game } = await import('/src/game.ts')
      const engine = (window as any).game.engine
      const second = new Game(engine)
      await second.init()
      ;(window as any).secondGame = second
    })
    const live2 = await countListeners(cdp)
    expect(total(live2), 'a second Game should register its own listeners').toBeGreaterThan(total(floor1))

    await page.evaluate(() => (window as any).secondGame.dispose())
    const floor2 = await countListeners(cdp)
    expect(floor2).toEqual(floor1)

    // Give any timer that outlived dispose() a chance to fire and throw.
    await page.waitForTimeout(4000)
    expect(pageErrors).toEqual([])
  })
})
