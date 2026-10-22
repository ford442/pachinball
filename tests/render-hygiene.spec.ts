import { expect, test, type Page } from '@playwright/test'

/**
 * Real-engine checks for the render-hygiene sprint (#443). The Vitest suite mocks Babylon, so
 * anything that depends on how the engine actually behaves (filter modes, shader compiles,
 * render-list contents) is asserted here, on the WebGL2 path under SwiftShader.
 */

interface ShadowGeneratorProbe {
  filter: number
  filteringQuality: number
  mapSize: number
  getShadowMap: () => { renderList: Array<{ name: string }> } | null
  constructor: { FILTER_PCF: number; FILTER_BLUREXPONENTIALSHADOWMAP: number; QUALITY_MEDIUM: number }
}

interface GameProbe {
  ready?: boolean
  qualityTier: string
  scene: {
    onAfterRenderObservable: { addOnce: (cb: () => void) => void }
  }
  shadowGenerator: ShadowGeneratorProbe | null
  renderer: { applyQualityTier: (tier: string) => void; dropQualityTierOnce: () => string }
  performanceMonitor: { setOnSustainedJank: (cb: (() => void) | null) => void }
}

type ProbeWindow = Window & { game?: GameProbe }

/** Console messages that mean a shader failed to build — the #427 failure signature. */
const COMPILE_ERROR = /Error compiling effect|Unable to compile effect|Shader compilation/i

function trackCompileErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (msg) => {
    const text = msg.text()
    if (COMPILE_ERROR.test(text)) errors.push(text)
  })
  page.on('pageerror', (err) => {
    if (COMPILE_ERROR.test(err.message)) errors.push(err.message)
  })
  return errors
}

async function boot(page: Page): Promise<void> {
  await page.goto('/?renderer=webgl2&debug=1')
  await expect(page.locator('#start-btn')).toBeVisible({ timeout: 60_000 })
  await page.waitForFunction(() => !!(window as ProbeWindow).game?.ready, undefined, { timeout: 90_000 })
}

/** Resolve after `n` fully rendered frames, so deferred (post-render) work has run. */
async function renderFrames(page: Page, n: number): Promise<void> {
  await page.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        const scene = (window as ProbeWindow).game!.scene
        let left = count
        const tick = (): void => {
          if (--left <= 0) resolve()
          else scene.onAfterRenderObservable.addOnce(tick)
        }
        scene.onAfterRenderObservable.addOnce(tick)
      }),
    n,
  )
}

async function shadowState(page: Page) {
  return page.evaluate(() => {
    const game = (window as ProbeWindow).game!
    const sg = game.shadowGenerator!
    const ctor = sg.constructor
    return {
      tier: game.qualityTier,
      filter: sg.filter,
      isPcf: sg.filter === ctor.FILTER_PCF,
      isBlurEsm: sg.filter === ctor.FILTER_BLUREXPONENTIALSHADOWMAP,
      pcfQualityIsMedium: sg.filteringQuality === ctor.QUALITY_MEDIUM,
      mapSize: sg.mapSize,
      casters: sg.getShadowMap()!.renderList.map((m) => m.name),
    }
  })
}

test.describe('render hygiene (#443)', () => {
  test.setTimeout(300_000)

  test('runs exactly one shadow filter per tier, applies tier switches, and ground is not a caster', async ({ page }) => {
    const compileErrors = trackCompileErrors(page)
    await boot(page)
    // The one-shot sustained-jank handler would otherwise drop the tier under us (SwiftShader
    // runs at a few fps). Tiers below are all driven explicitly.
    await page.evaluate(() => (window as ProbeWindow).game!.performanceMonitor.setOnSustainedJank(null))
    await renderFrames(page, 3)

    const casters = (await shadowState(page)).casters
    // ground stays a receiver only.
    expect(casters).not.toContain('lcdGround')
    expect(casters).not.toContain('ground')

    for (const [tier, expectPcf] of [
      ['high', true],
      ['medium', false],
      ['high', true],
      ['low', false],
      ['high', true],
    ] as const) {
      await page.evaluate((t) => (window as ProbeWindow).game!.renderer.applyQualityTier(t), tier)
      await renderFrames(page, 3)
      const s = await shadowState(page)
      expect(s.tier).toBe(tier)
      expect(s.isPcf, `${tier}: PCF`).toBe(expectPcf)
      expect(s.isBlurEsm, `${tier}: blur ESM`).toBe(!expectPcf)
      if (expectPcf) expect(s.pcfQualityIsMedium).toBe(true)
      expect(s.mapSize).toBe(2048)
    }

    // The automatic one-step drop (PerformanceMonitor -> renderer.dropQualityTierOnce) is a
    // separate path from applyQualityTier and must move the filter too.
    await page.evaluate(() => (window as ProbeWindow).game!.renderer.applyQualityTier('high'))
    for (const expected of ['medium', 'low'] as const) {
      await page.evaluate(() => (window as ProbeWindow).game!.renderer.dropQualityTierOnce())
      await renderFrames(page, 3)
      const s = await shadowState(page)
      expect(s.tier).toBe(expected)
      expect(s.isBlurEsm, `drop to ${expected}: blur ESM`).toBe(true)
    }

    expect(compileErrors, 'no shader compile errors across tier switches').toEqual([])
  })
})
