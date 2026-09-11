import { test, expect } from '@playwright/test'
import {
  assertWasmOwnerReady,
  bootWasmOwner,
  startPlaying,
  type GameHooks,
} from './helpers/wasm-owner-boot'

/**
 * #383 Slice B acceptance: synthwave-surf runs in wasm-owner with the second
 * Rapier world unstepped. Every other track keeps stepping Rapier, so the
 * gate is checked per track, not as a blanket flag.
 *
 * Drives stepPhysics directly, like the other wasm-owner specs, to avoid rAF
 * hangs in headless runs.
 */

type AdventureHooks = GameHooks & {
  game?: GameHooks['game'] & {
    adventureMode?: {
      isActive: () => boolean
      start: (
        ballBody: unknown,
        camera: unknown,
        ballMesh: unknown,
        trackType: string
      ) => Promise<void>
      getColliderDescriptors: () => readonly { kind: string; label?: string }[]
      getUnexportedColliders: () => readonly string[]
      getPortalSensorHandle: () => number
    } | null
    scene?: { activeCamera?: unknown }
    physicsController?: GameHooks['game'] extends { physicsController?: infer P } ? P : never
  }
}

async function startTrack(page: import('@playwright/test').Page, trackType: string) {
  return page.evaluate(async (track) => {
    const g = (window as unknown as AdventureHooks).game
    const ball = g?.ballManager?.getBallBody?.()
    const camera = g?.scene?.activeCamera
    if (!g?.adventureMode || !ball || !camera) {
      return { ok: false, error: 'adventure mode, ball or camera missing' }
    }
    try {
      await g.adventureMode.start(ball, camera, undefined, track)
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
    g.physicsController?.rebuildHandleCaches?.()
    return { ok: g.adventureMode.isActive(), error: null as string | null }
  }, trackType)
}

/** Run the fixed-step physics loop n times with a pinned dt. */
async function stepPhysics(page: import('@playwright/test').Page, steps: number) {
  return page.evaluate((n) => {
    const g = (window as unknown as AdventureHooks).game
    if (!g?.physicsController || !g.engine) return { ok: false, rapierMs: -1, wasmMs: -1 }
    const origDt = g.engine.getDeltaTime.bind(g.engine)
    g.engine.getDeltaTime = () => 1000 / 60
    try {
      for (let i = 0; i < n; i++) {
        g.physicsController.stepPhysics(g.inputManager, g.inputActions, null, null)
      }
    } finally {
      g.engine.getDeltaTime = origDt
    }
    return {
      ok: true,
      rapierMs: g.physics?.getLastRapierStepMs?.() ?? -1,
      wasmMs: (g.physics as unknown as { getLastWasmStepMs?: () => number })
        ?.getLastWasmStepMs?.() ?? -1,
    }
  }, steps)
}

test.describe('wasm-owner adventure: synthwave-surf runs without Rapier', () => {
  test('plays a ball through synthwave-surf with lastRapierStepMs === 0', async ({ page }) => {
    test.setTimeout(180_000)

    // Only physics/WASM console errors are interesting here. Babylon's
    // GL_MAX_VERTEX_UNIFORM_BUFFERS shader-compile failures are swiftshader
    // limits in the headless container and fire on every spec in this repo.
    const physicsErrors: string[] = []
    const isPhysicsError = (text: string) =>
      /wasm|physics|rapier|PhysicsModule|physics-degrade/i.test(text) &&
      !text.startsWith('BJS - ')
    page.on('console', (msg) => {
      if (msg.type() === 'error' && isPhysicsError(msg.text())) physicsErrors.push(msg.text())
    })
    page.on('pageerror', (err) => {
      if (isPhysicsError(err.message)) physicsErrors.push(err.message)
    })

    const boot = await bootWasmOwner(page)
    assertWasmOwnerReady(boot)
    await startPlaying(page)

    const started = await startTrack(page, 'SYNTHWAVE_SURF')
    expect(started.error, started.error ?? 'track start failed').toBeNull()
    expect(started.ok).toBe(true)

    // The track must actually be emitting descriptors, not silently building
    // nothing — otherwise "fully exported" would be vacuously true.
    const track = await page.evaluate(() => {
      const g = (window as unknown as AdventureHooks).game
      const descs = g?.adventureMode?.getColliderDescriptors?.() ?? []
      return {
        total: descs.length,
        kinds: [...new Set(descs.map((d) => d.kind))].sort(),
        unexported: [...(g?.adventureMode?.getUnexportedColliders?.() ?? [])],
        portalHandle: g?.adventureMode?.getPortalSensorHandle?.() ?? -1,
      }
    })
    expect(track.unexported, 'synthwave-surf must build no non-descriptor geometry').toEqual([])
    expect(track.total).toBeGreaterThan(20)
    expect(track.kinds).toContain('box')
    expect(track.portalHandle).toBe(-1)

    // Drop the ball onto the first ramp and let it run.
    const placed = await page.evaluate(() => {
      const g = (window as unknown as AdventureHooks).game
      const rapier = g?.physics?.getRapier?.()
      const ball = g?.ballManager?.getBallBody?.()
      if (!rapier || !ball) return false
      ball.setTranslation(new rapier.Vector3(0, 2, 1), true)
      ball.setLinvel(new rapier.Vector3(0, 0, 0), true)
      g.physicsController?.rebuildHandleCaches?.()
      return true
    })
    expect(placed).toBe(true)

    const before = await page.evaluate(() => {
      const t = (window as unknown as AdventureHooks).game?.ballManager?.getBallBody?.()?.translation()
      return { x: t?.x ?? 0, y: t?.y ?? 0, z: t?.z ?? 0 }
    })

    const run = await stepPhysics(page, 180)
    expect(run.ok).toBe(true)

    const after = await page.evaluate(() => {
      const g = (window as unknown as AdventureHooks).game
      const t = g?.ballManager?.getBallBody?.()?.translation()
      return {
        x: t?.x ?? 0,
        y: t?.y ?? 0,
        z: t?.z ?? 0,
        adventureActive: g?.adventureMode?.isActive() ?? false,
        engine: (window as unknown as { currentPhysicsEngine?: string }).currentPhysicsEngine ?? null,
        rapierMs: g?.physics?.getLastRapierStepMs?.() ?? -1,
      }
    })

    expect(after.engine).toBe('wasm-owner')
    expect(after.adventureActive, 'adventure must still be running').toBe(true)
    expect(after.rapierMs, 'Rapier must not step while synthwave-surf is active').toBe(0)
    expect(run.rapierMs).toBe(0)
    expect(run.wasmMs, 'the C++ engine must be the one doing the work').toBeGreaterThan(0)

    // The ball actually simulated — C++ moved it, Rapier did not.
    const travelled = Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z)
    expect(
      travelled,
      `ball did not move: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`
    ).toBeGreaterThan(0.5)
    expect(Number.isFinite(travelled)).toBe(true)

    expect(physicsErrors, `physics console errors: ${physicsErrors.join(' | ')}`).toEqual([])
  })

  test('prism-pathway reports geometry C++ cannot own, so the gate keeps it on Rapier', async ({ page }) => {
    test.setTimeout(180_000)

    const boot = await bootWasmOwner(page)
    assertWasmOwnerReady(boot)
    await startPlaying(page)

    const started = await startTrack(page, 'PRISM_PATHWAY')
    expect(started.error, started.error ?? 'track start failed').toBeNull()
    expect(started.ok).toBe(true)

    const track = await page.evaluate(() => {
      const g = (window as unknown as AdventureHooks).game
      return {
        unexported: [...(g?.adventureMode?.getUnexportedColliders?.() ?? [])],
        descriptors: g?.adventureMode?.getColliderDescriptors?.().length ?? 0,
      }
    })
    // The convex hull has no descriptor at all, so however clean the rest of
    // the track looks, WasmOwner.syncAdventureTrack must refuse to own it.
    expect(track.unexported.length).toBeGreaterThan(0)
    expect(track.unexported.join(' ')).toMatch(/convexHull/)
    expect(track.descriptors).toBeGreaterThan(0)

    // Deliberately NOT stepping physics here. Any adventure track that still
    // steps Rapier under wasm-owner traps the Rapier WASM module — that is
    // pre-existing on main (verified there for prism-pathway and for
    // synthwave-surf before this slice) and is not what this spec gates.
    // The refusal itself is covered by tests/wasm-owner-adventure.test.ts.
  })
})
