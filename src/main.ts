import { EngineFactory } from '@babylonjs/core/Engines/engineFactory'
import type { Engine } from '@babylonjs/core/Engines/engine'
import type { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine'
import './style.css'
import { Game } from './game'
import type * as RAPIER from '@dimforge/rapier3d-compat'
import { getRendererPreference, exposeRenderer, RENDERER_WEBGL2 } from './renderers/renderer-selector'
import { applyHardwareScaling, resolveEngineOptions } from './engine/engine-options'
import { scheduleIdleWasmPreload } from './engine/wasm-idle-preload'
import { VisibilityManager } from './engine/visibility-manager'
import { registerServiceWorker } from './pwa'

/**
 * Preload physics WASM in parallel with engine creation.
 * This overlaps the WASM fetch with engine initialization for faster startup.
 * @returns Promise that resolves with the initialized Rapier module
 */
async function preloadPhysics(): Promise<typeof RAPIER> {
  const rapier = await import('@dimforge/rapier3d-compat')
  await (rapier.init as unknown as () => Promise<void>)()
  return rapier
}

async function bootstrap(): Promise<void> {
  registerServiceWorker()

  const canvas = document.getElementById('pachinball-canvas') as HTMLCanvasElement | null
  if (!canvas) throw new Error('Canvas element not found')

  console.time('[Bootstrap] Total initialization')
  console.time('[Bootstrap] Engine + Physics parallel init')

  // Parallelize engine creation and physics WASM loading
  // This reduces total load time by overlapping network fetch (WASM) with GPU initialization
  const [engine, preloadedRapier] = await Promise.all([
    createEngine(canvas),
    preloadPhysics()
  ]) as [Engine | WebGPUEngine, typeof RAPIER]

  console.timeEnd('[Bootstrap] Engine + Physics parallel init')
  console.time('[Bootstrap] Game init')

  applyHardwareScaling(engine)
  exposeRenderer(canvas, isWebGPUEngine(engine))

  ;(window as unknown as Record<string, unknown>).bootstrapEngineOptions = resolveEngineOptions()

  const game = new Game(engine, preloadedRapier)
  await game.init()

  const visibilityManager = new VisibilityManager({
    engine,
    renderFrame: () => game.renderFrame(),
    getGameState: () => game.stateManager.getState(),
    soundSystem: game.soundSystem,
    effects: game.effects,
  })
  visibilityManager.attach()
  scheduleIdleWasmPreload()

  // Expose for Playwright tests
  ;(window as unknown as Record<string, unknown>).game = game

  // Expose visibility diagnostic helper
  ;(window as unknown as Record<string, unknown>).runVisibilityDiagnostic = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const game = (window as unknown as Record<string, unknown>).game as any
    if (!game) {
      console.error('Game not loaded')
      return
    }
    const scene = game.scene
    const engine = game.engine
    if (!scene) {
      console.error('Scene not ready')
      return
    }
    const cam = scene.activeCamera
    if (!cam) {
      console.error('No active camera')
      return
    }
    console.log('=== CAMERA ===')
    console.log('position:', cam.position?.asArray?.() || cam.position)
    console.log('target:', cam.target?.asArray?.() || cam.target)
    console.log('alpha/beta/radius:', cam.alpha, cam.beta, cam.radius)
    console.log('fov:', cam.fov, 'minZ:', cam.minZ, 'maxZ:', cam.maxZ)
    console.log('viewport:', cam.viewport)
    console.log('activeCameras:', scene.activeCameras?.map((c: unknown) => (c as { name?: string }).name))

    console.log('=== MESHES (count:', scene.meshes.length, ') ===')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const interesting = scene.meshes.filter((m: any) =>
      /flipper|ball|bumper|wall|pin|playfield|lcd|cabinet/i.test(m.name)
    )
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    console.table(interesting.map((m: any) => ({
      name: m.name,
      enabled: m.isEnabled(),
      visible: m.isVisible,
      visibility: m.visibility,
      inFrustum: cam.isInFrustum(m),
      x: m.position.x.toFixed(2),
      y: m.position.y.toFixed(2),
      z: m.position.z.toFixed(2),
      material: m.material?.name || '(none)',
      alpha: m.material?.alpha,
      parent: m.parent?.name || '(none)',
    })))

    console.log('=== LIGHTS ===')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    console.table(scene.lights.map((l: any) => ({
      name: l.name, type: l.getClassName(), intensity: l.intensity, enabled: l.isEnabled()
    })))

    console.log('=== RENDER STATS ===')
    console.log('engine fps:', engine?.getFps().toFixed(1))
    console.log('render width × height:', engine?.getRenderWidth(), '×', engine?.getRenderHeight())
    console.log('hardware scaling:', engine?.getHardwareScalingLevel())
    console.log('canvas client:', engine?.getRenderingCanvas()?.clientWidth, '×', engine?.getRenderingCanvas()?.clientHeight)
    console.log('=== DIAGNOSTIC COMPLETE ===')
  }

  console.timeEnd('[Bootstrap] Game init')
  console.timeEnd('[Bootstrap] Total initialization')
  console.log('[Bootstrap] Physics WASM preloading completed successfully')

  // Setup canvas resize handling
  setupResizeHandler(canvas, engine)

  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      visibilityManager.dispose()
      game.dispose()
      engine.dispose()
    })
  }
}

/**
 * Setup resize handling for the canvas
 */
function setupResizeHandler(_canvas: HTMLCanvasElement, engine: Engine | WebGPUEngine): void {
  // ResizeObserver is owned by GameRenderer (game-renderer.ts:setupResizeObserver).
  // A second observer on the same canvas created an infinite resize loop: engine.resize()
  // mutates canvas.width/height, which triggers the observer again on each call.
  // Window resize is kept as a lightweight fallback for cases the element observer misses.
  window.addEventListener('resize', () => {
    engine.resize()
  })
}

async function createEngine(canvas: HTMLCanvasElement): Promise<Engine | WebGPUEngine> {
  const engineOptions = resolveEngineOptions()

  const preference = getRendererPreference()
  if (preference === RENDERER_WEBGL2) {
    console.log('[Bootstrap] Renderer preference: WebGL2 (forced)')
    return (await EngineFactory.CreateAsync(canvas, {
      disableWebGPU: true,
      ...engineOptions,
    })) as Engine
  }
  if (preference !== 'auto') {
    console.log(`[Bootstrap] Renderer preference: ${preference}`)
  }

  if (!engineOptions.preserveDrawingBuffer) {
    console.log('[Bootstrap] preserveDrawingBuffer=false (opt in via ?preserveBuffer=1)')
  }

  try {
    return (await EngineFactory.CreateAsync(canvas, { ...engineOptions })) as WebGPUEngine
  } catch (err) {
    console.warn('WebGPU init failed, using WebGL fallback', err)
    return (await EngineFactory.CreateAsync(canvas, {
      disableWebGPU: true,
      ...engineOptions,
    })) as Engine
  }
}

/** True if the created engine is actually running on WebGPU. */
function isWebGPUEngine(engine: Engine | WebGPUEngine): boolean {
  return (
    engine.getClassName() === 'WebGPUEngine' ||
    (engine as unknown as { isWebGPU?: boolean }).isWebGPU === true
  )
}

bootstrap().catch((err) => {
  console.error('Failed to bootstrap game', err)
})
