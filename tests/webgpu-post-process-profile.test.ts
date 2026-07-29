import { describe, it, expect } from 'vitest'
import {
  FULL_PIPELINE_UNIFORM_BUFFER_ESTIMATE,
  WEBGPU_DEFAULT_MAX_UNIFORM_BUFFERS_PER_STAGE,
  applyBloomPipelineProfile,
  bloomPipelineTogglesForTier,
  downgradePostProcessTier,
  isUniformBufferLimitError,
  isWebGPUEngine,
  readMaxUniformBuffersPerStage,
  resolveWebGPUPostProcessProfile,
  type WebGPUPostProcessProfile,
} from '../src/game/webgpu-post-process-profile'

function mockEngine(className: string, limits?: { maxUniformBuffersPerShaderStage?: number }) {
  return {
    getClassName: () => className,
    currentLimits: limits,
    maxUniformBuffersPerShaderStage: limits?.maxUniformBuffersPerShaderStage,
  }
}

describe('webgpu-post-process-profile', () => {
  it('detects WebGPU engines', () => {
    expect(isWebGPUEngine(mockEngine('WebGPUEngine') as never)).toBe(true)
    expect(isWebGPUEngine(mockEngine('Engine') as never)).toBe(false)
  })

  it('reads uniform buffer cap from WebGPU limits', () => {
    const engine = mockEngine('WebGPUEngine', { maxUniformBuffersPerShaderStage: 12 })
    expect(readMaxUniformBuffersPerStage(engine as never)).toBe(12)
  })

  it('falls back to spec default when limits are missing', () => {
    const engine = mockEngine('WebGPUEngine')
    expect(readMaxUniformBuffersPerStage(engine as never)).toBe(
      WEBGPU_DEFAULT_MAX_UNIFORM_BUFFERS_PER_STAGE,
    )
  })

  it('selects conservative tier when adapter cap is below full pipeline estimate', () => {
    const profile = resolveWebGPUPostProcessProfile(
      mockEngine('WebGPUEngine', { maxUniformBuffersPerShaderStage: 12 }) as never,
    )
    expect(profile.tier).toBe('conservative')
    expect(profile.isWebGPU).toBe(true)
  })

  it('keeps full tier on WebGL2', () => {
    const profile = resolveWebGPUPostProcessProfile(mockEngine('Engine') as never)
    expect(profile.tier).toBe('full')
    expect(profile.isWebGPU).toBe(false)
  })

  it('conservative tier disables optional image-processing features', () => {
    const toggles = bloomPipelineTogglesForTier('conservative', false)
    expect(toggles.fxaaEnabled).toBe(false)
    expect(toggles.sharpenEnabled).toBe(false)
    expect(toggles.vignetteEnabled).toBe(false)
    expect(toggles.colorCurvesEnabled).toBe(false)
  })

  it('full tier keeps cinematic features when motion is allowed', () => {
    const toggles = bloomPipelineTogglesForTier('full', false)
    expect(toggles.fxaaEnabled).toBe(true)
    expect(toggles.sharpenEnabled).toBe(true)
    expect(toggles.vignetteEnabled).toBe(true)
    expect(toggles.colorCurvesEnabled).toBe(true)
  })

  it('recognizes uniform-buffer validation errors', () => {
    const message =
      'The number of uniform buffers (17) in the Vertex stage exceeds the maximum per-stage limit (12).'
    expect(isUniformBufferLimitError(message)).toBe(true)
    expect(isUniformBufferLimitError('something else')).toBe(false)
  })

  it('downgrades tiers in order', () => {
    expect(downgradePostProcessTier('full')).toBe('conservative')
    expect(downgradePostProcessTier('conservative')).toBe('bloom-only')
    expect(downgradePostProcessTier('bloom-only')).toBeNull()
  })

  it('applyBloomPipelineProfile toggles pipeline flags', () => {
    const bloom = {
      fxaaEnabled: true,
      sharpenEnabled: true,
      chromaticAberrationEnabled: true,
      grainEnabled: true,
      imageProcessing: {
        vignetteEnabled: true,
        colorCurvesEnabled: true,
        colorGradingEnabled: true,
      },
    }

    const profile: WebGPUPostProcessProfile = {
      isWebGPU: true,
      maxUniformBuffersPerStage: 12,
      tier: 'conservative',
      reason: 'test',
    }

    applyBloomPipelineProfile(bloom as never, profile, false)

    expect(bloom.fxaaEnabled).toBe(false)
    expect(bloom.sharpenEnabled).toBe(false)
    expect(bloom.imageProcessing.vignetteEnabled).toBe(false)
    expect(bloom.imageProcessing.colorCurvesEnabled).toBe(false)
    expect(bloom.imageProcessing.colorGradingEnabled).toBe(false)
  })

  it('documents the full-pipeline uniform-buffer estimate used for tier selection', () => {
    expect(FULL_PIPELINE_UNIFORM_BUFFER_ESTIMATE).toBeGreaterThan(
      WEBGPU_DEFAULT_MAX_UNIFORM_BUFFERS_PER_STAGE,
    )
  })
})
