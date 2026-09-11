import { test, expect } from '@playwright/test'

async function waitForBootstrapOptions(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction(() => {
    const w = window as unknown as { bootstrapEngineOptions?: unknown }
    return w.bootstrapEngineOptions !== undefined
  }, { timeout: 90_000 })
}

test.describe('Engine bootstrap', () => {
  test.describe.configure({ mode: 'serial' })

  test('default boot exposes preserveDrawingBuffer=false', async ({ page }) => {
    await page.goto('http://localhost:5173/')
    await waitForBootstrapOptions(page)

    const preserveDrawingBuffer = await page.evaluate(() => {
      const w = window as unknown as {
        bootstrapEngineOptions?: { preserveDrawingBuffer?: boolean }
      }
      return w.bootstrapEngineOptions?.preserveDrawingBuffer
    })

    expect(preserveDrawingBuffer).toBe(false)
  })

  test('?preserveBuffer=1 enables preserveDrawingBuffer', async ({ page }) => {
    await page.goto('http://localhost:5173/?preserveBuffer=1')
    await waitForBootstrapOptions(page)

    const preserveDrawingBuffer = await page.evaluate(() => {
      const w = window as unknown as {
        bootstrapEngineOptions?: { preserveDrawingBuffer?: boolean }
      }
      return w.bootstrapEngineOptions?.preserveDrawingBuffer
    })

    expect(preserveDrawingBuffer).toBe(true)
  })

  test('?renderer=webgl2 boots and tags canvas', async ({ page }) => {
    await page.goto('http://localhost:5173/?renderer=webgl2')
    await waitForBootstrapOptions(page)

    const renderer = await page.evaluate(() => {
      const canvas = document.getElementById('pachinball-canvas') as HTMLCanvasElement | null
      return {
        dataset: canvas?.dataset.renderer ?? null,
        currentRenderer: (window as unknown as { currentRenderer?: string }).currentRenderer ?? null,
      }
    })

    expect(renderer.dataset).toBe('webgl2')
    expect(renderer.currentRenderer).toBe('webgl2')
  })

  test('boot publishes the context-loss hook and an empty degrade buffer', async ({ page }) => {
    await page.goto('http://localhost:5173/?renderer=webgl2')
    await waitForBootstrapOptions(page)

    await expect(page.locator('body')).toHaveAttribute('data-gpu-context', 'ok')
    await expect(page.locator('#power-toast')).toBeHidden()

    const degrades = await page.evaluate(
      () => (window as unknown as { bootstrapGpuDegrades?: unknown[] }).bootstrapGpuDegrades,
    )
    expect(Array.isArray(degrades)).toBe(true)
    // WebGL2 has no uniform-buffer cap to trip and no featureLevel to fall back from, so
    // this route is the one boot that must record nothing at all.
    expect(degrades).toEqual([])
  })

  test('boot publishes a render-path probe', async ({ page }) => {
    await page.goto('http://localhost:5173/?renderer=webgl2')
    await waitForBootstrapOptions(page)

    // The post-process half of the probe is filled when the pipeline is built, which is
    // later than engine creation — wait for the whole snapshot rather than half of it.
    await page.waitForFunction(() => {
      const probe = (window as unknown as { bootstrapGpuProbe?: { postProcessTier?: string | null } })
        .bootstrapGpuProbe
      return probe?.postProcessTier != null
    }, { timeout: 90_000 })

    const probe = await page.evaluate(
      () => (window as unknown as { bootstrapGpuProbe?: Record<string, unknown> }).bootstrapGpuProbe,
    )

    expect(probe).toMatchObject({
      backend: 'webgl2',
      featureLevel: 'webgl2',
      maxUniformBuffersPerShaderStage: null,
      postProcessTier: 'full',
    })
  })

  test('context loss flips the hook to lost and toasts, restore flips it back', async ({ page }) => {
    await page.goto('http://localhost:5173/?renderer=webgl2')
    await waitForBootstrapOptions(page)

    // WebGPU has no reliable cross-browser programmatic context loss, so the bootstrap
    // publishes these dev-only hooks instead of the test killing a real device.
    await page.evaluate(() => {
      const w = window as unknown as { __DEBUG_LOSE_CONTEXT?: () => void }
      w.__DEBUG_LOSE_CONTEXT?.()
    })

    await expect(page.locator('body')).toHaveAttribute('data-gpu-context', 'lost')
    await expect(page.locator('#power-toast')).toContainText('Graphics context lost')

    await page.evaluate(() => {
      const w = window as unknown as { __DEBUG_RESTORE_CONTEXT?: () => void }
      w.__DEBUG_RESTORE_CONTEXT?.()
    })

    await expect(page.locator('body')).toHaveAttribute('data-gpu-context', 'ok')
    await expect(page.locator('#power-toast')).toContainText('Graphics restored')

    const paths = await page.evaluate(
      () =>
        (window as unknown as { bootstrapGpuDegrades?: Array<{ path: string }> })
          .bootstrapGpuDegrades?.map((d) => d.path) ?? [],
    )
    expect(paths).toContain('context-lost')
    expect(paths).toContain('context-restored')
  })

  test('the restore toast does not animate under prefers-reduced-motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('http://localhost:5173/?renderer=webgl2')
    await waitForBootstrapOptions(page)

    await page.evaluate(() => {
      const w = window as unknown as { __DEBUG_LOSE_CONTEXT?: () => void }
      w.__DEBUG_LOSE_CONTEXT?.()
    })

    await expect(page.locator('#power-toast')).toHaveCSS('transition-duration', '0s')
  })

  test('?renderer=webgl2 game start and screenshot', async ({ page }, testInfo) => {
    test.setTimeout(180_000)

    await page.goto('http://localhost:5173/?renderer=webgl2')
    await waitForBootstrapOptions(page)
    await page.locator('#start-btn').click()
    await page.waitForFunction(() => {
      const w = window as unknown as { game?: { scene?: unknown } }
      return Boolean(w.game?.scene)
    }, { timeout: 90_000 })

    await page.screenshot({ path: testInfo.outputPath('engine-bootstrap-webgl2.png'), timeout: 60_000 })
  })
})
