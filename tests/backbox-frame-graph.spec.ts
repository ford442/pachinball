import { chromium, expect, test, type Page } from '@playwright/test'

/**
 * #461 Slice A: the backbox is one Frame Graph composite.
 *
 * Asserts on the graph's node list and per-frame pass state, not on screenshots of the flash:
 *   - CRT and jackpot are graph passes on the composite; the scene camera carries neither;
 *   - photosensitive mode leaves both nodes out, reduced motion swaps in the still jackpot node;
 *   - `?nopp=1` is the composite and nothing else;
 *   - `?renderer=webgl2` builds it with 0 "Error compiling effect".
 *
 * The WebGPU `core` / `compatibility` runs need a WebGPU adapter in headless Chromium, so they are
 * opt-in like tests/webgpu-probe.spec.ts: `WEBGPU_CI=1 npx playwright test tests/backbox-frame-graph.spec.ts`.
 */

interface GraphReport {
  status: 'idle' | 'pending' | 'built' | 'failed'
  error: string | null
  plan: { effects: string[]; omitted: Array<{ node: string; reason: string }> }
  graph: {
    backend: 'webgpu' | 'webgl2'
    nodes: string[]
    activeEffects: string[]
    executedFrames: number
  } | null
}

interface GraphProbe {
  ready?: boolean
  scene: { activeCamera: { _postProcesses?: Array<{ name: string } | null> } | null }
  display: {
    getBackboxGraphInfo: () => GraphReport
    setCRTEffectEnabled: (on: boolean) => void
  } | null
  applyAccessibilitySettings: (reducedMotion: boolean, photosensitiveMode: boolean) => void
  triggerJackpot: () => void
  stateManager: { isPlaying: () => boolean }
}

type ProbeWindow = Window & { game?: GraphProbe }

const LAYERS = [
  'backbox:physical',
  'backbox:grid',
  'backbox:reels',
  'backbox:video',
  'backbox:image',
  'backbox:character',
  'backbox:lcd',
]

const COMPILE_ERROR = /Error compiling effect|Unable to compile effect|Shader compilation/i

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

async function bootAndBuild(page: Page, query: string): Promise<GraphReport> {
  await page.setViewportSize({ width: 640, height: 360 })
  await page.goto(`/?${query}`)
  await page.waitForFunction(() => !!(window as ProbeWindow).game?.ready, undefined, { timeout: 90_000 })
  await page.waitForFunction(
    () => {
      const status = (window as ProbeWindow).game?.display?.getBackboxGraphInfo().status
      return status === 'built' || status === 'failed'
    },
    undefined,
    { timeout: 60_000 },
  )
  return report(page)
}

function report(page: Page): Promise<GraphReport> {
  return page.evaluate(() => (window as ProbeWindow).game!.display!.getBackboxGraphInfo())
}

/** Names of the post-processes on the scene camera: CRT and jackpot must never be among them. */
function cameraPostProcesses(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    ((window as ProbeWindow).game!.scene.activeCamera?._postProcesses ?? [])
      .filter((pp): pp is { name: string } => !!pp)
      .map((pp) => pp.name),
  )
}

/** Wait until `effect` ran on the last executed frame (a disabled pass only copies through). */
async function waitForActiveEffect(page: Page, effect: string): Promise<void> {
  await page.waitForFunction(
    (name) => ((window as ProbeWindow).game?.display?.getBackboxGraphInfo().graph?.activeEffects ?? []).includes(name),
    effect,
    { timeout: 20_000 },
  )
}

test.describe('Backbox Frame Graph', () => {
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(180_000)

  test('?renderer=webgl2: one composite, CRT and jackpot on the glass only, 0 compile errors', async ({ page }) => {
    const compileErrors = trackCompileErrors(page)
    const built = await bootAndBuild(page, 'renderer=webgl2&noopt=1')
    expect(built.status, built.error ?? '').toBe('built')
    expect(built.graph?.backend).toBe('webgl2')
    expect(built.graph?.nodes).toEqual(['backbox:clear', ...LAYERS, 'backbox:crt', 'backbox:jackpot'])

    await page.locator('#start-btn').click()
    await page.waitForFunction(() => (window as ProbeWindow).game?.stateManager.isPlaying() === true, undefined, {
      timeout: 30_000,
    })

    await page.evaluate(() => (window as ProbeWindow).game!.display!.setCRTEffectEnabled(true))
    await waitForActiveEffect(page, 'crt')
    await page.evaluate(() => (window as ProbeWindow).game!.triggerJackpot())
    await waitForActiveEffect(page, 'jackpot')

    const onCamera = await cameraPostProcesses(page)
    expect(onCamera.filter((name) => /crt|jackpot/i.test(name)), 'no CRT / jackpot pass on the scene camera').toEqual([])

    const executed = (await report(page)).graph!.executedFrames
    expect(executed).toBeGreaterThan(0)
    expect(compileErrors, 'no "Error compiling effect" with the backbox graph on WebGL2').toEqual([])
  })

  test('photosensitive mode omits the CRT and jackpot nodes; reduced motion keeps a still', async ({ page }) => {
    await bootAndBuild(page, 'renderer=webgl2&noopt=1')

    await page.evaluate(() => (window as ProbeWindow).game!.applyAccessibilitySettings(false, true))
    await page.waitForFunction(() => {
      const nodes = (window as ProbeWindow).game?.display?.getBackboxGraphInfo().graph?.nodes ?? []
      return !nodes.includes('backbox:crt')
    }, undefined, { timeout: 30_000 })
    let r = await report(page)
    expect(r.graph?.nodes).toEqual(['backbox:clear', ...LAYERS, 'backbox:output'])
    expect(r.plan.omitted).toEqual([
      { node: 'crt', reason: 'photosensitive' },
      { node: 'jackpot', reason: 'photosensitive' },
    ])

    await page.evaluate(() => (window as ProbeWindow).game!.applyAccessibilitySettings(true, false))
    await page.waitForFunction(() => {
      const nodes = (window as ProbeWindow).game?.display?.getBackboxGraphInfo().graph?.nodes ?? []
      return nodes.includes('backbox:jackpotStill')
    }, undefined, { timeout: 30_000 })
    r = await report(page)
    expect(r.graph?.nodes.slice(-2)).toEqual(['backbox:crt', 'backbox:jackpotStill'])
  })

  test('?nopp=1 builds the composite and nothing else', async ({ page }) => {
    const r = await bootAndBuild(page, 'renderer=webgl2&noopt=1&nopp=1')
    expect(r.status, r.error ?? '').toBe('built')
    expect(r.graph?.nodes).toEqual(['backbox:clear', ...LAYERS, 'backbox:output'])
  })
})

test.describe('Backbox Frame Graph on WebGPU (opt-in)', () => {
  test.skip(process.env.WEBGPU_CI !== '1', 'set WEBGPU_CI=1 to run the WebGPU backbox graph checks')
  test.setTimeout(180_000)

  for (const [label, query] of [
    ['core', 'noopt=1'],
    ['compatibility', 'gpu=compat&noopt=1'],
  ] as const) {
    test(`builds on WebGPU ${label}`, async ({ baseURL }) => {
      // Same flags as tests/webgpu-probe.spec.ts, plus `--use-vulkan=swiftshader`: without it the
      // SwiftShader device is lost as soon as a canvas presents.
      const browser = await chromium.launch({
        // Locally, point this at a Chromium that matches the installed Playwright if the bundled one is missing.
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
        const r = await bootAndBuild(page, query)
        expect(r.status, r.error ?? '').toBe('built')
        expect(r.graph?.backend).toBe('webgpu')
        expect(r.graph?.nodes).toEqual(['backbox:clear', ...LAYERS, 'backbox:crt', 'backbox:jackpot'])
        expect(await cameraPostProcesses(page)).not.toContain('crtPP')
      } finally {
        await browser.close()
      }
    })
  }
})
