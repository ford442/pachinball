import { Scene } from '@babylonjs/core'
import type { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline'
import { EffectsConfig } from '../config'
import type { ParticleEffects } from './effects-particles'

export type RuntimePerformanceTier = 'high' | 'medium' | 'low'

export class RuntimePerformanceController {
  private scene: Scene
  private bloomPipeline: DefaultRenderingPipeline | null
  private particleEffects: ParticleEffects

  // Runtime adaptive tiering
  private lastFpsCheck = 0
  private fpsTrendCounter = 0
  private runtimePerformanceTier: RuntimePerformanceTier = 'high'

  constructor(
    scene: Scene,
    bloomPipeline: DefaultRenderingPipeline | null,
    particleEffects: ParticleEffects
  ) {
    this.scene = scene
    this.bloomPipeline = bloomPipeline
    this.particleEffects = particleEffects
  }

  setBloomPipeline(pipeline: DefaultRenderingPipeline | null): void {
    this.bloomPipeline = pipeline
    this.applyPerformanceTier()
  }

  checkPerformance(dt: number): void {
    if (!EffectsConfig.performance.autoDisableOnLowFps) return

    this.lastFpsCheck += dt
    if (this.lastFpsCheck < EffectsConfig.performance.fpsCheckInterval) return

    this.lastFpsCheck = 0
    const fps = this.scene.getEngine().getFps()
    const targetTier: RuntimePerformanceTier = fps < 40 ? 'low' : fps < 55 ? 'medium' : 'high'

    if (targetTier === this.runtimePerformanceTier) {
      this.fpsTrendCounter = 0
      return
    }

    this.fpsTrendCounter++
    if (this.fpsTrendCounter >= 3) {
      this.setRuntimePerformanceTier(targetTier)
      this.fpsTrendCounter = 0
      console.log(`[Performance] Runtime tier changed → ${this.runtimePerformanceTier} (FPS: ${fps.toFixed(1)})`)
    }
  }

  setRuntimePerformanceTier(tier: RuntimePerformanceTier): void {
    this.runtimePerformanceTier = tier
    this.applyPerformanceTier()
  }

  applyPerformanceTier(): void {
    if (!this.bloomPipeline) return

    switch (this.runtimePerformanceTier) {
      case 'high':
        this.bloomPipeline.bloomWeight = 0.25
        this.bloomPipeline.bloomScale = 0.5
        this.particleEffects.setMaxParticles(100)
        break
      case 'medium':
        this.bloomPipeline.bloomWeight = 0.15
        this.bloomPipeline.bloomScale = 0.3
        this.particleEffects.setMaxParticles(60)
        break
      case 'low':
        this.bloomPipeline.bloomWeight = 0.08
        this.bloomPipeline.bloomScale = 0.15
        this.particleEffects.setMaxParticles(30)
        break
    }
  }

  getRuntimePerformanceTier(): RuntimePerformanceTier {
    return this.runtimePerformanceTier
  }

  /** Immediate tier review — used after heavy track switches or particle spikes. */
  forcePerformanceTierReview(): void {
    const fps = this.scene.getEngine().getFps()
    const targetTier: RuntimePerformanceTier = fps < 40 ? 'low' : fps < 55 ? 'medium' : 'high'
    if (targetTier === this.runtimePerformanceTier) return

    this.setRuntimePerformanceTier(targetTier)
    console.log(`[Performance] Forced tier review → ${this.runtimePerformanceTier} (FPS: ${fps.toFixed(1)})`)
  }

  areEnhancedEffectsEnabled(): boolean {
    if (!EffectsConfig.enableEnhancedEffects) return false
    if (EffectsConfig.enableFallbackMode) return false
    if (this.runtimePerformanceTier === 'low') return false
    return true
  }
}
