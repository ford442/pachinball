import './style.css'
import { Game } from './game'
import { exposeRenderer } from './renderers/renderer-selector'
import { applyHardwareScaling, resolveEngineOptions } from './engine/engine-options'
import { createEngine, isWebGPUEngine } from './engine/create-engine'
import { scheduleIdleWasmPreload } from './engine/wasm-idle-preload'
import { preloadPhysicsSystem } from './game-elements/physics-preload'
import { VisibilityManager } from './engine/visibility-manager'
import { formatGpuProbeSummary } from './engine/gpu-degrade-telemetry'
import { runVisibilityDiagnostic } from './engine/visibility-diagnostic'
import { registerServiceWorker } from './pwa'
import { createTimerScope } from './core/timers'
import { BOOT_STALL_MS, armBootWatchdog, showBootError } from './game/boot-error'

declare global {
  interface Window {
    /** The live Game; read by Playwright specs and the diagnostic helper. */
    game?: Game
    runVisibilityDiagnostic?: () => void
  }
}

/** Set once constructed so the failure banner can name the checkpoint stage that was running. */
let bootGame: Game | undefined

async function bootstrap(): Promise<void> {
  const bootStartedAt = performance.now()
  registerServiceWorker()

  const canvas = document.getElementById('pachinball-canvas') as HTMLCanvasElement | null
  if (!canvas) throw new Error('Canvas element not found')

  console.time('[Bootstrap] Total initialization')
  console.time('[Bootstrap] Engine + Physics parallel init')

  // Parallelize engine creation and physics WASM loading
  // This reduces total load time by overlapping network fetch (WASM) with GPU initialization
  // The Game (and its timers) does not exist yet; this scope covers only the pre-Game phase.
  const preGameTimers = createTimerScope()
  armBootWatchdog(preGameTimers, BOOT_STALL_MS, () => 'engine + physics preload')
  const [engine, physics] = await Promise.all([
    createEngine(canvas),
    preloadPhysicsSystem(),
  ]).finally(() => preGameTimers.dispose())

  console.timeEnd('[Bootstrap] Engine + Physics parallel init')
  console.time('[Bootstrap] Game init')

  applyHardwareScaling(engine)
  // The WebGL2 fallback swaps in a fresh canvas (#451); tag the one the engine renders to.
  exposeRenderer(engine.getRenderingCanvas() ?? canvas, isWebGPUEngine(engine))

  ;(window as unknown as Record<string, unknown>).bootstrapEngineOptions = resolveEngineOptions()

  const game = new Game(engine, physics)
  bootGame = game
  armBootWatchdog(
    game.timers,
    Math.max(0, BOOT_STALL_MS - (performance.now() - bootStartedAt)),
    () => game.checkpointDebug.describeProgress(),
  )
  await game.init()
  console.info(formatGpuProbeSummary())

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
  window.runVisibilityDiagnostic = () => runVisibilityDiagnostic(window.game)

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
  showBootError(
    'Game failed to start',
    err instanceof Error ? err.message : String(err),
    bootGame?.checkpointDebug.describeProgress() ?? 'engine + physics preload',
    true,
  )
})
