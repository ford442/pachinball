import { EngineFactory } from '@babylonjs/core/Engines/engineFactory'
import type { Engine } from '@babylonjs/core/Engines/engine'
import type { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine'
import './style.css'
import { Game } from './game'
import type * as RAPIER from '@dimforge/rapier3d-compat'

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

  const game = new Game(engine, preloadedRapier)
  await game.init()

  // Expose for Playwright tests
  ;(window as unknown as Record<string, unknown>).game = game

  console.timeEnd('[Bootstrap] Game init')
  console.timeEnd('[Bootstrap] Total initialization')
  console.log('[Bootstrap] Physics WASM preloading completed successfully')

  // Setup canvas resize handling
  setupResizeHandler(canvas, engine)

  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      game.dispose()
      engine.dispose()
    })
  }
}

/**
 * Setup resize handling for the canvas
 */
function setupResizeHandler(canvas: HTMLCanvasElement, engine: Engine | WebGPUEngine): void {
  // Use ResizeObserver for proper canvas resize detection
  const resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      if (entry.target === canvas) {
        // Debounce resize calls
        requestAnimationFrame(() => {
          engine.resize()
          console.log('[Resize] Canvas resized:', canvas.width, 'x', canvas.height)
        })
      }
    }
  })

  resizeObserver.observe(canvas)

  // Fallback to window resize event
  window.addEventListener('resize', () => {
    engine.resize()
  })

  console.log('[Resize] ResizeObserver setup complete')
}

/**
 * Reduce GPU fill-rate on mobile and high-DPI devices.
 * Mobile:  render at ½ canvas size (level 2) — displays scale up via CSS.
 * HiDPI desktop (DPR > 1): render at logical resolution so the OS handles
 * the scale-up, halving fill-rate on 4K / Retina screens with minimal
 * visual difference for a fast-moving arcade game.
 */
function applyHardwareScaling(engine: Engine | WebGPUEngine): void {
  const isMobile = /Mobi|Android/i.test(navigator.userAgent)
  if (isMobile) {
    engine.setHardwareScalingLevel(2)
    console.log('[Bootstrap] Mobile detected: hardware scaling 2x (half resolution)')
  } else if (window.devicePixelRatio > 1) {
    // Cap at 2 so a 3x screen still gets some Retina benefit
    const scale = Math.min(window.devicePixelRatio, 2)
    engine.setHardwareScalingLevel(scale)
    console.log(`[Bootstrap] HiDPI display (DPR ${window.devicePixelRatio}): hardware scaling ${scale}x`)
  }
}

async function createEngine(canvas: HTMLCanvasElement): Promise<Engine | WebGPUEngine> {
  const engineOptions = {
    antialias: true,
    preserveDrawingBuffer: true,
    stencil: true
  }
  
  try {
    return (await EngineFactory.CreateAsync(canvas, { ...engineOptions })) as WebGPUEngine
  } catch (err) {
    console.warn('WebGPU init failed, using WebGL fallback', err)
    return (await EngineFactory.CreateAsync(canvas, { disableWebGPU: true, ...engineOptions })) as Engine
  }
}

bootstrap().catch((err) => {
  console.error('Failed to bootstrap game', err)
})
