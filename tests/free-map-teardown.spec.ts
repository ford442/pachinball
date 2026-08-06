import { test, expect, type Page } from '@playwright/test'

test.setTimeout(180_000)

interface TestGame {
  adventureMode?: {
    isActive: () => boolean
    getCurrentZone: () => string | null
    getLastTeardownStats?: () => {
      lingeringBodies: number
      exitPortalsRemoved?: number
      meshesDisposed?: number
      bodiesRemoved?: number
    } | null
  }
  freeMapTestMode?: {
    loadById: (id: string) => boolean
  }
  toggleFreeMapTestMode?: () => void
  levelLoader?: {
    loadCampaignTrack: (trackId: string, options?: { resetBallToPlunger?: boolean }) => {
      success: boolean
      teardown?: { lingeringBodies: number; exitPortalsRemoved?: number } | null
    }
  }
  endAdventureMode: () => void
  startAdventureMode: () => void
}

async function bootGame(page: Page): Promise<void> {
  await page.goto('http://localhost:5173/?renderer=webgl2')
  const startBtn = page.locator('#start-btn')
  await expect(startBtn).toBeVisible({ timeout: 30_000 })

  await expect.poll(async () => {
    return page.evaluate(() => !!(window as unknown as { game?: { stateManager?: unknown } }).game?.stateManager)
  }, { intervals: [200], timeout: 15_000 }).toBe(true)

  await page.evaluate(() => {
    document.getElementById('start-btn')?.click()
  })

  await expect.poll(async () => {
    const gs = await page.evaluate(() => {
      const g = (window as unknown as { game?: { stateManager?: { getState?: () => number; isPlaying?: () => boolean } } }).game
      return {
        state: g?.stateManager?.getState?.() ?? -1,
        isPlaying: g?.stateManager?.isPlaying?.() ?? false,
        ready: g != null && 'levelLoader' in (g as object) && 'adventureMode' in (g as object),
      }
    })
    return gs
  }, { intervals: [200], timeout: 60_000 }).toEqual(expect.objectContaining({
    state: 2,
    isPlaying: true,
    ready: true,
  }))
}

test.describe('Free-map playfield load E2E', () => {
  test('cycles tracks via free-map with clean teardown stats', async ({ page }) => {
    await bootGame(page)

    const result = await page.evaluate(async () => {
      const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
      const g = (window as unknown as Record<string, unknown>).game as TestGame

      if (g.adventureMode?.isActive()) g.endAdventureMode()
      g.startAdventureMode()
      await wait(300)

      g.toggleFreeMapTestMode?.()
      await wait(200)

      const loaded = g.freeMapTestMode?.loadById('CYBER_CORE') ?? false
      await wait(400)

      const teardown = g.adventureMode?.getLastTeardownStats?.() ?? null
      const zone = g.adventureMode?.getCurrentZone() ?? null

      return {
        loaded,
        zone,
        lingeringBodies: teardown?.lingeringBodies ?? -1,
        meshesDisposed: teardown?.meshesDisposed ?? -1,
        bodiesRemoved: teardown?.bodiesRemoved ?? -1,
      }
    })

    expect(result.loaded).toBe(true)
    expect(result.zone).toBe('CYBER_CORE')
    expect(result.lingeringBodies).toBe(0)
    expect(result.meshesDisposed).toBeGreaterThanOrEqual(0)
    expect(result.bodiesRemoved).toBeGreaterThanOrEqual(0)
  })

  test('double free-map load does not accumulate lingering bodies', async ({ page }) => {
    await bootGame(page)

    const result = await page.evaluate(async () => {
      const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
      const g = (window as unknown as Record<string, unknown>).game as TestGame
      const loader = g.levelLoader
      const adventureMode = g.adventureMode
      if (!loader || !adventureMode) throw new Error('Systems not initialized')

      if (adventureMode.isActive()) g.endAdventureMode()
      g.startAdventureMode()
      await wait(300)

      loader.loadCampaignTrack('NEON_HELIX', { resetBallToPlunger: true })
      await wait(300)
      const first = adventureMode.getLastTeardownStats?.() ?? null

      loader.loadCampaignTrack('QUANTUM_GRID', { resetBallToPlunger: true })
      await wait(300)
      const second = adventureMode.getLastTeardownStats?.() ?? null

      return {
        firstLingering: first?.lingeringBodies ?? -1,
        secondLingering: second?.lingeringBodies ?? -1,
        finalZone: adventureMode.getCurrentZone(),
      }
    })

    expect(result.firstLingering).toBe(0)
    expect(result.secondLingering).toBe(0)
    expect(result.finalZone).toBe('QUANTUM_GRID')
  })
})
