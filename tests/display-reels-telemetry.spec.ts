import { test, expect, type Page } from '@playwright/test'

/**
 * Phase 1 telemetry capture for issue #261 (canvas reel draw/upload budget).
 * Records numbers for WebGPU + WebGL2 and a jackpot stress sample.
 */

test.setTimeout(180_000)

type ReelsTelemetry = {
  enabled: boolean
  budgetMs: number
  frameCount: number
  spinFrameCount: number
  budgetExceededCount: number
  spinBudgetExceededCount: number
  spinAvg: { drawMs: number; uploadMs: number; totalMs: number }
  spinMax: { drawMs: number; uploadMs: number; totalMs: number }
}

type MeasurementResult = {
  requestedRenderer: string
  renderer: string
  scenario: string
  telemetry: ReelsTelemetry
}

const MIN_SPIN_FRAMES = 1

async function bootGame(page: Page, renderer: 'webgl2' | 'webgpu'): Promise<void> {
  await page.goto(`http://localhost:5173/?renderer=${renderer}`)
  await page.evaluate(() => {
    localStorage.setItem('debug:reels-telemetry', 'true')
  })
  await page.reload()

  await page.waitForFunction(() => {
    const g = (window as unknown as Record<string, unknown>).game as
      | { display?: unknown }
      | undefined
    return g != null && g.display != null
  }, { timeout: 90_000 })

  const startBtn = page.locator('#start-btn')
  await expect(startBtn).toBeVisible({ timeout: 30_000 })
  await startBtn.click({ force: true })

  await page.waitForFunction(() => {
    const w = window as unknown as {
      game?: {
        display?: { debugStartReelsBenchmarkSpin?: () => void }
        stateManager?: { getState: () => number }
      }
    }
    return (
      typeof w.game?.display?.debugStartReelsBenchmarkSpin === 'function' &&
      w.game?.stateManager?.getState() === 2
    )
  }, { timeout: 30_000 })
}

async function captureSpinTelemetry(page: Page, scenario: 'idle-spin' | 'jackpot-stress'): Promise<ReelsTelemetry> {
  const spinStarted = await page.evaluate((mode) => {
    const g = (window as unknown as Record<string, unknown>).game as {
      display: {
        resetReelsTelemetry: () => void
        setReelsTelemetryEnabled: (v: boolean) => void
        isReelsSpinning: () => boolean
        debugStartReelsBenchmarkSpin: () => void
      }
      eventBus: { emit: (event: string, payload?: string) => void }
      triggerJackpot?: () => void
    }

    g.display.resetReelsTelemetry()
    g.display.setReelsTelemetryEnabled(true)

    if (mode === 'jackpot-stress') {
      g.eventBus.emit('display:set', 'jackpot')
      g.triggerJackpot?.()
    } else {
      g.eventBus.emit('display:set', 'reach')
    }

    g.display.debugStartReelsBenchmarkSpin()
    return g.display.isReelsSpinning()
  }, scenario)

  expect(spinStarted).toBe(true)

  // Benchmark spin is 2.0 s + staggered stops; allow spring settle.
  await page.waitForTimeout(3_500)

  return page.evaluate(() => {
    const g = (window as unknown as Record<string, unknown>).game as {
      display: { getReelsTelemetry: () => ReelsTelemetry }
    }
    return g.display.getReelsTelemetry()
  })
}

async function getRendererBackend(page: Page): Promise<string> {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas')
    return canvas?.getAttribute('data-renderer') ?? (window as unknown as { currentRenderer?: string }).currentRenderer ?? 'unknown'
  })
}

test.describe.configure({ mode: 'serial' })

test.describe('Display reels canvas telemetry (#261 Phase 1)', () => {
  const results: MeasurementResult[] = []

  test.afterAll(() => {
    console.log('\n[ReelsTelemetry] Phase 1 measurement summary:')
    for (const row of results) {
      const t = row.telemetry
      console.log(
        `  ${row.requestedRenderer}→${row.renderer} / ${row.scenario}: ` +
          `frames=${t.frameCount} spinFrames=${t.spinFrameCount} ` +
          `spinAvg draw=${t.spinAvg.drawMs.toFixed(3)}ms ` +
          `upload=${t.spinAvg.uploadMs.toFixed(3)}ms total=${t.spinAvg.totalMs.toFixed(3)}ms | ` +
          `spinMax total=${t.spinMax.totalMs.toFixed(3)}ms | ` +
          `budgetExceeded=${t.spinBudgetExceededCount}/${t.spinFrameCount}`
      )
    }
  })

  for (const renderer of ['webgl2', 'webgpu'] as const) {
    test(`${renderer}: idle spin telemetry`, async ({ page }) => {
      await bootGame(page, renderer)
      const rendererBackend = await getRendererBackend(page)

      const telemetry = await captureSpinTelemetry(page, 'idle-spin')
      results.push({
        requestedRenderer: renderer,
        renderer: rendererBackend,
        scenario: 'idle-spin',
        telemetry,
      })

      expect(telemetry.enabled).toBe(true)
      expect(telemetry.spinFrameCount).toBeGreaterThan(0)
      expect(telemetry.spinMax.totalMs).toBeLessThan(telemetry.budgetMs * 5)
    })
  }

  test('webgl2: jackpot stress spin telemetry', async ({ page }) => {
    await bootGame(page, 'webgl2')
    const rendererBackend = await getRendererBackend(page)

    const telemetry = await captureSpinTelemetry(page, 'jackpot-stress')
    results.push({
      requestedRenderer: 'webgl2',
      renderer: rendererBackend,
      scenario: 'jackpot-stress',
      telemetry,
    })

    expect(telemetry.spinFrameCount).toBeGreaterThan(0)
    // Stress sample records spikes for the Phase 1 decision doc; it is allowed to exceed budget.
    expect(telemetry.spinMax.totalMs).toBeGreaterThan(0)
  })
})
