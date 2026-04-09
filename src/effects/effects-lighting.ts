import { Scene, Color3 } from '@babylonjs/core'
import type { DefaultRenderingPipeline } from '@babylonjs/core'

export class LightingEffects {
  private scene: Scene
  private pipeline: DefaultRenderingPipeline | null = null
  private strobeActive = false
  private strobeTimer = 0

  constructor(scene: Scene) {
    this.scene = scene
  }

  setPipeline(pipeline: DefaultRenderingPipeline): void {
    this.pipeline = pipeline
  }

  update(dt: number): void {
    if (this.strobeActive) {
      this.strobeTimer += dt * 10
      const intensity = (Math.sin(this.strobeTimer) + 1) / 2
      if (this.pipeline) {
        this.pipeline.bloomWeight = 0.5 + intensity
      }
    }
  }

  startStrobe(): void {
    this.strobeActive = true
    this.strobeTimer = 0
  }

  stopStrobe(): void {
    this.strobeActive = false
    if (this.pipeline) {
      this.pipeline.bloomWeight = 0.5
    }
  }

  updateEnvironmentColor(colorHex: string): void {
    const color = Color3.FromHexString(colorHex)

    // Update ambient light
    const ambientLight = this.scene.getLightByName('ambientLight')
    if (ambientLight) {
      (ambientLight as unknown as { diffuse: Color3 }).diffuse = color
    }

    // Update glow layer if exists
    const glowLayer = this.scene.getGlowLayerByName('glow')
    if (glowLayer) {
      glowLayer.intensity = 0.5
    }
  }

  fadeOut(duration: number): void {
    // Create fade overlay - stub for future implementation
    void duration
  }

  dispose(): void {
    this.stopStrobe()
  }
}
