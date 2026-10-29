import { chromium, expect, test, type Page } from '@playwright/test'

/**
 * #461 Slice B: scene post-processing is a Frame Graph, not a DefaultRenderingPipeline.
 *
 * The scene still renders through its camera, into one HDR target the graph reads; the graph's
 * nodes (bloom, image processing, sharpen, FXAA, and the HIGH-only SSAO / SSR / motion blur) are
 * chosen from the tier by `planSceneGraph()`. These specs assert on the node list AND on pixels: a
 * graph that builds, reports the right nodes and presents a black frame (a rebuild that gave the
 * camera a render pass its materials never compiled for) must not pass.
 *
 * The WebGPU `core` / `compatibility` runs need a WebGPU adapter in headless Chromium, so they are
 * opt-in like tests/backbox-frame-graph.spec.ts: `WEBGPU_CI=1 npx playwright test tests/scene-frame-graph.spec.ts`.
 */

interface SceneGraphReport {
  plan: { nodes: string[]; omitted: Array<{ node: string; reason: string }> } | null
  pending: boolean
  error: string | null
  graph: {
    backend: 'webgpu' | 'webgl2'
    nodes: string[]
    planned: string[]
    width: number
    height: number
    hdr: boolean
    format: string
    samples: number
    executedFrames: number
    generation: number
    active: boolean
    building: boolean
  } | null
}

interface GraphProbe {
  ready?: boolean
  qualityTier: string
  postProcessDegraded: boolean
  accessibility: unknown
  engine: { _gl?: WebGL2RenderingContext; getCaps: () => { maxDrawBuffers?: number }; getRenderWidth: (screen: boolean) => number; getRenderHeight: (screen: boolean) => number }
  scene: {
    onAfterRenderObservable: { addOnce: (cb: () => void) => void }
    imageProcessingConfiguration: { applyByPostProcess: boolean }
    postProcessRenderPipelineManager?: unknown
    prePassRenderer: unknown
    geometryBufferRenderer: unknown
  }
  tableCam: { outputRenderTarget: { name: string; renderPassId: number } | null }
  bloomPipeline: { bloomScale: number } | null
  renderer: {
    getSceneGraphInfo: () => SceneGraphReport
    applyQualityTier: (tier: string) => void
    postProcess: { _isSwiftShader: boolean }
  }
  applyAccessibilitySettings: (reducedMotion: boolean, photosensitiveMode: boolean) => void
  performanceMonitor: { setOnSustainedJank: (cb: (() => void) | null) => void }
  stateManager: { isPlaying: () => boolean }
}

type ProbeWindow = Window & {
  game?: GraphProbe
  bootstrapGpuProbe?: { backend: string | null; postProcessTier: string | null; maxUniformBuffersPerShaderStage: number | null }
  bootstrapGpuDegrades?: Array<{ path: string; detail?: string }>
}

const COMPILE_ERROR = /Error compiling effect|Unable to compile effect|Shader compilation/i
/**
 * MEDIUM / HIGH: the scene colour target is 4× MSAA, so there is no FXAA node (#488 §3). LOW drops
 * MSAA and sharpen and keeps FXAA.
 */
const FULL_NODES = ['scene:render', 'scene:bloom', 'scene:imageProcessing', 'scene:sharpen']
const LOW_NODES = ['scene:render', 'scene:bloom', 'scene:imageProcessing', 'scene:fxaa']

function trackCompileErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (COMPILE_ERROR.test(msg.text())) errors.push(msg.text())
  })
  page.on('pageerror', (err) => {
    if (COMPILE_ERROR.test(err.message)) errors.push(err.message)
  })
  return errors
}

function report(page: Page): Promise<SceneGraphReport> {
  return page.evaluate(() => (window as ProbeWindow).game!.renderer.getSceneGraphInfo())
}

async function boot(page: Page, query: string, waitForGraph = true): Promise<SceneGraphReport> {
  await page.setViewportSize({ width: 640, height: 360 })
  await page.goto(`/?${query}`)
  await page.waitForFunction(() => !!(window as ProbeWindow).game?.ready, undefined, { timeout: 90_000 })
  // The one-shot sustained-jank handler would drop the tier under a slow software run.
  await page.evaluate(() => (window as ProbeWindow).game!.performanceMonitor.setOnSustainedJank(null))
  if (waitForGraph) await settled(page)
  return report(page)
}

/** Resolve once no build is pending and the graph has a generation (or the plan has no node at all). */
async function settled(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const r = (window as ProbeWindow).game?.renderer.getSceneGraphInfo()
      if (!r || r.pending) return false
      return r.plan !== null && (r.plan.nodes.length === 0 || r.graph !== null)
    },
    undefined,
    { timeout: 120_000 },
  )
}

/** After a rebuild: the new generation is the one that is running, not just built. */
async function waitForNodes(page: Page, nodes: string[]): Promise<void> {
  await page.waitForFunction(
    (expected) => {
      const r = (window as ProbeWindow).game?.renderer.getSceneGraphInfo()
      return !r?.pending && JSON.stringify(r?.graph?.nodes) === JSON.stringify(expected)
    },
    nodes,
    { timeout: 120_000 },
  )
}

/** Mean RGB of the presented frame (WebGL2 only), read inside the frame it was drawn in. */
function canvasMean(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const game = (window as ProbeWindow).game!
        game.scene.onAfterRenderObservable.addOnce(() => {
          const gl = game.engine._gl!
          const w = game.engine.getRenderWidth(true)
          const h = game.engine.getRenderHeight(true)
          const pixels = new Uint8Array(w * h * 4)
          gl.bindFramebuffer(gl.FRAMEBUFFER, null)
          gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
          let sum = 0
          for (let i = 0; i < pixels.length; i += 4) sum += (pixels[i]! + pixels[i + 1]! + pixels[i + 2]!) / 3
          resolve(sum / (w * h))
        })
      }),
  )
}

/** The cabinet scene behind the menu averages ~150 on 0..255; a black frame is ~0-5. */
const DRAWN = 40

test.describe('Scene Frame Graph', () => {
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(240_000)

  test('?renderer=webgl2: bloom, image processing and sharpen on a 4x MSAA HDR target, 0 compile errors, scene drawn', async ({ page }) => {
    const compileErrors = trackCompileErrors(page)
    const r = await boot(page, 'renderer=webgl2&noopt=1')
    expect(r.error, r.error ?? '').toBeNull()
    expect(r.graph?.backend).toBe('webgl2')
    expect(r.graph?.nodes).toEqual(FULL_NODES)
    expect(r.graph?.hdr).toBe(true)
    expect(r.graph?.samples).toBe(4)
    expect(r.plan?.omitted).toContainEqual({ node: 'fxaa', reason: 'msaa' })
    // WebGL2 keeps half float: the packed rg11b10ufloat target draws black there (WebGPU only).
    expect(r.graph?.format).toBe('rgba16f')

    // The camera renders into the graph's target; materials leave tone mapping to the node.
    const state = await page.evaluate(() => ({
      camera: (window as ProbeWindow).game!.tableCam.outputRenderTarget?.name ?? null,
      byPostProcess: (window as ProbeWindow).game!.scene.imageProcessingConfiguration.applyByPostProcess,
      // The old pipeline is gone: nothing is attached to the camera through the pipeline manager.
      pipelines: Object.keys(
        (
          (window as ProbeWindow).game!.scene.postProcessRenderPipelineManager as
            | { _renderPipelines?: Record<string, unknown> }
            | undefined
        )?._renderPipelines ?? {},
      ),
      probe: (window as ProbeWindow).bootstrapGpuProbe,
      degrades: (window as ProbeWindow).bootstrapGpuDegrades,
    }))
    expect(state.camera).toBe('sceneColor')
    expect(state.byPostProcess).toBe(true)
    expect(state.pipelines).toEqual([])
    expect(state.probe).toMatchObject({ backend: 'webgl2', postProcessTier: 'full' })
    expect(state.degrades).toEqual([])

    expect(await canvasMean(page), 'the scene is drawn through the graph').toBeGreaterThan(DRAWN)
    expect((await report(page)).graph!.executedFrames).toBeGreaterThan(0)
    expect(compileErrors, 'no "Error compiling effect" with the scene graph on WebGL2').toEqual([])
  })

  test('a rebuild keeps one render target (one render pass) and keeps the scene drawn', async ({ page }) => {
    await boot(page, 'renderer=webgl2&noopt=1')
    const before = await page.evaluate(() => (window as ProbeWindow).game!.tableCam.outputRenderTarget!.renderPassId)

    // The bloom scale is part of the built bloom node: changing it builds a new generation.
    for (const scale of [0.25, 0.4]) {
      const generation = (await report(page)).graph!.generation
      await page.evaluate((s) => { (window as ProbeWindow).game!.bloomPipeline!.bloomScale = s }, scale)
      await page.waitForFunction(
        (before) => {
          const r = (window as ProbeWindow).game!.renderer.getSceneGraphInfo()
          return !r.pending && (r.graph?.generation ?? 0) > before
        },
        generation,
        { timeout: 120_000 },
      )
      // A new target per generation gave the camera a render pass its materials had never compiled
      // for, and a frozen scene never compiled them: the scene went black and stayed black.
      expect(
        await page.evaluate(() => (window as ProbeWindow).game!.tableCam.outputRenderTarget!.renderPassId),
        `render pass after bloom scale ${scale}`,
      ).toBe(before)
      await page.waitForTimeout(1500)
      expect(await canvasMean(page), `scene drawn after bloom scale ${scale}`).toBeGreaterThan(DRAWN)
    }
  })

  test('a resize builds the next generation at the new size and keeps the scene drawn', async ({ page }) => {
    const first = await boot(page, 'renderer=webgl2&noopt=1')
    const target = await page.evaluate(() => (window as ProbeWindow).game!.tableCam.outputRenderTarget!.renderPassId)
    await page.setViewportSize({ width: 800, height: 520 })
    await page.waitForFunction(
      (oldWidth) => {
        const r = (window as ProbeWindow).game!.renderer.getSceneGraphInfo()
        return !r.pending && r.graph !== null && r.graph.width !== oldWidth
      },
      first.graph!.width,
      { timeout: 120_000 },
    )
    // The one target was resized, not replaced: same render pass.
    expect(await page.evaluate(() => (window as ProbeWindow).game!.tableCam.outputRenderTarget!.renderPassId)).toBe(target)
    const r = await report(page)
    expect(r.graph?.width).toBeGreaterThan(0)
    expect(r.graph?.nodes).toEqual(FULL_NODES)
    await page.waitForTimeout(1500)
    expect(await canvasMean(page), 'scene drawn at the new size').toBeGreaterThan(DRAWN)
  })

  test('quality tiers change the node set: LOW leaves sharpen out, HIGH has no HIGH-only node on a software rasteriser', async ({ page }) => {
    await boot(page, 'renderer=webgl2&noopt=1')

    await page.evaluate(() => (window as ProbeWindow).game!.renderer.applyQualityTier('low'))
    await waitForNodes(page, LOW_NODES)
    expect((await report(page)).plan?.omitted).toContainEqual({ node: 'sharpen', reason: 'quality-tier' })
    // LOW: no MSAA (FXAA instead); same target object, so its sample count changed in place.
    expect((await report(page)).graph?.samples).toBe(1)
    expect(await canvasMean(page)).toBeGreaterThan(DRAWN)

    await page.evaluate(() => (window as ProbeWindow).game!.renderer.applyQualityTier('high'))
    await waitForNodes(page, FULL_NODES)
    // SwiftShader (and every CI runner) is a software rasteriser: the HIGH-only nodes cost more than it can pay.
    expect((await report(page)).plan?.omitted).toContainEqual({ node: 'ssao', reason: 'heavy-unavailable' })

    await page.evaluate(() => (window as ProbeWindow).game!.renderer.applyQualityTier('medium'))
    await waitForNodes(page, FULL_NODES)
    expect(await canvasMean(page)).toBeGreaterThan(DRAWN)
  })

  test('reduced motion leaves bloom and sharpen out and keeps the grade; turning it off brings them back', async ({ page }) => {
    await boot(page, 'renderer=webgl2&noopt=1')

    await page.evaluate(() => (window as ProbeWindow).game!.applyAccessibilitySettings(true, false))
    await waitForNodes(page, ['scene:render', 'scene:imageProcessing'])
    const reduced = await report(page)
    expect(reduced.plan?.omitted).toContainEqual({ node: 'bloom', reason: 'reduced-motion' })
    expect(reduced.plan?.omitted).toContainEqual({ node: 'sharpen', reason: 'reduced-motion' })

    await page.evaluate(() => (window as ProbeWindow).game!.applyAccessibilitySettings(false, false))
    await waitForNodes(page, FULL_NODES)
    expect(await canvasMean(page)).toBeGreaterThan(DRAWN)
  })

  test('HIGH-only nodes: one geometry pass feeds SSAO, SSR and motion blur, with no prepass', async ({ page }) => {
    test.setTimeout(480_000)
    const compileErrors = trackCompileErrors(page)
    await boot(page, 'renderer=webgl2&noopt=1')

    // Lift the software-rasteriser gate (as render-hygiene.spec.ts does): everything else about the
    // context is real, so this is the graph the first GPU that qualifies builds.
    await page.evaluate(() => {
      const game = (window as ProbeWindow).game!
      game.renderer.postProcess._isSwiftShader = false
      game.renderer.applyQualityTier('high')
    })
    await waitForNodes(page, [
      'scene:render',
      'scene:geometryClear',
      'scene:geometry',
      'scene:ssao',
      'scene:ssr',
      'scene:motionBlur',
      'scene:bloom',
      'scene:imageProcessing',
      'scene:sharpen',
    ])
    await page.waitForTimeout(2000)
    expect(await canvasMean(page), 'scene drawn with the HIGH-only nodes').toBeGreaterThan(DRAWN)
    const engineState = await page.evaluate(() => ({
      prepass: !!(window as ProbeWindow).game!.scene.prePassRenderer,
      geometryBuffer: !!(window as ProbeWindow).game!.scene.geometryBufferRenderer,
    }))
    // The graph carries its own geometry pass: nothing enables the engine's prepass or legacy G-buffer.
    expect(engineState).toEqual({ prepass: false, geometryBuffer: false })

    // And back: the chain is gone and the scene keeps rendering.
    await page.evaluate(() => (window as ProbeWindow).game!.renderer.applyQualityTier('medium'))
    await waitForNodes(page, FULL_NODES)
    expect(await canvasMean(page)).toBeGreaterThan(DRAWN)
    expect(compileErrors, 'no shader compile errors building and tearing down the HIGH-only nodes').toEqual([])
  })

  test('HIGH-only nodes are skipped, not broken, when the context has too few draw buffers', async ({ page }) => {
    const compileErrors = trackCompileErrors(page)
    await boot(page, 'renderer=webgl2&noopt=1')
    await page.evaluate(() => {
      const game = (window as ProbeWindow).game!
      game.renderer.postProcess._isSwiftShader = false
      game.engine.getCaps().maxDrawBuffers = 2
      game.renderer.applyQualityTier('high')
    })
    await waitForNodes(page, FULL_NODES)
    const r = await report(page)
    expect(r.plan?.omitted).toContainEqual({ node: 'ssao', reason: 'heavy-unavailable' })
    expect(await page.evaluate(() => (window as ProbeWindow).game!.postProcessDegraded)).toBe(true)
    expect(compileErrors).toEqual([])
  })

  test('?nopp=1 is the scene render and nothing else: no graph, the camera renders to the canvas', async ({ page }) => {
    const r = await boot(page, 'renderer=webgl2&noopt=1&nopp=1', false)
    expect(r.plan).toBeNull() // setup() never planned: there is no post-process state at all
    expect(r.graph).toBeNull()
    const state = await page.evaluate(() => ({
      camera: (window as ProbeWindow).game!.tableCam.outputRenderTarget,
      byPostProcess: (window as ProbeWindow).game!.scene.imageProcessingConfiguration.applyByPostProcess,
      controller: (window as ProbeWindow).game!.bloomPipeline,
    }))
    expect(state).toEqual({ camera: null, byPostProcess: false, controller: null })
    expect(await canvasMean(page), 'the scene is drawn straight to the canvas').toBeGreaterThan(DRAWN)
  })
})

test.describe('Scene Frame Graph on WebGPU (opt-in)', () => {
  test.skip(process.env.WEBGPU_CI !== '1', 'set WEBGPU_CI=1 to run the WebGPU scene graph checks')
  test.setTimeout(240_000)

  for (const [label, query] of [
    ['core', 'noopt=1'],
    ['compatibility', 'gpu=compat&noopt=1'],
  ] as const) {
    test(`builds the tier's nodes on WebGPU ${label}`, async ({ baseURL }) => {
      // Same flags as tests/backbox-frame-graph.spec.ts: without `--use-vulkan=swiftshader` the
      // SwiftShader device is lost as soon as a canvas presents.
      const browser = await chromium.launch({
        executablePath: process.env.PW_CHROMIUM_PATH || undefined,
        args: [
          '--no-sandbox',
          '--enable-unsafe-webgpu',
          '--enable-features=Vulkan',
          '--use-vulkan=swiftshader',
          '--use-webgpu-adapter=swiftshader',
          '--use-angle=swiftshader',
        ],
      })
      try {
        const page = await browser.newPage({ baseURL })
        const r = await boot(page, query)
        expect(r.error, r.error ?? '').toBeNull()
        expect(r.graph?.backend).toBe('webgpu')
        const probe = await page.evaluate(() => (window as ProbeWindow).bootstrapGpuProbe)
        // The tier the old pipeline would have picked on this adapter picks the nodes: below 17 uniform
        // buffers per stage the image-processing node is left out of the graph, not toggled off.
        const strict = (probe?.maxUniformBuffersPerShaderStage ?? 0) < 17
        expect(probe?.postProcessTier).toBe(strict ? 'bloom-only' : 'full')
        expect(r.graph?.nodes).toEqual(strict ? ['scene:render', 'scene:bloom'] : FULL_NODES)
        expect(r.graph!.executedFrames).toBeGreaterThan(0)
        // WebGPU render targets support 4x MSAA; the packed HDR format where the device can render it.
        expect(r.graph?.samples).toBe(4)
        expect(['rg11b10ufloat', 'rgba16f']).toContain(r.graph?.format)
      } finally {
        await browser.close()
      }
    })
  }
})
