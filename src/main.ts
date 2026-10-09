import './style.css'
import { Game } from './game'
import { exposeRenderer } from './renderers/renderer-selector'
import { applyHardwareScaling, resolveEngineOptions } from './engine/engine-options'
import { createEngine, isWebGPUEngine } from './engine/create-engine'
import { scheduleIdleWasmPreload } from './engine/wasm-idle-preload'
import { preloadPhysicsSystem } from './game-elements/physics-preload'
import { formatGpuProbeSummary } from './engine/gpu-degrade-telemetry'
import { registerServiceWorker } from './pwa'

declare global {
  interface Window {
    /** The live Game; read by Playwright specs and the diagnostic helper. */
    game?: Game
    runVisibilityDiagnostic?: () => void
  }
}

/** Set once constructed so the failure banner can name the checkpoint stage that was running. */
let bootGame: Game | undefined

/** The banner is its own chunk: only a failed or stalled boot needs it (#449). */
const loadBootError = () => import('./game/boot-error')

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
  void loadBootError().then((m) => m.watchPreGame(loading))
  const [engine, physics] = await loading

  console.timeEnd('[Bootstrap] Engine + Physics parallel init')
  console.time('[Bootstrap] Game init')

  applyHardwareScaling(engine)
  // The WebGL2 fallback swaps in a fresh canvas (#451); tag the one the engine renders to.
  exposeRenderer(engine.getRenderingCanvas() ?? canvas, isWebGPUEngine(engine))

  ;(window as unknown as Record<string, unknown>).bootstrapEngineOptions = resolveEngineOptions()

  const game = new Game(engine, physics)
  bootGame = game
  void loadBootError().then((m) => m.watchGame(game))
  await game.init()
  console.info(formatGpuProbeSummary())

  // Settled long ago (started with the engine): awaiting a *fresh* import here would queue behind
  // the running render loop. dispose() can land meanwhile, so re-check the signal.
  const { VisibilityManager } = await visibilityModule
  if (game.signal.aborted) return
  const visibilityManager = new VisibilityManager({
    engine,
    renderFrame: () => game.renderFrame(),
    getGameState: () => game.stateManager.getState(),
    soundSystem: game.soundSystem,
  })
  visibilityManager.attach()
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
      visibilityManager.dispose()
      game.dispose()
      engine.dispose()
      delete window.game
      delete window.runVisibilityDiagnostic
    })
  }
}

bootstrap().catch((err: unknown) => {
  console.error('Failed to bootstrap game', err)
  void loadBootError().then((m) => m.showBootFailure(err, bootGame))
})
