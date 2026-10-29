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
  getShadowMap: () => {
    renderList: Array<{ name: string }>
    onAfterRenderObservable: { add: (cb: () => void) => unknown; remove: (observer: unknown) => void }
  } | null
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
    textures: Array<{ getClassName: () => string }>
    lights: Array<{ name: string; intensity: number; includedOnlyMeshes: Array<{ name: string }> }>
    autoClear: boolean
    _activeMeshesFrozen: boolean
    getMeshByName: (name: string) => { setEnabled: (v: boolean) => void } | null
    activeCamera: { position: { x: number; y: number; z: number } } | null
  }
  shadowGenerator: ShadowGeneratorProbe | null
  dynamicShadowGenerator: ShadowGeneratorProbe | null
  shadowRig: { isStaticLive: () => boolean; getReceivers: () => Array<{ name: string; receiveShadows: boolean }> }
  keyLight: { intensity: number; excludedMeshes: Array<{ name: string }> }
  renderer: {
    applyQualityTier: (tier: string) => void
    dropQualityTierOnce: () => string
    postProcess: {
      _isSwiftShader: boolean
    }
    getSceneGraphInfo: () => {
      plan: { nodes: string[]; omitted: Array<{ node: string; reason: string }> } | null
      pending: boolean
      graph: { nodes: string[] } | null
    }
  }
  postProcessDegraded: boolean
  staticScene: { materials: { describe: () => Array<[string, string]> } } | null
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
  // `noopt=1`: the game's SceneOptimizer (target 55 fps) degrades a software-GL run within seconds
  // (shadows, particles, post and render targets off, textures, including the shadow map, to 512),
  // which makes "what is the scene's shadow map size / is the gate frozen" depend on how loaded the
  // machine is.
  await page.goto('/?renderer=webgl2&debug=1&noopt=1')
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
    // stands between this context and the geometry pass's four colour attachments.
    const state = await page.evaluate(() => {
      const game = (window as ProbeWindow).game!
      game.renderer.postProcess._isSwiftShader = false
      game.engine.getCaps().maxDrawBuffers = 2
      game.renderer.applyQualityTier('high')
      const plan = game.renderer.getSceneGraphInfo().plan
      return {
        omitted: plan?.omitted.filter((o) => o.reason === 'heavy-unavailable').map((o) => o.node) ?? [],
        planned: plan?.nodes ?? [],
        degraded: game.postProcessDegraded,
        prepass: !!game.scene.prePassRenderer,
      }
    })
    expect(state).toMatchObject({ omitted: ['ssao', 'ssr', 'motionBlur'], degraded: true, prepass: false })
    expect(state.planned).not.toContain('ssao')

    await renderFrames(page, 3)
    // The pre-guard failure mode: hundreds of "glFragData ... exceed MAX_DRAW_BUFFERS" compiles.
    expect(compileErrors).toEqual([])
  })

  test('SSAO, SSR and motion blur are graph nodes sharing one geometry pass, and never enable a prepass', async ({ page }) => {
    test.setTimeout(900_000)
    const compileErrors = trackCompileErrors(page)
    const pageErrors: string[] = []
    page.on('pageerror', (err) => pageErrors.push(err.message))
    await boot(page)
    await page.evaluate(() => (window as ProbeWindow).game!.performanceMonitor.setOnSustainedJank(null))

    // SwiftShader forces the heavy chain off by name; lift that. The context has what the geometry
    // pass needs (four draw buffers, float render targets).
    await page.evaluate(() => {
      ;(window as ProbeWindow).game!.renderer.postProcess._isSwiftShader = false
    })

    const settle = () =>
      page.waitForFunction(() => !(window as ProbeWindow).game!.renderer.getSceneGraphInfo().pending, undefined, { timeout: 600_000 })
    const snap = () =>
      page.evaluate(() => {
        const game = (window as ProbeWindow).game!
        return {
          nodes: game.renderer.getSceneGraphInfo().graph?.nodes ?? [],
          prepass: !!game.scene.prePassRenderer,
          geometryBuffer: !!game.scene.geometryBufferRenderer,
        }
      })

    for (let round = 0; round < 2; round++) {
      await page.evaluate(() => (window as ProbeWindow).game!.renderer.applyQualityTier('high'))
      await settle()
      await renderFrames(page, 3)
      const on = await snap()
      expect(on.nodes, `round ${round}: heavy chain built`).toEqual(
        expect.arrayContaining(['scene:geometry', 'scene:ssao', 'scene:ssr', 'scene:motionBlur']),
      )
      // Exactly one geometry pass beside the camera render, no engine prepass, no legacy G-buffer pass.
      expect(on.nodes.filter((n) => n === 'scene:geometry')).toHaveLength(1)
      expect(on.prepass).toBe(false)
      expect(on.geometryBuffer).toBe(false)

      await page.evaluate(() => (window as ProbeWindow).game!.renderer.applyQualityTier('medium'))
      await settle()
      // Frames must keep rendering after the chain is gone (this call would never resolve if the
      // render loop had stopped).
      await renderFrames(page, 3)
      const off = await snap()
      expect(off.nodes, `round ${round}: heavy chain torn down`).not.toContain('scene:geometry')
      // MEDIUM: MSAA on the scene target, so no FXAA node (#488 §3).
      expect(off.nodes).toEqual(['scene:render', 'scene:bloom', 'scene:imageProcessing', 'scene:sharpen'])
      expect(off.prepass).toBe(false)
    }

    expect(pageErrors).toEqual([])
    expect(compileErrors).toEqual([])
  })

  test('no MirrorTexture exists: a render target nobody samples is not allocated (#484)', async ({ page }) => {
    test.setTimeout(600_000)
    const compileErrors = trackCompileErrors(page)
    await boot(page)
    await page.evaluate(() => (window as ProbeWindow).game!.performanceMonitor.setOnSustainedJank(null))
    await renderFrames(page, 3)

    const mirrors = () =>
      page.evaluate(() =>
        (window as ProbeWindow).game!.scene.textures.filter((t) => t.getClassName() === 'MirrorTexture').length,
      )
    expect(await mirrors(), 'after boot').toBe(0)

    await page.evaluate(() => {
      const game = (window as ProbeWindow).game!
      for (let i = 0; i < 10; i++) {
        game.ballManager.spawnExtraBalls(1)
        game.ballManager.removeBall(game.ballManager.getBallBodies().at(-1))
      }
    })
    for (const preset of ['neo', 'vertical', 'wide']) {
      await page.evaluate((p) => (window as ProbeWindow).game!.cabinetManager.loadCabinetPreset(p), preset)
      await renderFrames(page, 3)
    }
    expect(await mirrors(), 'after spawn/collect cycles and cabinet swaps').toBe(0)
    expect(compileErrors, 'no shader compile errors across cabinet swaps').toEqual([])
  })

  test('shadows are two generators: the static map renders on a refreeze, the dynamic one every frame (#484)', async ({ page }) => {
    test.setTimeout(600_000)
    const compileErrors = trackCompileErrors(page)
    await boot(page)
    await page.evaluate(() => (window as ProbeWindow).game!.performanceMonitor.setOnSustainedJank(null))
    await page.evaluate(() => (window as ProbeWindow).game!.startGame())
    await renderFrames(page, 6)
    for (let i = 0; i < 40 && (await page.evaluate(() => (window as ProbeWindow).game!.staticSceneGate!.getStats().state)) !== 'frozen'; i++) {
      await renderFrames(page, 2)
    }

    const design = await page.evaluate(() => {
      const game = (window as ProbeWindow).game!
      const names = (g: ShadowGeneratorProbe) => g.getShadowMap()!.renderList.map((m) => m.name)
      const receivers = game.shadowRig.getReceivers()
      const twins = game.scene.lights.filter((l) => l.name === 'keyLightStatic' || l.name === 'keyLightDynamic')
      return {
        staticCasters: names(game.shadowGenerator!),
        dynamicCasters: names(game.dynamicShadowGenerator!),
        receivers: receivers.map((m) => m.name),
        allReceive: receivers.every((m) => m.receiveShadows),
        keyExcludes: game.keyLight.excludedMeshes.map((m) => m.name),
        twinNames: twins.map((l) => l.name).sort(),
        twinIntensity: twins.reduce((sum, l) => sum + l.intensity, 0),
        keyIntensity: game.keyLight.intensity,
        twinsLightOnly: twins.every((l) => l.includedOnlyMeshes.map((m) => m.name).join() === receivers.map((m) => m.name).join()),
      }
    })
    expect(design.twinNames).toEqual(['keyLightDynamic', 'keyLightStatic'])
    expect(design.receivers).toContain('lcdGround')
    expect(design.allReceive).toBe(true)
    expect(design.keyExcludes.sort()).toEqual([...design.receivers].sort())
    expect(design.twinsLightOnly, 'the twins light the receivers and nothing else').toBe(true)
    expect(design.twinIntensity, 'twins together carry exactly the key light').toBeCloseTo(design.keyIntensity, 5)
    expect(design.dynamicCasters).toEqual(expect.arrayContaining(['ball', 'flipperBlade']))
    expect(design.staticCasters).not.toContain('ball')
    expect(design.staticCasters).not.toContain('flipperBlade')

    // Count renders of each map over a window of frames.
    const count = (frames: number, spawn = false) =>
      page.evaluate(
        ({ frames: n, spawn }) =>
          new Promise<{ frames: number; staticRenders: number; dynamicRenders: number }>((resolve) => {
            const game = (window as ProbeWindow).game!
            const scene = game.scene
            const out = { frames: 0, staticRenders: 0, dynamicRenders: 0 }
            const s = game.shadowGenerator!.getShadowMap()!.onAfterRenderObservable.add(() => out.staticRenders++)
            const d = game.dynamicShadowGenerator!.getShadowMap()!.onAfterRenderObservable.add(() => out.dynamicRenders++)
            const f = scene.onAfterRenderObservable.add(() => {
              if (++out.frames < n) return
              game.shadowGenerator!.getShadowMap()!.onAfterRenderObservable.remove(s)
              game.dynamicShadowGenerator!.getShadowMap()!.onAfterRenderObservable.remove(d)
              scene.onAfterRenderObservable.remove(f)
              resolve(out)
            })
            if (spawn) game.ballManager.spawnExtraBalls(1)
          }),
        { frames, spawn },
      )

    const settled = await count(20)
    expect(settled.staticRenders, 'static map is not re-rendered while the scene is static').toBe(0)
    expect(settled.dynamicRenders, 'dynamic map renders every frame').toBe(settled.frames)

    // A ball is a dynamic caster: spawning one thaws the gate but never the static map.
    const spawned = await count(20, true)
    expect(spawned.staticRenders, 'ball spawn does not re-render the static map').toBe(0)
    expect(spawned.dynamicRenders).toBe(spawned.frames)

    // A cabinet swap can change the static casters: the map renders again, then stops again.
    await page.evaluate(() => (window as ProbeWindow).game!.cabinetManager.loadCabinetPreset('neo'))
    const swapped = await count(30)
    expect(swapped.staticRenders, 'a cabinet swap refreshes the static map').toBeGreaterThanOrEqual(1)
    for (let i = 0; i < 40 && (await page.evaluate(() => (window as ProbeWindow).game!.shadowRig.isStaticLive())); i++) {
      await renderFrames(page, 2)
    }
    expect((await count(20)).staticRenders, 'and then stays still').toBe(0)

    expect(compileErrors, 'no shader compile errors with the twin lights').toEqual([])
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
    const allowlist = await page.evaluate(() => (window as ProbeWindow).game!.staticScene!.materials.describe())
    const allowed = allowlist.map(([name]) => name).sort()
    const UNLIT_DECOR =
      /^(underBaseMat|underCoreMat|underEdgeMat|spillLMat|spillRMat|arcadePillarMat|pillarCoreMat|ceilingNeonMat|backGridMat|dataFall(Cyan|Magenta)Mat|backLogoMat)$/

    // The allowlist is exactly the unlit decor, every member says why, and the frozen set IS the allowlist.
    expect(allowed).toHaveLength(12)
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

  test('merges the shared-material room decor into one mesh per material', async ({ page }) => {
    await boot(page)
    const decor = await page.evaluate(() => {
      const scene = (window as ProbeWindow).game!.scene as unknown as {
        getMeshByName: (n: string) => { material: { name: string } } | null
      }
      const names = ['arcadePillars', 'arcadePillarCores', 'ceilingTubes', 'dataFallMagenta', 'dataFallCyan']
      const originals = ['arcadePillar0', 'arcadePillar5', 'pillarCore3', 'ceilingTube2', 'dataFall0', 'dataFall6']
      return {
        merged: Object.fromEntries(names.map((n) => [n, scene.getMeshByName(n)?.material.name ?? null])),
        originalsGone: originals.every((n) => scene.getMeshByName(n) === null),
      }
    })
    expect(decor.merged).toEqual({
      arcadePillars: 'arcadePillarMat',
      arcadePillarCores: 'pillarCoreMat',
      ceilingTubes: 'ceilingNeonMat',
      dataFallMagenta: 'dataFallMagentaMat',
      dataFallCyan: 'dataFallCyanMat',
    })
    expect(decor.originalsGone, 'the merged sources are disposed, not left as invisible scene meshes').toBe(true)
  })

  test('the frozen active-mesh list matches a fresh evaluation after every kind of change', async ({ page }) => {
    test.setTimeout(900_000)
    await boot(page)
    await page.evaluate(() => (window as ProbeWindow).game!.performanceMonitor.setOnSustainedJank(null))

    // Runs every scenario in the page: act, give the watchers a couple of frames, wait for the
    // gate to refreeze, then compare the frozen list with what a from-scratch evaluation selects.
    const results = await page.evaluate(async () => {
      const game = (window as any).game
      const scene = game.scene
      const gate = game.staticSceneGate
      const frames = (n: number) =>
        new Promise<void>((resolve) => {
          let k = 0
          const o = scene.onAfterRenderObservable.add(() => {
            if (++k >= n) {
              scene.onAfterRenderObservable.remove(o)
              resolve()
            }
          })
        })
      const waitFrozen = async () => {
        for (let i = 0; i < 80; i++) {
          if (gate.getStats().state === 'frozen' && scene._activeMeshesFrozen) return true
          await frames(2)
        }
        return false
      }
      const ids = () => {
        const a = scene._activeMeshes
        const out = new Map<number, string>()
        for (let i = 0; i < a.length; i++) out.set(a.data[i].uniqueId, a.data[i].name)
        return out
      }
      const results: Array<{ label: string; froze: boolean; thawed: boolean; missing: string[]; extra: string[] }> = []
      const verify = async (label: string, action?: () => unknown) => {
        if (action) await action()
        await frames(1)
        const thawed = !scene._activeMeshesFrozen || gate.getStats().state !== 'frozen'
        await frames(1)
        const froze = await waitFrozen()
        const frozen = ids()
        scene.unfreezeActiveMeshes()
        scene.updateTransformMatrix()
        // The frozen list is captured with frustum clipping off, so compare it with that.
        scene.skipFrustumClipping = true
        scene._evaluateActiveMeshes()
        scene.skipFrustumClipping = false
        const fresh = ids()
        gate.invalidate('verify')
        results.push({
          label,
          froze,
          thawed,
          missing: [...fresh].filter(([id]) => !frozen.has(id)).map(([, n]) => n),
          extra: [...frozen].filter(([id]) => !fresh.has(id)).map(([, n]) => n),
        })
      }

      const named = (name: string) => scene.meshes.find((m: { name: string }) => m.name === name)
      await verify('menu')
      await verify('start', () => game.startGame())
      await verify('spawn a ball', () => game.ballManager.spawnExtraBalls(1))
      await verify('collect a ball', () => game.ballManager.removeBall(game.ballManager.getBallBodies().at(-1)))
      const cap = named('bump_cap')
      await verify('disable a mesh', () => cap.setEnabled(false))
      await verify('enable a mesh', () => cap.setEnabled(true))
      await verify('hide a mesh', () => { cap.isVisible = false })
      await verify('show a mesh', () => { cap.isVisible = true })
      const original = cap.material
      const other = scene.materials.find((m: any) => m !== original && m.getClassName() === 'StandardMaterial' && !m.isFrozen)
      await verify('swap a material', () => { cap.material = other })
      await verify('restore the material', () => { cap.material = original })
      const mat = scene.materials.find((m: any) => m.getClassName() === 'StandardMaterial' && !m.isFrozen && m.alpha === 1)
      await verify('fade a material', () => { mat.alpha = 0.5 })
      await verify('unfade the material', () => { mat.alpha = 1 })
      const spark = scene.particleSystems.find((p: any) => p.name === 'bumperSpark_pool_0')
      await verify('start a particle system', () => spark.start())
      await verify('stop a particle system', () => spark.stop())
      const camera = scene.activeCamera
      await verify('move the camera', () => { camera.position.x += 3 })
      await verify('move the camera back', () => { camera.position.x -= 3 })
      await verify('FEVER ends', async () => {
        game.eventBus.emit('fever:start')
        await frames(3)
        game.eventBus.emit('fever:end')
      })
      await verify('quality tier changes', () => game.renderer.applyQualityTier('low'))
      await verify('quality tier changes back', () => game.renderer.applyQualityTier('high'))
      return results
    })

    for (const r of results) {
      expect(r.froze, `${r.label}: refroze`).toBe(true)
      expect(r.missing, `${r.label}: meshes a fresh evaluation selects that the frozen list lacks`).toEqual([])
      expect(r.extra, `${r.label}: meshes the frozen list draws that a fresh evaluation would not`).toEqual([])
    }
    // The watchers (not luck) are what caught the changes: those scenarios thawed the list.
    const mustThaw = ['start', 'spawn a ball', 'collect a ball', 'disable a mesh', 'hide a mesh', 'swap a material', 'fade a material', 'start a particle system', 'move the camera']
    for (const label of mustThaw) expect(results.find((r) => r.label === label)?.thawed, `${label}: thawed the list`).toBe(true)
  })

  test('?freezeMeshes=0 keeps the active-mesh list thawed', async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 360 })
    await page.goto('/?renderer=webgl2&debug=1&noopt=1&freezeMeshes=0')
    await expect(page.locator('#start-btn')).toBeVisible({ timeout: 60_000 })
    await page.waitForFunction(() => !!(window as ProbeWindow).game?.ready, undefined, { timeout: 90_000 })
    await page.evaluate(() => (window as ProbeWindow).game!.performanceMonitor.setOnSustainedJank(null))
    for (let i = 0; i < 20; i++) await renderFrames(page, 2)
    const state = await page.evaluate(() => {
      const game = (window as ProbeWindow).game!
      return {
        activeFrozen: game.scene._activeMeshesFrozen,
        gate: game.staticSceneGate!.getStats().state,
        frozenMaterials: game.scene.materials.filter((m) => m.isFrozen).length,
      }
    })
    expect(state.activeFrozen).toBe(false)
    // The material freeze is independent of the flag, and the gate itself still settles.
    expect(state.gate).toBe('frozen')
    expect(state.frozenMaterials).toBeGreaterThan(0)
  })

  test('skips the colour clear only while the skybox fills the frame', async ({ page }) => {
    await boot(page)
    await page.evaluate(() => (window as ProbeWindow).game!.performanceMonitor.setOnSustainedJank(null))
    const autoClear = () => page.evaluate(() => (window as ProbeWindow).game!.scene.autoClear)
    await renderFrames(page, 3)
    expect(await autoClear(), 'cabinet camera inside the skybox').toBe(false)

    await page.evaluate(() => { (window as ProbeWindow).game!.scene.getMeshByName('skybox')!.setEnabled(false) })
    await renderFrames(page, 2)
    expect(await autoClear(), 'skybox disabled').toBe(true)
    await page.evaluate(() => { (window as ProbeWindow).game!.scene.getMeshByName('skybox')!.setEnabled(true) })
    await renderFrames(page, 2)
    expect(await autoClear(), 'skybox back').toBe(false)

    await page.evaluate(() => { (window as ProbeWindow).game!.scene.activeCamera!.position.z = 400 })
    await renderFrames(page, 2)
    expect(await autoClear(), 'camera outside the skybox').toBe(true)
  })
})
