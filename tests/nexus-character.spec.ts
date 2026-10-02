import { test, expect, type Page } from '@playwright/test'

// Nexus character take: poster load drives the emoji walk-by; 404 keeps the
// walk-by; reduced motion keeps the poster static (no loop video element).
test.setTimeout(180_000)

interface TakeStatus { poster: string; loop: string; takeActive: boolean }
interface WalkBy { characterTakeActive: boolean; active: boolean; eligible: boolean }

async function bootDisplay(page: Page): Promise<void> {
  await page.goto('http://localhost:5173/?renderer=webgl2')
  await page.waitForFunction(() => {
    const g = (window as unknown as { game?: { display?: { getCharacterTakeStatus?: unknown } } }).game
    return typeof g?.display?.getCharacterTakeStatus === 'function'
  }, undefined, { timeout: 90_000 })
}

async function setState(page: Page, state: string): Promise<void> {
  await page.evaluate((s) => {
    const g = (window as unknown as { game: { eventBus: { emit: (e: string, p: string) => void } } }).game
    g.eventBus.emit('display:set', s)
  }, state)
}

function status(page: Page): Promise<TakeStatus> {
  return page.evaluate(() =>
    (window as unknown as { game: { display: { getCharacterTakeStatus: () => TakeStatus } } }).game.display.getCharacterTakeStatus(),
  )
}

function walkBy(page: Page): Promise<WalkBy> {
  return page.evaluate(() =>
    (window as unknown as { game: { display: { getWalkByDebug: () => WalkBy } } }).game.display.getWalkByDebug(),
  )
}

test('REACH poster loads and suppresses the emoji walk-by', async ({ page }) => {
  await bootDisplay(page)
  await setState(page, 'reach')
  await expect.poll(() => status(page), { timeout: 90_000 }).toMatchObject({ poster: 'loaded', takeActive: true })
  expect((await walkBy(page)).characterTakeActive).toBe(true)
})

test('404 posters fall back to the emoji walk-by', async ({ page }) => {
  await page.route('**/backbox/nexus/*', (route) => route.fulfill({ status: 404, body: '' }))
  await bootDisplay(page)
  await expect.poll(async () => (await status(page)).poster, { timeout: 90_000 }).toBe('failed')
  const idle = await walkBy(page)
  expect(idle.characterTakeActive).toBe(false)
  expect(idle.eligible).toBe(true)

  await setState(page, 'reach')
  await expect.poll(() => status(page), { timeout: 90_000 }).toMatchObject({ poster: 'failed', takeActive: false })
  expect((await walkBy(page)).eligible).toBe(true)
})

test('reduced motion keeps the idle poster static', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' })
  const page = await context.newPage()
  try {
    await bootDisplay(page)
    await expect.poll(() => status(page), { timeout: 90_000 }).toMatchObject({ poster: 'loaded', loop: 'skipped' })
    const loopVideos = await page.evaluate(
      () => Array.from(document.querySelectorAll('video')).filter((v) => v.src.includes('/nexus/')).length,
    )
    expect(loopVideos).toBe(0)
  } finally {
    await context.close()
  }
})
