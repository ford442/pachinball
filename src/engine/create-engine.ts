/**
 * Babylon engine creation — routes WebGPU vs WebGL2 based on user preference.
 *
 * Babylon's EngineFactory.CreateAsync always prefers WebGPU when supported and
 * ignores a `disableWebGPU` option, so forced WebGL2 must use Engine directly.
 *
 * We also avoid `WebGPUEngine.CreateAsync`: in @babylonjs/core 7.54.3 it wraps
 * `initAsync()` in a promise with no reject path, so a failed WebGPU init never
 * settles (and leaves the half-built engine undisposed). Constructing the
 * engine ourselves and awaiting `initAsync()` gives us both a real rejection to
 * fall back on and a handle to dispose before the next attempt.
 */

import { Engine } from '@babylonjs/core/Engines/engine'
import type { Engine as EngineType } from '@babylonjs/core/Engines/engine'
import type { EngineOptions } from '@babylonjs/core/Engines/thinEngine'
import { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine'
import type { WebGPUEngine as WebGPUEngineType, WebGPUEngineOptions } from '@babylonjs/core/Engines/webgpuEngine'
import {
  getRendererPreference,
  RENDERER_AUTO,
  RENDERER_WEBGPU,
  type RendererPreference,
} from '../renderers/renderer-selector'
import {
  resolveEngineOptions,
  type GpuFeatureLevel,
  type ResolvedEngineOptions,
} from './engine-options'
import {
  describeClampedLimits,
  probeGpuLimits,
  type GpuLike,
  type ProbeGpuLimitsOptions,
  type ResolvedGpuLimits,
} from './gpu-limits'
import { ensureGpuDegradeBuffer, recordGpuDegrade } from './gpu-degrade-telemetry'
import { GpuContextToast, type GpuContextToastDeps } from './gpu-context-toast'

export type EngineCreationPlan = 'webgl2' | 'webgpu'

/** Greppable marker for "we booted on a degraded GPU path" — see docs/ENGINE_BOOTSTRAP.md. */
export const GPU_DEGRADE_MARKER = '[Bootstrap][gpu-degrade]'

/** Pure routing for tests — which backend createEngine will attempt. */
export function resolveEngineCreationPlan(
  preference: RendererPreference,
  webgpuSupported: boolean,
): EngineCreationPlan {
  if (preference === RENDERER_WEBGPU) return 'webgpu'
  if (preference === RENDERER_AUTO) return webgpuSupported ? 'webgpu' : 'webgl2'
  return 'webgl2'
}

/** core → try core then compatibility; compat stays compatibility-only. */
export function webgpuFeatureLevelsToTry(featureLevel: GpuFeatureLevel): GpuFeatureLevel[] {
  if (featureLevel === 'compatibility') return ['compatibility']
  return ['core', 'compatibility']
}

export function toWebGLEngineOptions(options: ResolvedEngineOptions): EngineOptions {
  return {
    antialias: options.antialias,
    preserveDrawingBuffer: options.preserveDrawingBuffer,
    stencil: options.stencil,
    audioEngine: options.audioEngine,
    doNotHandleContextLost: options.doNotHandleContextLost,
    failIfMajorPerformanceCaveat: options.failIfMajorPerformanceCaveat,
    premultipliedAlpha: options.premultipliedAlpha,
    powerPreference: options.powerPreference,
    adaptToDeviceRatio: options.adaptToDeviceRatio,
  }
}

/**
 * Build the Babylon WebGPU options for one attempt.
 *
 * When `requiredLimits` is supplied (the probe-and-clamp path) it wins: Babylon only
 * applies `setMaximumLimits` when `deviceDescriptor.requiredLimits` is unset, so we turn
 * the blunt flag off explicitly rather than relying on that ordering.
 */
export function toWebGPUEngineOptions(
  options: ResolvedEngineOptions,
  featureLevel: GpuFeatureLevel = options.featureLevel,
  requiredLimits?: Record<string, number>,
): WebGPUEngineOptions {
  const gpuPower =
    options.powerPreference === 'default'
      ? undefined
      : (options.powerPreference as WebGPUEngineOptions['powerPreference'])
  const hasProbedLimits = requiredLimits !== undefined && Object.keys(requiredLimits).length > 0
  return {
    antialias: options.antialias,
    stencil: options.stencil,
    audioEngine: options.audioEngine,
    doNotHandleContextLost: options.doNotHandleContextLost,
    premultipliedAlpha: options.premultipliedAlpha,
    adaptToDeviceRatio: options.adaptToDeviceRatio,
    // MRT defense — do not disable to "fix" Safari; see webgpu-post-process-profile.ts.
    // The compatibility retry is the one place we ask for less: a strict adapter that
    // rejected core+maxLimits can still hand us a device once we stop demanding them.
    setMaximumLimits:
      featureLevel === 'compatibility' || hasProbedLimits ? false : options.setMaximumLimits,
    powerPreference: gpuPower,
    featureLevel,
    enableGPUDebugMarkers: options.enableGPUDebugMarkers,
    enableAllFeatures: false,
    // Deliberately empty: risky optional features (timestamp-query,
    // float32-filterable, rg11b10ufloat-renderable) are not universally supported,
    // and a hard requirement here fails device creation outright. The rule is to
    // check `adapter.features.has(...)` in the pass that needs one and degrade
    // there instead. Babylon mutates this object during initAsync, so it must stay
    // a fresh literal per call.
    deviceDescriptor: hasProbedLimits
      ? { requiredFeatures: [], requiredLimits: { ...requiredLimits } }
      : { requiredFeatures: [] },
  }
}

interface ContextObservable {
  add: (callback: () => void) => unknown
  removeCallback: (callback: () => void) => unknown
}

interface ContextLostEngine {
  onContextLostObservable?: ContextObservable
  onContextRestoredObservable?: ContextObservable
}

export interface GpuContextLoggingDeps extends GpuContextToastDeps {
  /** Feature level recorded with the degrade entry; null for WebGL2. */
  featureLevel?: GpuFeatureLevel | null
  /** Injected by tests; defaults to a fresh toast bound to the ambient document. */
  toast?: GpuContextToast
}

/**
 * Log GPU context loss / restore, surface it in `#power-toast`, and record both in the
 * degrade ring buffer.
 *
 * `doNotHandleContextLost` is false, so Babylon owns the actual rebuild of GPU resources.
 * Calling `engine.resize()` here would look like recovery without re-uploading a single
 * buffer or pipeline, so we still don't — we wait for Babylon's restore observable and
 * only then say "Restored".
 */
export function attachGpuContextLogging(
  engine: ContextLostEngine,
  deps: GpuContextLoggingDeps = {},
): () => void {
  const { featureLevel = null, toast: injectedToast, ...toastDeps } = deps
  const toast = injectedToast ?? new GpuContextToast(toastDeps)
  toast.markReady()

  const onLost = (): void => {
    console.warn(`${GPU_DEGRADE_MARKER} GPU context lost — Babylon will attempt to restore it`)
    recordGpuDegrade('context-lost', featureLevel)
    toast.onLost()
  }
  const onRestored = (): void => {
    console.log('[Bootstrap] GPU context restored')
    recordGpuDegrade('context-restored', featureLevel)
    toast.onRestored()
  }

  engine.onContextLostObservable?.add(onLost)
  engine.onContextRestoredObservable?.add(onRestored)

  return () => {
    engine.onContextLostObservable?.removeCallback(onLost)
    engine.onContextRestoredObservable?.removeCallback(onRestored)
    toast.dispose()
  }
}

/** Minimal surface of WebGPUEngine used by the fallback loop, so tests can inject a stub. */
export interface WebGPUEngineLike {
  initAsync(glslangOptions?: unknown, twgslOptions?: unknown): Promise<void>
  dispose(): void
}

export type WebGPUEngineFactory = (
  canvas: HTMLCanvasElement,
  options: WebGPUEngineOptions,
) => WebGPUEngineLike

const defaultWebGPUEngineFactory: WebGPUEngineFactory = (canvas, options) =>
  new WebGPUEngine(canvas, options) as unknown as WebGPUEngineLike

export interface WebGPUCreationResult {
  engine: WebGPUEngineLike
  featureLevel: GpuFeatureLevel
}

export type GpuLimitsProbe = (
  options: ProbeGpuLimitsOptions,
) => Promise<ResolvedGpuLimits | null>

const defaultGpuLimitsProbe: GpuLimitsProbe = (probeOptions) => {
  const gpu =
    typeof navigator !== 'undefined'
      ? (navigator as Navigator & { gpu?: GpuLike }).gpu
      : undefined
  return probeGpuLimits(gpu, probeOptions)
}

export interface WebGPUFallbackDeps {
  factory?: WebGPUEngineFactory
  /** Injected in tests; defaults to `navigator.gpu.requestAdapter()`. */
  probeLimits?: GpuLimitsProbe
}

/**
 * Try WebGPU at each feature level in turn, disposing the failed instance before
 * moving on. Returns null when every level failed — the caller falls back to WebGL2.
 *
 * The `core` attempt probes the adapter and asks for only the limits the MRT chain needs
 * (clamped to what the adapter reports). The `compatibility` retry deliberately drops the
 * list entirely and takes WebGPU's default limits — asking a strict adapter for *less* is
 * the whole point of that retry.
 */
export async function createWebGPUEngineWithFallback(
  canvas: HTMLCanvasElement,
  options: ResolvedEngineOptions,
  factory: WebGPUEngineFactory = defaultWebGPUEngineFactory,
  deps: WebGPUFallbackDeps = {},
): Promise<WebGPUCreationResult | null> {
  const levels = webgpuFeatureLevelsToTry(options.featureLevel)
  const probeLimits = deps.probeLimits ?? defaultGpuLimitsProbe
  const engineFactory = deps.factory ?? factory

  let probed: ResolvedGpuLimits | null = null
  if (options.setMaximumLimits && levels.includes('core')) {
    probed = await probeLimits({ powerPreference: options.powerPreference, featureLevel: 'core' })
    if (probed) {
      if (probed.clamped.length > 0) {
        const detail = describeClampedLimits(probed.clamped)
        console.warn(`${GPU_DEGRADE_MARKER} adapter clamped requiredLimits: ${detail}`)
        recordGpuDegrade('limits-clamped', 'core', detail)
      }
      if (probed.unsupported.length > 0) {
        console.log(
          `[Bootstrap] adapter does not report ${probed.unsupported.join(', ')} — omitted from requiredLimits`,
        )
      }
    } else {
      console.log('[Bootstrap] requiredLimits probe unavailable, keeping setMaximumLimits')
    }
  }

  for (const featureLevel of levels) {
    // Compatibility is the safety net: no probed limits, WebGPU defaults only.
    const requiredLimits = featureLevel === 'core' ? probed?.requiredLimits : undefined
    const gpuOptions = toWebGPUEngineOptions(options, featureLevel, requiredLimits)
    let engine: WebGPUEngineLike | undefined
    try {
      engine = engineFactory(canvas, gpuOptions)
      await engine.initAsync()
      if (featureLevel !== options.featureLevel) {
        console.warn(
          `${GPU_DEGRADE_MARKER} WebGPU featureLevel fell back to ${featureLevel} ` +
            `(setMaximumLimits=${String(gpuOptions.setMaximumLimits)})`,
        )
        recordGpuDegrade(
          'webgpu-featurelevel',
          featureLevel,
          `requested ${options.featureLevel}`,
        )
      }
      return { engine, featureLevel }
    } catch (err) {
      console.warn(`[Bootstrap] WebGPU init failed at featureLevel=${featureLevel}`, err)
      // Dispose before the next attempt — a half-initialised WebGPUEngine keeps
      // its canvas context and device callbacks alive otherwise.
      try {
        engine?.dispose()
      } catch (disposeErr) {
        console.warn('[Bootstrap] Disposing failed WebGPU engine threw', disposeErr)
      }
    }
  }

  return null
}

function createWebGL2Engine(
  canvas: HTMLCanvasElement,
  engineOptions: ResolvedEngineOptions,
): EngineType {
  if (!Engine.IsSupported) {
    throw new Error('WebGL2 is not supported on this device')
  }
  const engine = new Engine(canvas, undefined, toWebGLEngineOptions(engineOptions))
  attachGpuContextLogging(engine)
  return engine
}

export async function createEngine(canvas: HTMLCanvasElement): Promise<EngineType | WebGPUEngineType> {
  ensureGpuDegradeBuffer()
  const engineOptions = resolveEngineOptions()
  const preference = getRendererPreference()
  const webgpuSupported = await WebGPUEngine.IsSupportedAsync
  const plan = resolveEngineCreationPlan(preference, webgpuSupported)

  if (plan === 'webgl2') {
    const reason =
      preference === RENDERER_AUTO && !webgpuSupported
        ? 'WebGPU unavailable'
        : 'WebGL2 preference'
    console.log(`[Bootstrap] Renderer preference: WebGL2 (${reason})`)
    const engine = createWebGL2Engine(canvas, engineOptions)
    console.log(`[Bootstrap] Active renderer: ${engine.getClassName()}`)
    return engine
  }

  console.log('[Bootstrap] Renderer preference: WebGPU (auto or explicit)')
  const created = await createWebGPUEngineWithFallback(canvas, engineOptions)

  if (created) {
    const engine = created.engine as unknown as WebGPUEngineType
    attachGpuContextLogging(engine, { featureLevel: created.featureLevel })
    console.log(
      `[Bootstrap] Active renderer: ${engine.getClassName()} (featureLevel=${created.featureLevel})`,
    )
    return engine
  }

  console.warn(`${GPU_DEGRADE_MARKER} WebGPU init failed at every featureLevel, using WebGL2 fallback`)
  recordGpuDegrade('webgl2-fallback', null, `requested ${engineOptions.featureLevel}`)
  const engine = createWebGL2Engine(canvas, engineOptions)
  console.log(`[Bootstrap] Active renderer: ${engine.getClassName()} (WebGL fallback)`)
  return engine
}

/** True if the created engine is actually running on WebGPU. */
export function isWebGPUEngine(engine: EngineType | WebGPUEngineType): boolean {
  return (
    engine.getClassName() === 'WebGPUEngine' ||
    (engine as unknown as { isWebGPU?: boolean }).isWebGPU === true
  )
}
