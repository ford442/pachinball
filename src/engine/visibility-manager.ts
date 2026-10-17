/**
 * Tab visibility lifecycle — pause render loop and audio when the document is hidden.
 */

import type { Engine as BabylonEngine } from '@babylonjs/core/Engines/engine'
import type { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine'
import { GameState } from '../game-elements'
import type { SoundSystem } from '../audio/sound-system'

export interface VisibilityManagerDeps {
  engine: BabylonEngine | WebGPUEngine
  renderFrame: () => void
  getGameState: () => GameState
  soundSystem: SoundSystem
}

export class VisibilityManager {
  private readonly deps: VisibilityManagerDeps
  private disposed = false
  private renderLoopActive = true

  constructor(deps: VisibilityManagerDeps) {
    this.deps = deps
  }

  /**
   * Pass the owning Game's signal so a plain `game.dispose()` detaches this too; without it
   * the listener would resume the render loop of a dead Game. `dispose()` stays for callers
   * (HMR) that tear down without a signal.
   */
  attach(signal?: AbortSignal): void {
    if (signal?.aborted) {
      this.disposed = true
      return
    }
    document.addEventListener('visibilitychange', this.onVisibilityChange, signal ? { signal } : undefined)
    signal?.addEventListener('abort', () => { this.disposed = true }, { once: true })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    document.removeEventListener('visibilitychange', this.onVisibilityChange)
  }

  private readonly onVisibilityChange = (): void => {
    if (this.disposed) return

    if (document.hidden) {
      this.pause()
      return
    }
    this.resume()
  }

  private pause(): void {
    if (!this.renderLoopActive) return
    this.renderLoopActive = false
    this.deps.engine.stopRenderLoop()
    void this.suspendAudioContexts()
  }

  private resume(): void {
    this.deps.engine.resize()

    if (!this.renderLoopActive) {
      this.renderLoopActive = true
      this.deps.engine.runRenderLoop(this.deps.renderFrame)
    }

    if (this.deps.getGameState() === GameState.PLAYING) {
      void this.resumeAudioContexts()
    }
  }

  private async suspendAudioContexts(): Promise<void> {
    await Promise.allSettled([
      this.deps.soundSystem.suspend(),
    ])
  }

  private async resumeAudioContexts(): Promise<void> {
    await Promise.allSettled([
      this.deps.soundSystem.resume(),
    ])
  }
}
