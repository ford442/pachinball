import './style.css'
import { Game } from './game'
import { exposeRenderer } from './renderers/renderer-selector'
import { applyHardwareScaling, resolveEngineOptions } from './engine/engine-options'
import { createEngine, isWebGPUEngine } from './engine/create-engine'
import { scheduleIdleWasmPreload } from './engine/wasm-idle-preload'
import { preloadPhysicsSystem } from './game-elements/physics-preload'
import { formatGpuProbeSummary } from './engine/gpu-degrade-telemetry'
import { registerServiceWorker } from './pwa'
import { bootError, bootWarn } from './boot-log'
import { BOOT_PRELOAD_STAGE, revealBootFailure } from './game/game-ui-popups'

declare global {
  interface Window {
    /** The live Game; read by Playwright specs and the diagnostic helper. */
    game?: Game
    runVisibilityDiagnostic?: () => void
  }
}

/** Set once constructed so the failure banner can name the checkpoint stage that was running. */
let bootGame: Game | undefined

/**
 * The watchdog and stage label are their own chunk: only a failed or stalled boot needs them
 * (#449). A load failure is a warning, never an unhandled rejection, and nothing that must be
 * visible depends on it (see `revealBootFailure`).
 */
function withBootError(use: (m: typeof import('./game/boot-error')) => void): void {
  void import('./game/boot-error')
    .then(use)
    .catch((err: unknown) => bootWarn('Boot error chunk unavailable', err))
}

async function bootstrap(): Promise<void> {
  registerServiceWorker()

  const canvas = document.getElementById('pachinball-canvas') as HTMLCanvasElement | null
  if (!canvas) throw new Error('Canvas element not found')

  console.time('[Bootstrap] Total initialization')
  console.time('[Bootstrap] Engine + Physics parallel init')

  // Parallelize engine creation and physics WASM loading
  // This reduces total load time by overlapping network fetch (WASM) with GPU initialization
  // Tab-visibility handling is only needed once the game runs; its own chunk keeps it out of the
  // entry (size budget) but is fetched now, in parallel, rather than after the render loop starts.
  const visibilityModule = import('./engine/visibility-manager')
  visibilityModule.catch(() => undefined) // a failure surfaces at the await below, not as unhandled
  const loading = Promise.all([createEngine(canvas), preloadPhysicsSystem()])
  // The Game (and its timers) does not exist yet: this watchdog covers only the pre-Game phase.
  withBootError((m) => m.watchPreGame(loading))
  const [engine, physics] = await loading

  console.timeEnd('[Bootstrap] Engine + Physics parallel init')
  console.time('[Bootstrap] Game init')

  applyHardwareScaling(engine)
  // The WebGL2 fallback swaps in a fresh canvas (#451); tag the one the engine renders to.
  exposeRenderer(engine.getRenderingCanvas() ?? canvas, isWebGPUEngine(engine))

  ;(window as unknown as Record<string, unknown>).bootstrapEngineOptions = resolveEngineOptions()

  const game = new Game(engine, physics)
  bootGame = game
  withBootError((m) => m.watchGame(game))
  await game.init()
  console.info(formatGpuProbeSummary())

  // Optional: a failed chunk fetch costs pause-on-hidden-tab handling, not a running game, so it
  // must not fail the boot or keep `window.game` unset. Started with the engine, so it has long
  // settled: awaiting a *fresh* import here would queue behind the running render loop.
  let visibilityManager: { dispose(): void } | undefined
  try {
    const { VisibilityManager } = await visibilityModule
    if (game.signal.aborted) return // dispose() landed meanwhile
    const manager = new VisibilityManager({
      engine,
      renderFrame: () => game.renderFrame(),
      getGameState: () => game.stateManager.getState(),
      soundSystem: game.soundSystem,
    })
    manager.attach()
    visibilityManager = manager
  } catch (err) {
    bootWarn('Tab-visibility handling unavailable', err)
  }
  scheduleIdleWasmPreload()

  // Expose for Playwright tests
  window.game = game

  // Expose visibility diagnostic helper
  window.runVisibilityDiagnostic = () => {
    void import('./engine/visibility-diagnostic').then((m) => m.runVisibilityDiagnostic(window.game))
  }

  console.timeEnd('[Bootstrap] Game init')
  console.timeEnd('[Bootstrap] Total initialization')
  console.log(`[Bootstrap] Physics ready (${(window as unknown as { currentPhysicsEngine?: string }).currentPhysicsEngine ?? 'unknown'})`)

  // Canvas resizing is owned by GameRenderer (game-renderer.ts:setupResizeObserver) and
  // DPR changes by setupDPRHandling, both torn down by Game.dispose(). A second observer
  // on the same canvas created an infinite resize loop (engine.resize() mutates
  // canvas.width/height), so main.ts deliberately registers none.

  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      visibilityManager?.dispose()
      game.dispose()
      engine.dispose()
      delete window.game
      delete window.runVisibilityDiagnostic
    })
  }
}

bootstrap().catch((err: unknown) => {
  bootError('Failed to bootstrap game', err) // not console.error: that is stripped from prod builds
  // Static markup only, no import: if the banner chunk is unreachable the failure must still show.
  revealBootFailure(err, bootGame ? '' : BOOT_PRELOAD_STAGE)
  // The chunk only refines the stage line (it reads the checkpoint snapshots); best effort.
  withBootError((m) => m.showBootFailure(err, bootGame))
})
