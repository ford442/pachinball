/**
 * Babylon engine bootstrap options — single source of truth for createEngine().
 * Override via URL params or window debug globals (see docs/ENGINE_BOOTSTRAP.md).
 */

export type PowerPreference = 'default' | 'high-performance' | 'low-power'

export interface ResolvedEngineOptions {
  antialias: boolean
  preserveDrawingBuffer: boolean
  stencil: boolean
  setMaximumLimits: boolean
  powerPreference: PowerPreference
  adaptToDeviceRatio: boolean
}

export interface EngineOptionsContext {
  search: string
  userAgent: string
  devicePixelRatio: number
  debugPreserveDrawingBuffer?: boolean
}

const DEFAULT_CONTEXT: EngineOptionsContext = {
  search: typeof window !== 'undefined' ? window.location.search : '',
  userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
  devicePixelRatio: typeof window !== 'undefined' ? window.devicePixelRatio : 1,
  debugPreserveDrawingBuffer:
    typeof window !== 'undefined'
      ? (window as unknown as { DEBUG_PRESERVE_DRAWING_BUFFER?: boolean }).DEBUG_PRESERVE_DRAWING_BUFFER
      : undefined,
}

function parseBoolParam(params: URLSearchParams, key: string): boolean | null {
  const raw = params.get(key)
  if (raw === null) return null
  return raw === '1' || raw === 'true'
}

function isMobileUserAgent(userAgent: string): boolean {
  return /Mobi|Android/i.test(userAgent)
}

/** Resolve Babylon EngineOptions for EngineFactory.CreateAsync. */
export function resolveEngineOptions(ctx: EngineOptionsContext = DEFAULT_CONTEXT): ResolvedEngineOptions {
  const params = new URLSearchParams(ctx.search)

  const antialiasOff = parseBoolParam(params, 'antialias') === false
  const preserveFromUrl = parseBoolParam(params, 'preserveBuffer')
  const preserveDrawingBuffer =
    preserveFromUrl === true ||
    ctx.debugPreserveDrawingBuffer === true ||
    false

  const maxLimitsOff = parseBoolParam(params, 'maxLimits') === false

  const powerParam = params.get('power')
  let powerPreference: PowerPreference
  if (powerParam === 'high-performance' || powerParam === 'low-power' || powerParam === 'default') {
    powerPreference = powerParam
  } else if (isMobileUserAgent(ctx.userAgent)) {
    powerPreference = 'default'
  } else {
    powerPreference = 'high-performance'
  }

  return {
    antialias: !antialiasOff,
    preserveDrawingBuffer,
    stencil: true,
    setMaximumLimits: !maxLimitsOff,
    powerPreference,
    adaptToDeviceRatio: false,
  }
}

/**
 * Hardware scaling level for Babylon's setHardwareScalingLevel().
 * Higher level = lower internal render resolution.
 */
export function resolveHardwareScalingLevel(ctx: EngineOptionsContext = DEFAULT_CONTEXT): number {
  if (isMobileUserAgent(ctx.userAgent)) {
    return 2
  }
  if (ctx.devicePixelRatio > 1) {
    return Math.min(ctx.devicePixelRatio, 2)
  }
  return 1
}

/** Apply resolved hardware scaling and log when non-default. */
export function applyHardwareScaling(
  engine: { setHardwareScalingLevel: (level: number) => void; getHardwareScalingLevel?: () => number },
  ctx: EngineOptionsContext = DEFAULT_CONTEXT,
): void {
  const level = resolveHardwareScalingLevel(ctx)
  if (level === 1) return

  engine.setHardwareScalingLevel(level)
  if (isMobileUserAgent(ctx.userAgent)) {
    console.log('[Bootstrap] Mobile detected: hardware scaling 2x (half resolution)')
  } else {
    console.log(`[Bootstrap] HiDPI display (DPR ${ctx.devicePixelRatio}): hardware scaling ${level}x`)
  }
}
