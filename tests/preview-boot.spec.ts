import { test, expect } from '@playwright/test'
import { existsSync } from 'node:fs'

// Runs only under playwright.preview.config.ts: boots the built bundle, not the dev server.
// The CI leg sets PREVIEW_EXPECT_ENGINE; locally it follows whether public/wasm exists.
const expectedEngine =
  process.env.PREVIEW_EXPECT_ENGINE ?? (existsSync('public/wasm/PhysicsModule.wasm') ? 'wasm-worker' : 'rapier')

test('production bundle boots cross-origin isolated on the expected physics engine', async ({ page }) => {
  test.setTimeout(120_000)

  await page.goto('/')
  await expect(page.locator('#start-btn')).toBeEnabled({ timeout: 60_000 })

  const state = await page.evaluate(() => ({
    isolated: window.crossOriginIsolated,
    engine: (window as { currentPhysicsEngine?: string }).currentPhysicsEngine,
    renderer: document.getElementById('pachinball-canvas')?.dataset.renderer ?? null,
  }))

  expect(state.isolated).toBe(true)
  expect(state.engine).toBe(expectedEngine)
  // SwiftShader/ANGLE offers no WebGPU adapter, so this is the WebGPU-unsupported -> WebGL2 path.
  expect(state.renderer).toBe('webgl2')
})
