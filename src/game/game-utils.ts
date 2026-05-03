import { Color3 } from '@babylonjs/core'
import { ASSET_BASE } from '../config'

/**
 * Resolve video URLs against ASSET_BASE.
 */
export function resolveVideoUrl(videoPath: string | undefined): string | undefined {
  if (!videoPath) return undefined
  if (videoPath.startsWith('http')) return videoPath
  const cleanPath = videoPath.startsWith('/') ? videoPath.slice(1) : videoPath
  return `${ASSET_BASE}/${cleanPath}`
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
