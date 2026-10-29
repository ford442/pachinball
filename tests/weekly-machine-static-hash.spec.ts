import { test, expect, type Page } from '@playwright/test'
import { assertWasmOwnerReady, bootWasmOwner } from './helpers/wasm-owner-boot'

/**
 * Two clients that load the same seed build the same `staticContentHash()`
 * before play — the weekly machine's descriptor is in the C++ world when the
 * frame-0 fingerprint is taken, so a spectator who loads the seed can restore
 * the recorder's snapshot.
 *
 * `?seed=N` selects the weekly machine for N (docs/DAILY_CASCADE.md); no seed
 * is the vanilla table. The page steps one idle frame so the owner has
 * exported the statics (`syncStatics` runs at the start of a step), then reads
 * the hash. Needs the compiled bundle, like the other wasm-owner specs.
 */

type Hashes = { ok: boolean; staticHash: string | null; seed: number | null; machine: string | null; pinFields: number }

/** The slice of `window.game` this spec drives (`GameHooks` does not type the engine's hash). */
type Game = {
  engine: { getDeltaTime: () => number; stopRenderLoop: () => void }
  startGame?: () => Promise<void>
  stateManager?: { isPlaying?: () => boolean }
  physicsController?: {
    rebuildHandleCaches?: () => void
    stepPhysics: (input: unknown, actions: null, runner: null, recorder: null) => void
  }
  replayRecorder?: { getMetadata?: () => { seed: number; machine?: string } | null }
  physics?: {
    getWasmEngine?: () => { getStaticContentHash?: () => string | null } | null
    getWasmTableWorld?: () => { allBodies(): Array<{ colliders: Array<{ desc: { shape: { kind: string } } }> }> } | null
  }
}

async function hashesAfterStart(page: Page): Promise<Hashes> {
  return page.evaluate(async () => {
    const g = (window as unknown as { game?: Game }).game
    const empty: Hashes = { ok: false, staticHash: null, seed: null, machine: null, pinFields: 0 }
    if (!g?.physicsController || !g.engine || !g.startGame) return empty

    g.engine.stopRenderLoop()
    g.engine.getDeltaTime = () => 1000 / 60
    await g.startGame()
    if (!g.stateManager?.isPlaying?.()) return empty
    g.physicsController.rebuildHandleCaches?.()
    const idle = {
      update: () => {},
      processBufferedInputs: () => ({
        flipperLeft: false, flipperRight: false, plungerCharge: null, plunger: false, nudge: null, timestamp: 0,
      }),
    }
    g.physicsController.stepPhysics(idle, null, null, null)

    const meta = g.replayRecorder?.getMetadata?.() ?? null
    const bodies = g.physics?.getWasmTableWorld?.()?.allBodies() ?? []
    return {
      ok: true,
      staticHash: g.physics?.getWasmEngine?.()?.getStaticContentHash?.() ?? null,
      seed: meta?.seed ?? null,
      machine: meta?.machine ?? null,
      pinFields: bodies.filter((b) => b.colliders.some((c) => c.desc.shape.kind === 'pinField')).length,
    }
  })
}

async function load(browser: import('@playwright/test').Browser, query: string): Promise<Hashes> {
  const context = await browser.newContext()
  const page = await context.newPage()
  const boot = await bootWasmOwner(page, 'wasm-owner', query)
  assertWasmOwnerReady(boot)
  const hashes = await hashesAfterStart(page)
  await context.close()
  return hashes
}

test.describe('weekly machine static hash', () => {
  test('the same seed builds the same statics on two clients; another seed or the vanilla table does not', async ({ browser }) => {
    test.setTimeout(300_000)
    const a = await load(browser, 'seed=20261029')
    const b = await load(browser, 'seed=20261029')
    const other = await load(browser, 'seed=20261030')
    const vanilla = await load(browser, '')

    for (const run of [a, b, other, vanilla]) expect(run.ok, JSON.stringify(run)).toBe(true)
    expect(a.machine).toBe('weekly')
    expect(a.seed).toBe(20261029)
    expect(vanilla.machine).toBeNull()
    expect(a.pinFields).toBe(1) // one PinField, not a cylinder per pin

    expect(a.staticHash).toMatch(/^[0-9a-f]{16}$/)
    expect(b.staticHash).toBe(a.staticHash)
    expect(other.staticHash).not.toBe(a.staticHash)
    expect(vanilla.staticHash).not.toBe(a.staticHash)
  })
})
