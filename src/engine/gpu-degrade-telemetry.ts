/**
 * Degrade telemetry ring buffer.
 *
 * `[Bootstrap][gpu-degrade]` is a greppable console marker, which is fine for a human
 * reading one log and useless for counting how often Safari/Metal falls back. This keeps
 * the same events in a bounded array on `window.bootstrapGpuDegrades` so Playwright can
 * assert on them today and an analytics sink can drain them later.
 *
 * Bounded on purpose: a flapping GPU context can fire context-lost forever, and an
 * unbounded array on `window` would be a leak in the one situation we most want to survive.
 */

import type { GpuFeatureLevel } from './engine-options'

/** Where in the bootstrap/runtime chain the degrade happened. */
export type GpuDegradePath =
  /** WebGPU init succeeded at a lower feature level than the one we asked for. */
  | 'webgpu-featurelevel'
  /** WebGPU failed at every feature level; the engine is WebGL2. */
  | 'webgl2-fallback'
  /** The adapter could not grant a limit the MRT post-process stack wanted. */
  | 'limits-clamped'
  /** The GPU device went away at runtime. */
  | 'context-lost'
  /** The GPU device came back. Recorded so a drain sees loss/restore pairs. */
  | 'context-restored'

export interface GpuDegradeEntry {
  path: GpuDegradePath
  /** Feature level in play when this was recorded; null when not a WebGPU path. */
  featureLevel: GpuFeatureLevel | null
  /** Human-readable extra context (clamped limit names, error message, …). */
  detail?: string
  /** `Date.now()` at record time. */
  timestamp: number
}

/** Oldest entries are dropped past this count. */
export const GPU_DEGRADE_RING_SIZE = 32

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

/** Append a degrade event, trimming the oldest entries past `GPU_DEGRADE_RING_SIZE`. */
export function recordGpuDegrade(
  path: GpuDegradePath,
  featureLevel: GpuFeatureLevel | null = null,
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
}
