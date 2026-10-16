/**
 * Hex colour parsing — Babylon-free (#322, #441) so every layer shares one
 * implementation. Callers that need a Babylon `Color3` wrap the result a layer up.
 */

export interface Rgb {
  r: number
  g: number
  b: number
}

/**
 * Parse `#rrggbb`, `rrggbb`, `#rgb` or `rgb` into 0–255 integer channels.
 * A channel that cannot be parsed becomes 0 rather than NaN.
 */
export function parseHexColor(hex: string): Rgb {
  const clean = hex.replace('#', '').replace(/^(.)(.)(.)$/, '$1$1$2$2$3$3')
  return {
    r: parseInt(clean.substring(0, 2), 16) || 0,
    g: parseInt(clean.substring(2, 4), 16) || 0,
    b: parseInt(clean.substring(4, 6), 16) || 0,
  }
}

/** Same as {@link parseHexColor} but with channels normalised to 0–1. */
export function parseHexColorUnit(hex: string): Rgb {
  const { r, g, b } = parseHexColor(hex)
  return { r: r / 255, g: g / 255, b: b / 255 }
}
