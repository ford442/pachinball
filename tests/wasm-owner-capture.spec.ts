import { test, expect } from '@playwright/test'
import {
  assertWasmOwnerReady,
  bootWasmOwner,
  startPlaying,
  type GameHooks,
} from './helpers/wasm-owner-boot'

/**
 * MagSpin capture / release on the C++ owner path (#420).
 *
 * The feeder takes a live ball into its well: the C++ body flips to
 * Kinematic (native `setBodyType`), is steered onto the hold point by
 * `setNextKinematicTransform` targets on its WASM id, and on release flips
 * back to Dynamic and leaves on the launch impulse. No Rapier anywhere
 * (`lastRapierStepMs === 0`, and the boot never fetched it).
 */

type Vec = { x: number; y: number; z: number }

type CaptureHooks = GameHooks & {
  game?: GameHooks['game'] & {
    magSpinFeeder?: {
      getPosition: () => Vec
      getState: () => number
      setGameplayEnabled: (enabled: boolean) => void
      onStateChange: ((state: number) => void) | null
    }
    ballManager?: {
      getBallBody?: () => {
        wasmId?: number | null
        setTranslation: (v: Vec, w: boolean) => void
        setLinvel: (v: Vec, w: boolean) => void
        setAngvel: (v: Vec, w: boolean) => void
        translation: () => Vec
        linvel: () => Vec
      }
    }
  }
}

/** MagSpinState: IDLE, CATCH, SPIN, RELEASE, COOLDOWN. */
const MAG_SPIN = { IDLE: 0, CATCH: 1, SPIN: 2, RELEASE: 3, COOLDOWN: 4 } as const
/** GameConfig.magSpin.holdYOffset. */
const HOLD_Y_OFFSET = 0.5

test.describe('wasm-owner MagSpin capture', () => {
  test('captures a ball into the well as a C++ kinematic body and launches it', async ({ page }) => {
    test.setTimeout(180_000)
    const boot = await bootWasmOwner(page)
    assertWasmOwnerReady(boot)
    await startPlaying(page)

    const run = await page.evaluate(({ MAG_SPIN, HOLD_Y_OFFSET }) => {
      const g = (window as unknown as CaptureHooks).game
      const feeder = g?.magSpinFeeder
      const ball = g?.ballManager?.getBallBody?.()
      const engine = g?.physics?.getWasmEngine?.() as unknown as {
        getPosition: (id: number) => Vec
        getVelocity: (id: number) => Vec
        getBodyType?: (id: number) => number
      } | undefined
      if (!g?.physicsController || !g.engine || !feeder || !ball || !engine || ball.wasmId == null) {
        return { ok: false, reason: 'hooks missing' }
      }
      const id = ball.wasmId

      feeder.setGameplayEnabled(true)
      const well = feeder.getPosition()
      const hold = { x: well.x, y: well.y + HOLD_Y_OFFSET, z: well.z }
      ball.setTranslation({ x: well.x + 0.3, y: 0.5, z: well.z + 0.3 }, true)
      ball.setLinvel({ x: 0, y: 0, z: 0 }, true)
      ball.setAngvel({ x: 0, y: 0, z: 0 }, true)
      g.physicsController.rebuildHandleCaches?.()

      const states: number[] = [feeder.getState()]
      let maxHoldError = 0
      let heldFrames = 0
      const heldTypes = new Set<number>()
      let releaseSpeed = 0
      let releasedType = -1
      let framesAfterRelease = -1

      const origDt = g.engine.getDeltaTime.bind(g.engine)
      g.engine.getDeltaTime = () => 1000 / 60
      try {
        for (let i = 0; i < 400 && framesAfterRelease < 3; i++) {
          g.physicsController.stepPhysics(g.inputManager, g.inputActions, null, null)
          const state = feeder.getState()
          if (states[states.length - 1] !== state) states.push(state)
          if (state === MAG_SPIN.SPIN) {
            heldFrames++
            // From the second SPIN tick the well has pushed its hold point.
            if (heldFrames > 2) {
              const p = engine.getPosition(id)
              maxHoldError = Math.max(maxHoldError, Math.hypot(p.x - hold.x, p.y - hold.y, p.z - hold.z))
              if (engine.getBodyType) heldTypes.add(engine.getBodyType(id))
            }
          }
          if (framesAfterRelease >= 0 || state === MAG_SPIN.RELEASE || state === MAG_SPIN.COOLDOWN) {
            framesAfterRelease++
            if (framesAfterRelease === 1) {
              const v = engine.getVelocity(id)
              releaseSpeed = Math.hypot(v.x, v.y, v.z)
              releasedType = engine.getBodyType?.(id) ?? -1
            }
          }
        }
      } finally {
        g.engine.getDeltaTime = origDt
      }

      return {
        ok: true,
        reason: '',
        states,
        heldFrames,
        maxHoldError,
        heldTypes: [...heldTypes],
        releaseSpeed,
        releasedType,
        rapierMs: g.physics?.getLastRapierStepMs?.() ?? -1,
        engine: (window as unknown as { currentPhysicsEngine?: string }).currentPhysicsEngine ?? null,
      }
    }, { MAG_SPIN, HOLD_Y_OFFSET })

    expect(run.ok, run.reason).toBe(true)
    expect(run.engine).toBe('wasm-owner')
    expect(run.rapierMs).toBe(0)
    expect(run.states).toEqual([MAG_SPIN.IDLE, MAG_SPIN.CATCH, MAG_SPIN.SPIN, MAG_SPIN.RELEASE, MAG_SPIN.COOLDOWN])
    // Held: the C++ body follows the well onto its hold point and stays there, kinematic.
    expect(run.heldFrames).toBeGreaterThan(30)
    expect(run.maxHoldError).toBeLessThan(1e-3)
    expect(run.heldTypes).toEqual([2])
    // Released: dynamic again, and moving on the launch impulse.
    expect(run.releasedType).toBe(0)
    expect(run.releaseSpeed).toBeGreaterThan(5)
  })

  test('the ball-trap funnel is a C++ cone that catches, holds and launches a ball', async ({ page }) => {
    test.setTimeout(180_000)
    const boot = await bootWasmOwner(page)
    assertWasmOwnerReady(boot)
    await startPlaying(page)

    const run = await page.evaluate(() => {
      type TrapState = { body: unknown; caughtBall: unknown; chamber: Vec; holdDuration: number }
      const g = (window as unknown as CaptureHooks).game as CaptureHooks['game'] & {
        trapStates?: TrapState[]
        ballTrapBuilder?: { updateTrap: (state: TrapState, dt: number) => unknown }
        physicsController?: { wasmOwner?: { getTableUnsupported: () => Array<{ shape: string }> } }
      }
      const trap = g?.trapStates?.[0]
      const ball = g?.ballManager?.getBallBody?.()
      const engine = g?.physics?.getWasmEngine?.() as unknown as {
        getPosition: (id: number) => Vec
        getVelocity: (id: number) => Vec
        getBodyType?: (id: number) => number
      } | undefined
      const traps = g?.ballTrapBuilder
      if (!g?.physicsController || !g.engine || !trap || !traps || !ball || !engine || ball.wasmId == null) {
        return { ok: false, reason: 'hooks missing' }
      }
      const id = ball.wasmId
      // One game tick: physics, then the trap update renderFrame runs.
      const step = () => {
        g.physicsController!.stepPhysics(g.inputManager, g.inputActions, null, null)
        traps.updateTrap(trap, 1 / 60)
      }
      const origDt = g.engine.getDeltaTime.bind(g.engine)
      g.engine.getDeltaTime = () => 1000 / 60
      try {
        step() // pick up the trap export
        const unsupportedCones = (g.physicsController.wasmOwner?.getTableUnsupported() ?? [])
          .filter((u) => u.shape === 'cone').length

        // Roll the ball up the table into the funnel.
        ball.setTranslation({ x: trap.chamber.x, y: 0.5, z: trap.chamber.z - 2.5 }, true)
        ball.setLinvel({ x: 0, y: 0, z: 9 }, true)
        ball.setAngvel({ x: 0, y: 0, z: 0 }, true)

        let caughtAt = -1
        for (let i = 0; i < 60 && caughtAt < 0; i++) {
          step()
          if (trap.caughtBall) caughtAt = i
        }
        const heldType = engine.getBodyType?.(id) ?? -1
        for (let i = 0; i < Math.ceil(trap.holdDuration * 60) - 10; i++) step()
        const held = engine.getPosition(id)
        const heldError = Math.hypot(held.x - trap.chamber.x, held.y - trap.chamber.y, held.z - trap.chamber.z)
        for (let i = 0; i < 20 && trap.caughtBall; i++) step()
        step()
        const v = engine.getVelocity(id)
        return {
          ok: true,
          reason: '',
          unsupportedCones,
          caughtAt,
          heldType,
          heldError,
          released: trap.caughtBall === null,
          releasedType: engine.getBodyType?.(id) ?? -1,
          releaseVy: v.y,
          rapierMs: g.physics?.getLastRapierStepMs?.() ?? -1,
        }
      } finally {
        g.engine.getDeltaTime = origDt
      }
    })

    expect(run.ok, run.reason).toBe(true)
    expect(run.rapierMs).toBe(0)
    // The funnel is exported (not "no cone shape") and the ball hits it.
    expect(run.unsupportedCones).toBe(0)
    expect(run.caughtAt).toBeGreaterThanOrEqual(0)
    // Held in the chamber as a C++ kinematic body…
    expect(run.heldType).toBe(2)
    expect(run.heldError).toBeLessThan(0.05)
    // …then launched up out of it.
    expect(run.released).toBe(true)
    expect(run.releasedType).toBe(0)
    expect(run.releaseVy).toBeGreaterThan(5)
  })

  test('wasm-worker captures and releases through worker commands', async ({ page }) => {
    test.setTimeout(180_000)
    const boot = await bootWasmOwner(page, 'wasm-worker')
    assertWasmOwnerReady(boot, 'wasm-worker')
    await startPlaying(page)

    // Worker snapshots only arrive between tasks, so this one rides the
    // page's own rAF loop instead of stepping synchronously.
    const run = await page.evaluate(async ({ MAG_SPIN, HOLD_Y_OFFSET }) => {
      const g = (window as unknown as CaptureHooks).game
      const feeder = g?.magSpinFeeder
      const ball = g?.ballManager?.getBallBody?.()
      const engine = g?.physics?.getWasmEngine?.() as unknown as {
        getPosition: (id: number) => Vec
        getVelocity: (id: number) => Vec
      } | undefined
      if (!feeder || !ball || !engine || ball.wasmId == null) return { ok: false, reason: 'hooks missing' }
      const id = ball.wasmId

      const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      const states: number[] = []
      const prev = feeder.onStateChange
      feeder.onStateChange = (s) => {
        states.push(s)
        prev?.(s)
      }

      feeder.setGameplayEnabled(true)
      const well = feeder.getPosition()
      const hold = { x: well.x, y: well.y + HOLD_Y_OFFSET, z: well.z }
      ball.setTranslation({ x: well.x + 0.3, y: 0.5, z: well.z + 0.3 }, true)
      ball.setLinvel({ x: 0, y: 0, z: 0 }, true)

      let minHoldError = Infinity
      let releaseSpeed = 0
      try {
        for (let i = 0; i < 900; i++) {
          await frame()
          const state = feeder.getState()
          if (state === MAG_SPIN.SPIN) {
            const p = engine.getPosition(id)
            minHoldError = Math.min(minHoldError, Math.hypot(p.x - hold.x, p.y - hold.y, p.z - hold.z))
          }
          if (states.includes(MAG_SPIN.COOLDOWN)) {
            const v = engine.getVelocity(id)
            releaseSpeed = Math.max(releaseSpeed, Math.hypot(v.x, v.y, v.z))
            if (releaseSpeed > 5) break
          }
        }
      } finally {
        feeder.onStateChange = prev
      }
      return { ok: true, reason: '', states, minHoldError, releaseSpeed }
    }, { MAG_SPIN, HOLD_Y_OFFSET })

    expect(run.ok, run.reason).toBe(true)
    expect(run.states).toEqual(expect.arrayContaining([MAG_SPIN.CATCH, MAG_SPIN.SPIN, MAG_SPIN.RELEASE, MAG_SPIN.COOLDOWN]))
    // The worker's C++ body reached the hold point…
    expect(run.minHoldError).toBeLessThan(1e-3)
    // …and left it on the launch.
    expect(run.releaseSpeed).toBeGreaterThan(5)
  })
})
