/**
 * Shared bloom post-process surface used by DefaultRenderingPipeline and the
 * WebGPU-strict MinimalBloomPipeline (standalone BloomEffect).
 */

import type { Color4 } from '@babylonjs/core/Maths/math.color'
import type { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline'

/** Image-processing knobs optional effects may read (absent on minimal bloom path). */
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

/** Properties touched by GameRenderer and EffectsSystem. */
export interface BloomPipelineController {
  bloomWeight: number
  bloomScale: number
  bloomKernel: number
  bloomEnabled: boolean
  bloomThreshold: number
  sharpenEnabled: boolean
  depthOfFieldEnabled: boolean
  imageProcessing?: BloomImageProcessingSurface | null
  prepare(): void
  dispose(): void
}

export type BloomPipelineHandle = DefaultRenderingPipeline | BloomPipelineController

export function isBloomPipelineController(
  pipeline: BloomPipelineHandle | null,
): pipeline is BloomPipelineController {
  return pipeline !== null
}
