import { test, expect } from '@playwright/test'
import { assertWasmOwnerReady, bootWasmOwner, type GameHooks } from './helpers/wasm-owner-boot'

/**
 * #444 Slice D in the real game: the start screen offers the table of the
 * week, Settings has the campaign save controls, and a race ghost follows its
 * verifier-recorded track step for step once a game starts. The dev server
 * keeps the arcade service offline, so the weekly button must fail softly.
 */

type GhostHooks = GameHooks & {
  game?: GameHooks['game'] & {
    scene?: { getMeshByName(name: string): { isEnabled(): boolean; position: { x: number; y: number; z: number } } | null }
    ghostRace?: unknown
    engine?: { getDeltaTime: () => number; stopRenderLoop: () => void }
    mapManager?: { update?: (dt: number) => void }
  }
}

test.describe('challenges v2 and the campaign save (#444 Slice D)', () => {
  test('start screen and settings offer the table of the week and the campaign save', async ({ page }) => {
    test.setTimeout(180_000)
    const boot = await bootWasmOwner(page)
    assertWasmOwnerReady(boot)
    await expect(page.locator('#weekly-btn')).toBeVisible()
    await page.locator('#settings-btn').click()
    await expect(page.locator('#campaign-save-status')).toHaveText('Saved on this device')
    await expect(page.locator('#campaign-link-code-btn')).toBeVisible()
    await expect(page.locator('#campaign-export-btn')).toBeVisible()
    await page.locator('#close-settings').click()

    // Offline (the dev server never talks to the arcade): a message, no game, no error.
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.locator('#weekly-btn').click()
    await expect.poll(() => page.evaluate(() => (window as unknown as GhostHooks).game?.stateManager?.isPlaying?.())).toBe(false)
    expect(errors).toEqual([])
  })

  test('a race ghost follows its track from the first step of the game', async ({ page }) => {
    test.setTimeout(180_000)
    const boot = await bootWasmOwner(page)
    assertWasmOwnerReady(boot)

    const seen = await page.evaluate(async () => {
      const g = (window as unknown as GhostHooks).game!
      // The dev server serves the game's own module, so this is its GhostRace.
      const { GhostRace } = await import('/src/replay/ghost-race.ts' as string) as typeof import('../src/replay/ghost-race')
      // Two samples, 2 steps apart: (1, 0.25, -9) then (1.2, 0.25, -8).
      const ints = Int32Array.from([1000, 250, -9000, 1200, 250, -8000])
      const bytes = new Uint8Array(ints.buffer)
      let binary = ''
      for (const b of bytes) binary += String.fromCharCode(b)
      g.ghostRace = new GhostRace(g.scene as never, { stride: 2, samples: 2, track: btoa(binary) }, 'test')

      g.engine!.stopRenderLoop()
      if (g.mapManager) g.mapManager.update = () => {}
      g.engine!.getDeltaTime = () => 1000 / 60
      await g.startGame!()
      const mesh = () => g.scene!.getMeshByName('ghostBallMesh')
      const frames: Array<{ enabled: boolean; x: number; z: number }> = []
      for (let i = 0; i < 6; i++) {
        g.physicsController!.stepPhysics(null, null, null, null)
        const m = mesh()
        frames.push({ enabled: !!m?.isEnabled(), x: m?.position.x ?? NaN, z: m?.position.z ?? NaN })
      }
      return frames
    })

    // After step 1: sample 0; step 2: halfway; step 3: sample 1; past the end: hidden.
    expect(seen[0]).toEqual({ enabled: true, x: 1, z: -9 })
    expect(seen[1]?.enabled).toBe(true)
    expect(seen[1]?.x).toBeCloseTo(1.1, 5)
    expect(seen[1]?.z).toBeCloseTo(-8.5, 5)
    expect(seen[2]).toMatchObject({ enabled: true })
    expect(seen[2]?.x).toBeCloseTo(1.2, 5)
    expect(seen[5]?.enabled).toBe(false)
  })
})
