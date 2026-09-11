import { test, expect } from '@playwright/test'
import {
  assertWasmOwnerReady,
  bootWasmOwner,
  startPlaying,
  type GameHooks,
} from './helpers/wasm-owner-boot'

/**
 * wasm-owner flipper smoke + plunger/score feel gate.
 * Drives stepPhysics directly to avoid rAF hangs.
 */
test.describe('wasm-owner native flipper hinge', () => {
  test('raise/lower launches a ball and skips Rapier step', async ({ page }) => {
    test.setTimeout(180_000)
    const boot = await bootWasmOwner(page)
    assertWasmOwnerReady(boot)
    await startPlaying(page)

    const placed = await page.evaluate(() => {
      const g = (window as unknown as GameHooks).game
      const rapier = g?.physics?.getRapier?.()
      const ball = g?.ballManager?.getBallBody?.()
      if (!rapier || !ball) return false
      g.physicsController?.rebuildHandleCaches?.()
      ball.setTranslation(new rapier.Vector3(-5.5, 0.45, -7.0), true)
      ball.setLinvel(new rapier.Vector3(0, 0, 0), true)
      g.physicsController?.rebuildHandleCaches?.()
      return true
    })
    expect(placed).toBe(true)

    await page.keyboard.down('Digit1')

    const launched = await page.evaluate(() => {
      const g = (window as unknown as GameHooks).game
      if (!g?.physicsController || !g.engine) {
        return { ok: false, vz: 0, rapierMs: -1, engine: null as string | null }
      }
      const origDt = g.engine.getDeltaTime.bind(g.engine)
      g.engine.getDeltaTime = () => 1000 / 60
      try {
        for (let i = 0; i < 90; i++) {
          g.physicsController.stepPhysics(g.inputManager, g.inputActions, null, null)
        }
      } finally {
        g.engine.getDeltaTime = origDt
      }
      const vz = g.ballManager?.getBallBody?.()?.linvel().z ?? 0
      const rapierMs = g.physics?.getLastRapierStepMs?.() ?? -1
      const engine = (window as unknown as { currentPhysicsEngine?: string }).currentPhysicsEngine ?? null
      return { ok: true, vz, rapierMs, engine }
    })

    await page.keyboard.up('Digit1')

    expect(launched.ok).toBe(true)
    expect(launched.engine).toBe('wasm-owner')
    expect(launched.rapierMs).toBe(0)
    expect(Math.abs(launched.vz)).toBeGreaterThan(0.5)
  })

  test('plunger leaves the launch lane', async ({ page }) => {
    test.setTimeout(180_000)
    const degrade: string[] = []
    page.on('console', (msg) => {
      if (msg.text().includes('[Bootstrap][physics-degrade]')) degrade.push(msg.text())
    })

    const boot = await bootWasmOwner(page)
    assertWasmOwnerReady(boot)
    await startPlaying(page)

    const launched = await page.evaluate(() => {
      const g = (window as unknown as GameHooks).game
      const out = {
        ok: false,
        leftLane: false,
        x: 0,
        z: 0,
        engine: (window as unknown as { currentPhysicsEngine?: string }).currentPhysicsEngine ?? null,
      }
      if (!g?.physicsController || !g.engine || !g.inputActions?.handlePlunger) return out
      if (typeof g.plungerChargeLevel === 'number') g.plungerChargeLevel = 1
      g.inputActions.handlePlunger()
      const origDt = g.engine.getDeltaTime.bind(g.engine)
      g.engine.getDeltaTime = () => 1000 / 60
      try {
        for (let i = 0; i < 48; i++) {
          g.physicsController.stepPhysics(g.inputManager, g.inputActions, null, null)
        }
      } finally {
        g.engine.getDeltaTime = origDt
      }
      const t = g.ballManager?.getBallBody?.()?.translation()
      out.x = t?.x ?? 0
      out.z = t?.z ?? 0
      out.leftLane = out.z > -4 || out.x < 8
      out.ok = true
      out.engine = (window as unknown as { currentPhysicsEngine?: string }).currentPhysicsEngine ?? null
      return out
    })
    expect(launched.ok).toBe(true)
    expect(launched.engine).toBe('wasm-owner')
    expect(launched.leftLane, `ball still in lane x=${launched.x} z=${launched.z}`).toBe(true)
    expect(degrade, 'must not degrade when WASM bundle is present').toHaveLength(0)
  })

  test('bumper contact awards score', async ({ page }) => {
    test.setTimeout(180_000)
    const boot = await bootWasmOwner(page)
    assertWasmOwnerReady(boot)
    await startPlaying(page)

    const scored = await page.evaluate(() => {
      const g = (window as unknown as GameHooks).game
      const rapier = g?.physics?.getRapier?.()
      const ball = g?.ballManager?.getBallBody?.()
      const bumper = g.gameObjects?.getBumperBodies?.()?.[0]
      if (!g?.physicsController || !g.engine || !rapier || !ball || !bumper) {
        return {
          ok: false,
          rapierMs: -1,
          points: 0,
          bumperHits: 0,
          raw: 0,
          lane: null as string | null,
          engine: null as string | null,
          x: 0,
          z: 0,
        }
      }
      const bp = bumper.translation()
      g.physicsController.resetBallScoreCounters?.()
      ball.setTranslation(new rapier.Vector3(bp.x + 2.2, bp.y, bp.z), true)
      ball.setLinvel(new rapier.Vector3(-10, 0, 0), true)
      g.physicsController.rebuildHandleCaches?.()
      const origDt = g.engine.getDeltaTime.bind(g.engine)
      g.engine.getDeltaTime = () => 1000 / 60
      try {
        for (let i = 0; i < 36; i++) {
          g.physicsController.stepPhysics(g.inputManager, g.inputActions, null, null)
        }
      } finally {
        g.engine.getDeltaTime = origDt
      }
      return {
        ok: true,
        rapierMs: g.physics?.getLastRapierStepMs?.() ?? -1,
        points: g.physicsController.getPointsThisBall?.() ?? 0,
        bumperHits: g.physicsController.getBumperHitsThisBall?.() ?? 0,
        raw: g.physicsController.getRawCollisionEvents?.() ?? 0,
        lane: g.physicsController.getLastLaneHit?.() ?? null,
        engine: (window as unknown as { currentPhysicsEngine?: string }).currentPhysicsEngine ?? null,
        x: g.ballManager?.getBallBody?.()?.translation().x ?? 0,
        z: g.ballManager?.getBallBody?.()?.translation().z ?? 0,
      }
    })
    expect(scored.ok).toBe(true)
    expect(scored.engine).toBe('wasm-owner')
    expect(scored.rapierMs).toBe(0)
    const scoredSomething = scored.points > 0 || scored.bumperHits > 0 || scored.lane !== null
    expect(
      scoredSomething,
      `no score points=${scored.points} hits=${scored.bumperHits} raw=${scored.raw} lane=${scored.lane} pos=${scored.x},${scored.z}`,
    ).toBe(true)
  })
})
