import { chromium, expect, test, type Page } from '@playwright/test'

/**
 * #488 §1: a WebGPU boot compiles no GLSL, so Babylon never fetches its GLSL → WGSL translator
 * (glslang + twgsl, ~2.7 MB from cdn.babylonjs.com).
 *
 * Boots `?renderer=webgpu`, drives the game through every state that compiles one of our shaders
 * (backbox cyber grid, CRT pass, the jackpot sequence, a table-map switch) and asserts that:
 *   - no request goes to cdn.babylonjs.com and nothing named glslang / twgsl is fetched;
 *   - the backbox grid material and the CRT / jackpot passes compiled as WGSL;
 *   - no shader-compile or WebGPU validation error reached the console.
 *
 * Needs a WebGPU adapter in headless Chromium (SwiftShader on a GPU-less box, see
 * tests/webgpu-probe.spec.ts); the test skips itself when the browser exposes none.
 * Locally, point PW_CHROMIUM_PATH at a Chromium that matches the installed Playwright if the
 * bundled one is missing.
 */

const WEBGPU_ARGS = [
  '--no-sandbox',
  '--enable-unsafe-webgpu',
  '--enable-features=Vulkan',
  // Without it the SwiftShader device is lost as soon as a canvas presents.
  '--use-vulkan=swiftshader',
  '--use-webgpu-adapter=swiftshader',
  '--disable-vulkan-surface',
  '--use-angle=swiftshader',
]

const TRANSLATOR_REQUEST = /cdn\.babylonjs\.com|glslang|twgsl/i
const SHADER_ERROR =
  /Error compiling effect|Unable to compile effect|Shader compilation|WGSL|ShaderModule|uncaptured|validation error|Invalid (?:ShaderModule|RenderPipeline|BindGroup|CommandBuffer|Texture|Sampler)/i

const SHADER_LANGUAGE_WGSL = 1

interface ShaderProbe {
  ready?: boolean
  stateManager: { isPlaying: () => boolean }
  triggerJackpot: () => void
  mapManager: { switchTableMap: (id: string) => void; getCurrentMap?: () => string } | null
  display: {
    getBackboxGraphInfo: () => {
      status: string
      error: string | null
      graph: { backend: string; nodes: string[]; activeEffects: string[] } | null
    }
    setCRTEffectEnabled: (on: boolean) => void
    // Private at the type level; read here only to check which language each shader compiled as.
    shaderLayer?: { material: { options: { shaderLanguage?: number } } | null }
    backboxGraph?: {
      frameGraph: { tasks: Array<{ name: string; postProcess?: { effect?: { shaderLanguage?: number } } }> }
    } | null
  } | null
}

type ProbeWindow = Window & { game?: ShaderProbe }

async function hasWebGpuAdapter(page: Page, origin: string): Promise<boolean> {
  // `navigator.gpu` only exists in a secure context; a page on the dev server's localhost origin is one.
  const probeUrl = new URL('/__webgpu-adapter-probe', origin).href
  await page.route(probeUrl, (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>probe</title>' }))
  await page.goto(probeUrl)
  const ok = await page.evaluate(async () => {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu
    if (!gpu) return false
    try {
      return !!(await gpu.requestAdapter())
    } catch {
      return false
    }
  })
  await page.unroute(probeUrl)
  return ok
}

async function waitForActiveEffect(page: Page, effect: string): Promise<void> {
  await page.waitForFunction(
    (name) => ((window as ProbeWindow).game?.display?.getBackboxGraphInfo().graph?.activeEffects ?? []).includes(name),
    effect,
    { timeout: 30_000 },
  )
}

test.describe('WebGPU boot fetches no GLSL translator (#488)', () => {
  test.setTimeout(240_000)

  test('backbox grid, CRT, jackpot and a table-map switch compile as WGSL', async ({ baseURL }) => {
    const browser = await chromium.launch({
      executablePath: process.env.PW_CHROMIUM_PATH || undefined,
      args: WEBGPU_ARGS,
    })
    try {
      const origin = baseURL ?? 'http://localhost:5173'
      const page = await browser.newPage({ baseURL: origin, viewport: { width: 640, height: 360 } })
      test.skip(!(await hasWebGpuAdapter(page, origin)), 'this browser exposes no WebGPU adapter')

      const requests: string[] = []
      const shaderErrors: string[] = []
      page.on('request', (req) => requests.push(req.url()))
      page.on('console', (msg) => {
        if ((msg.type() === 'error' || msg.type() === 'warning') && SHADER_ERROR.test(msg.text())) {
          shaderErrors.push(`${msg.type()}: ${msg.text()}`)
        }
      })
      page.on('pageerror', (err) => {
        if (SHADER_ERROR.test(err.message)) shaderErrors.push(`pageerror: ${err.message}`)
      })

      await page.goto('/?renderer=webgpu&noopt=1')
      await page.waitForFunction(() => !!(window as ProbeWindow).game?.ready, undefined, { timeout: 120_000 })
      await page.waitForFunction(
        () => {
          const status = (window as ProbeWindow).game?.display?.getBackboxGraphInfo().status
          return status === 'built' || status === 'failed'
        },
        undefined,
        { timeout: 90_000 },
      )
      const built = await page.evaluate(() => (window as ProbeWindow).game!.display!.getBackboxGraphInfo())
      expect(built.status, built.error ?? '').toBe('built')
      expect(built.graph?.backend).toBe('webgpu')
      expect(built.graph?.nodes).toEqual(expect.arrayContaining(['backbox:grid', 'backbox:crt', 'backbox:jackpot']))

      await page.locator('#start-btn').click()
      await page.waitForFunction(() => (window as ProbeWindow).game?.stateManager.isPlaying() === true, undefined, {
        timeout: 30_000,
      })

      // CRT pass on the composite.
      await page.evaluate(() => (window as ProbeWindow).game!.display!.setCRTEffectEnabled(true))
      await waitForActiveEffect(page, 'crt')

      // A table-map switch (LCD playfield + map-driven backbox theme).
      await page.evaluate(() => (window as ProbeWindow).game!.mapManager?.switchTableMap('cyber-core'))

      // The jackpot sequence: its pass and the canvas text it samples.
      await page.evaluate(() => (window as ProbeWindow).game!.triggerJackpot())
      await waitForActiveEffect(page, 'jackpot')
      // Let the sequence run on; anything compiled late would fetch the translator now.
      await page.waitForTimeout(4_000)

      expect(requests.filter((url) => TRANSLATOR_REQUEST.test(url)), 'no glslang / twgsl / cdn.babylonjs.com request').toEqual([])

      const languages = await page.evaluate(() => {
        const display = (window as ProbeWindow).game!.display!
        const tasks = display.backboxGraph?.frameGraph.tasks ?? []
        const pass = (name: string) => tasks.find((t) => t.name === name)?.postProcess?.effect?.shaderLanguage
        return {
          grid: display.shaderLayer?.material?.options.shaderLanguage,
          crt: pass('backbox:crt'),
          jackpot: pass('backbox:jackpot'),
        }
      })
      expect(languages).toEqual({ grid: SHADER_LANGUAGE_WGSL, crt: SHADER_LANGUAGE_WGSL, jackpot: SHADER_LANGUAGE_WGSL })
      expect(shaderErrors, 'no shader-compile or WebGPU validation error').toEqual([])
    } finally {
      await browser.close()
    }
  })
})
