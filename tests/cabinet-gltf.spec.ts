import { test, expect, type Page } from '@playwright/test'

// Classic cabinet: the authored glTF loads on WebGL2, and a missing model
// falls back to the procedural cabinet without blocking Start.
test.setTimeout(180_000)

interface LoadInfo { type: string; source: string; lod?: string; url?: string; meshCount: number }

async function cabinetInfo(page: Page): Promise<LoadInfo | null> {
  return page.evaluate(() => {
    const g = (window as unknown as { game?: { cabinetManager?: { getLoadInfo?: () => LoadInfo } } }).game
    return g?.cabinetManager?.getLoadInfo?.() ?? null
  })
}

test('classic cabinet loads from glTF on WebGL2', async ({ page }) => {
  await page.goto('/?renderer=webgl2')
  await expect.poll(async () => (await cabinetInfo(page))?.source, { timeout: 120_000 }).toBe('gltf')
  const info = (await cabinetInfo(page))!
  expect(info.type).toBe('classic')
  expect(['simple', 'high']).toContain(info.lod)
  expect(info.meshCount).toBeGreaterThan(20)
  await expect(page.locator('#start-btn')).toBeEnabled({ timeout: 60_000 })
})

test('missing cabinet glTF falls back to the procedural cabinet', async ({ page }) => {
  await page.route('**/models/cabinet/classic/*.glb', (route) => route.fulfill({ status: 404, body: '' }))
  await page.goto('/?renderer=webgl2')
  await expect.poll(async () => (await cabinetInfo(page))?.source, { timeout: 120_000 }).toBe('procedural')
  await expect(page.locator('#start-btn')).toBeEnabled({ timeout: 60_000 })
})
