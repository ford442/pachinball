import { test, expect, type Page } from '@playwright/test'
import { assertWasmOwnerReady, bootWasmOwner, type GameHooks } from './helpers/wasm-owner-boot'

/**
 * `?seed=12345` twice → the same bumper-hit count over a fixed input tape (#422).
 *
 * Two fresh page loads with the same share-link seed must play the same game:
 * the seed reaches `initSessionRng`, the spawn / feeder forks draw the same
 * values, the C++ owner steps the same world, and scoring debounces on the
 * simulation clock rather than wall time.
 *
 * Not flaky on rAF: the render loop is stopped *before* `startGame()`, so the
 * page cannot step physics on its own between our calls, and the whole tape
 * then runs inside one `evaluate` at a pinned 1/60 s delta (the same trick as
 * wasm-owner-flipper.spec.ts, taken one step further).
 */

type TapeResult = {
  ok: boolean
  seed: number | null
  score: number
  bumperMatches: number
  ball: { x: number; y: number; z: number } | null
  staticHash: string | null
}

async function playTape(page: Page): Promise<TapeResult> {
  return page.evaluate(async () => {
    const g = (window as unknown as GameHooks).game as NonNullable<GameHooks['game']> & {
      engine: { getDeltaTime: () => number; stopRenderLoop: () => void }
      score?: number
      replayRecorder?: { getMetadata?: () => { seed: number } | null }
      physicsController: NonNullable<NonNullable<GameHooks['game']>['physicsController']> & {
        getBumperMatches?: () => number
      }
      physics: NonNullable<NonNullable<GameHooks['game']>['physics']> & {
        getWasmEngine?: () => { getStaticContentHash?: () => string | null }
      }
      gameObjects?: { getBumperVisuals?: () => Array<{ mesh: { position: { x: number; y: number; z: number } } }> }
    }
    const empty: TapeResult = { ok: false, seed: null, score: 0, bumperMatches: 0, ball: null, staticHash: null }
    if (!g?.physicsController || !g.engine || !g.startGame) return empty

    g.engine.stopRenderLoop()
    g.engine.getDeltaTime = () => 1000 / 60
    await g.startGame()
    if (!g.stateManager?.isPlaying?.()) return empty

    const ball = g.ballManager?.getBallBody?.()
    const bumper = g.gameObjects?.getBumperVisuals?.()?.[0]
    if (!ball || !bumper) return empty
    g.physicsController.rebuildHandleCaches?.()
    // Onto the first bumper, as scoring-collision-dispatch.spec.ts does, so the
    // tape is guaranteed to score; everything after this is the simulation's.
    const p = bumper.mesh.position
    ball.setTranslation({ x: p.x, y: p.y + 0.3, z: p.z + 0.9 }, true)
    ball.setLinvel({ x: 0.35, y: 0, z: -4 }, true)

    // Fixed tape: alternating flipper strokes, as a pure function of the frame.
    let frame = 0
    const input = {
      update: () => {},
      processBufferedInputs: () => {
        const f = frame++
        return {
          flipperLeft: f % 48 >= 8 && f % 48 < 20,
          flipperRight: (f + 24) % 48 >= 8 && (f + 24) % 48 < 20,
          plunger: false,
          nudge: null,
          timestamp: f * (1000 / 60),
        }
      },
    }
    for (let i = 0; i < 360; i++) g.physicsController.stepPhysics(input, null, null, null)

    const t = g.ballManager?.getBallBody?.()?.translation() ?? null
    return {
      ok: true,
      seed: g.replayRecorder?.getMetadata?.()?.seed ?? null,
      score: g.score ?? 0,
      bumperMatches: g.physicsController.getBumperMatches?.() ?? 0,
      ball: t ? { x: t.x, y: t.y, z: t.z } : null,
      staticHash: g.physics?.getWasmEngine?.()?.getStaticContentHash?.() ?? null,
    }
  })
}

test.describe('share-link seed determinism (#422)', () => {
  test('?seed=12345 twice gives the same bumper hits over a fixed tape', async ({ browser }) => {
    test.setTimeout(240_000)
    const runs: TapeResult[] = []
    for (let i = 0; i < 2; i++) {
      const context = await browser.newContext()
      const page = await context.newPage()
      const boot = await bootWasmOwner(page, 'wasm-owner', 'seed=12345')
      assertWasmOwnerReady(boot)
      runs.push(await playTape(page))
      await context.close()
    }

    const [a, b] = runs
    expect(a!.ok, JSON.stringify(a)).toBe(true)
    expect(b!.ok, JSON.stringify(b)).toBe(true)
    // The share-link seed is the session seed the recorder logs.
    expect(a!.seed).toBe(12345)
    expect(b!.seed).toBe(12345)
    expect(a!.bumperMatches).toBeGreaterThan(0)
    expect(b!.bumperMatches, `run A ${JSON.stringify(a)} vs run B ${JSON.stringify(b)}`).toBe(a!.bumperMatches)
    expect(b!.score).toBe(a!.score)
    expect(b!.ball).toEqual(a!.ball)
    expect(b!.staticHash).toBe(a!.staticHash)
  })
})
