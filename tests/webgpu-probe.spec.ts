import { chromium, expect, test } from '@playwright/test'

/**
 * Spike (render-perf PR0): can headless Chromium run WebGPU on a CI box with no GPU
 * (Dawn on SwiftShader)? The answer decides how the WGSL display-shader port (PR4) and the
 * offline `?renderer=webgpu` spec are verified: in CI, or only by hand on a real GPU.
 *
 *   WEBGPU_CI=1 npx playwright test tests/webgpu-probe.spec.ts --project=chromium
 *
 * It launches its own browser on purpose: `use.launchOptions.args` in a project REPLACES the
 * top-level args (it does not merge), so a dedicated launch keeps the flag set unambiguous.
 * Opt-in because the result depends on the host's Chromium build / Vulkan loader.
 */
test.describe('WebGPU availability probe (opt-in)', () => {
  test.skip(process.env.WEBGPU_CI !== '1', 'set WEBGPU_CI=1 to run the WebGPU availability probe')

  test('headless Chromium exposes a WebGPU adapter via SwiftShader', async () => {
    const browser = await chromium.launch({
      channel: 'chromium',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--enable-unsafe-webgpu',
        '--enable-features=Vulkan',
        '--use-webgpu-adapter=swiftshader',
        '--use-angle=swiftshader',
        '--disable-vulkan-surface',
      ],
    })
    try {
      const context = await browser.newContext()
      const page = await context.newPage()
      // `navigator.gpu` only exists in a secure context; http://localhost qualifies and needs no server.
      await page.route('http://localhost/webgpu-probe', (route) =>
        route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>probe</title>' }),
      )
      await page.goto('http://localhost/webgpu-probe')

      const result = await page.evaluate(async () => {
        const gpu = (navigator as Navigator & { gpu?: GPU }).gpu
        if (!gpu) return { hasGpu: false as const }
        const adapter = await gpu.requestAdapter()
        if (!adapter) return { hasGpu: true as const, adapter: false as const }
        const info = (adapter as GPUAdapter & { info?: GPUAdapterInfo }).info
        const device = await adapter.requestDevice()
        return {
          hasGpu: true as const,
          adapter: true as const,
          device: !!device,
          vendor: info?.vendor ?? null,
          architecture: info?.architecture ?? null,
          description: info?.description ?? null,
          isFallbackAdapter: info?.isFallbackAdapter ?? null,
          features: [...adapter.features],
        }
      })

      test.info().annotations.push({ type: 'webgpu', description: JSON.stringify(result) })
      console.log(`[webgpu-probe] ${JSON.stringify(result)}`)
      expect(result.hasGpu, 'navigator.gpu should exist with --enable-unsafe-webgpu').toBe(true)
      expect(result, 'requestAdapter() should resolve to an adapter').toMatchObject({ adapter: true, device: true })
    } finally {
      await browser.close()
    }
  })
})
