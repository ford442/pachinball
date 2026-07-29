/**
 * WebGPU post-process compatibility — DefaultRenderingPipeline's image-processing
 * pass can exceed maxUniformBuffersPerShaderStage (12 on many Windows adapters).
 * See ENGINE_BOOTSTRAP.md post-process degradation tiers.
 */

import type { Engine } from '@babylonjs/core/Engines/engine'
import type { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine'
import type { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline'

/** Conservative default: WebGPU spec minimum per-stage uniform buffer count. */
export const WEBGPU_DEFAULT_MAX_UNIFORM_BUFFERS_PER_STAGE = 12

/**
 * Estimated uniform buffers for the full DefaultRenderingPipeline image-processing
 * vertex stage (bloom + FXAA + sharpen + tone-map + vignette + color curves).
 * Adapters capped at 12 need the conservative profile below.
 */
export const FULL_PIPELINE_UNIFORM_BUFFER_ESTIMATE = 17

export type WebGPUPostProcessTier = 'full' | 'conservative' | 'bloom-only'

export interface WebGPUPostProcessProfile {
  readonly isWebGPU: boolean
  readonly maxUniformBuffersPerStage: number | null
  readonly tier: WebGPUPostProcessTier
  readonly reason: string
}

export interface BloomPipelineToggles {
  fxaaEnabled: boolean
  sharpenEnabled: boolean
  vignetteEnabled: boolean
  colorCurvesEnabled: boolean
  chromaticAberrationEnabled: boolean
  grainEnabled: boolean
}

export function isWebGPUEngine(engine: Engine | WebGPUEngine): boolean {
  return (
    engine.getClassName() === 'WebGPUEngine' ||
    (engine as unknown as { isWebGPU?: boolean }).isWebGPU === true
  )
}

/** Read adapter/device uniform-buffer cap when running on WebGPU. */
export function readMaxUniformBuffersPerStage(engine: Engine | WebGPUEngine): number | null {
  if (!isWebGPUEngine(engine)) return null

  const webgpu = engine as WebGPUEngine
  const fromLimits = webgpu.currentLimits?.maxUniformBuffersPerShaderStage
  if (typeof fromLimits === 'number' && fromLimits > 0) return fromLimits

  const fromEngine = (webgpu as unknown as { maxUniformBuffersPerShaderStage?: number })
    .maxUniformBuffersPerShaderStage
  if (typeof fromEngine === 'number' && fromEngine > 0) return fromEngine

  return WEBGPU_DEFAULT_MAX_UNIFORM_BUFFERS_PER_STAGE
}

/** Pick a post-process tier from the adapter uniform-buffer cap. */
export function resolveWebGPUPostProcessProfile(
  engine: Engine | WebGPUEngine,
  forcedTier?: WebGPUPostProcessTier,
): WebGPUPostProcessProfile {
  if (!isWebGPUEngine(engine)) {
    return {
      isWebGPU: false,
      maxUniformBuffersPerStage: null,
      tier: 'full',
      reason: 'WebGL2 backend — no WebGPU uniform-buffer cap',
    }
  }

  const maxUniformBuffersPerStage = readMaxUniformBuffersPerStage(engine)

  if (forcedTier) {
    return {
      isWebGPU: true,
      maxUniformBuffersPerStage,
      tier: forcedTier,
      reason: `forced ${forcedTier} profile`,
    }
  }

  if (
    maxUniformBuffersPerStage !== null &&
    maxUniformBuffersPerStage < FULL_PIPELINE_UNIFORM_BUFFER_ESTIMATE
  ) {
    return {
      isWebGPU: true,
      maxUniformBuffersPerStage,
      tier: 'conservative',
      reason: `adapter maxUniformBuffersPerShaderStage=${maxUniformBuffersPerStage} < estimated full pipeline (${FULL_PIPELINE_UNIFORM_BUFFER_ESTIMATE})`,
    }
  }

  return {
    isWebGPU: true,
    maxUniformBuffersPerStage,
    tier: 'full',
    reason: 'adapter supports full DefaultRenderingPipeline image-processing stack',
  }
}

/** Map tier → enabled pipeline features (fewer features → fewer vertex uniform buffers). */
export function bloomPipelineTogglesForTier(
  tier: WebGPUPostProcessTier,
  reducedMotion: boolean,
): BloomPipelineToggles {
  if (tier === 'bloom-only') {
    return {
      fxaaEnabled: false,
      sharpenEnabled: false,
      vignetteEnabled: false,
      colorCurvesEnabled: false,
      chromaticAberrationEnabled: false,
      grainEnabled: false,
    }
  }

  if (tier === 'conservative') {
    return {
      fxaaEnabled: false,
      sharpenEnabled: false,
      vignetteEnabled: false,
      colorCurvesEnabled: false,
      chromaticAberrationEnabled: false,
      grainEnabled: false,
    }
  }

  return {
    fxaaEnabled: true,
    sharpenEnabled: !reducedMotion,
    vignetteEnabled: !reducedMotion,
    colorCurvesEnabled: true,
    chromaticAberrationEnabled: false,
    grainEnabled: false,
  }
}

export function applyBloomPipelineProfile(
  bloom: DefaultRenderingPipeline,
  profile: WebGPUPostProcessProfile,
  reducedMotion: boolean,
): void {
  const toggles = bloomPipelineTogglesForTier(profile.tier, reducedMotion)

  bloom.fxaaEnabled = toggles.fxaaEnabled
  bloom.sharpenEnabled = toggles.sharpenEnabled
  bloom.chromaticAberrationEnabled = toggles.chromaticAberrationEnabled
  bloom.grainEnabled = toggles.grainEnabled

  bloom.imageProcessing.vignetteEnabled = toggles.vignetteEnabled
  bloom.imageProcessing.colorCurvesEnabled = toggles.colorCurvesEnabled
  if (!toggles.colorCurvesEnabled) {
    bloom.imageProcessing.colorGradingEnabled = false
  }
}

/** True when a WebGPU validation error indicates uniform-buffer overflow. */
export function isUniformBufferLimitError(message: string): boolean {
  const lower = message.toLowerCase()
  return lower.includes('uniform buffers') && lower.includes('exceeds the maximum')
}

/** Downgrade tier after a runtime WebGPU validation failure. */
export function downgradePostProcessTier(current: WebGPUPostProcessTier): WebGPUPostProcessTier | null {
  if (current === 'full') return 'conservative'
  if (current === 'conservative') return 'bloom-only'
  return null
}
