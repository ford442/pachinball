/**
 * Static asset URL resolution — Babylon-free (#322).
 *
 * Split out of `src/game/game-utils.ts` so `src/game-elements/` can resolve
 * asset paths without importing from the high-level game layer. `hexToColor3`
 * stays in game-utils because it constructs a Babylon `Color3`, which this
 * kernel layer is not allowed to depend on.
 */

/**
 * Resolve static asset URLs for Vite subdirectory deployment.
 * Prepends import.meta.env.BASE_URL so assets load correctly under any base path.
 * Absolute URLs (http...) are returned as-is.
 */
export function resolveAssetUrl(assetPath: string | undefined): string | undefined {
  if (!assetPath) return undefined
  if (/^https?:\/\//i.test(assetPath)) return assetPath
  const base = (import.meta.env.BASE_URL as string) || '/'
  const cleanPath = assetPath.startsWith('/') ? assetPath.slice(1) : assetPath
  return `${base}${cleanPath}`
}

/** @deprecated Use resolveAssetUrl — kept for existing video call sites. */
export function resolveVideoUrl(videoPath: string | undefined): string | undefined {
  return resolveAssetUrl(videoPath)
}
