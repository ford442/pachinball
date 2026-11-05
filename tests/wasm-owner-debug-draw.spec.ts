import { test, expect } from '@playwright/test'
import { assertWasmOwnerReady, bootWasmOwner, startPlaying } from './helpers/wasm-owner-boot'

test.use({
  launchOptions: { args: ['--no-sandbox', '--disable-setuid-sandbox'] },
})

test('wasm-owner physics debug draw shows C++ collider wireframes', async ({ page }) => {
  test.setTimeout(180_000)

  const boot = await bootWasmOwner(page)
  assertWasmOwnerReady(boot)
  await startPlaying(page)

  await page.evaluate(() => {
    const checkbox = document.getElementById('debug-physics-draw') as HTMLInputElement | null
    if (!checkbox) return
    checkbox.checked = true
    checkbox.dispatchEvent(new Event('change', { bubbles: true }))
  })

  // The overlay is a lazy chunk (00d840c): the toggle imports it, then the
  // renderer refreshes at most every 250ms. Wait for the lines, not a fixed time.
  const readDebugLines = () => page.evaluate(() => {
    const scene = (window as unknown as { game?: { scene?: { meshes?: Array<{ name: string; getVerticesData?: (kind: string) => Float32Array | number[] | null }> } } }).game?.scene
    const mesh = scene?.meshes?.find((m) => m.name === 'physicsDebugLines')
    const positions = mesh?.getVerticesData?.('position')
    const vertexCount = positions ? positions.length / 3 : 0
    const engine = (window as unknown as { currentPhysicsEngine?: string }).currentPhysicsEngine ?? null
    return { vertexCount, engine }
  })

  await expect.poll(async () => (await readDebugLines()).vertexCount, {
    message: 'C++ debug wireframes should have vertices from cached static colliders',
    timeout: 15_000,
  }).toBeGreaterThan(0)
  expect((await readDebugLines()).engine).toBe('wasm-owner')
})
