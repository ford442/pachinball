import { test, expect } from '@playwright/test'
import { AdventureTrackType } from '../src/adventure/adventure-types'
import {
  assertWasmOwnerReady,
  bootWasmOwner,
  startPlaying,
  type GameHooks,
} from './helpers/wasm-owner-boot'

/**
 * #383 cutover acceptance: every catalogued adventure track runs in
 * wasm-owner with the second Rapier world unstepped — full descriptor export,
 * `lastRapierStepMs === 0`, and moving gizmos posed by TypeScript rather than
 * Rapier's kinematic integration. Synthwave-surf additionally plays a ball.
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
      getColliderDescriptors: () => readonly {
        kind: string
        label?: string
        motion?: string
        angularVelocity?: { x: number; y: number; z: number }
        removed?: true
      }[]
      getBodyForDescriptor: (index: number) => { rotation: () => { x: number; y: number; z: number; w: number } } | null
      getUnexportedColliders: () => readonly string[]
      getPortalSensorHandle: () => number
      switchToTrack: (track: string) => Promise<boolean>
      activateExitPortal: (track: string, kind: 'success' | 'failure', mode?: string) => boolean
      deactivateExitPortal: () => void
    } | null
    scene?: { activeCamera?: unknown }
    physicsController?: NonNullable<GameHooks['game']>['physicsController'] & {
      getAdventureOwnership?: () => {
        owned: boolean
        unsupported: ReadonlyArray<{ reason: string; index?: number; label?: string }>
      }
    }
  }
}

const CATALOGUED_TRACKS = Object.values(AdventureTrackType)

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

/**
 * Take GPU work out of these physics-only tests. They drive `stepPhysics` by
 * hand, so the page's render loop is stopped; and `mapManager.update` is
 * stubbed because its periodic LCD-table texture re-upload (`texImage2D`) was
 * measured at over four minutes per call under headless software WebGL,
 * starving every later `page.evaluate`.
 */
async function pauseRendering(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const g = (window as unknown as {
      game?: { engine?: { stopRenderLoop?: () => void }; mapManager?: { update?: (dt: number) => void } }
    }).game
    g?.engine?.stopRenderLoop?.()
    if (g?.mapManager) g.mapManager.update = () => {}
  })
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
      g?.physicsController?.rebuildHandleCaches?.()
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

  test('every catalogued track exports fully and runs with Rapier unstepped', async ({ page }) => {
    test.setTimeout(600_000)

    const boot = await bootWasmOwner(page)
    assertWasmOwnerReady(boot)
    await startPlaying(page)
    await pauseRendering(page)

    const started = await startTrack(page, CATALOGUED_TRACKS[0])
    expect(started.error, started.error ?? 'track start failed').toBeNull()

    const failures: string[] = []
    let spinnersChecked = 0

    for (const track of CATALOGUED_TRACKS) {
      const switched = await page.evaluate(async (t) => {
        const g = (window as unknown as AdventureHooks).game
        const ok = (await g?.adventureMode?.switchToTrack(t)) ?? false
        g?.physicsController?.rebuildHandleCaches?.()
        return ok
      }, track)
      if (!switched) {
        failures.push(`${track}: switchToTrack failed`)
        continue
      }

      // Record every prescribed-spin body's pose, then step: Rapier stays
      // unstepped, so any rotation must come from the TypeScript driver.
      const spinners = await page.evaluate(() => {
        const a = (window as unknown as AdventureHooks).game?.adventureMode
        const descs = a?.getColliderDescriptors() ?? []
        return descs.flatMap((d, i) => {
          const w = d.angularVelocity
          if (d.removed || d.motion !== 'kinematic-velocity' || !w || Math.hypot(w.x, w.y, w.z) < 1e-6) return []
          const q = a?.getBodyForDescriptor(i)?.rotation()
          return q ? [{ index: i, label: d.label ?? '?', q: { x: q.x, y: q.y, z: q.z, w: q.w } }] : []
        })
      })

      const run = await stepPhysics(page, 30)

      const report = await page.evaluate((before) => {
        const g = (window as unknown as AdventureHooks).game
        const a = g?.adventureMode
        const ownership = g?.physicsController?.getAdventureOwnership?.()
        const stuck = before.filter(({ index, q }) => {
          const now = a?.getBodyForDescriptor(index)?.rotation()
          return !now || Math.abs(now.x * q.x + now.y * q.y + now.z * q.z + now.w * q.w) > 0.999999
        })
        return {
          descriptors: a?.getColliderDescriptors().length ?? 0,
          active: a?.isActive() ?? false,
          owned: ownership?.owned ?? false,
          unsupported: (ownership?.unsupported ?? []).map((u) => `${u.label ?? '?'}: ${u.reason}`),
          rapierMs: g?.physics?.getLastRapierStepMs?.() ?? -1,
          stuck: stuck.map((s) => s.label),
        }
      }, spinners)
      spinnersChecked += spinners.length

      const problems: string[] = []
      if (!report.active) problems.push('adventure not active')
      if (report.descriptors === 0) problems.push('no descriptors emitted')
      if (report.unsupported.length > 0) problems.push(`unsupported: ${[...new Set(report.unsupported)].join('; ')}`)
      if (!report.owned) problems.push('not owned by wasm')
      if (!run.ok || run.rapierMs !== 0 || report.rapierMs !== 0) problems.push(`Rapier stepped (${run.rapierMs} ms)`)
      if (run.wasmMs <= 0) problems.push('C++ engine did not step')
      if (report.stuck.length > 0) problems.push(`spinning bodies did not turn: ${report.stuck.join(', ')}`)
      if (problems.length > 0) failures.push(`${track}: ${problems.join(' | ')}`)
    }

    expect(failures, failures.join('\n')).toEqual([])
    // CYBER_CORE, CHRONO_CORE, CPU_CORE, … all carry platters; a zero here
    // would mean the rotation check above silently checked nothing.
    expect(spinnersChecked).toBeGreaterThan(5)
  })

  test('an exit portal opening and closing keeps the track owned', async ({ page }) => {
    test.setTimeout(180_000)

    const boot = await bootWasmOwner(page)
    assertWasmOwnerReady(boot)
    await startPlaying(page)
    await pauseRendering(page)
    const started = await startTrack(page, 'CYBER_CORE')
    expect(started.error, started.error ?? 'track start failed').toBeNull()

    const sample = async () => {
      const run = await stepPhysics(page, 10)
      return page.evaluate((rapierMs) => {
        const g = (window as unknown as AdventureHooks).game
        const descs = g?.adventureMode?.getColliderDescriptors() ?? []
        return {
          owned: g?.physicsController?.getAdventureOwnership?.()?.owned ?? false,
          rapierMs,
          livePortalSensors: descs.filter((d) => d.label === 'exitPortalSensor' && !d.removed).length,
        }
      }, run.rapierMs)
    }

    expect(await sample()).toEqual({ owned: true, rapierMs: 0, livePortalSensors: 0 })

    const opened = await page.evaluate(() =>
      (window as unknown as AdventureHooks).game?.adventureMode?.activateExitPortal('CYBER_CORE', 'success') ?? false
    )
    expect(opened).toBe(true)
    expect(await sample()).toEqual({ owned: true, rapierMs: 0, livePortalSensors: 1 })

    // Re-opening replaces the portal rather than stacking a second sensor.
    await page.evaluate(() => {
      (window as unknown as AdventureHooks).game?.adventureMode?.activateExitPortal('CYBER_CORE', 'failure')
    })
    expect(await sample()).toEqual({ owned: true, rapierMs: 0, livePortalSensors: 1 })

    await page.evaluate(() => {
      (window as unknown as AdventureHooks).game?.adventureMode?.deactivateExitPortal()
    })
    expect(await sample()).toEqual({ owned: true, rapierMs: 0, livePortalSensors: 0 })
  })
})
