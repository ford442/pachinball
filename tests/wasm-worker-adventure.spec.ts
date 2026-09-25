import { test, expect, type Page } from '@playwright/test'
import {
  assertWasmOwnerReady,
  bootWasmOwner,
  startPlaying,
  type GameHooks,
} from './helpers/wasm-owner-boot'

/**
 * #414 acceptance: `wasm-worker` owns an adventure track with Rapier unstepped,
 * over the SharedArrayBuffer transport when the page is cross-origin isolated
 * and over transferred `postMessage` buffers when it is not.
 *
 * Unlike the wasm-owner specs, stepping must yield between ticks: the worker
 * answers asynchronously (and `shared-attach` is itself a message), so a
 * synchronous loop inside one `page.evaluate` would never see a snapshot.
 */

type WorkerHooks = GameHooks & {
  game?: GameHooks['game'] & {
    adventureMode?: {
      isActive: () => boolean
      start: (ballBody: unknown, camera: unknown, ballMesh: unknown, trackType: string) => Promise<void>
      getColliderDescriptors: () => readonly { kind: string; removed?: true }[]
    } | null
    scene?: { activeCamera?: unknown }
    engine?: { getDeltaTime: () => number; stopRenderLoop?: () => void }
    mapManager?: { update?: (dt: number) => void }
    physics?: NonNullable<GameHooks['game']>['physics'] & { getLastWasmStepMs?: () => number }
    physicsController?: NonNullable<NonNullable<GameHooks['game']>['physicsController']> & {
      getAdventureOwnership?: () => {
        owned: boolean
        unsupported: ReadonlyArray<{ reason: string; label?: string }>
      }
    }
  }
}

const TRACK = 'SYNTHWAVE_SURF'

/** Serve the page without COOP/COEP so `crossOriginIsolated` is false. */
async function stripIsolationHeaders(page: Page) {
  await page.route((url) => url.pathname === '/' || url.pathname.endsWith('/index.html'), async (route) => {
    const response = await route.fetch()
    const headers = { ...response.headers() }
    delete headers['cross-origin-opener-policy']
    delete headers['cross-origin-embedder-policy']
    await route.fulfill({ response, headers })
  })
}

async function playTrackInWorker(page: Page) {
  const boot = await bootWasmOwner(page, 'wasm-worker')
  assertWasmOwnerReady(boot, 'wasm-worker')
  await startPlaying(page)

  const started = await page.evaluate(async (track) => {
    const g = (window as unknown as WorkerHooks).game
    // Physics-only: the spec steps by hand, and headless LCD re-uploads are slow.
    g?.engine?.stopRenderLoop?.()
    if (g?.mapManager) g.mapManager.update = () => {}
    const ball = g?.ballManager?.getBallBody?.()
    const camera = g?.scene?.activeCamera
    if (!g?.adventureMode || !ball || !camera) return 'adventure mode, ball or camera missing'
    try {
      await g.adventureMode.start(ball, camera, undefined, track)
    } catch (err) {
      return err instanceof Error ? err.message : String(err)
    }
    g.physicsController?.rebuildHandleCaches?.()
    ball.setTranslation({ x: 0, y: 2, z: 1 }, true)
    ball.setLinvel({ x: 0, y: 0, z: 0 }, true)
    g.physicsController?.rebuildHandleCaches?.()
    return g.adventureMode.isActive() ? null : 'adventure did not start'
  }, TRACK)
  expect(started).toBeNull()

  return page.evaluate(async (steps) => {
    const g = (window as unknown as WorkerHooks).game!
    const ball = g.ballManager!.getBallBody!()
    const before = ball.translation()
    const origDt = g.engine!.getDeltaTime.bind(g.engine)
    g.engine!.getDeltaTime = () => 1000 / 60
    let maxWasmMs = 0
    try {
      for (let i = 0; i < steps; i++) {
        g.physicsController!.stepPhysics(g.inputManager, g.inputActions, null, null)
        maxWasmMs = Math.max(maxWasmMs, g.physics?.getLastWasmStepMs?.() ?? 0)
        // Let the worker's messages (attach / step-result) land.
        await new Promise((r) => setTimeout(r, 2))
      }
    } finally {
      g.engine!.getDeltaTime = origDt
    }
    const after = ball.translation()
    const ownership = g.physicsController?.getAdventureOwnership?.()
    return {
      isolated: crossOriginIsolated,
      mode: g.physics?.getWasmMode?.() ?? '',
      rapierMs: g.physics?.getLastRapierStepMs?.() ?? -1,
      maxWasmMs,
      owned: ownership?.owned ?? false,
      unsupported: (ownership?.unsupported ?? []).map((u) => `${u.label ?? '?'}: ${u.reason}`),
      descriptors: g.adventureMode?.getColliderDescriptors().length ?? 0,
      travelled: Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z),
      stats: g.physics?.getWasmEngine?.()?.getTransportStats?.() ?? null,
    }
  }, 180)
}

function expectOwnedAndPlayed(run: Awaited<ReturnType<typeof playTrackInWorker>>) {
  expect(run.mode).toBe('wasm-worker')
  expect(run.unsupported).toEqual([])
  expect(run.owned, 'wasm-worker must own the whole track').toBe(true)
  expect(run.descriptors).toBeGreaterThan(20)
  expect(run.rapierMs, 'Rapier must not step while the worker owns the track').toBe(0)
  expect(run.maxWasmMs, 'the worker must report C++ step time').toBeGreaterThan(0)
  expect(run.travelled, 'C++ in the worker must move the ball').toBeGreaterThan(0.5)
}

test.describe('wasm-worker adventure ownership', () => {
  test('cross-origin isolated: synthwave-surf over the shared transport', async ({ page }) => {
    test.setTimeout(240_000)
    const run = await playTrackInWorker(page)
    expect(run.isolated, 'dev server must send COOP/COEP').toBe(true)
    expectOwnedAndPlayed(run)
    expect(run.stats?.transport).toBe('shared')
    expect(run.stats?.sharedSnapshots).toBeGreaterThan(100)
    // No per-step transform ArrayBuffer crossed postMessage.
    expect(run.stats?.postMessageSnapshots).toBe(0)
  })

  test('not isolated: synthwave-surf over postMessage transfers', async ({ page }) => {
    test.setTimeout(240_000)
    await stripIsolationHeaders(page)
    const run = await playTrackInWorker(page)
    expect(run.isolated).toBe(false)
    expectOwnedAndPlayed(run)
    expect(run.stats?.transport).toBe('post-message')
    expect(run.stats?.sharedSnapshots).toBe(0)
    expect(run.stats?.postMessageSnapshots).toBeGreaterThan(100)
  })
})
