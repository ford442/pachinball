import { chromium, expect, test } from '@playwright/test'

/**
 * Opt-in: `?renderer=webgpu` must get through `scene_critical` on a software adapter.
 *
 *   WEBGPU_CI=1 npx playwright test tests/webgpu-boot.spec.ts --project=chromium
 *
 * Regression for `TypeError: engine.createDynamicTexture is not a function` thrown from
 * `StructuralMaterials.createLCDGridTexture` (docs/RENDER_BUDGET.md). Launches its own browser: the
 * project-level `launchOptions.args` would replace, not extend, this flag set, and without
 * `--use-vulkan=swiftshader` the SwiftShader device is lost as soon as a canvas presents
 * (docs/FRAME_GRAPH.md), which would fail the boot for an unrelated reason.
 */
test.describe('WebGPU boot (opt-in)', () => {
  test.skip(process.env.WEBGPU_CI !== '1', 'set WEBGPU_CI=1 to boot the game on the WebGPU backend')

  test('scene_critical builds the LCD grid texture on WebGPU', async () => {
    test.setTimeout(180_000)
    const browser = await chromium.launch({
      channel: 'chromium',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--enable-unsafe-webgpu',
        '--enable-features=Vulkan',
        '--use-vulkan=swiftshader',
        '--use-webgpu-adapter=swiftshader',
        '--use-angle=swiftshader',
        '--disable-vulkan-surface',
      ],
    })
    try {
      const page = await (await browser.newContext({ viewport: { width: 640, height: 360 } })).newPage()
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(e.message))
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text())
      })
      await page.goto('/?renderer=webgpu&debug=1&noopt=1')
      await page.waitForFunction(
        () => (window as unknown as { game?: { ready?: boolean } }).game?.ready === true,
        undefined,
        { timeout: 150_000 },
      )

      const webgpu = await page.evaluate(
        () => (window as unknown as { game: { engine: { isWebGPU?: boolean } } }).game.engine.isWebGPU === true,
      )
      expect(webgpu, 'engine is WebGPU').toBe(true)
      expect(errors.filter((e) => e.includes('createDynamicTexture'))).toEqual([])
    } finally {
      await browser.close()
    }
  })
})
