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

    await expect(page.locator('html')).toHaveAttribute('data-gpu-context', 'ok')
    await expect(page.locator('#power-toast')).toBeHidden()

    const degrades = await page.evaluate(
      () => (window as unknown as { bootstrapGpuDegrades?: unknown[] }).bootstrapGpuDegrades,
    )
    expect(Array.isArray(degrades)).toBe(true)
  })

  test('context loss flips the hook to lost and toasts, restore flips it back', async ({ page }) => {
    await page.goto('http://localhost:5173/?renderer=webgl2')
    await waitForBootstrapOptions(page)

    // WEBGL_lose_context is the only way to drive a real loss/restore from a test.
    const simulated = await page.evaluate(() => {
      const canvas = document.getElementById('pachinball-canvas') as HTMLCanvasElement | null
      const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl')
      const ext = (gl as WebGLRenderingContext | null)?.getExtension('WEBGL_lose_context') as
        | { loseContext: () => void; restoreContext: () => void }
        | null
      if (!ext) return null
      ext.loseContext()
      ;(window as unknown as { __loseContextExt?: unknown }).__loseContextExt = ext
      return true
    })
    test.skip(simulated === null, 'WEBGL_lose_context unavailable in this browser')

    await expect(page.locator('html')).toHaveAttribute('data-gpu-context', 'lost')
    await expect(page.locator('#power-toast')).toContainText('Graphics context lost')

    await page.evaluate(() => {
      const ext = (window as unknown as {
        __loseContextExt?: { restoreContext: () => void }
      }).__loseContextExt
      ext?.restoreContext()
    })

    await expect(page.locator('html')).toHaveAttribute('data-gpu-context', 'ok')

    const paths = await page.evaluate(
      () =>
        (window as unknown as { bootstrapGpuDegrades?: Array<{ path: string }> })
          .bootstrapGpuDegrades?.map((d) => d.path) ?? [],
    )
    expect(paths).toContain('context-lost')
    expect(paths).toContain('context-restored')
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
