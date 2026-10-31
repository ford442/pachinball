/**
 * Babylon engine bootstrap options — single source of truth for createEngine().
 * Override via URL params or window debug globals (see docs/ENGINE_BOOTSTRAP.md).
 *
 * `setMaximumLimits: true` is the WebGPU MRT defense (SSAO + DoF + bloom).
 * Do not turn it off to "fix" Safari — degrade post-process via
 * `src/game/webgpu-post-process-profile.ts` instead.
 */

import { hardwareScalingLevelFor, resolveRenderScale } from './resolution-policy'

export type PowerPreference = 'default' | 'high-performance' | 'low-power'
export type GpuFeatureLevel = 'core' | 'compatibility'

export interface ResolvedEngineOptions {
  antialias: boolean
  preserveDrawingBuffer: boolean
  stencil: boolean
  /**
   * WebGPU: request adapter maximum limits. Keep true; bloom/SSAO already
   * degrade on strict adapters (webgpu-post-process-profile.ts).
   */
  setMaximumLimits: boolean
  powerPreference: PowerPreference
  adaptToDeviceRatio: boolean
  /** We own audio via src/audio AudioEngine — do not spawn Babylon's AudioContext. */
  audioEngine: false
  /** Babylon should restore the context; we still log / toast / resize. */
  doNotHandleContextLost: false
  /** False so SwiftShader CI can boot; `?gpu=strict` enables the caveat check. */
  failIfMajorPerformanceCaveat: boolean
  /** Matches CSS cabinet compositing. */
  premultipliedAlpha: true
  /** WebGPU feature level; `?gpu=compat` forces compatibility. */
  featureLevel: GpuFeatureLevel
  /** WebGPU debug markers; `?gpuDebug=1`. */
  enableGPUDebugMarkers: boolean
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

/** Exported for quality-tier probing and fullscreen gating. */
export { isMobileUserAgent }

export interface MobileQualityHints {
  userAgent?: string
  /** `navigator.deviceMemory` when available (GiB). */
  deviceMemory?: number
  /** `navigator.connection.saveData` when available. */
  saveData?: boolean
}

/** True when mobile heuristics should force LOW quality. */
export function shouldForceLowQualityMobile(hints: MobileQualityHints = {}): boolean {
  const ua = hints.userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent : '')
  if (!isMobileUserAgent(ua)) return false
  const deviceMemory =
    hints.deviceMemory ??
    (typeof navigator !== 'undefined'
      ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory
      : undefined)
  const saveData =
    hints.saveData ??
    (typeof navigator !== 'undefined'
      ? (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData
      : undefined)
  if (saveData === true) return true
  if (typeof deviceMemory === 'number' && deviceMemory > 0 && deviceMemory <= 4) return true
  return false
}

/** Resolve Babylon EngineOptions for EngineFactory.CreateAsync. */
export function resolveEngineOptions(ctx: EngineOptionsContext = DEFAULT_CONTEXT): ResolvedEngineOptions {
  const params = new URLSearchParams(ctx.search)

  // Off by default: the scene renders into its own HDR target (MSAA there, FXAA on LOW), so a
  // multisampled canvas only costs memory and a resolve. `?antialias=1` turns it back on.
  const antialiasOn = parseBoolParam(params, 'antialias') === true
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

  const gpu = params.get('gpu')
  const featureLevel: GpuFeatureLevel = gpu === 'compat' ? 'compatibility' : 'core'
  const failIfMajorPerformanceCaveat = gpu === 'strict'
  const enableGPUDebugMarkers = parseBoolParam(params, 'gpuDebug') === true

  return {
    antialias: antialiasOn,
    preserveDrawingBuffer,
    stencil: true,
    setMaximumLimits: !maxLimitsOff,
    powerPreference,
    adaptToDeviceRatio: false,
    audioEngine: false,
    doNotHandleContextLost: false,
    failIfMajorPerformanceCaveat,
    premultipliedAlpha: true,
    featureLevel,
    enableGPUDebugMarkers,
  }
}

/**
 * Boot-time hardware scaling level for Babylon's setHardwareScalingLevel().
 * Higher level = lower internal render resolution; `level = 1 / renderScale`.
 *
 * With `adaptToDeviceRatio: false`, Babylon's `resize()` sizes the backbuffer to
 * `clientWidth / level` — DPR never enters on its own, so the policy brings it in:
 * `renderScale = min(DPR, 1.5 mobile | 2 desktop)` (see `resolution-policy.ts`). The quality tier
 * is not known yet at boot; `GameRenderer` re-applies the policy with the tier's cap once it is.
 */
export function resolveHardwareScalingLevel(ctx: EngineOptionsContext = DEFAULT_CONTEXT): number {
  const scale = resolveRenderScale({
    devicePixelRatio: ctx.devicePixelRatio,
    mobile: isMobileUserAgent(ctx.userAgent),
    quality: null,
    search: ctx.search,
  })
  return hardwareScalingLevelFor(scale)
}

/** Apply the boot-time hardware scaling and log it when it is not 1. */
export function applyHardwareScaling(
  engine: { setHardwareScalingLevel: (level: number) => void; getHardwareScalingLevel?: () => number },
  ctx: EngineOptionsContext = DEFAULT_CONTEXT,
): void {
  const level = resolveHardwareScalingLevel(ctx)
  if (level === 1) return

  engine.setHardwareScalingLevel(level)
  console.log(`[Bootstrap] Render scale ${(1 / level).toFixed(2)}x CSS pixels (DPR ${ctx.devicePixelRatio})`)
}
