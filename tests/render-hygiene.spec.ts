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
    onAfterRenderObservable: {
      add: (cb: () => void) => unknown
      addOnce: (cb: () => void) => void
      remove: (observer: unknown) => void
    }
    prePassRenderer: { renderTargets: unknown[] } | null
    geometryBufferRenderer: unknown
    materials: unknown[]
    postProcessRenderPipelineManager: { _renderPipelines: Record<string, unknown> }
  }
  shadowGenerator: ShadowGeneratorProbe | null
  renderer: {
    applyQualityTier: (tier: string) => void
    dropQualityTierOnce: () => string
    postProcess: {
      _isSwiftShader: boolean
      _ssaoPipeline: unknown
      _ssrPipeline: unknown
      _motionBlur: unknown
    }
  }
  postProcessDegraded: boolean
  engine: { getCaps: () => { maxDrawBuffers?: number } }
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
  // Small on purpose: SwiftShader rasterises on the CPU, and none of these checks are pixel-based.
  await page.setViewportSize({ width: 640, height: 360 })
  await page.goto('/?renderer=webgl2&debug=1')
  await expect(page.locator('#start-btn')).toBeVisible({ timeout: 60_000 })
  await page.waitForFunction(() => !!(window as ProbeWindow).game?.ready, undefined, { timeout: 90_000 })
}

/**
 * Resolve after `n` fully rendered frames, so deferred (post-render) work has run. A persistent
 * observer, not a chain of `addOnce`: Babylon runs an observer added during a notification in
 * that same pass, so re-arming `addOnce` from inside the callback counts one frame for any `n`.
 */
async function renderFrames(page: Page, n: number): Promise<void> {
  await page.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        const scene = (window as ProbeWindow).game!.scene
        let left = count
        const observer = scene.onAfterRenderObservable.add(() => {
          if (--left > 0) return
          scene.onAfterRenderObservable.remove(observer)
          resolve()
        })
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

  test('heavy post is skipped, not broken, when the context has too few draw buffers', async ({ page }) => {
    test.setTimeout(900_000)
    const compileErrors = trackCompileErrors(page)
    await boot(page)
    await page.evaluate(() => (window as ProbeWindow).game!.performanceMonitor.setOnSustainedJank(null))

    // SwiftShader forces the heavy chain off by name; lift that so only the draw-buffer guard
    // stands between this 6-buffer context and the 7-attachment prepass.
    const state = await page.evaluate(() => {
      const game = (window as ProbeWindow).game!
      game.renderer.postProcess._isSwiftShader = false
      game.renderer.applyQualityTier('high')
      const pp = game.renderer.postProcess
      return {
        maxDrawBuffers: game.engine.getCaps().maxDrawBuffers ?? 0,
        ssao: !!pp._ssaoPipeline,
        ssr: !!pp._ssrPipeline,
        motionBlur: !!pp._motionBlur,
        degraded: game.postProcessDegraded,
        prepass: !!game.scene.prePassRenderer,
      }
    })
    test.skip(state.maxDrawBuffers >= 7, 'this context has enough draw buffers; the guard is not exercised')
    expect(state).toMatchObject({ ssao: false, ssr: false, motionBlur: false, degraded: true, prepass: false })

    await renderFrames(page, 3)
    // The pre-guard failure mode: hundreds of "glFragData ... exceed MAX_DRAW_BUFFERS" compiles.
    expect(compileErrors).toEqual([])
  })

  test('SSAO2, SSR and motion blur share one prepass and never add a GeometryBufferRenderer', async ({ page }) => {
    const compileErrors = trackCompileErrors(page)
    const pageErrors: string[] = []
    page.on('pageerror', (err) => pageErrors.push(err.message))
    await boot(page)
    await page.evaluate(() => (window as ProbeWindow).game!.performanceMonitor.setOnSustainedJank(null))

    // Emulate a desktop GPU on this software context: report 8 draw buffers (SwiftShader's 6
    // would trip the guard) and switch off the PBR sub-surface scattering that adds 2 attachments,
    // so the real 6-buffer context fits the 5 the chain needs.
    await page.evaluate(() => {
      const game = (window as ProbeWindow).game!
      game.engine.getCaps().maxDrawBuffers = 8
      for (const material of game.scene.materials) {
        const sub = (material as { subSurface?: { isScatteringEnabled: boolean } }).subSurface
        if (sub?.isScatteringEnabled) sub.isScatteringEnabled = false
      }
      game.renderer.postProcess._isSwiftShader = false
    })

    const snap = () =>
      page.evaluate(() => {
        const game = (window as ProbeWindow).game!
        const pp = game.renderer.postProcess
        return {
          ssao: !!pp._ssaoPipeline,
          ssr: !!pp._ssrPipeline,
          motionBlur: !!pp._motionBlur,
          degraded: game.postProcessDegraded,
          prepass: !!game.scene.prePassRenderer,
          prepassTargets: game.scene.prePassRenderer?.renderTargets.length ?? 0,
          geometryBuffer: !!game.scene.geometryBufferRenderer,
          pipelines: Object.keys(game.scene.postProcessRenderPipelineManager._renderPipelines).sort(),
        }
      })

    for (let round = 0; round < 2; round++) {
      await page.evaluate(() => (window as ProbeWindow).game!.renderer.applyQualityTier('high'))
      await renderFrames(page, 3)
      const on = await snap()
      expect(on, `round ${round}: heavy chain built`).toMatchObject({ ssao: true, ssr: true, motionBlur: true, degraded: false })
      // Exactly one buffer: the shared prepass MRT, and no legacy G-buffer pass beside it.
      expect(on.prepass).toBe(true)
      expect(on.prepassTargets).toBe(1)
      expect(on.geometryBuffer).toBe(false)

      await page.evaluate(() => (window as ProbeWindow).game!.renderer.applyQualityTier('medium'))
      // Frames must keep rendering after the chain is gone. A disposed SSAO2 left registered in
      // the pipeline manager throws from its `isSupported` once the prepass is disabled, which
      // stops the render loop (this call then never resolves).
      await renderFrames(page, 3)
      const off = await snap()
      expect(off, `round ${round}: heavy chain torn down`).toMatchObject({ ssao: false, ssr: false, motionBlur: false })
      // Symmetric with the enable: nothing keeps an MRT alive once every consumer is gone, and
      // no disposed pipeline stays registered with the manager.
      expect(off.prepass).toBe(false)
      expect(off.pipelines).toEqual(['pachinbloom'])
    }

    expect(pageErrors).toEqual([])
    expect(compileErrors).toEqual([])
  })
})
