import { describe, it, expect, beforeEach } from 'vitest'
import {
  FULL_PIPELINE_UNIFORM_BUFFER_ESTIMATE,
  WEBGPU_DEFAULT_MAX_UNIFORM_BUFFERS_PER_STAGE,
  applyBloomPipelineProfile,
  bloomPipelineTogglesForTier,
  downgradePostProcessTier,
  isUniformBufferLimitError,
  isWebGPUAdapterStrictForPostProcess,
  isWebGPUEngine,
  readMaxUniformBuffersPerStage,
  recordPostProcessTierDegrade,
  resolveWebGPUPostProcessProfile,
  type WebGPUPostProcessProfile,
} from '../src/game/webgpu-post-process-profile'
import {
  getGpuDegrades,
  resetGpuDegradesForTests,
  setActiveGpuFeatureLevel,
} from '../src/engine/gpu-degrade-telemetry'

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

  it('selects none tier when adapter cap is below pipeline minimum', () => {
    const profile = resolveWebGPUPostProcessProfile(
      mockEngine('WebGPUEngine', { maxUniformBuffersPerShaderStage: 12 }) as never,
    )
    expect(profile.tier).toBe('bloom-only')
    expect(profile.isWebGPU).toBe(true)
  })

  it('keeps full tier on WebGL2', () => {
    const profile = resolveWebGPUPostProcessProfile(mockEngine('Engine') as never)
    expect(profile.tier).toBe('full')
    expect(profile.isWebGPU).toBe(false)
  })

  it('bloom-only tier disables image processing and optional features', () => {
    const toggles = bloomPipelineTogglesForTier('bloom-only', false)
    expect(toggles.imageProcessingEnabled).toBe(false)
    expect(toggles.fxaaEnabled).toBe(false)
    expect(toggles.sharpenEnabled).toBe(false)
    expect(toggles.vignetteEnabled).toBe(false)
    expect(toggles.colorCurvesEnabled).toBe(false)
  })

  it('conservative tier matches bloom-only (image-processing pass must be skipped)', () => {
    const toggles = bloomPipelineTogglesForTier('conservative', false)
    expect(toggles.imageProcessingEnabled).toBe(false)
    expect(toggles.fxaaEnabled).toBe(false)
  })

  it('full tier keeps cinematic features when motion is allowed', () => {
    const toggles = bloomPipelineTogglesForTier('full', false)
    expect(toggles.imageProcessingEnabled).toBe(true)
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

  it('downgrades tiers to none', () => {
    expect(downgradePostProcessTier('full')).toBe('none')
    expect(downgradePostProcessTier('conservative')).toBe('none')
    expect(downgradePostProcessTier('bloom-only')).toBe('none')
    expect(downgradePostProcessTier('none')).toBeNull()
  })

  it('applyBloomPipelineProfile toggles pipeline flags', () => {
    const bloom = {
      imageProcessingEnabled: true,
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
      tier: 'bloom-only',
      reason: 'test',
    }

    applyBloomPipelineProfile(bloom as never, profile, false)

    expect(bloom.imageProcessingEnabled).toBe(false)
    expect(bloom.fxaaEnabled).toBe(false)
    expect(bloom.sharpenEnabled).toBe(false)
    expect(bloom.imageProcessing.vignetteEnabled).toBe(false)
    expect(bloom.imageProcessing.colorCurvesEnabled).toBe(false)
    expect(bloom.imageProcessing.colorGradingEnabled).toBe(false)
  })

  it('detects strict WebGPU adapters that cannot run DefaultRenderingPipeline', () => {
    expect(
      isWebGPUAdapterStrictForPostProcess(
        mockEngine('WebGPUEngine', { maxUniformBuffersPerShaderStage: 12 }) as never,
      ),
    ).toBe(true)
    expect(
      isWebGPUAdapterStrictForPostProcess(
        mockEngine('WebGPUEngine', { maxUniformBuffersPerShaderStage: 24 }) as never,
      ),
    ).toBe(false)
    expect(isWebGPUAdapterStrictForPostProcess(mockEngine('Engine') as never)).toBe(false)
  })

  it('documents the full-pipeline uniform-buffer estimate used for tier selection', () => {
    expect(FULL_PIPELINE_UNIFORM_BUFFER_ESTIMATE).toBeGreaterThan(
      WEBGPU_DEFAULT_MAX_UNIFORM_BUFFERS_PER_STAGE,
    )
  })
})

describe('post-process tier degrade telemetry', () => {
  beforeEach(() => {
    resetGpuDegradesForTests()
  })

  it('records the boot downgrade a strict adapter forces, with the reason', () => {
    const engine = mockEngine('WebGPUEngine', { maxUniformBuffersPerShaderStage: 12 })
    setActiveGpuFeatureLevel('core')

    const profile = resolveWebGPUPostProcessProfile(engine as never)
    recordPostProcessTierDegrade('postprocess-tier-boot', profile)

    const [entry] = getGpuDegrades()
    expect(profile.tier).toBe('bloom-only')
    expect(entry.path).toBe('postprocess-tier-boot')
    expect(entry.featureLevel).toBe('core')
    expect(entry.detail).toContain('tier bloom-only')
    expect(entry.detail).toContain('maxUniformBuffersPerShaderStage=12')
  })

  it('records the runtime downgrade as a tier transition', () => {
    const engine = mockEngine('WebGPUEngine', { maxUniformBuffersPerShaderStage: 12 })
    setActiveGpuFeatureLevel('compatibility')

    const booted = resolveWebGPUPostProcessProfile(engine as never)
    const next = downgradePostProcessTier(booted.tier)
    expect(next).toBe('none')

    recordPostProcessTierDegrade(
      'postprocess-tier-runtime',
      { ...booted, tier: next!, reason: 'runtime validation: uniform buffers exceeds the maximum' },
      booted.tier,
    )

    const [entry] = getGpuDegrades()
    expect(entry.path).toBe('postprocess-tier-runtime')
    expect(entry.featureLevel).toBe('compatibility')
    expect(entry.detail).toBe(
      'bloom-only \u2192 none: runtime validation: uniform buffers exceeds the maximum',
    )
  })

  it('stays quiet on the undegraded full tier', () => {
    const engine = mockEngine('WebGPUEngine', { maxUniformBuffersPerShaderStage: 24 })

    recordPostProcessTierDegrade(
      'postprocess-tier-boot',
      resolveWebGPUPostProcessProfile(engine as never),
    )

    expect(getGpuDegrades()).toHaveLength(0)
  })
})
