import { test, expect } from '@playwright/test'
import { assertWasmOwnerReady, bootWasmOwner, startPlaying } from './helpers/wasm-owner-boot'

// No `test.use({ launchOptions })` here: it REPLACES the config's args (it does not merge), so the
// spec ran on a different flag set from every other wasm-owner spec.

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

  // On failure, say why the overlay is empty: chunk not loaded, not enabled, or no colliders.
  const overlayState = () => page.evaluate(() => {
    const g = (window as unknown as {
      game?: {
        physics?: { getWasmMode?: () => string; getWasmDebugColliders?: () => ArrayLike<unknown> | null }
        settingsUI?: { physicsDebugRenderer?: { isEnabled?: () => boolean } | null }
      }
    }).game
    const checkbox = document.getElementById('debug-physics-draw') as HTMLInputElement | null
    return {
      checkbox: checkbox ? checkbox.checked : 'missing',
      rendererLoaded: !!g?.settingsUI?.physicsDebugRenderer,
      rendererEnabled: g?.settingsUI?.physicsDebugRenderer?.isEnabled?.() ?? null,
      mode: g?.physics?.getWasmMode?.() ?? null,
      colliders: g?.physics?.getWasmDebugColliders?.()?.length ?? null,
    }
  })
  // #519 A3: on a software-GL runner the page draws a few frames a second, and the toggle's lazy
  // import (a module graph on the dev server) used up the 15 s poll before the first overlay
  // refresh. The import is not what this spec measures: wait for it on its own, then give the
  // 250 ms-throttled overlay its 15 s.
  await expect.poll(async () => (await overlayState()).rendererLoaded, {
    message: 'the physics debug overlay chunk should load after the toggle',
    timeout: 60_000,
  }).toBe(true)
  try {
    await expect.poll(async () => (await readDebugLines()).vertexCount, {
      message: 'C++ debug wireframes should have vertices from cached static colliders',
      timeout: 15_000,
    }).toBeGreaterThan(0)
  } catch (err) {
    throw new Error(`${err instanceof Error ? err.message : String(err)}\noverlay state: ${JSON.stringify(await overlayState())}`)
  }
  expect((await readDebugLines()).engine).toBe('wasm-owner')
})
