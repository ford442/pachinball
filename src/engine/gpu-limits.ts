/**
 * Probe-and-clamp WebGPU `requiredLimits`.
 *
 * `setMaximumLimits: true` asks the adapter for *every* limit at its maximum. It works,
 * but it is blunt: it makes a device request that is far larger than the post-process
 * stack needs, and on drivers that dislike some of those maxima the whole `requestDevice`
 * fails and we degrade a feature level for no reason.
 *
 * Instead we call `navigator.gpu.requestAdapter()` ourselves, read `adapter.limits`, and
 * request only what the MRT chain (bloom + SSAO + DoF) actually consumes — clamped to what
 * the adapter reports, so `requestDevice()` can never fail *because of* this list. The
 * compatibility retry in `create-engine.ts` stays as the safety net for everything else.
 */

import type { GpuFeatureLevel, PowerPreference } from './engine-options'

/**
 * Limits the WebGPU post-process chain wants, and why each one is above the WebGPU
 * default (a value at the default is listed so a clamp shows up in telemetry instead of
 * silently surprising us later).
 *
 * WebGPU spec defaults, for reference: maxColorAttachments 8,
 * maxColorAttachmentBytesPerSample 32, maxUniformBuffersPerShaderStage 12,
 * maxStorageBuffersPerShaderStage 8, maxSampledTexturesPerShaderStage 16,
 * maxSamplersPerShaderStage 16, maxBindGroups 4, maxTextureDimension2D 8192.
 */
export const MRT_REQUIRED_LIMITS: Readonly<Record<string, number>> = Object.freeze({
  /** Bloom downsample + SSAO + DoF write several targets in one pass. Default is already 8. */
  maxColorAttachments: 8,
  /**
   * Above the default 32. Four RGBA16F attachments = 32 B/sample; adding a depth-ish
   * RGBA8 target pushes past it. Adapters capped at 32 fall back to the bloom-only
   * profile in webgpu-post-process-profile.ts, which is exactly the clamp we want to see.
   */
  maxColorAttachmentBytesPerSample: 64,
  /**
   * Above the default 12 — the known Safari/Metal ceiling that triggers the bloom-only
   * profile today. Babylon binds scene + material + post-process UBOs per stage.
   */
  maxUniformBuffersPerShaderStage: 16,
  /** SSAO's blur passes read storage buffers; default 8 is enough, listed to catch compat (4). */
  maxStorageBuffersPerShaderStage: 8,
  /** Post-process chains sample the prior target plus lookup textures. Default 16. */
  maxSampledTexturesPerShaderStage: 16,
  maxSamplersPerShaderStage: 16,
  /** Babylon uses scene / material / mesh bind groups. Default 4. */
  maxBindGroups: 4,
  /** Full-res render targets on a 4K display. Default 8192. */
  maxTextureDimension2D: 8192,
})

/** Just enough of `GPUSupportedLimits` to read by name — it is prototype-backed, not a plain object. */
export interface AdapterLimitsLike {
  readonly [name: string]: unknown
}

export interface AdapterLike {
  readonly limits?: AdapterLimitsLike
}

export interface ClampedLimit {
  name: string
  requested: number
  granted: number
}

export interface ResolvedGpuLimits {
  /** Safe to hand to `deviceDescriptor.requiredLimits` — never exceeds the adapter. */
  requiredLimits: Record<string, number>
  /** Limits the adapter could not fully grant. Non-empty means a degraded post-process profile. */
  clamped: ClampedLimit[]
  /** Limits this adapter does not report at all; omitted from the request. */
  unsupported: string[]
}

/**
 * `min*` limits invert: a *smaller* value is the more capable adapter, so requesting one
 * means asking for at most the adapter's value rather than at least.
 */
function isMinimumLimit(name: string): boolean {
  return name.startsWith('min')
}

/**
 * Clamp `wanted` against what the adapter reports.
 *
 * Pure — `create-engine.ts` owns the `requestAdapter()` call so this stays unit-testable
 * with a fake adapter.
 */
export function resolveRequiredLimits(
  adapterLimits: AdapterLimitsLike | undefined,
  wanted: Readonly<Record<string, number>> = MRT_REQUIRED_LIMITS,
): ResolvedGpuLimits {
  const requiredLimits: Record<string, number> = {}
  const clamped: ClampedLimit[] = []
  const unsupported: string[] = []

  for (const [name, requested] of Object.entries(wanted)) {
    const reported = adapterLimits?.[name]
    if (typeof reported !== 'number' || !Number.isFinite(reported)) {
      unsupported.push(name)
      continue
    }

    const granted = isMinimumLimit(name)
      ? Math.max(requested, reported)
      : Math.min(requested, reported)

    requiredLimits[name] = granted
    if (granted !== requested) {
      clamped.push({ name, requested, granted })
    }
  }

  return { requiredLimits, clamped, unsupported }
}

/** Minimal `navigator.gpu` surface, so tests can inject a fake. */
export interface GpuLike {
  requestAdapter(options?: {
    powerPreference?: PowerPreference
    featureLevel?: GpuFeatureLevel
  }): Promise<AdapterLike | null>
}

export interface ProbeGpuLimitsOptions {
  powerPreference?: PowerPreference
  featureLevel?: GpuFeatureLevel
  wanted?: Readonly<Record<string, number>>
}

/**
 * Request an adapter and clamp {@link MRT_REQUIRED_LIMITS} against it.
 *
 * Returns null when there is no `navigator.gpu`, no adapter, or `requestAdapter()` threw —
 * the caller then keeps the blunt `setMaximumLimits` path rather than failing to boot.
 * `'default'` powerPreference is dropped because WebGPU only accepts the two named hints.
 */
export async function probeGpuLimits(
  gpu: GpuLike | undefined,
  options: ProbeGpuLimitsOptions = {},
): Promise<ResolvedGpuLimits | null> {
  if (!gpu || typeof gpu.requestAdapter !== 'function') return null

  const request: { powerPreference?: PowerPreference; featureLevel?: GpuFeatureLevel } = {}
  if (options.powerPreference && options.powerPreference !== 'default') {
    request.powerPreference = options.powerPreference
  }
  if (options.featureLevel === 'compatibility') {
    request.featureLevel = 'compatibility'
  }

  let adapter: AdapterLike | null
  try {
    adapter = await gpu.requestAdapter(request)
  } catch (err) {
    console.warn('[Bootstrap] requestAdapter() threw while probing limits', err)
    return null
  }

  if (!adapter) return null
  return resolveRequiredLimits(adapter.limits, options.wanted)
}

/** Compact one-line summary for logs and degrade telemetry. */
export function describeClampedLimits(clamped: readonly ClampedLimit[]): string {
  return clamped.map((c) => `${c.name} ${c.requested}→${c.granted}`).join(', ')
}
