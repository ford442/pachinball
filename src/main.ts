import { EngineFactory } from '@babylonjs/core/Engines/engineFactory'
import type { Engine } from '@babylonjs/core/Engines/engine'
import type { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine'
import './style.css'
import { Game } from './game'

async function bootstrap(): Promise<void> {
  const canvas = document.getElementById('pachinball-canvas') as HTMLCanvasElement | null
  if (!canvas) throw new Error('Canvas element not found')

  const engine = (await createEngine(canvas)) as Engine | WebGPUEngine
  const game = new Game(engine)
  await game.init()

  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      game.dispose()
      engine.dispose()
    })
  }
}

async function createEngine(canvas: HTMLCanvasElement): Promise<Engine | WebGPUEngine> {
  try {
    return (await EngineFactory.CreateAsync(canvas, {})) as WebGPUEngine
  } catch (err) {
    console.warn('WebGPU init failed, using WebGL fallback', err)
    return (await EngineFactory.CreateAsync(canvas, { disableWebGPU: true })) as Engine
  }
}

bootstrap().catch((err) => {
  console.error('Failed to bootstrap game', err)
})
