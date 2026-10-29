/**
 * Resolution policy (#488 §3): how many pixels the scene renders, and how that adapts at runtime.
 *
 * With `adaptToDeviceRatio: false`, Babylon sizes the backbuffer to `clientWidth / level`, where
 * `level` is the hardware scaling level — DPR never enters on its own. So the policy works in
 * *render scale* (backbuffer pixels per CSS pixel) and converts: `level = 1 / scale`.
 *
 *   scale = min(devicePixelRatio, platform cap, quality-tier cap)      (or `?renderScale=`)
 *
 * - platform cap: 1.5 on mobile, 2 on desktop — a DPR-3 phone renders at 1.5× CSS pixels, not the
 *   old fixed level 2 (½× CSS, 1/6 of native per axis).
 * - quality-tier cap: HIGH none, MEDIUM 1.5, LOW 1.
 *
 * `DynamicResolutionController` (`dynamic-resolution.ts`, lazy) then steps the scale down when frames
 * run over budget and back up when they run under, with hysteresis (30 frames over, 120 under).
 *
 * Pure: no Babylon import, so it unit-tests in Node. The tier is taken as its string value
 * (`QualityTier` is `'low' | 'medium' | 'high'`) so `src/engine` does not import the game layer.
 */

/** `QualityTier`'s values. */
export type RenderScaleTier = 'low' | 'medium' | 'high'

export const RENDER_SCALE_PLATFORM_CAP = { mobile: 1.5, desktop: 2 } as const

export const RENDER_SCALE_TIER_CAP: Record<RenderScaleTier, number> = {
  high: Number.POSITIVE_INFINITY,
  medium: 1.5,
  low: 1,
}

/** Smallest scale anything may pick (a quarter of CSS pixels by area). */
export const MIN_RENDER_SCALE = 0.5

export interface RenderScaleContext {
  devicePixelRatio: number
  mobile: boolean
  /** Null before the tier is detected (boot): the platform cap alone applies. */
  quality: RenderScaleTier | null
  /** URL query string; `?renderScale=1.25` pins the scale (and turns dynamic resolution off). */
  search?: string
}

/** `?renderScale=` as a number in [MIN_RENDER_SCALE, 4], else null. */
export function parseRenderScaleOverride(search = ''): number | null {
  const raw = new URLSearchParams(search).get('renderScale')
  if (raw === null) return null
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) return null
  return Math.min(4, Math.max(MIN_RENDER_SCALE, value))
}

/**
 * Whether dynamic resolution runs. `?dynres=1` forces it on, `?dynres=0` off; a pinned
 * `?renderScale=` turns it off. Under automation (`navigator.webdriver`) it is off by default: a
 * software rasteriser never meets the budget, so the scale would walk to the minimum on a timing
 * the e2e specs cannot predict.
 */
export function isDynamicResolutionEnabled(search = '', automated = false): boolean {
  const raw = new URLSearchParams(search).get('dynres')
  if (raw === '0' || raw === 'false') return false
  if (parseRenderScaleOverride(search) !== null) return false
  if (raw === '1' || raw === 'true') return true
  return !automated
}

/** The highest render scale the policy allows for this display and tier. */
export function resolveRenderScale(ctx: RenderScaleContext): number {
  const override = parseRenderScaleOverride(ctx.search)
  if (override !== null) return override
  const dpr = Number.isFinite(ctx.devicePixelRatio) && ctx.devicePixelRatio > 0 ? ctx.devicePixelRatio : 1
  const platformCap = ctx.mobile ? RENDER_SCALE_PLATFORM_CAP.mobile : RENDER_SCALE_PLATFORM_CAP.desktop
  const tierCap = ctx.quality === null ? Number.POSITIVE_INFINITY : RENDER_SCALE_TIER_CAP[ctx.quality]
  return Math.max(MIN_RENDER_SCALE, Math.min(dpr, platformCap, tierCap))
}

/** Babylon hardware scaling level for a render scale. */
export function hardwareScalingLevelFor(scale: number): number {
  return 1 / scale
}
