import { describe, it, expect, vi } from 'vitest'

vi.mock('@babylonjs/core/Misc/sceneOptimizer', () => {
  class SceneOptimization {
    constructor(public priority = 0) {}
    getDescription() { return '' }
  }
  class ShadowsOptimization extends SceneOptimization {
    getDescription() { return 'Turning shadows on/off' }
  }
  class LensFlaresOptimization extends SceneOptimization {
    getDescription() { return 'Turning lens flares on/off' }
  }
  class PostProcessesOptimization extends SceneOptimization {
    getDescription() { return 'Turning post-processes on/off' }
  }
  class ParticlesOptimization extends SceneOptimization {
    getDescription() { return 'Turning particles on/off' }
  }
  class TextureOptimization extends SceneOptimization {
    constructor(priority = 0, public maximumSize = 1024) { super(priority) }
    getDescription() { return `Reducing render target texture size to ${this.maximumSize}` }
  }
  class RenderTargetsOptimization extends SceneOptimization {
    getDescription() { return 'Turning render targets off' }
  }
  class HardwareScalingOptimization extends SceneOptimization {
    constructor(priority = 0, public maximumScale = 2) { super(priority) }
    getDescription() { return `Setting hardware scaling level to ${this.maximumScale}` }
  }
  class MergeMeshesOptimization extends SceneOptimization {
    getDescription() { return 'Merging similar meshes together' }
  }
  class SceneOptimizerOptions {
    optimizations: SceneOptimization[] = []
    constructor(public targetFrameRate = 60) {}
    addOptimization(opt: SceneOptimization) {
      this.optimizations.push(opt)
      return this
    }
  }
  return {
    SceneOptimization,
    ShadowsOptimization,
    LensFlaresOptimization,
    PostProcessesOptimization,
    ParticlesOptimization,
    TextureOptimization,
    RenderTargetsOptimization,
    HardwareScalingOptimization,
    MergeMeshesOptimization,
    SceneOptimizerOptions,
  }
})

describe('createSafeSceneOptimizerOptions', () => {
  it('never includes MergeMeshesOptimization (keeps flipper hierarchy intact)', async () => {
    const { createSafeSceneOptimizerOptions } = await import('../src/game/safe-scene-optimizer-options')
    const { MergeMeshesOptimization } = await import('@babylonjs/core/Misc/sceneOptimizer')

    const options = createSafeSceneOptimizerOptions(55)

    expect(options.targetFrameRate).toBe(55)
    expect(options.optimizations.length).toBeGreaterThan(0)
    expect(
      options.optimizations.some((opt) => opt instanceof MergeMeshesOptimization)
    ).toBe(false)
    expect(
      options.optimizations.map((opt) => opt.getDescription())
    ).not.toContain('Merging similar meshes together')
  })
})
