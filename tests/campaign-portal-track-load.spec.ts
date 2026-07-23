import { test, expect, type Page } from '@playwright/test'

test.setTimeout(180_000)

interface TestGame {
  adventureMode?: {
    isActive: () => boolean
    getCurrentZone: () => string | null
    getLastTeardownStats?: () => { lingeringBodies: number; meshesDisposed?: number } | null
  }
  adventureTrackProgression?: {
    getCurrentTrack: () => string
    isTrackCompleted: (id: string) => boolean
  }
  adventureProgressionSupervisor?: {
    startTrack: (trackId: string, initialScore?: number) => void
    update: (dt: number, score: number) => void
    isPortalOpen: () => boolean
    onPortalEntered: (finalScore: number, goldBalls: number) => void
  }
  levelLoader?: {
    loadCampaignTrack: (trackId: string, options?: { resetBallToPlunger?: boolean }) => { success: boolean }
  }
  eventBus?: {
    on: (event: string, handler: (payload: unknown) => void) => () => void
    emit: (event: string, payload?: unknown) => void
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

test.describe('Campaign portal → track load E2E', () => {
  test('loads next track via LevelLoader with clean teardown stats', async ({ page }) => {
    await bootGame(page)

    const result = await page.evaluate(async () => {
      const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
      const g = (window as unknown as Record<string, unknown>).game as TestGame & {
        sessionGoldBalls?: number
      }

      if (g.adventureMode?.isActive()) g.endAdventureMode()
      g.startAdventureMode()
      await wait(400)

      const loader = g.levelLoader
      const supervisor = g.adventureProgressionSupervisor
      const adventureMode = g.adventureMode
      if (!loader || !supervisor || !adventureMode) {
        throw new Error('Campaign systems not initialized')
      }

      supervisor.startTrack('NEON_HELIX', 0)
      supervisor.update(0.1, 55_000)
      const portalOpenBeforeEntry = supervisor.isPortalOpen()
      supervisor.onPortalEntered(55_000, g.sessionGoldBalls ?? 0)
      await wait(500)

      const teardown = adventureMode.getLastTeardownStats?.() ?? null

      return {
        portalOpenBeforeEntry,
        currentZone: adventureMode.getCurrentZone(),
        lingeringBodies: teardown?.lingeringBodies ?? -1,
        meshesDisposed: teardown?.meshesDisposed ?? -1,
      }
    })

    expect(result.portalOpenBeforeEntry).toBe(true)
    expect(result.currentZone).toBe('PACHINKO_HALL')
    expect(result.lingeringBodies).toBe(0)
    expect(result.meshesDisposed).toBeGreaterThanOrEqual(0)
  })

  test('portal entered advances progression and persists current track', async ({ page }) => {
    await bootGame(page)

    const result = await page.evaluate(() => {
      const g = (window as unknown as Record<string, unknown>).game as TestGame & {
        sessionGoldBalls?: number
      }

      if (g.adventureMode?.isActive()) g.endAdventureMode()
      g.startAdventureMode()

      const supervisor = g.adventureProgressionSupervisor
      const progression = g.adventureTrackProgression
      if (!supervisor || !progression) {
        throw new Error('Campaign systems not initialized')
      }

      supervisor.startTrack('NEON_HELIX', 0)
      supervisor.update(0.1, 55_000)
      supervisor.onPortalEntered(55_000, g.sessionGoldBalls ?? 0)

      const stored = localStorage.getItem('pachinball.campaign.rewards.v1')
      const parsed = stored ? JSON.parse(stored) as { progression?: { currentTrack?: string } } : null

      return {
        neonCompleted: progression.isTrackCompleted('NEON_HELIX'),
        currentTrack: progression.getCurrentTrack(),
        persistedTrack: parsed?.progression?.currentTrack ?? null,
      }
    })

    expect(result.neonCompleted).toBe(true)
    expect(result.currentTrack).toBe('PACHINKO_HALL')
    expect(result.persistedTrack).toBe('PACHINKO_HALL')
  })
})