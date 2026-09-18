import { expect, test, type Page } from '@playwright/test'

export type GameHooks = {
  game?: {
    startGame?: () => Promise<void>
    stateManager?: { isPlaying?: () => boolean }
    physics?: {
      isWasmOwnerMode?: () => boolean
      getWasmEngine?: () => {
        isReady?: boolean
        /** PhysicsWorkerClient only. */
        getTransportStats?: () => {
          transport: 'shared' | 'post-message'
          sharedSnapshots: number
          postMessageSnapshots: number
          sharedAttaches: number
          staleSnapshots: number
        }
      }
      getWasmMode?: () => string
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

export type OwnerEngine = 'wasm-owner' | 'wasm-worker'

export async function bootWasmOwner(
  page: Page,
  mode: OwnerEngine = 'wasm-owner',
): Promise<{ wasmReady: boolean; engine: string | null }> {
  await page.addInitScript((m) => {
    localStorage.setItem('pachinball:physics-engine', m)
  }, mode)
  await page.goto('/?renderer=webgl2')
  await expect(page.locator('#start-btn')).toBeVisible({ timeout: 30_000 })
  await expect.poll(async () => {
    return page.evaluate(() => !!(window as unknown as GameHooks).game?.stateManager)
  }, { timeout: 60_000 }).toBe(true)

  return page.evaluate(() => {
    const w = window as unknown as GameHooks & { currentPhysicsEngine?: string }
    const g = w.game
    const wasmReady = !!(g?.physics?.isWasmOwnerMode?.() && g?.physics?.getWasmEngine?.()?.isReady)
    // currentPhysicsEngine is only exposed once physics first steps.
    return { wasmReady, engine: w.currentPhysicsEngine ?? g?.physics?.getWasmMode?.() ?? null }
  })
}

/** Fail in CI when the WASM bundle did not load; skip locally when emcc artefact is absent. */
export function assertWasmOwnerReady(
  boot: { wasmReady: boolean; engine: string | null },
  mode: OwnerEngine = 'wasm-owner',
): void {
  if (!boot.wasmReady) {
    if (process.env.CI) {
      expect(boot.engine, 'WASM bundle must load in native-physics CI').toBe(mode)
    } else {
      test.skip(true, `${mode} engine not loaded in this environment`)
    }
  }
  expect(boot.engine).toBe(mode)
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
