import { test, expect, type Page } from '@playwright/test'
import {
  assertWasmOwnerReady,
  bootWasmOwner,
  startPlaying,
  stripIsolationHeaders,
  type GameHooks,
} from './helpers/wasm-owner-boot'

/**
 * #439 Slice 1: with no localStorage override, a cross-origin-isolated page
 * boots the C++ world in a Dedicated Worker, a non-isolated page keeps the
 * in-process owner, and a worker that cannot load falls back to that owner
 * with the greppable degrade marker instead of hanging boot.
 *
 * Physics is stepped by hand (render loop stopped, fixed 1/60 s dt), as in
 * wasm-worker-adventure.spec.ts: headless SwiftShader renders about one frame
 * a second. Each step yields so the worker's replies land; on the worker, a
 * read trails the command that caused it by one step.
 */

const PHYSICS_DEGRADE_MARKER = '[Bootstrap][physics-degrade]'

type DefaultHooks = GameHooks & {
  game?: GameHooks['game'] & {
    engine?: { getDeltaTime: () => number; stopRenderLoop?: () => void }
    mapManager?: { update?: (dt: number) => void }
  }
}

function collectDegradeLogs(page: Page): string[] {
  const lines: string[] = []
  page.on('console', (msg) => {
    if (msg.text().includes(PHYSICS_DEGRADE_MARKER)) lines.push(msg.text())
  })
  return lines
}

/** Stop the render loop and advance `steps` fixed steps; returns the max worker step ms seen. */
async function stepByHand(page: Page, steps: number): Promise<number> {
  return page.evaluate(async (n) => {
    const g = (window as unknown as DefaultHooks).game!
    g.engine!.stopRenderLoop?.()
    // Physics-only: headless LCD re-uploads are slow.
    if (g.mapManager) g.mapManager.update = () => {}
    g.engine!.getDeltaTime = () => 1000 / 60
    let maxWorkerMs = 0
    for (let i = 0; i < n; i++) {
      g.physicsController!.stepPhysics(g.inputManager, g.inputActions, null, null)
      maxWorkerMs = Math.max(maxWorkerMs, g.physics?.getWasmEngine?.()?.getLastWorkerStepMs?.() ?? 0)
      // Let the worker's messages (attach / step-result) land.
      await new Promise((r) => setTimeout(r, 2))
    }
    return maxWorkerMs
  }, steps)
}

async function readBall(page: Page) {
  return page.evaluate(() => {
    const ball = (window as unknown as GameHooks).game!.ballManager!.getBallBody!()
    const p = ball.translation()
    return { x: p.x, z: p.z, vz: ball.linvel().z }
  })
}

async function readTiming(page: Page) {
  return page.evaluate(() => {
    const physics = (window as unknown as GameHooks).game?.physics
    return {
      isolated: crossOriginIsolated,
      mode: physics?.getWasmMode?.() ?? '',
      rapierMs: physics?.getLastRapierStepMs?.() ?? -1,
      stats: physics?.getWasmEngine?.()?.getTransportStats?.() ?? null,
      degradeReason: (window as unknown as { physicsDegradeReason?: string }).physicsDegradeReason ?? null,
    }
  })
}

test.describe('wasm-worker default (#439)', () => {
  test('isolated boot defaults to wasm-worker: plunger and flipper run in the worker', async ({ page }) => {
    test.setTimeout(240_000)
    const degrade = collectDegradeLogs(page)

    const boot = await bootWasmOwner(page, 'default')
    assertWasmOwnerReady(boot, 'wasm-worker')
    await startPlaying(page)

    // Plunger: let the served ball settle in the lane, then launch it.
    let maxWorkerMs = await stepByHand(page, 60)
    const before = await readBall(page)
    expect(before.x > 8 && before.z < -4, `served ball must rest in the plunger lane: ${JSON.stringify(before)}`).toBe(true)
    const fired = await page.evaluate(() => (window as unknown as GameHooks).game!.inputActions!.handlePlunger!(1))
    expect(fired, 'handlePlunger must find the ball in the plunger lane').toBe(true)
    maxWorkerMs = Math.max(maxWorkerMs, await stepByHand(page, 60))
    const after = await readBall(page)
    expect(after.z - before.z, 'the worker must carry the launched ball up the lane').toBeGreaterThan(2)

    // Flipper: same placement as wasm-worker-flipper.spec.ts.
    await page.evaluate(() => {
      const g = (window as unknown as GameHooks).game!
      const ball = g.ballManager!.getBallBody!()
      g.physicsController!.rebuildHandleCaches?.()
      ball.setTranslation({ x: -2.5, y: 0.4, z: -6.2 }, true)
      ball.setLinvel({ x: 0, y: 0, z: -1.5 }, true)
      g.physicsController!.rebuildHandleCaches?.()
      g.inputActions!.handleFlipperLeft!(true)
    })
    await stepByHand(page, 45)
    await page.evaluate(() => (window as unknown as GameHooks).game!.inputActions!.handleFlipperLeft!(false))
    await stepByHand(page, 15)
    const struck = await readBall(page)
    expect(Math.abs(struck.vz), 'the left flipper must strike the ball').toBeGreaterThan(0.5)

    const timing = await readTiming(page)
    expect(timing.isolated, 'dev server must send COOP/COEP').toBe(true)
    expect(timing.mode).toBe('wasm-worker')
    expect(timing.rapierMs, 'Rapier must not step on the worker default').toBe(0)
    expect(maxWorkerMs, 'getLastWorkerStepMs() must be measured inside the worker').toBeGreaterThan(0)
    expect(timing.stats?.transport).toBe('shared')
    expect(timing.stats?.sharedSnapshots).toBeGreaterThan(0)
    expect(timing.degradeReason).toBeNull()
    expect(degrade, 'a healthy worker boot logs no degrade marker').toEqual([])
  })

  test('non-isolated boot keeps the in-process wasm-owner', async ({ page }) => {
    test.setTimeout(240_000)
    const degrade = collectDegradeLogs(page)
    await stripIsolationHeaders(page)

    const boot = await bootWasmOwner(page, 'default')
    assertWasmOwnerReady(boot, 'wasm-owner')
    await startPlaying(page)
    await stepByHand(page, 30)

    const timing = await readTiming(page)
    expect(timing.isolated).toBe(false)
    expect(timing.mode).toBe('wasm-owner')
    expect(timing.rapierMs).toBe(0)
    expect(timing.degradeReason, 'choosing the owner is not a degrade').toBeNull()
    expect(degrade).toEqual([])
  })

  test('a worker script that cannot load falls back to wasm-owner with the marker', async ({ page }) => {
    test.setTimeout(240_000)
    const degrade = collectDegradeLogs(page)
    // The worker entry only (`/src/wasm/physics-worker.ts?worker_file` in dev);
    // the client / boot / protocol modules on the main thread still load.
    await page.route((url) => url.pathname.endsWith('/physics-worker.ts'), (route) => route.abort())

    const boot = await bootWasmOwner(page, 'default')
    assertWasmOwnerReady(boot, 'wasm-owner')
    await startPlaying(page)
    await stepByHand(page, 30)

    const timing = await readTiming(page)
    expect(timing.isolated).toBe(true)
    expect(timing.mode).toBe('wasm-owner')
    expect(timing.rapierMs).toBe(0)
    expect(timing.degradeReason).toContain(PHYSICS_DEGRADE_MARKER)
    expect(timing.degradeReason).toContain('worker')
    expect(degrade.some((line) => /worker/i.test(line))).toBe(true)
  })
})
