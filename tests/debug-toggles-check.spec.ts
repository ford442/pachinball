import { test, expect } from '@playwright/test'

test.use({
  launchOptions: { args: ['--no-sandbox', '--disable-setuid-sandbox'] },
})

test('wireframe and physics-debug toggles work', async ({ page }) => {
  // SwiftShader frames hold the main thread for seconds on a loaded runner, and every check() waits on it.
  test.setTimeout(120_000)
  await page.goto('/?renderer=webgl2')
  await page.waitForLoadState('networkidle')

  await expect.poll(async () => page.evaluate(() => !!window.game?.scene), {
    timeout: 60_000, intervals: [200],
  }).toBe(true)

  await page.locator('#settings-btn').click({ force: true })
  await page.waitForTimeout(300)

  // Toggle wireframe on
  await page.locator('#debug-wireframe').check({ force: true })
  await expect.poll(async () => page.evaluate(() => window.game?.scene?.forceWireframe)).toBe(true)

  // Toggle physics debug on, render a few frames
  await page.locator('#debug-physics-draw').check({ force: true })
  // The collider overlay is a lazy chunk (`ensurePhysicsDebugRenderer`): wait for its mesh, not a fixed delay.
  await expect.poll(async () => page.evaluate(() => {
    const scene = window.game?.scene
    return scene?.meshes?.some((m) => m.name === 'physicsDebugLines') ?? false
  }), { timeout: 15_000, intervals: [200] }).toBe(true)

  // Turn wireframe back off
  await page.locator('#debug-wireframe').uncheck({ force: true })
  await expect.poll(async () => page.evaluate(() => window.game?.scene?.forceWireframe)).toBe(false)
})
