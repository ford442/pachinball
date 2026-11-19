import { expect, test, type Page } from '@playwright/test'
import type { GameTestHandle } from '../game-test-handle'
import type { PhysicsWorkerTransportStats } from '../../src/wasm/physics-worker-client'

/** `window` with the live Game, typed against src/ (see tests/game-test-handle.ts). */
export type GameHooks = { game?: GameTestHandle }

/**
 * `getWasmEngine()` is typed as the `WasmSimEngine` interface; the transport stats exist only on its
 * `PhysicsWorkerClient` implementation (absent in-process), so specs read them through this.
 */
export type WorkerTransportProbe = { getTransportStats?: () => PhysicsWorkerTransportStats } | null | undefined

export type OwnerEngine = 'wasm-owner' | 'wasm-worker'

/** Serve the page without COOP/COEP so `crossOriginIsolated` is false. */
export async function stripIsolationHeaders(page: Page): Promise<void> {
  await page.route((url) => url.pathname === '/' || url.pathname.endsWith('/index.html'), async (route) => {
    const response = await route.fetch()
    const headers = { ...response.headers() }
    delete headers['cross-origin-opener-policy']
    delete headers['cross-origin-embedder-policy']
    await route.fulfill({ response, headers })
  })
}

export async function bootWasmOwner(
  page: Page,
  /** `'default'` sets no localStorage override, so isolation picks the engine (#439). */
  mode: OwnerEngine | 'default' = 'wasm-owner',
  /** Extra query parameters, e.g. `seed=12345` (#422). */
  query = '',
): Promise<{ wasmReady: boolean; engine: string | null; rapierLoaded: boolean; rapierRequests: string[] }> {
  // Any fetch of the Rapier module (the Vite dep in dev, the rapier-*.js chunk in a build).
  const rapierRequests: string[] = []
  page.on('request', (req) => {
    if (/@dimforge|rapier3d|\/assets\/rapier-[^/]*\.js/i.test(req.url())) rapierRequests.push(req.url())
  })
  if (mode !== 'default') {
    await page.addInitScript((m) => {
      localStorage.setItem('pachinball:physics-engine', m)
    }, mode)
  }
  await page.goto(`/?renderer=webgl2${query ? `&${query}` : ''}`)
  await expect(page.locator('#start-btn')).toBeVisible({ timeout: 30_000 })
  await expect.poll(async () => {
    return page.evaluate(() => !!(window as unknown as GameHooks).game?.stateManager)
  }, { timeout: 60_000 }).toBe(true)

  const state = await page.evaluate(() => {
    const w = window as unknown as GameHooks & { currentPhysicsEngine?: string }
    const g = w.game
    const wasmReady = !!(g?.physics?.isWasmOwnerMode?.() && g?.physics?.getWasmEngine?.()?.isReady)
    // The owner path must not load Rapier at all: no namespace, no World (#412).
    const rapierLoaded = g?.physics?.getRapier?.() != null || g?.physics?.getRapierWorld?.() != null
    // currentPhysicsEngine is only exposed once physics first steps.
    return { wasmReady, engine: w.currentPhysicsEngine ?? g?.physics?.getWasmMode?.() ?? null, rapierLoaded }
  })
  return { ...state, rapierRequests: [...rapierRequests] }
}

/** Fail in CI when the WASM bundle did not load; skip locally when emcc artefact is absent. */
export function assertWasmOwnerReady(
  boot: { wasmReady: boolean; engine: string | null; rapierLoaded: boolean; rapierRequests: string[] },
  mode: OwnerEngine = 'wasm-owner',
): void {
  if (!boot.wasmReady) {
    if (process.env.CI) {
      expect(boot.engine, 'WASM bundle must load in native-physics CI').toBe(mode)
    } else {
      test.skip(true, `${mode} engine not loaded in this environment`)
    }
  }
  expect(boot.engine).toBe(mode)
  expect(boot.rapierLoaded, 'owner boot must not create a Rapier module or World').toBe(false)
  expect(boot.rapierRequests, 'owner boot must not fetch Rapier').toEqual([])
}

export async function startPlaying(page: Page): Promise<void> {
  const started = await page.evaluate(async () => {
    const g = (window as unknown as GameHooks).game
    try {
      await g?.startGame?.()
      return { ok: g?.stateManager?.isPlaying?.() === true, error: null as string | null }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
  expect(started.error, started.error ?? 'startGame failed').toBeNull()
  expect(started.ok).toBe(true)
}
