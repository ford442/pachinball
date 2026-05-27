import { test, expect, type Page } from '@playwright/test'

test.setTimeout(180_000)
test.describe.configure({ mode: 'serial' })

interface TestAdventureMode {
  isActive: () => boolean
  onEvent?: (event: string, data?: unknown) => void
}

interface TestGame {
  score: number
  display?: { storyText?: string }
  adventureMode?: TestAdventureMode
  endAdventureMode: () => void
  startAdventureMode: () => void
  adventureProgressionSupervisor?: {
    startTrack: (trackId: string, initialScore?: number) => void
    update: (dt: number, currentScore: number) => void
    getActiveMultiplier?: () => number
  }
  adventureTrackProgression?: {
    getCurrentTrack?: () => string
    isTrackCompleted: (trackId: string) => boolean
    getTrackInfo?: (trackId: string) => { timeLimitSeconds: number } | null
    getStats?: () => { totalRewardsEarned: number }
  }
  uiManager?: {
    updateCountdownTimer: (remaining: number, limit: number) => void
    hideCountdownTimer: () => void
    prefersReducedMotion?: boolean
  }
}

async function bootGame(page: Page): Promise<void> {
  await page.goto('http://localhost:5173')
  const startBtn = page.locator('#start-btn')
  await expect(startBtn).toBeVisible({ timeout: 30_000 })
  await startBtn.click()
  await page.waitForFunction(() => {
    const g = (window as unknown as Record<string, unknown>).game as
      | { eventBus?: unknown; adventureProgressionSupervisor?: unknown; adventureTrackProgression?: unknown }
      | undefined
    return g != null && g.eventBus != null && g.adventureProgressionSupervisor != null && g.adventureTrackProgression != null
  }, { timeout: 60_000 })
}

test.describe('Campaign progression E2E', () => {
  let page: Page

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage()
    await bootGame(page)
  })

  test.afterAll(async () => {
    await page.close()
  })

  test('A -> B -> A success flow with portal entry advancement', async () => {
    const result = await page.evaluate(() => {
      const g = (window as unknown as Record<string, unknown>).game as TestGame

      if (g.adventureMode?.isActive()) g.endAdventureMode()
      g.startAdventureMode()

      const callback = g.adventureMode?.onEvent
      const supervisor = g.adventureProgressionSupervisor
      const progression = g.adventureTrackProgression
      if (!callback || !supervisor || !progression) {
        throw new Error('Campaign systems are not initialized')
      }

      const simulateSuccessPortalEntry = (trackId: string, nextTrack: string, score: number) => {
        g.score = score
        supervisor.startTrack(trackId, 0)
        supervisor.update(0.1, score)
        callback('PORTAL_ENTERED', {
          id: `${trackId}-exit-portal`,
          trackId,
          nextTrack,
          kind: 'success',
          position: { x: 0, y: 0, z: 0 },
          teleportPosition: { x: 1, y: 0, z: 1 },
        })
      }

      // NEON_HELIX (A) -> CYBER_CORE (B)
      supervisor.startTrack('NEON_HELIX', 0)
      supervisor.update(0.1, 60_000)
      const firstPortalMessage = g.display?.storyText ?? ''
      callback('PORTAL_ENTERED', {
        id: 'NEON_HELIX-exit-portal',
        trackId: 'NEON_HELIX',
        nextTrack: 'CYBER_CORE',
        kind: 'success',
        position: { x: 0, y: 0, z: 0 },
        teleportPosition: { x: 1, y: 0, z: 1 },
      })

      // CYBER_CORE (B) -> QUANTUM_GRID (A)
      simulateSuccessPortalEntry('CYBER_CORE', 'QUANTUM_GRID', 140_000)

      return {
        firstPortalMessage,
        currentTrack: progression.getCurrentTrack?.() ?? null,
        neonCompleted: progression.isTrackCompleted('NEON_HELIX'),
        cyberCompleted: progression.isTrackCompleted('CYBER_CORE'),
      }
    })

    expect(result.firstPortalMessage).toContain('PORTAL OPEN')
    expect(result.neonCompleted).toBe(true)
    expect(result.cyberCompleted).toBe(true)
    expect(result.currentTrack).toBe('QUANTUM_GRID')
  })

  test('timeout path opens emergency portal and applies penalized advance messaging', async () => {
    const result = await page.evaluate(() => {
      const g = (window as unknown as Record<string, unknown>).game as TestGame

      if (g.adventureMode?.isActive()) g.endAdventureMode()
      g.startAdventureMode()

      const callback = g.adventureMode?.onEvent
      const supervisor = g.adventureProgressionSupervisor
      const progression = g.adventureTrackProgression
      if (!callback || !supervisor || !progression) {
        throw new Error('Campaign systems are not initialized')
      }

      const limit = progression.getTrackInfo?.('NEON_HELIX')?.timeLimitSeconds ?? 120
      g.score = 1_000
      supervisor.startTrack('NEON_HELIX', 1_000)
      supervisor.update(limit + 1, 1_000)

      const storyText = g.display?.storyText ?? ''
      const overlayText = document.querySelector('#campaign-portal-overlay [data-testid="campaign-portal-headline"]')?.textContent ?? ''
      const timeoutMultiplier = supervisor.getActiveMultiplier?.() ?? 1

      callback('PORTAL_ENTERED', {
        id: 'NEON_HELIX-exit-portal',
        trackId: 'NEON_HELIX',
        nextTrack: 'CYBER_CORE',
        kind: 'timeout',
        position: { x: 0, y: 0, z: 0 },
        teleportPosition: { x: 1, y: 0, z: 1 },
      })

      return {
        timeoutMultiplier,
        storyText,
        overlayText,
        completed: progression.isTrackCompleted('NEON_HELIX'),
        totalRewardsEarned: progression.getStats?.().totalRewardsEarned ?? 0,
      }
    })

    expect(result.timeoutMultiplier).toBeLessThan(1)
    expect(result.overlayText).toContain('TIME OUT')
    expect(result.storyText).toContain('REWARD PENALTY ACTIVE')
    expect(result.completed).toBe(true)
    expect(result.totalRewardsEarned).toBe(0)
  })

  test('countdown HUD shows urgency colors and respects reduced-motion pulse suppression', async () => {
    const timerState = await page.evaluate(() => {
      const g = (window as unknown as Record<string, unknown>).game as TestGame
      const ui = g.uiManager
      if (!ui) throw new Error('UI manager not available')

      ui.updateCountdownTimer(90, 100)
      const timer = document.getElementById('campaign-countdown-timer')
      if (!timer) throw new Error('Countdown timer not visible')
      const safeColor = window.getComputedStyle(timer).color

      ui.updateCountdownTimer(40, 100)
      const cautionColor = window.getComputedStyle(timer).color

      ui.updateCountdownTimer(20, 100)
      const warningColor = window.getComputedStyle(timer).color

      ui.prefersReducedMotion = false
      ui.updateCountdownTimer(10, 100)
      const dangerAnimation = timer.style.animation
      const dangerColor = window.getComputedStyle(timer).color

      ui.prefersReducedMotion = true
      ui.updateCountdownTimer(10, 100)
      const reducedMotionAnimation = timer.style.animation

      ui.hideCountdownTimer()

      return {
        safeColor,
        cautionColor,
        warningColor,
        dangerColor,
        dangerAnimation,
        reducedMotionAnimation,
      }
    })

    expect(timerState.safeColor).not.toBe(timerState.cautionColor)
    expect(timerState.cautionColor).not.toBe(timerState.warningColor)
    expect(timerState.warningColor).not.toBe(timerState.dangerColor)
    expect(timerState.dangerAnimation).toContain('campaignTimerPulse')
    expect(timerState.reducedMotionAnimation).toBe('')
  })
})
