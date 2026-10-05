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

declare global {
  interface Window {
    /** The live Game; read by Playwright specs and the diagnostic helper. */
    game?: Game
    runVisibilityDiagnostic?: () => void
  }
}

async function bootstrap(): Promise<void> {
  registerServiceWorker()

  const canvas = document.getElementById('pachinball-canvas') as HTMLCanvasElement | null
  if (!canvas) throw new Error('Canvas element not found')

  console.time('[Bootstrap] Total initialization')
  console.time('[Bootstrap] Engine + Physics parallel init')

  // Parallelize engine creation and physics WASM loading
  // This reduces total load time by overlapping network fetch (WASM) with GPU initialization
  const [engine, physics] = await Promise.all([
    createEngine(canvas),
    preloadPhysicsSystem(),
  ])

  console.timeEnd('[Bootstrap] Engine + Physics parallel init')
  console.time('[Bootstrap] Game init')

  applyHardwareScaling(engine)
  exposeRenderer(canvas, isWebGPUEngine(engine))

  ;(window as unknown as Record<string, unknown>).bootstrapEngineOptions = resolveEngineOptions()

  const game = new Game(engine, physics)
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

bootstrap().catch((err) => {
  console.error('Failed to bootstrap game', err)
})
