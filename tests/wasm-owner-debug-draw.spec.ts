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

  // PhysicsDebugRenderer caps refresh at 250ms; wait for render loop to populate lines.
  await page.waitForTimeout(600)

  const debugLines = await page.evaluate(() => {
    const scene = (window as unknown as { game?: { scene?: { meshes?: Array<{ name: string; getVerticesData?: (kind: string) => Float32Array | number[] | null }> } } }).game?.scene
    const mesh = scene?.meshes?.find((m) => m.name === 'physicsDebugLines')
    const positions = mesh?.getVerticesData?.('position')
    const vertexCount = positions ? positions.length / 3 : 0
    const engine = (window as unknown as { currentPhysicsEngine?: string }).currentPhysicsEngine ?? null
    return { vertexCount, engine }
  })

  expect(debugLines.engine).toBe('wasm-owner')
  expect(debugLines.vertexCount, 'C++ debug wireframes should have vertices from cached static colliders').toBeGreaterThan(0)
})
