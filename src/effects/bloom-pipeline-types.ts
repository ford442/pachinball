/**
 * The post-process knobs `EffectsSystem`, the quality tiers and `PostProcessManager` write.
 * `ScenePostController` (src/game/scene-post-controller.ts) implements it for the scene Frame Graph.
 */

import type { Color4 } from '@babylonjs/core/Maths/math.color'

/** Image-processing knobs optional effects may read (absent while the graph has no image-processing node). */
export interface BloomImageProcessingSurface {
  vignetteWeight: number
  vignetteColor: Color4
  vignetteBlendMode: number
  vignetteEnabled: boolean
  colorCurvesEnabled: boolean
  colorGradingEnabled: boolean
  toneMappingEnabled: boolean
  toneMappingType: number
  contrast: number
  exposure: number
}

/** Properties touched by PostProcessManager and EffectsSystem. */
export interface BloomPipelineController {
  bloomWeight: number
  bloomScale: number
  bloomKernel: number
  bloomEnabled: boolean
  bloomThreshold: number
  sharpenEnabled: boolean
  imageProcessing?: BloomImageProcessingSurface | null
  prepare(): void
  dispose(): void
}
