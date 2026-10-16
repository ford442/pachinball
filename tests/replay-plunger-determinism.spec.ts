import { test, expect, type Page } from '@playwright/test'
import { assertWasmOwnerReady, bootWasmOwner, type GameHooks } from './helpers/wasm-owner-boot'

/**
 * `?seed=12345` twice, a scripted Space-bar hold of N frames → the same launch
 * impulse and the same bumper hits (#441). Then the first run's tape replays
 * in a fresh page whose own plunger charge is idle (0) — the launch must still
 * match, because the charge rides on the tape.
 *
 * Real input path: keydown/keyup reach the game's `InputHandler`, charge
 * counts fixed steps held, `processBufferedInputs()` puts it on the frame and
 * the recorder writes it. Not flaky on rAF: the render loop is stopped before
 * `startGame()` and every frame runs inside one `evaluate` at a pinned 1/60 s
 * delta, as in replay-seed-determinism.spec.ts.
 */

const HOLD_FRAMES = 80
/** A different hold — the control that shows charge actually changes the shot. */
const SHORT_HOLD_FRAMES = 40
/**
 * Long enough for the shot to run the lane and score its sensor, short of the
 * drain (whose game-over path is very slow under headless WebGL).
 */
const PLAY_FRAMES = 240

type RunResult = {
  ok: boolean
  reason?: string
  launchImpulse: number
  score: number
  bumperMatches: number
  ball: { x: number; y: number; z: number } | null
  tape: string | null
  tapeCharge: number | null
  snapshotOutcome: string | null
}

type Game = NonNullable<GameHooks['game']> & {
  engine: { getDeltaTime: () => number; stopRenderLoop: () => void }
  score?: number
  plungerChargeLevel: number
  replayRecorder: {
    stop: (score: number) => unknown
    constructor: { toJSON: (p: unknown, compress?: boolean) => string; fromJSON: (j: string) => { frames: unknown[] } }
  }
  replayRunner: { load: (p: unknown) => void }
  physicsController: NonNullable<NonNullable<GameHooks['game']>['physicsController']> & {
    getBumperMatches?: () => number
    getLastReplaySnapshotResult?: () => { outcome: string } | null
    stepPhysics: (...args: unknown[]) => void
  }
}

/** Live run: hold Space for HOLD_FRAMES fixed steps, release, play on; return the uploaded tape. */
async function playLive(page: Page, holdFrames = HOLD_FRAMES): Promise<RunResult> {
  return page.evaluate(async ({ hold, play }) => {
    const g = (window as unknown as { game: Game }).game
    const out: RunResult = { ok: false, launchImpulse: 0, score: 0, bumperMatches: 0, ball: null, tape: null, tapeCharge: null, snapshotOutcome: null }
    if (!g?.physicsController || !g.engine || !g.startGame || !g.inputActions) return { ...out, reason: 'hooks' }

    g.engine.stopRenderLoop()
    g.engine.getDeltaTime = () => 1000 / 60
    await g.startGame()
    if (!g.stateManager?.isPlaying?.()) return { ...out, reason: 'not playing' }
    g.physicsController.rebuildHandleCaches?.()

    const step = () => g.physicsController.stepPhysics(g.inputManager, g.inputActions, null, g.replayRecorder)
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }))
    for (let i = 0; i < hold; i++) step()
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' }))
    for (let i = 0; i < play; i++) step()

    const payload = g.replayRecorder.stop(g.score ?? 0)
    const tape = g.replayRecorder.constructor.toJSON(payload, true)
    const frames = g.replayRecorder.constructor.fromJSON(tape).frames as Array<{ plungerCharge: number | null }>
    const t = g.ballManager?.getBallBody?.()?.translation() ?? null
    return {
      ok: true,
      launchImpulse: g.inputActions.lastLaunchImpulse ?? 0,
      score: g.score ?? 0,
      bumperMatches: g.physicsController.getBumperMatches?.() ?? 0,
      ball: t ? { x: t.x, y: t.y, z: t.z } : null,
      tape,
      tapeCharge: frames.find((f) => f.plungerCharge !== null)?.plungerCharge ?? null,
      snapshotOutcome: null,
    }
  }, { hold: holdFrames, play: PLAY_FRAMES })
}

/** Spectator: idle live charge, replay the tape through the game's own runner. */
async function playReplay(page: Page, tape: string): Promise<RunResult> {
  return page.evaluate(async (json) => {
    const g = (window as unknown as { game: Game }).game
    const out: RunResult = { ok: false, launchImpulse: 0, score: 0, bumperMatches: 0, ball: null, tape: null, tapeCharge: null, snapshotOutcome: null }
    if (!g?.physicsController || !g.engine || !g.startGame || !g.inputActions) return { ...out, reason: 'hooks' }

    g.engine.stopRenderLoop()
    g.engine.getDeltaTime = () => 1000 / 60
    const payload = g.replayRecorder.constructor.fromJSON(json)
    g.replayRunner.load(payload)
    await g.startGame()
    if (!g.stateManager?.isPlaying?.()) return { ...out, reason: 'not playing' }
    g.physicsController.rebuildHandleCaches?.()
    g.plungerChargeLevel = 0

    for (let i = 0; i < payload.frames.length; i++) {
      g.plungerChargeLevel = 0 // whatever the spectator holds is irrelevant
      g.physicsController.stepPhysics(null, g.inputActions, g.replayRunner, null)
    }
    const t = g.ballManager?.getBallBody?.()?.translation() ?? null
    return {
      ...out,
      ok: true,
      launchImpulse: g.inputActions.lastLaunchImpulse ?? 0,
      score: g.score ?? 0,
      bumperMatches: g.physicsController.getBumperMatches?.() ?? 0,
      ball: t ? { x: t.x, y: t.y, z: t.z } : null,
      snapshotOutcome: g.physicsController.getLastReplaySnapshotResult?.()?.outcome ?? null,
    }
  }, tape)
}

async function freshPage(browser: import('@playwright/test').Browser) {
  const context = await browser.newContext()
  const page = await context.newPage()
  const boot = await bootWasmOwner(page, 'wasm-owner', 'seed=12345')
  assertWasmOwnerReady(boot)
  return { context, page }
}

test.describe('plunger charge on the replay tape (#441)', () => {
  test('?seed=12345 twice with the same N-frame hold launches identically; the tape replays it', async ({ browser }) => {
    test.setTimeout(300_000)
    const runs: RunResult[] = []
    for (let i = 0; i < 2; i++) {
      const { context, page } = await freshPage(browser)
      runs.push(await playLive(page))
      await context.close()
    }
    const [a, b] = runs
    expect(a!.ok, JSON.stringify(a)).toBe(true)
    expect(b!.ok, JSON.stringify(b)).toBe(true)

    // Charge is HOLD_FRAMES fixed steps of the max charge time, carried on the tape.
    expect(a!.tapeCharge).not.toBeNull()
    expect(a!.tapeCharge!).toBeGreaterThan(0)
    expect(a!.launchImpulse).toBeGreaterThan(0)
    expect(b!.tapeCharge).toBe(a!.tapeCharge)
    expect(b!.launchImpulse).toBe(a!.launchImpulse)
    expect(b!.bumperMatches, `run A ${JSON.stringify({ ...a, tape: undefined })} vs B ${JSON.stringify({ ...b, tape: undefined })}`).toBe(a!.bumperMatches)
    expect(b!.score).toBe(a!.score)
    expect(b!.ball).toEqual(a!.ball)

    // Spectate run A's tape with an idle charge: same launch, same game.
    const { context, page } = await freshPage(browser)
    const r = await playReplay(page, a!.tape!)
    await context.close()
    expect(r.ok, JSON.stringify(r)).toBe(true)
    expect(r.snapshotOutcome).toBe('restored')
    expect(r.launchImpulse).toBe(a!.launchImpulse)
    expect(r.bumperMatches).toBe(a!.bumperMatches)
    expect(r.score).toBe(a!.score)
    expect(r.ball).toEqual(a!.ball)

    // Control: a shorter hold is a different shot, so the matches above are not vacuous.
    const control = await freshPage(browser)
    const c = await playLive(control.page, SHORT_HOLD_FRAMES)
    await control.context.close()
    expect(c.ok, JSON.stringify(c)).toBe(true)
    expect(c.tapeCharge!).toBeLessThan(a!.tapeCharge!)
    expect(c.launchImpulse).toBeLessThan(a!.launchImpulse)
    expect(c.ball).not.toEqual(a!.ball)
  })
})
