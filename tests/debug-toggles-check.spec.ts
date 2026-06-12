import { test, expect } from '@playwright/test'

test.use({
  launchOptions: { args: ['--no-sandbox', '--disable-setuid-sandbox'] },
})

interface TestGame {
  scene?: { forceWireframe: boolean }
}

test('wireframe and physics-debug toggles work', async ({ page }) => {
  await page.goto('/?renderer=webgl2')
  await page.waitForLoadState('networkidle')

  await expect.poll(async () => page.evaluate(() => !!(window as unknown as { game?: TestGame }).game?.scene), {
    timeout: 15000, intervals: [200],
  }).toBe(true)

  await page.locator('#settings-btn').click({ force: true })
  await page.waitForTimeout(300)

  // Toggle wireframe on
  await page.locator('#debug-wireframe').check({ force: true })
  await page.waitForTimeout(200)
  const wireframeOn = await page.evaluate(() => (window as unknown as { game?: TestGame }).game?.scene?.forceWireframe)
  expect(wireframeOn).toBe(true)

  // Toggle physics debug on, render a few frames
  await page.locator('#debug-physics-draw').check({ force: true })
  await page.waitForTimeout(500)
  const linesMeshExists = await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const scene = (window as unknown as { game?: any }).game?.scene
    return scene?.meshes?.some((m: { name: string }) => m.name === 'physicsDebugLines') ?? false
  })
  expect(linesMeshExists).toBe(true)

  // Turn wireframe back off
  await page.locator('#debug-wireframe').uncheck({ force: true })
  await page.waitForTimeout(200)
  const wireframeOff = await page.evaluate(() => (window as unknown as { game?: TestGame }).game?.scene?.forceWireframe)
  expect(wireframeOff).toBe(false)
})
