import { test, expect, type Page } from '@playwright/test'

test.setTimeout(180_000)

interface TestGame {
  adventureMode?: {
    isActive: () => boolean
    getCurrentZone: () => string | null
    getLastTeardownStats?: () => { lingeringBodies: number } | null
  }
  adventureTrackProgression?: {
    getCurrentTrack: () => string
    isTrackCompleted: (id: string) => boolean
  }
  adventureProgressionSupervisor?: {
    startTrack: (trackId: string, initialScore?: number) => void
    update: (dt: number, score: number) => void
    isPortalOpen: () => boolean
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
  await startBtn.click()
  await page.waitForFunction(() => {
    const g = (window as unknown as Record<string, unknown>).game as TestGame | undefined
    return g != null && g.levelLoader != null && g.adventureMode != null
  }, { timeout: 60_000 })
}

test.describe('Campaign portal → track load E2E', () => {
  test('loads next track via LevelLoader with clean teardown stats', async ({ page }) => {
    await bootGame(page)

    const result = await page.evaluate(() => {
      const g = (window as unknown as Record<string, unknown>).game as TestGame
      if (g.adventureMode?.isActive()) g.endAdventureMode()
      g.startAdventureMode()

      const loader = g.levelLoader
      const supervisor = g.adventureProgressionSupervisor
      const progression = g.adventureTrackProgression
      const adventureMode = g.adventureMode
      if (!loader || !supervisor || !progression || !adventureMode) {
        throw new Error('Campaign systems not initialized')
      }

      supervisor.startTrack('NEON_HELIX', 0)
      supervisor.update(0.1, 55_000)

      const portalOpenBeforeLoad = supervisor.isPortalOpen()
      const loadResult = loader.loadCampaignTrack('PACHINKO_HALL', { resetBallToPlunger: false })
      const teardown = adventureMode.getLastTeardownStats?.() ?? null

      return {
        portalOpenBeforeLoad,
        loadSuccess: loadResult.success,
        currentZone: adventureMode.getCurrentZone(),
        lingeringBodies: teardown?.lingeringBodies ?? -1,
      }
    })

    expect(result.portalOpenBeforeLoad).toBe(true)
    expect(result.loadSuccess).toBe(true)
    expect(result.currentZone).toBe('PACHINKO_HALL')
    expect(result.lingeringBodies).toBe(0)
  })

  test('portal entered advances progression and persists current track', async ({ page }) => {
    await bootGame(page)

    const result = await page.evaluate(() => {
      const g = (window as unknown as Record<string, unknown>).game as TestGame & {
        adventureMode?: TestGame['adventureMode'] & { onEvent?: (event: string, data?: unknown) => void }
      }

      if (g.adventureMode?.isActive()) g.endAdventureMode()
      g.startAdventureMode()

      const callback = g.adventureMode?.onEvent
      const supervisor = g.adventureProgressionSupervisor
      const progression = g.adventureTrackProgression
      if (!callback || !supervisor || !progression) {
        throw new Error('Campaign systems not initialized')
      }

      supervisor.startTrack('NEON_HELIX', 0)
      supervisor.update(0.1, 55_000)
      callback('PORTAL_ENTERED', {
        id: 'NEON_HELIX-exit-portal',
        trackId: 'NEON_HELIX',
        kind: 'success',
        position: { x: 0, y: 0, z: 0 },
      })

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