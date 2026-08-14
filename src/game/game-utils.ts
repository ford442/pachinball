import { Color3 } from '@babylonjs/core/Maths/math.color'
// resolveAssetUrl / resolveVideoUrl moved to src/core/asset-urls.ts (#322) so
// game-elements can use them without importing from the game layer. Re-exported
// here for the game-layer call sites that already reference them.
export { resolveAssetUrl, resolveVideoUrl } from '../core/asset-urls'

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
