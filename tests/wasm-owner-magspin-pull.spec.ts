import { test, expect } from '@playwright/test'
import {
  assertWasmOwnerReady,
  bootWasmOwner,
  startPlaying,
  type GameHooks,
} from './helpers/wasm-owner-boot'

/**
 * MagSpin's C++ pull well on the owner path (#420 leftover). A resting ball just
 * outside the capture radius is drawn in by the C++ engine and captured by the
 * (unchanged) TS proximity check; with the well gated off, the same ball on the
 * same table is not. Gating the well is the same collision-group path a held
 * ball or a cooldown uses.
 *
 * Trials stay short on purpose: past a few hundred frames of ball travel the
 * software-rendered dev server can stall on playfield effects (this is true of
 * main too), which is nothing to do with the well.
 */

type Vec = { x: number; y: number; z: number }

type PullHooks = GameHooks & {
  game?: GameHooks['game'] & {
    magSpinFeeder?: {
      getPosition: () => Vec
      getState: () => number
      getCatchRadius: () => number
      setGameplayEnabled: (enabled: boolean) => void
      getBodies: () => Array<{ setEnabled: (enabled: boolean) => void; isEnabled: () => boolean }>
    }
    ballManager?: {
      getBallBody?: () => {
        setTranslation: (v: Vec, w: boolean) => void
        setLinvel: (v: Vec, w: boolean) => void
        setAngvel: (v: Vec, w: boolean) => void
        translation: () => Vec
      }
    }
  }
}

interface Trial {
  ok: boolean
  reason: string
  /** Frames until the toy captured the ball, or -1. */
  capturedAt: number
  /** Sideways travel toward the well over the trial. */
  dx: number
}

const IDLE = 0
const CATCH = 1

test.describe('wasm-owner MagSpin pull well', () => {
  test('draws a resting ball in from outside the capture radius, and only while the well is on', async ({ page }) => {
    test.setTimeout(240_000)
    const boot = await bootWasmOwner(page)
    assertWasmOwnerReady(boot)
    await startPlaying(page)

    // The well is a C++ force field, exported with the table: the toy holds one body
    // for it and the owner reports nothing unsupported for it.
    const exported = await page.evaluate(() => {
      const g = (window as unknown as { game?: Record<string, any> }).game
      const bodies = g?.magSpinFeeder?.getBodies?.() ?? []
      const owner = g?.physicsController?.wasmOwner
      const unsupported = owner?.getTableUnsupported?.() ?? []
      return {
        ownerPresent: typeof owner?.getTableUnsupported === 'function',
        bodies: bodies.length,
        shapes: bodies.map((b: any) => b.colliders?.[0]?.desc?.shape?.kind),
        unsupportedWells: unsupported.filter((u: { shape: string }) => u.shape === 'axisPullField').length,
      }
    })
    expect(exported.ownerPresent).toBe(true)
    expect(exported.bodies).toBe(1)
    expect(exported.shapes).toEqual(['axisPullField'])
    expect(exported.unsupportedWells).toBe(0)

    // One evaluate per trial: put the toy back to a clean idle state, drop a ball at rest
    // `d` metres to the well's left, gate the well, and step the real game loop.
    const trial = (pull: boolean, d: number, maxFrames: number): Promise<Trial> =>
      page.evaluate(({ pull, d, maxFrames, IDLE, CATCH }) => {
        const g = (window as unknown as PullHooks).game
        const feeder = g?.magSpinFeeder
        const ball = g?.ballManager?.getBallBody?.()
        if (!g?.physicsController || !g.engine || !feeder || !ball) {
          return { ok: false, reason: 'hooks missing', capturedAt: -1, dx: 0 }
        }
        const well = feeder.getPosition()
        const [field] = feeder.getBodies()
        feeder.setGameplayEnabled(true)

        // Skip waiting out a whole spin + cooldown: release the ball and re-arm the toy.
        const internals = feeder as unknown as {
          caughtBall: unknown
          capture: { release: (b: unknown, launch?: object) => void }
          setState: (s: number) => void
        }
        if (feeder.getState() !== IDLE) {
          internals.capture.release(ball, {})
          internals.caughtBall = null
          internals.setState(IDLE)
        }
        const start = { x: well.x - d, y: 0.3, z: well.z }
        ball.setTranslation(start, true)
        ball.setLinvel({ x: 0, y: 0, z: 0 }, true)
        ball.setAngvel({ x: 0, y: 0, z: 0 }, true)
        g.physicsController.rebuildHandleCaches?.()
        field.setEnabled(pull)

        const origDt = g.engine.getDeltaTime.bind(g.engine)
        g.engine.getDeltaTime = () => 1000 / 60
        let capturedAt = -1
        try {
          for (let i = 0; i < maxFrames; i++) {
            g.physicsController.stepPhysics(g.inputManager, g.inputActions, null, null)
            if (feeder.getState() === CATCH) { capturedAt = i; break }
          }
        } finally {
          g.engine.getDeltaTime = origDt
        }
        const end = ball.translation()
        field.setEnabled(true)
        return { ok: true, reason: '', capturedAt, dx: end.x - start.x }
      }, { pull, d, maxFrames, IDLE, CATCH })

    // Inside the pull radius (3.0) but beyond the no-pull reach (~1.4): the well alone decides.
    const withoutPull = await trial(false, 1.7, 90)
    expect(withoutPull.ok, withoutPull.reason).toBe(true)
    expect(withoutPull.capturedAt).toBe(-1)

    const withPull = await trial(true, 1.7, 90)
    expect(withPull.ok, withPull.reason).toBe(true)
    expect(withPull.capturedAt).toBeGreaterThanOrEqual(0)

    // Further out the pull cannot capture, but the C++ field still bends the ball toward the well.
    const farOff = await trial(false, 2.5, 60)
    const farOn = await trial(true, 2.5, 60)
    expect(farOff.ok && farOn.ok).toBe(true)
    expect(farOn.capturedAt).toBe(-1)
    expect(farOn.dx - farOff.dx).toBeGreaterThan(0.15)
  })
})
