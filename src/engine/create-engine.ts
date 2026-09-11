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
  ensureGpuDegradeBuffer,
  ensureGpuProbe,
  getActiveGpuFeatureLevel,
  recordGpuDegrade,
  recordGpuProbeEngine,
  setActiveGpuFeatureLevel,
  type GpuDegradeFeatureLevel,
} from './gpu-degrade-telemetry'
import { GpuContextToast, type GpuContextToastDeps } from './gpu-context-toast'

export type EngineCreationPlan = 'webgl2' | 'webgpu'

/** Greppable marker for "we booted on a degraded GPU path" — see docs/ENGINE_BOOTSTRAP.md. */
export const GPU_DEGRADE_MARKER = '[Bootstrap][gpu-degrade]'

/** Dev/test-only globals that drive the context-loss UX without a real device loss. */
export const DEBUG_LOSE_CONTEXT_GLOBAL = '__DEBUG_LOSE_CONTEXT'
export const DEBUG_RESTORE_CONTEXT_GLOBAL = '__DEBUG_RESTORE_CONTEXT'

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
 * We do **not** probe `adapter.limits` and clamp `requiredLimits` here — see
 * "Why we don't probe-and-clamp" in docs/ENGINE_BOOTSTRAP.md. `requiredLimits` are
 * validation bounds, not allocations: asking for the adapter maximum costs nothing, and
 * asking for less cannot raise a cap the post-process stack is already over.
 */
export function toWebGPUEngineOptions(
  options: ResolvedEngineOptions,
  featureLevel: GpuFeatureLevel = options.featureLevel,
): WebGPUEngineOptions {
  const gpuPower =
    options.powerPreference === 'default'
      ? undefined
      : (options.powerPreference as WebGPUEngineOptions['powerPreference'])
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
    setMaximumLimits: featureLevel === 'compatibility' ? false : options.setMaximumLimits,
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
    deviceDescriptor: { requiredFeatures: [] },
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
  /** Feature level recorded with the degrade entry; defaults to the booted level. */
  featureLevel?: GpuDegradeFeatureLevel | null
  /** Injected by tests; defaults to a fresh toast bound to the ambient document. */
  toast?: GpuContextToast
  /**
   * Where `__DEBUG_LOSE_CONTEXT` / `__DEBUG_RESTORE_CONTEXT` are published.
   * Defaults to `window` outside production builds; pass `null` to skip them.
   */
  debugHookHost?: Record<string, unknown> | null
}

function defaultDebugHookHost(): Record<string, unknown> | null {
  // Production builds get no debug globals; dev server and Playwright do.
  if (import.meta.env?.PROD) return null
  return typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>) : null
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
  const {
    featureLevel,
    toast: injectedToast,
    debugHookHost = defaultDebugHookHost(),
    ...toastDeps
  } = deps
  // `undefined` means "whatever the engine booted on", resolved at record time.
  const level = (): GpuDegradeFeatureLevel | null =>
    featureLevel === undefined ? getActiveGpuFeatureLevel() : featureLevel
  const toast = injectedToast ?? new GpuContextToast(toastDeps)
  toast.markReady()

  const onLost = (): void => {
    console.warn(`${GPU_DEGRADE_MARKER} GPU context lost — Babylon will attempt to restore it`)
    recordGpuDegrade('context-lost', level())
    toast.onLost()
  }
  const onRestored = (): void => {
    console.log('[Bootstrap] GPU context restored')
    recordGpuDegrade('context-restored', level())
    toast.onRestored()
  }

  engine.onContextLostObservable?.add(onLost)
  engine.onContextRestoredObservable?.add(onRestored)

  // WebGPU has no reliable cross-browser programmatic context loss, so tests drive the
  // handlers directly rather than trying to kill a real device.
  if (debugHookHost) {
    debugHookHost[DEBUG_LOSE_CONTEXT_GLOBAL] = onLost
    debugHookHost[DEBUG_RESTORE_CONTEXT_GLOBAL] = onRestored
  }

  return () => {
    engine.onContextLostObservable?.removeCallback(onLost)
    engine.onContextRestoredObservable?.removeCallback(onRestored)
    if (debugHookHost) {
      if (debugHookHost[DEBUG_LOSE_CONTEXT_GLOBAL] === onLost) {
        delete debugHookHost[DEBUG_LOSE_CONTEXT_GLOBAL]
      }
      if (debugHookHost[DEBUG_RESTORE_CONTEXT_GLOBAL] === onRestored) {
        delete debugHookHost[DEBUG_RESTORE_CONTEXT_GLOBAL]
      }
    }
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

/**
 * Try WebGPU at each feature level in turn, disposing the failed instance before
 * moving on. Returns null when every level failed — the caller falls back to WebGL2.
 *
 * The `compatibility` retry is the one attempt that deliberately asks for less
 * (`setMaximumLimits: false`); a strict adapter that rejected core can still hand us a
 * device once we stop demanding every limit at its maximum.
 */
export async function createWebGPUEngineWithFallback(
  canvas: HTMLCanvasElement,
  options: ResolvedEngineOptions,
  factory: WebGPUEngineFactory = defaultWebGPUEngineFactory,
): Promise<WebGPUCreationResult | null> {
  const levels = webgpuFeatureLevelsToTry(options.featureLevel)

  for (const featureLevel of levels) {
    const gpuOptions = toWebGPUEngineOptions(options, featureLevel)
    let engine: WebGPUEngineLike | undefined
    try {
      engine = factory(canvas, gpuOptions)
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
  setActiveGpuFeatureLevel('webgl2')
  recordGpuProbeEngine('webgl2', 'webgl2')
  attachGpuContextLogging(engine, { featureLevel: 'webgl2' })
  return engine
}

export async function createEngine(canvas: HTMLCanvasElement): Promise<EngineType | WebGPUEngineType> {
  ensureGpuDegradeBuffer()
  ensureGpuProbe()
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
    setActiveGpuFeatureLevel(created.featureLevel)
    recordGpuProbeEngine('webgpu', created.featureLevel)
    attachGpuContextLogging(engine, { featureLevel: created.featureLevel })
    console.log(
      `[Bootstrap] Active renderer: ${engine.getClassName()} (featureLevel=${created.featureLevel})`,
    )
    return engine
  }

  console.warn(`${GPU_DEGRADE_MARKER} WebGPU init failed at every featureLevel, using WebGL2 fallback`)
  recordGpuDegrade('webgl2-fallback', 'webgl2', `requested ${engineOptions.featureLevel}`)
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
