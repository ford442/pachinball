import { expect, test, type Page } from '@playwright/test'

export type GameHooks = {
  game?: {
    startGame?: () => Promise<void>
    stateManager?: { isPlaying?: () => boolean }
    physics?: {
      isWasmOwnerMode?: () => boolean
      getWasmEngine?: () => { isReady?: boolean }
      getRapier?: () => { Vector3: new (x: number, y: number, z: number) => unknown }
      getLastRapierStepMs?: () => number
    }
    physicsController?: {
      rebuildHandleCaches?: () => void
      resetBallScoreCounters?: () => void
      getPointsThisBall?: () => number
      getBumperHitsThisBall?: () => number
      getRawCollisionEvents?: () => number
      getLastLaneHit?: () => string | null
      applyOwnedBallImpulse?: (body: unknown, ix: number, iy: number, iz: number) => void
      stepPhysics: (
        inputManager: unknown,
        inputActions: unknown,
        replayRunner: null,
        replayRecorder: null
      ) => void
    }
    ballManager?: {
      getBallBody?: () => {
        setTranslation: (v: unknown, w: boolean) => void
        setLinvel: (v: unknown, w: boolean) => void
        translation: () => { x: number; y: number; z: number }
        linvel: () => { x: number; y: number; z: number }
      }
    }
    gameObjects?: {
      getBumperBodies?: () => Array<{ translation: () => { x: number; y: number; z: number } }>
    }
    inputManager?: unknown
    inputActions?: { handlePlunger?: () => boolean; handleFlipperLeft?: (pressed: boolean) => void }
    plungerChargeLevel?: number
    engine?: { getDeltaTime: () => number }
    scene?: { meshes?: Array<{ name: string; getVerticesData?: (kind: string) => Float32Array | number[] | null }> }
  }
}

export async function bootWasmOwner(page: Page): Promise<{ wasmReady: boolean; engine: string | null }> {
  await page.addInitScript(() => {
    localStorage.setItem('pachinball:physics-engine', 'wasm-owner')
  })
  await page.goto('/?renderer=webgl2')
  await expect(page.locator('#start-btn')).toBeVisible({ timeout: 10_000 })
  await expect.poll(async () => {
    return page.evaluate(() => !!(window as unknown as GameHooks).game?.stateManager)
  }, { timeout: 15_000 }).toBe(true)

  return page.evaluate(() => {
    const w = window as unknown as GameHooks & { currentPhysicsEngine?: string }
    const g = w.game
    const wasmReady = !!(g?.physics?.isWasmOwnerMode?.() && g?.physics?.getWasmEngine?.()?.isReady)
    return { wasmReady, engine: w.currentPhysicsEngine ?? null }
  })
}

/** Fail in CI when the WASM bundle did not load; skip locally when emcc artefact is absent. */
export function assertWasmOwnerReady(boot: { wasmReady: boolean; engine: string | null }): void {
  if (!boot.wasmReady) {
    if (process.env.CI) {
      expect(boot.engine, 'WASM bundle must load in native-physics CI').toBe('wasm-owner')
    } else {
      test.skip(true, 'WASM owner engine not loaded in this environment')
    }
  }
  expect(boot.engine).toBe('wasm-owner')
}

export async function startPlaying(page: Page): Promise<void> {
  const started = await page.evaluate(async () => {
    const g = (window as unknown as GameHooks).game
    try {
      await g?.startGame?.()
      return { ok: g?.stateManager?.isPlaying?.() === true, error: null as string | null }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
  expect(started.error, started.error ?? 'startGame failed').toBeNull()
  expect(started.ok).toBe(true)
}
