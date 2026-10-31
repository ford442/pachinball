/**
 * WebGPU post-process compatibility — the image-processing pass of the old monolithic
 * DefaultRenderingPipeline could exceed maxUniformBuffersPerShaderStage (12 on many Windows
 * adapters). This module picks the tier (`full` / `bloom-only` / `none`); `planSceneGraph()`
 * (scene-graph-plan.ts) turns it into the scene Frame Graph's node set, leaving the
 * image-processing node out below `full`. See ENGINE_BOOTSTRAP.md post-process degradation tiers.
 */

import type { Engine } from '@babylonjs/core/Engines/engine'
import type { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine'
import { recordGpuDegrade, recordGpuProbePostProcess } from '../engine/gpu-degrade-telemetry'

/** Conservative default: WebGPU spec minimum per-stage uniform buffer count. */
export const WEBGPU_DEFAULT_MAX_UNIFORM_BUFFERS_PER_STAGE = 12

/**
 * Estimated uniform buffers for DefaultRenderingPipeline's vertex stage (bloom +
 * image-processing stack). Babylon still bound the full layout even when toggles
 * disabled FXAA/sharpen/vignette — adapters below this cap get the `bloom-only` tier, whose
 * graph has no image-processing node at all. The cut-off is unchanged, so the same adapters
 * land on the same tiers they always did.
 */
export const FULL_PIPELINE_UNIFORM_BUFFER_ESTIMATE = 17

export type WebGPUPostProcessTier = 'full' | 'conservative' | 'bloom-only' | 'none'

export interface WebGPUPostProcessProfile {
  readonly isWebGPU: boolean
  readonly maxUniformBuffersPerStage: number | null
  readonly tier: WebGPUPostProcessTier
  readonly reason: string
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
      tier: 'bloom-only',
      reason: `adapter maxUniformBuffersPerShaderStage=${maxUniformBuffersPerStage} < estimated DefaultRenderingPipeline minimum (${FULL_PIPELINE_UNIFORM_BUFFER_ESTIMATE}) — bloom-only graph, no image-processing node`,
    }
  }

  return {
    isWebGPU: true,
    maxUniformBuffersPerStage,
    tier: 'full',
    reason: 'adapter supports the full image-processing stack',
  }
}

/**
 * Push a tier degrade into the shared ring buffer.
 *
 * Tier downgrades were the one degrade path with no observable surface at all — they are
 * also the one most likely to be silently costing players visual fidelity, so the `reason`
 * string the profile already computes is routed straight into `detail`.
 *
 * A no-op at tier `full`: that is the undegraded path and must not fill the ring buffer.
 */
export function recordPostProcessTierDegrade(
  path: 'postprocess-tier-boot' | 'postprocess-tier-runtime',
  profile: WebGPUPostProcessProfile,
  fromTier?: WebGPUPostProcessTier,
): void {
  // The probe records the tier in play whether or not it is a degrade — `full` is the
  // answer to "what did this session get" just as much as `bloom-only` is.
  recordGpuProbePostProcess(profile.tier, profile.maxUniformBuffersPerStage)
  if (profile.tier === 'full') return
  const transition = fromTier ? `${fromTier} \u2192 ${profile.tier}` : `tier ${profile.tier}`
  recordGpuDegrade(path, undefined, `${transition}: ${profile.reason}`)
}

/** True when a WebGPU validation error indicates uniform-buffer overflow. */
export function isUniformBufferLimitError(message: string): boolean {
  const lower = message.toLowerCase()
  return lower.includes('uniform buffers') && lower.includes('exceeds the maximum')
}

/** Downgrade tier after a runtime WebGPU validation failure. */
export function downgradePostProcessTier(current: WebGPUPostProcessTier): WebGPUPostProcessTier | null {
  if (current === 'full' || current === 'conservative' || current === 'bloom-only') return 'none'
  return null
}

/** True when the active WebGPU adapter is below the cap the `full` tier needs. */
export function isWebGPUAdapterStrictForPostProcess(engine: Engine | WebGPUEngine): boolean {
  if (!isWebGPUEngine(engine)) return false
  const cap = readMaxUniformBuffersPerStage(engine)
  return cap !== null && cap < FULL_PIPELINE_UNIFORM_BUFFER_ESTIMATE
}
