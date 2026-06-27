import { Color3 } from '@babylonjs/core'

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

/**
 * Convert hex color string to Babylon Color3.
 */
export function hexToColor3(hex: string): Color3 {
  const clean = hex.replace('#', '')
  const r = parseInt(clean.substring(0, 2), 16) / 255
  const g = parseInt(clean.substring(2, 4), 16) / 255
  const b = parseInt(clean.substring(4, 6), 16) / 255
  return new Color3(r, g, b)
}
