/**
 * Warn when optional backbox video caching may exceed available storage.
 * Called before the service worker runtime-caches large remote media.
 */

const WARN_THRESHOLD = 0.85
const LARGE_VIDEO_BYTES = 8 * 1024 * 1024 // 8 MiB — typical short loop clip

export interface StorageQuotaSnapshot {
  usage: number
  quota: number
  usageRatio: number
  estimatedVideoBytes: number
  wouldExceedThreshold: boolean
}

export function estimateBackboxVideoBytes(videoCount = 5): number {
  return videoCount * LARGE_VIDEO_BYTES
}

/**
 * Read StorageManager quota/usage when available (Chromium, Safari 17+).
 */
export async function readStorageQuota(): Promise<StorageQuotaSnapshot | null> {
  if (!navigator.storage?.estimate) return null

  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate()
    const usageRatio = quota > 0 ? usage / quota : 0
    return {
      usage,
      quota,
      usageRatio,
      estimatedVideoBytes: estimateBackboxVideoBytes(),
      wouldExceedThreshold: usageRatio >= WARN_THRESHOLD,
    }
  } catch {
    return null
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

/**
 * Log a console warning when caching all backbox videos could push storage
 * past ~85% of quota. Does not block caching — cabinet operators decide.
 */
export async function warnIfBackboxCacheMayFillQuota(videoCount = 5): Promise<void> {
  const snapshot = await readStorageQuota()
  if (!snapshot || snapshot.quota === 0) return

  const projected = snapshot.usage + estimateBackboxVideoBytes(videoCount)
  const projectedRatio = projected / snapshot.quota

  if (projectedRatio < WARN_THRESHOLD && !snapshot.wouldExceedThreshold) return

  console.warn(
    '[PWA] Storage quota warning: caching backbox videos may use significant space.',
    {
      used: formatBytes(snapshot.usage),
      quota: formatBytes(snapshot.quota),
      usagePercent: `${(snapshot.usageRatio * 100).toFixed(1)}%`,
      estimatedVideos: formatBytes(estimateBackboxVideoBytes(videoCount)),
      projectedPercent: `${(projectedRatio * 100).toFixed(1)}%`,
      tip: 'Attract poster (attract.png) is precached; full video loops are optional runtime cache.',
    },
  )
}
