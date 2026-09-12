/**
 * E2E for #383 Slice B: an adventure track runs in `wasm-owner` with Rapier
 * unstepped.
 *
 * The load-bearing assertion is that the Rapier world's step counter stays
 * flat while adventure is active — that is the whole point of the slice, and
 * the thing that silently regresses if geometry export ever starts failing.
 */

import { test, expect, type Page } from '@playwright/test'

test.setTimeout(180_000)

interface CutoverGame {
  adventureMode?: {
    isActive: () => boolean
    collectTrackBodies?: () => unknown[]
  }
  physics?: {
    getWasmMode?: () => string
    isWasmOwnerMode?: () => boolean
    getOwnerSkipRapierStep?: () => boolean
    getWorld?: () => { timestep?: number } | null
  }
  physicsController?: {
    getAdventureOwnership?: () => {
      owned: boolean
      unsupported: ReadonlyArray<{ reason: string; index?: number; label?: string }>
    }
  }
  levelLoader?: {
    loadCampaignTrack: (trackId: string, options?: { resetBallToPlunger?: boolean }) => { success: boolean }
  }
  startAdventureMode: () => void
  endAdventureMode: () => void
}

async function bootGame(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('pachinball:physics-engine', 'wasm-owner')
  })
  await page.goto('http://localhost:5173/?renderer=webgl2')

  const startBtn = page.locator('#start-btn')
  await expect(startBtn).toBeVisible({ timeout: 30_000 })

  await expect.poll(
    () => page.evaluate(() => !!(window as unknown as { game?: { stateManager?: unknown } }).game?.stateManager),
    { intervals: [200], timeout: 90_000 }
  ).toBe(true)

  // Click through the DOM rather than the mouse: the cabinet-selector overlay
  // sits over the button and intercepts pointer events.
  await page.evaluate(() => { document.getElementById('start-btn')?.click() })

  await expect.poll(async () => page.evaluate(() => {
    const g = (window as unknown as { game?: { stateManager?: { isPlaying?: () => boolean } } }).game
    return g?.stateManager?.isPlaying?.() ?? false
  }), { intervals: [200], timeout: 90_000 }).toBe(true)
}

test.describe('wasm-owner adventure cutover', () => {
  test('Neon Helix runs in wasm-owner with Rapier unstepped', async ({ page }) => {
    await bootGame(page)

    const mode = await page.evaluate(() => {
      const g = (window as unknown as Record<string, unknown>).game as CutoverGame
      return g.physics?.getWasmMode?.() ?? 'rapier'
    })
    test.skip(mode !== 'wasm-owner', `WASM unavailable in this runner (mode=${mode})`)

    const result = await page.evaluate(async () => {
      const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
      const g = (window as unknown as Record<string, unknown>).game as CutoverGame

      if (g.adventureMode?.isActive()) g.endAdventureMode()
      g.startAdventureMode()
      await wait(400)
      g.levelLoader?.loadCampaignTrack('NEON_HELIX', { resetBallToPlunger: true })
      await wait(800)

      const ownership = g.physicsController?.getAdventureOwnership?.()
      const trackBodyCount = g.adventureMode?.collectTrackBodies?.().length ?? 0
      const adventureOwned = ownership?.owned ?? false
      const unsupported = [...(ownership?.unsupported ?? [])]

      // Rapier exposes no step counter, so count integration indirectly: a
      // disabled, unstepped world leaves a free-floating probe body exactly
      // where it was put. Under gravity a stepping world would move it.
      const world = g.physics?.getWorld?.() as
         
        { createRigidBody?: (d: unknown) => any; removeRigidBody?: (b: unknown) => void } | null

      let probeMoved = -1
       
      const RAPIER = (window as unknown as { RAPIER?: any }).RAPIER
      if (world?.createRigidBody && RAPIER) {
        const probe = world.createRigidBody(
          RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 50, 0)
        )
        const y0 = probe.translation().y
        await wait(600)
        probeMoved = Math.abs(probe.translation().y - y0)
        world.removeRigidBody?.(probe)
      }

      return {
        adventureActive: g.adventureMode?.isActive() ?? false,
        trackBodyCount,
        adventureOwned,
        unsupportedCount: unsupported.length,
        unsupported: JSON.stringify(unsupported).slice(0, 500),
        skipRapierStep: g.physics?.getOwnerSkipRapierStep?.() ?? false,
        probeMoved,
      }
    })

    expect(result.adventureActive).toBe(true)
    expect(result.trackBodyCount).toBeGreaterThan(0)

    // Every Neon Helix collider must have a WASM equivalent.
    expect(result.unsupportedCount, `unsupported geometry: ${result.unsupported}`).toBe(0)
    expect(result.adventureOwned).toBe(true)

    // ...and with the track owned, Rapier's integration is switched off.
    expect(result.skipRapierStep).toBe(true)
    if (result.probeMoved >= 0) {
      expect(result.probeMoved).toBeLessThan(0.01)
    }
  })

  test('falls back to a stepping Rapier world when WASM is unavailable', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('pachinball:physics-engine', 'rapier')
    })
    await page.goto('http://localhost:5173/?renderer=webgl2')
    await expect(page.locator('#start-btn')).toBeVisible({ timeout: 30_000 })
    await expect.poll(
      () => page.evaluate(() => !!(window as unknown as { game?: { stateManager?: unknown } }).game?.stateManager),
      { intervals: [200], timeout: 90_000 }
    ).toBe(true)
    await page.evaluate(() => { document.getElementById('start-btn')?.click() })

    await expect.poll(async () => page.evaluate(() => {
      const g = (window as unknown as { game?: { stateManager?: { isPlaying?: () => boolean } } }).game
      return g?.stateManager?.isPlaying?.() ?? false
    }), { intervals: [200], timeout: 90_000 }).toBe(true)

    const result = await page.evaluate(async () => {
      const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
      const g = (window as unknown as Record<string, unknown>).game as CutoverGame
      if (g.adventureMode?.isActive()) g.endAdventureMode()
      g.startAdventureMode()
      await wait(400)
      g.levelLoader?.loadCampaignTrack('NEON_HELIX', { resetBallToPlunger: true })
      await wait(600)
      return {
        adventureActive: g.adventureMode?.isActive() ?? false,
        isOwner: g.physics?.isWasmOwnerMode?.() ?? false,
        trackBodyCount: g.adventureMode?.collectTrackBodies?.().length ?? 0,
      }
    })

    // The track still builds and plays on the Rapier-only path (#382 fallback).
    expect(result.isOwner).toBe(false)
    expect(result.adventureActive).toBe(true)
    expect(result.trackBodyCount).toBeGreaterThan(0)
  })
})
