import { test, expect, type Page } from '@playwright/test'
import type { BootedGame } from './game-test-handle'

test.setTimeout(180_000)
test.describe.configure({ mode: 'serial' })

type TestGame = BootedGame

/** AdventureMode's event callback is protected (TrackBuilder); the spec fires it to simulate zone events. */
type AdventureEventProbe = { onEvent?: (event: string, data?: unknown) => void }

async function bootGame(page: Page): Promise<void> {
  await page.goto('/')
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
    test.setTimeout(180_000)
    page = await browser.newPage()
    await bootGame(page)
  })

  test.afterAll(async () => {
    await page.close()
  })

  test('A -> B -> A success flow with portal entry advancement', async () => {
    const result = await page.evaluate(() => {
      const g = window.game as TestGame

      if (g.adventureMode?.isActive()) g.endAdventureMode()
      g.startAdventureMode()

      const callback = (g.adventureMode as unknown as AdventureEventProbe | undefined)?.onEvent
      const supervisor = g.adventureProgressionSupervisor
      const progression = g.adventureTrackProgression
      if (!callback || !supervisor || !progression) {
        throw new Error('Campaign systems are not initialized')
      }

      const simulateSuccessPortalEntry = (trackId: string, score: number) => {
        g.score = score
        supervisor.startTrack(trackId, 0)
        supervisor.update(0.1, score)
        callback('PORTAL_ENTERED', {
          id: `${trackId}-exit-portal`,
          trackId,
          kind: 'success',
          position: { x: 0, y: 0, z: 0 },
        })
      }

      // NEON_HELIX (A) -> PACHINKO_HALL (A hub)
      supervisor.startTrack('NEON_HELIX', 0)
      supervisor.update(0.1, 60_000)
      const firstPortalMessage = g.display?.storyText ?? ''
      callback('PORTAL_ENTERED', {
        id: 'NEON_HELIX-exit-portal',
        trackId: 'NEON_HELIX',
        kind: 'success',
        position: { x: 0, y: 0, z: 0 },
      })

      // PACHINKO_HALL (A) -> CYBER_CORE (B)
      simulateSuccessPortalEntry('PACHINKO_HALL', 100_000)
      simulateSuccessPortalEntry('CYBER_CORE', 140_000)

      return {
        firstPortalMessage,
        currentTrack: progression.getCurrentTrack?.() ?? null,
        neonCompleted: progression.isTrackCompleted('NEON_HELIX'),
        hallCompleted: progression.isTrackCompleted('PACHINKO_HALL'),
        cyberCompleted: progression.isTrackCompleted('CYBER_CORE'),
      }
    })

    expect(result.firstPortalMessage).toContain('PORTAL OPEN')
    expect(result.neonCompleted).toBe(true)
    expect(result.hallCompleted).toBe(true)
    expect(result.cyberCompleted).toBe(true)
    expect(result.currentTrack).toBe('QUANTUM_GRID')
  })

  test('timeout path opens emergency portal and applies penalized advance messaging', async () => {
    const result = await page.evaluate(() => {
      const g = window.game as TestGame

      if (g.adventureMode?.isActive()) g.endAdventureMode()
      g.startAdventureMode()

      const callback = (g.adventureMode as unknown as AdventureEventProbe | undefined)?.onEvent
      const supervisor = g.adventureProgressionSupervisor
      const progression = g.adventureTrackProgression
      if (!callback || !supervisor || !progression) {
        throw new Error('Campaign systems are not initialized')
      }

      const limit = progression.getTrackInfo?.('NEON_HELIX')?.timeLimitSeconds ?? 120
      // The page is shared across this describe: earlier tests already earned rewards.
      const rewardsBefore = progression.getStats?.().totalRewardsEarned ?? 0
      g.score = 1_000
      supervisor.startTrack('NEON_HELIX', 1_000)
      supervisor.update(limit + 1, 1_000)

      const storyText = g.display?.storyText ?? ''
      const overlayText = document.querySelector('#campaign-portal-overlay [data-testid="campaign-portal-headline"]')?.textContent ?? ''
      const timeoutMultiplier = supervisor.getActiveMultiplier?.() ?? 1

      callback('PORTAL_ENTERED', {
        id: 'NEON_HELIX-exit-portal',
        trackId: 'NEON_HELIX',
        kind: 'timeout',
        position: { x: 0, y: 0, z: 0 },
      })

      return {
        timeoutMultiplier,
        storyText,
        overlayText,
        completed: progression.isTrackCompleted('NEON_HELIX'),
        rewardsEarned: (progression.getStats?.().totalRewardsEarned ?? 0) - rewardsBefore,
      }
    })

    expect(result.timeoutMultiplier).toBeLessThan(1)
    expect(result.overlayText).toContain('TIME OUT')
    expect(result.storyText).toContain('REWARD PENALTY ACTIVE')
    expect(result.completed).toBe(true)
    expect(result.rewardsEarned).toBe(0)
  })

  test('countdown HUD shows urgency colors and respects reduced-motion pulse suppression', async () => {
    const timerState = await page.evaluate(() => {
      const g = window.game as TestGame
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

  test('reward toast appears and archive shows unlocked cosmetics after portal completion', async () => {
    const result = await page.evaluate(async () => {
      const g = window.game as TestGame
      if (g.adventureMode?.isActive()) g.endAdventureMode()
      g.startAdventureMode()

      const callback = (g.adventureMode as unknown as AdventureEventProbe | undefined)?.onEvent
      const supervisor = g.adventureProgressionSupervisor
      const progression = g.adventureTrackProgression
      if (!callback || !supervisor || !progression) {
        throw new Error('Campaign systems are not initialized')
      }

      supervisor.startTrack('NEON_HELIX', 0)
      supervisor.update(0.1, 62_000)
      g.score = 62_000
      callback('PORTAL_ENTERED', {
        id: 'NEON_HELIX-exit-portal',
        trackId: 'NEON_HELIX',
        kind: 'success',
        position: { x: 0, y: 0, z: 0 },
      })

      const toast = document.querySelector('[data-testid="campaign-reward-toast"]') as HTMLElement | null
      const toastText = toast?.textContent ?? ''

      // The stage map (which hosts the archive) is a lazily loaded chunk.
      await g.toggleCampaignMap?.()
      const archive = document.querySelector('[data-testid="campaign-archive-panel"]')
      const shardTotal = document.querySelector('[data-testid="campaign-shards-total"]')?.textContent ?? ''
      const unlockedCount = document.querySelectorAll('.campaign-archive-item.unlocked').length

      return {
        toastText,
        archiveVisible: archive !== null,
        shardTotal,
        unlockedCount,
      }
    })

    expect(result.toastText).toContain('Shards')
    expect(result.archiveVisible).toBe(true)
    expect(result.shardTotal.trim()).not.toBe('0 Shards')
    expect(result.unlockedCount).toBeGreaterThan(0)
  })

  test('jackpot starts multiball and shows multiplier indicator', async () => {
    const result = await page.evaluate(() => {
      const g = window.game as TestGame
      if (!g.eventBus || !g.ballManager) {
        throw new Error('Multiball systems are not initialized')
      }

      let startEvents = 0
      const unsubStart = g.eventBus.on('multiball:start', () => { startEvents++ })

      g.eventBus.emit('jackpot:start')

      const comboText = document.getElementById('combo')?.textContent ?? ''
      const chainStats = g.ballManager.getChainStats?.()

      unsubStart()

      return {
        startEvents,
        comboText,
        multiballActive: chainStats?.isActive ?? false,
        scoreMultiplier: chainStats?.scoreMultiplier ?? 1,
      }
    })

    expect(result.startEvents).toBeGreaterThan(0)
    expect(result.multiballActive).toBe(true)
    expect(result.scoreMultiplier).toBeGreaterThan(1)
    expect(result.comboText).toContain('MB x')
  })

  test('combo chain meter renders with visible progress pips', async () => {
    const result = await page.evaluate(() => {
      const g = window.game as TestGame
      if (!g.uiManager?.updateComboChainMeter) {
        throw new Error('Combo chain HUD is not initialized')
      }

      g.uiManager.updateComboChainMeter(3, 3, true)
      const meter = document.querySelector('[data-testid="combo-chain-meter"]') as HTMLElement | null
      const filledPips = meter?.querySelectorAll('span span').length ?? 0

      return {
        visible: meter !== null,
        text: meter?.textContent ?? '',
        filledPips,
      }
    })

    expect(result.visible).toBe(true)
    expect(result.text).toContain('CHAIN')
    expect(result.text).toContain('x3')
    expect(result.filledPips).toBeGreaterThan(0)
  })
})
