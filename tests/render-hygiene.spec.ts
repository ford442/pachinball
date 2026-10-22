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
    materials: Array<{ name: string; isFrozen: boolean; maxSimultaneousLights?: number }>
    postProcessRenderPipelineManager: { _renderPipelines: Record<string, unknown> }
  }
  shadowGenerator: ShadowGeneratorProbe | null
  renderer: {
    describeFrozenMaterials: () => Array<[string, string]>
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
  staticSceneGate: {
    getStats: () => {
      state: string
      refreezeCount: number
      invalidationCount: number
      lastReason: string | null
      holds: number
      reasons: Array<[string, number]>
    }
  } | null
  eventBus: { emit: (event: string) => void }
  startGame: () => Promise<void>
  debugHelper: { buildDebugSnapshot: (dt: number, lives: number) => { renderStats?: { meshes: number; activeMeshes: number; materials: number; frozenMaterials: number; staticScene: { refreezeCount: number } | null } } } | null
  mirrorTexture: { renderList: unknown[]; refreshRate: number; getSize: () => unknown } | null
  ballManager: {
    spawnExtraBalls: (count: number) => void
    getBallBodies: () => unknown[]
    removeBall: (body: unknown) => void
    resetBall: () => void
  }
  cabinetManager: { loadCabinetPreset: (type: string) => Promise<void> }
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

  test('mirror render list returns to baseline after spawn/collect cycles and cabinet swaps; refresh rate follows the tier', async ({ page }) => {
    test.setTimeout(600_000)
    const compileErrors = trackCompileErrors(page)
    await boot(page)
    await page.evaluate(() => (window as ProbeWindow).game!.performanceMonitor.setOnSustainedJank(null))
    await renderFrames(page, 3)

    const cycles = await page.evaluate(() => {
      const game = (window as ProbeWindow).game!
      const mirror = game.mirrorTexture!
      const baseline = mirror.renderList.length
      let listedOnSpawn = 0
      let maxLength = baseline
      for (let i = 0; i < 50; i++) {
        game.ballManager.spawnExtraBalls(1)
        const body = game.ballManager.getBallBodies().at(-1)
        // The new ball is in the list in the same call that spawned it, so it is drawn on the
        // first frame it exists.
        if (mirror.renderList.length === baseline + 1) listedOnSpawn++
        maxLength = Math.max(maxLength, mirror.renderList.length)
        game.ballManager.removeBall(body)
      }
      return { baseline, listedOnSpawn, maxLength, after: mirror.renderList.length }
    })
    expect(cycles.listedOnSpawn).toBe(50)
    expect(cycles.maxLength).toBe(cycles.baseline + 1)
    expect(cycles.after).toBe(cycles.baseline)

    // Three preset swaps through the real glTF loader path.
    const lengths: number[] = []
    for (const preset of ['neo', 'vertical', 'wide']) {
      await page.evaluate((p) => (window as ProbeWindow).game!.cabinetManager.loadCabinetPreset(p), preset)
      await renderFrames(page, 3)
      lengths.push(await page.evaluate(() => (window as ProbeWindow).game!.mirrorTexture!.renderList.length))
    }
    expect(lengths).toEqual([cycles.baseline, cycles.baseline, cycles.baseline])

    // Refresh cadence follows the tier; the mirror is never resized.
    const sizeBefore = await page.evaluate(() => JSON.stringify((window as ProbeWindow).game!.mirrorTexture!.getSize()))
    for (const [tier, rate] of [['high', 1], ['medium', 2], ['low', 2], ['high', 1]] as const) {
      await page.evaluate((t) => (window as ProbeWindow).game!.renderer.applyQualityTier(t), tier)
      expect(await page.evaluate(() => (window as ProbeWindow).game!.mirrorTexture!.refreshRate), tier).toBe(rate)
    }
    await page.evaluate(() => (window as ProbeWindow).game!.renderer.dropQualityTierOnce())
    expect(await page.evaluate(() => (window as ProbeWindow).game!.mirrorTexture!.refreshRate), 'after auto drop').toBe(2)
    expect(await page.evaluate(() => JSON.stringify((window as ProbeWindow).game!.mirrorTexture!.getSize()))).toBe(sizeBefore)

    expect(compileErrors, 'no shader compile errors across cabinet swaps and tier switches').toEqual([])
  })

  test('the static-scene gate sees spawns, collects, tier changes, cabinet loads and FEVER windows', async ({ page }) => {
    test.setTimeout(600_000)
    await boot(page)
    await page.evaluate(() => (window as ProbeWindow).game!.performanceMonitor.setOnSustainedJank(null))
    await renderFrames(page, 4)

    const stats = () =>
      page.evaluate(() => {
        const s = (window as ProbeWindow).game!.staticSceneGate!.getStats()
        return { ...s, reasons: Object.fromEntries(s.reasons) }
      })
    const delta = async (action: () => Promise<unknown>, reason: string): Promise<number> => {
      const before = (await stats()).reasons[reason] ?? 0
      await action()
      return ((await stats()).reasons[reason] ?? 0) - before
    }
    const run = <T>(fn: (game: GameProbe) => T) => page.evaluate((src) => new Function('game', `return (${src})(game)`)((window as ProbeWindow).game), fn.toString())

    // createMainBall ran during boot, before any spawn made by this test.
    expect((await stats()).reasons['ball:spawn']).toBeGreaterThanOrEqual(1)

    expect(await delta(() => run((g) => g.ballManager.spawnExtraBalls(1)), 'ball:spawn')).toBeGreaterThanOrEqual(1)
    expect(await delta(() => run((g) => g.ballManager.removeBall(g.ballManager.getBallBodies().at(-1))), 'ball:collect')).toBe(1)
    expect(await delta(() => run((g) => g.ballManager.resetBall()), 'ball:spawn')).toBeGreaterThanOrEqual(1)

    // Tier: a real change invalidates, re-applying the current tier does not.
    await run((g) => g.renderer.applyQualityTier('high'))
    expect(await delta(() => run((g) => g.renderer.applyQualityTier('medium')), 'quality-tier')).toBe(1)
    expect(await delta(() => run((g) => g.renderer.applyQualityTier('medium')), 'quality-tier')).toBe(0)

    // Cabinet load: held for the whole async load, released afterwards.
    const duringLoad = await page.evaluate(async () => {
      const game = (window as ProbeWindow).game!
      const loading = game.cabinetManager.loadCabinetPreset('neo')
      const heldWhileLoading = game.staticSceneGate!.getStats().holds
      await loading
      return { heldWhileLoading, heldAfter: game.staticSceneGate!.getStats().holds }
    })
    expect(duringLoad.heldWhileLoading).toBeGreaterThanOrEqual(1)
    expect(duringLoad.heldAfter).toBe(0)
    expect((await stats()).reasons['cabinet:load']).toBeGreaterThanOrEqual(1)

    // FEVER: held from start to end, then it refreezes once.
    await renderFrames(page, 6)
    const quiet = await stats()
    expect(quiet.holds).toBe(0)
    await run((g) => g.eventBus.emit('fever:start'))
    await renderFrames(page, 6)
    const fever = await stats()
    expect(fever.holds).toBe(1)
    expect(fever.state).toBe('thawed')
    expect(fever.refreezeCount).toBe(quiet.refreezeCount)
    await run((g) => g.eventBus.emit('fever:end'))
    await renderFrames(page, 6)
    const after = await stats()
    expect(after.holds).toBe(0)
    expect(after.refreezeCount).toBeGreaterThan(fever.refreezeCount)
    expect(after.state).toBe('frozen')

    // The counter reaches the debug HUD snapshot.
    const snapshot = await page.evaluate(() => (window as ProbeWindow).game!.debugHelper!.buildDebugSnapshot(0.016, 3).renderStats)
    expect(snapshot!.staticScene!.refreezeCount).toBe(after.refreezeCount)
    expect(snapshot!.activeMeshes).toBeGreaterThan(0)
    expect(snapshot!.meshes).toBeGreaterThanOrEqual(snapshot!.activeMeshes)
  })

  test('freezes only the unlit room decor, and thaws / refreezes it across tier changes and cabinet loads without a compile error', async ({ page }) => {
    test.setTimeout(900_000)
    const compileErrors = trackCompileErrors(page)
    await boot(page)
    await page.evaluate(() => (window as ProbeWindow).game!.performanceMonitor.setOnSustainedJank(null))
    // (a) the menu
    await renderFrames(page, 8)

    const frozenNames = () =>
      page.evaluate(() =>
        (window as ProbeWindow).game!.scene.materials.filter((m) => m.isFrozen).map((m) => m.name).sort(),
      )
    const gateState = () => page.evaluate(() => (window as ProbeWindow).game!.staticSceneGate!.getStats().state)
    const waitFrozen = async () => {
      for (let i = 0; i < 40 && (await gateState()) !== 'frozen'; i++) await renderFrames(page, 2)
    }

    await waitFrozen()
    const allowlist = await page.evaluate(() => (window as ProbeWindow).game!.renderer.describeFrozenMaterials())
    const allowed = allowlist.map(([name]) => name).sort()
    const UNLIT_DECOR =
      /^(underBaseMat|underCoreMat|underEdgeMat|spillLMat|spillRMat|arcadePillarMat|pillarCoreMat\d|ceilingNeonMat|backGridMat|dataFallMat\d|backLogoMat)$/

    // The allowlist is exactly the unlit decor, every member says why, and the frozen set IS the allowlist.
    expect(allowed).toHaveLength(22)
    expect(allowed.every((n) => UNLIT_DECOR.test(n))).toBe(true)
    expect(allowlist.every(([, why]) => why.length > 20)).toBe(true)
    expect(await frozenNames()).toEqual(allowed)
    for (const lit of ['arcadeFloorMat', 'arcadeWallMat']) expect(allowed).not.toContain(lit)

    // (b) Start
    await page.evaluate(() => (window as ProbeWindow).game!.startGame())
    await renderFrames(page, 6)
    await waitFrozen()
    expect(await frozenNames()).toEqual(allowed)

    // (c) a tier switch: thawed before the change lands, refrozen afterwards.
    const thawedAtOnce = await page.evaluate(() => {
      const game = (window as ProbeWindow).game!
      game.renderer.applyQualityTier('low')
      return game.scene.materials.filter((m) => m.isFrozen).length
    })
    expect(thawedAtOnce).toBe(0)
    await renderFrames(page, 3)
    await waitFrozen()
    expect(await frozenNames()).toEqual(allowed)
    await page.evaluate(() => (window as ProbeWindow).game!.renderer.applyQualityTier('high'))
    await renderFrames(page, 3)
    await waitFrozen()

    // (d) cabinet preset swaps that load glTF: thawed for the whole load, refrozen after, lights still clamped.
    for (const preset of ['neo', 'wide']) {
      const during = await page.evaluate(async (p) => {
        const game = (window as ProbeWindow).game!
        const loading = game.cabinetManager.loadCabinetPreset(p)
        const frozenWhileLoading = game.scene.materials.filter((m) => m.isFrozen).length
        await loading
        return frozenWhileLoading
      }, preset)
      expect(during, `${preset}: thawed while loading`).toBe(0)
      await renderFrames(page, 4)
      await waitFrozen()
      expect(await frozenNames(), `${preset}: refrozen`).toEqual(allowed)
    }

    // The WebGL2 light clamp survived the glTF loads: nothing above the uniform-block budget.
    const overBudget = await page.evaluate(() => {
      const game = (window as ProbeWindow).game!
      const gl = (game.engine as unknown as { _gl: WebGL2RenderingContext })._gl
      const blocks = Math.min(
        gl.getParameter(gl.MAX_VERTEX_UNIFORM_BLOCKS) as number,
        gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_BLOCKS) as number,
      )
      const budget = Math.max(4, blocks - 4)
      return game.scene.materials.filter((m) => (m.maxSimultaneousLights ?? 0) > budget).map((m) => m.name)
    })
    expect(overBudget).toEqual([])

    // Fog: a frozen material ignores fog changes, and the track themes lerp fog every frame, so a
    // change thaws the set and it refreezes once the value holds still.
    const fogThawed = await page.evaluate(async () => {
      const game = (window as ProbeWindow).game!
      const scene = game.scene as unknown as { fogDensity: number }
      scene.fogDensity += 0.004
      await new Promise<void>((resolve) => game.scene.onAfterRenderObservable.addOnce(() => resolve()))
      return game.scene.materials.filter((m) => m.isFrozen).length
    })
    expect(fogThawed, 'a fog change thaws the frozen set').toBe(0)
    await renderFrames(page, 3)
    await waitFrozen()
    expect(await frozenNames()).toEqual(allowed)

    // A FEVER window must not freeze (or leave frozen) anything outside the allowlist.
    await page.evaluate(() => (window as ProbeWindow).game!.eventBus.emit('fever:start'))
    await renderFrames(page, 4)
    await page.evaluate(() => (window as ProbeWindow).game!.eventBus.emit('fever:end'))
    await renderFrames(page, 4)
    await waitFrozen()
    expect(await frozenNames()).toEqual(allowed)

    expect(compileErrors, 'no "Error compiling effect" across menu, Start, tier switch and cabinet swaps').toEqual([])
  })
})
