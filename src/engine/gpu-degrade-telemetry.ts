/**
 * Degrade telemetry ring buffer.
 *
 * `[Bootstrap][gpu-degrade]` is a greppable console marker, which is fine for a human
 * reading one log and useless for counting how often Safari/Metal falls back. This keeps
 * the same events in a bounded array on `window.bootstrapGpuDegrades` so Playwright can
 * assert on them today and an analytics sink can drain them later.
 *
 * This module deliberately depends on nothing but a type: both `src/engine/**` (feature
 * level + context loss) and `src/game/**` (post-process tier downgrades) record into it,
 * and the engine layer must not import the game layer to do so.
 *
 * Bounded on purpose: a flapping GPU context can fire context-lost forever, and an
 * unbounded array on `window` would be a leak in the one situation we most want to survive.
 */

import type { GpuFeatureLevel } from './engine-options'

/** WebGPU feature levels plus the WebGL2 fallback, which is not one. */
export type GpuDegradeFeatureLevel = GpuFeatureLevel | 'webgl2'

/** Where in the bootstrap/runtime chain the degrade happened. */
export type GpuDegradePath =
  /** WebGPU init succeeded at a lower feature level than the one we asked for. */
  | 'webgpu-featurelevel'
  /** WebGPU failed at every feature level; the engine is WebGL2. */
  | 'webgl2-fallback'
  /** The adapter's uniform-buffer cap forced a reduced post-process tier at startup. */
  | 'postprocess-tier-boot'
  /** A WebGPU validation error forced a further tier downgrade while playing. */
  | 'postprocess-tier-runtime'
  /** The GPU device went away at runtime. */
  | 'context-lost'
  /** The GPU device came back. Recorded so a drain sees loss/restore pairs. */
  | 'context-restored'

export interface GpuDegradeEntry {
  path: GpuDegradePath
  /** Feature level in play when this was recorded; null before the engine exists. */
  featureLevel: GpuDegradeFeatureLevel | null
  /** Human-readable extra context (tier transition, validation message, …). */
  detail?: string
  /** `Date.now()` at record time. */
  timestamp: number
}

/** Oldest entries are dropped past this count. */
export const GPU_DEGRADE_RING_SIZE = 16

/** Property name on `window`; exported so tests and Playwright agree on the spelling. */
export const GPU_DEGRADE_GLOBAL = 'bootstrapGpuDegrades'

type DegradeHost = Record<string, unknown>

/** Module-level fallback so the buffer still works in Node (vitest, SSR-ish contexts). */
const fallbackHost: DegradeHost = {}

function host(): DegradeHost {
  return typeof window !== 'undefined' ? (window as unknown as DegradeHost) : fallbackHost
}

function buffer(): GpuDegradeEntry[] {
  const h = host()
  const existing = h[GPU_DEGRADE_GLOBAL]
  if (Array.isArray(existing)) return existing as GpuDegradeEntry[]
  const created: GpuDegradeEntry[] = []
  h[GPU_DEGRADE_GLOBAL] = created
  return created
}

/**
 * The level the engine actually booted on.
 *
 * Recorded once by `createEngine()` so the post-process layer — which can see "this is
 * WebGPU" but not "this is the compatibility retry" — does not have to re-derive it.
 */
let activeFeatureLevel: GpuDegradeFeatureLevel | null = null

export function setActiveGpuFeatureLevel(level: GpuDegradeFeatureLevel | null): void {
  activeFeatureLevel = level
}

export function getActiveGpuFeatureLevel(): GpuDegradeFeatureLevel | null {
  return activeFeatureLevel
}

/** Append a degrade event, trimming the oldest entries past `GPU_DEGRADE_RING_SIZE`. */
export function recordGpuDegrade(
  path: GpuDegradePath,
  featureLevel: GpuDegradeFeatureLevel | null = activeFeatureLevel,
  detail?: string,
): GpuDegradeEntry {
  const entry: GpuDegradeEntry = { path, featureLevel, timestamp: Date.now() }
  if (detail !== undefined) entry.detail = detail

  const entries = buffer()
  entries.push(entry)
  if (entries.length > GPU_DEGRADE_RING_SIZE) {
    entries.splice(0, entries.length - GPU_DEGRADE_RING_SIZE)
  }
  return entry
}

/**
 * Create `window.bootstrapGpuDegrades` if it does not exist yet.
 *
 * Called during bootstrap so Playwright can read an empty array on a clean boot instead of
 * having to distinguish "no degrades" from "telemetry never loaded".
 */
export function ensureGpuDegradeBuffer(): GpuDegradeEntry[] {
  return buffer()
}

/** Snapshot of the ring buffer, oldest first. */
export function getGpuDegrades(): GpuDegradeEntry[] {
  return buffer().slice()
}

/** Count entries on one path — what an analytics sink actually wants. */
export function countGpuDegrades(path: GpuDegradePath): number {
  return buffer().filter((entry) => entry.path === path).length
}

export function resetGpuDegradesForTests(): void {
  buffer().length = 0
  activeFeatureLevel = null
  host()[GPU_PROBE_GLOBAL] = undefined
}

/**
 * One-shot "what did this session actually get" snapshot.
 *
 * The ring buffer answers "what went wrong"; this answers the question a bug report
 * really asks — *which* render path is this player on. It is filled in two steps because
 * the two facts are known at different times and by different layers: the engine layer
 * knows the backend and feature level at creation, and only the post-process layer (which
 * the engine layer must not import) knows the uniform-buffer cap and the resulting tier.
 */
export interface GpuProbeSnapshot {
  backend: 'webgpu' | 'webgl2' | null
  featureLevel: GpuDegradeFeatureLevel | null
  maxUniformBuffersPerShaderStage: number | null
  postProcessTier: string | null
}

/** Property name on `window`; exported so tests and Playwright agree on the spelling. */
export const GPU_PROBE_GLOBAL = 'bootstrapGpuProbe'

function probe(): GpuProbeSnapshot {
  const h = host()
  const existing = h[GPU_PROBE_GLOBAL]
  if (existing && typeof existing === 'object') return existing as GpuProbeSnapshot
  const created: GpuProbeSnapshot = {
    backend: null,
    featureLevel: null,
    maxUniformBuffersPerShaderStage: null,
    postProcessTier: null,
  }
  h[GPU_PROBE_GLOBAL] = created
  return created
}

/** Record the backend/feature level half of the probe. Called once by `createEngine()`. */
export function recordGpuProbeEngine(
  backend: 'webgpu' | 'webgl2',
  featureLevel: GpuDegradeFeatureLevel,
): GpuProbeSnapshot {
  const snapshot = probe()
  snapshot.backend = backend
  snapshot.featureLevel = featureLevel
  return snapshot
}

/** Record the post-process half of the probe. Called once the tier has been resolved. */
export function recordGpuProbePostProcess(
  postProcessTier: string,
  maxUniformBuffersPerShaderStage: number | null,
): GpuProbeSnapshot {
  const snapshot = probe()
  snapshot.postProcessTier = postProcessTier
  snapshot.maxUniformBuffersPerShaderStage = maxUniformBuffersPerShaderStage
  return snapshot
}

/** Create `window.bootstrapGpuProbe` so readers never have to null-check the global. */
export function ensureGpuProbe(): GpuProbeSnapshot {
  return probe()
}

/** Copy of the probe — the HUD reads this rather than holding the live object. */
export function getGpuProbe(): GpuProbeSnapshot {
  return { ...probe() }
}

/**
 * One-line boot summary so a pasted console log carries backend, feature level and
 * post-process tier without opening the HUD. Also counts recorded degrades.
 */
export function formatGpuProbeSummary(): string {
  const p = probe()
  return (
    `[Bootstrap] GPU probe: backend=${p.backend ?? '?'} featureLevel=${p.featureLevel ?? '?'} ` +
    `pp=${p.postProcessTier ?? '?'} maxUBO/stage=${p.maxUniformBuffersPerShaderStage ?? '?'} ` +
    `degrades=${getGpuDegrades().length}`
  )
}
