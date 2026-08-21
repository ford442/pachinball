/**
 * Babylon engine creation — routes WebGPU vs WebGL2 based on user preference.
 *
 * Babylon's EngineFactory.CreateAsync always prefers WebGPU when supported and
 * ignores a `disableWebGPU` option, so forced WebGL2 must use Engine directly.
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

export type EngineCreationPlan = 'webgl2' | 'webgpu'

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
    // MRT defense — do not disable to "fix" Safari; see webgpu-post-process-profile.ts
    setMaximumLimits: options.setMaximumLimits,
    powerPreference: gpuPower,
    featureLevel,
    enableGPUDebugMarkers: options.enableGPUDebugMarkers,
    enableAllFeatures: false,
  }
}

function showGpuToast(message: string): void {
  if (typeof document === 'undefined') return
  const el = document.getElementById('power-toast')
  if (!el) return
  el.textContent = message
  el.classList.remove('hidden')
  el.classList.add('show')
  window.setTimeout(() => {
    el.classList.add('hidden')
    el.classList.remove('show')
  }, 4000)
}

/** Log + toast + resize when the GPU context is lost (Babylon still owns restore). */
export function attachGpuContextLostHandlers(
  canvas: HTMLCanvasElement,
  engine: { resize: () => void },
): () => void {
  const onLost = (event: Event): void => {
    event.preventDefault?.()
    console.warn('[Bootstrap] GPU context lost', event.type)
    showGpuToast('Graphics context lost — restoring…')
    try {
      engine.resize()
    } catch (err) {
      console.warn('[Bootstrap] engine.resize() after context lost failed', err)
    }
  }
  canvas.addEventListener('webglcontextlost', onLost)
  canvas.addEventListener('webgpucontextlost', onLost)
  return () => {
    canvas.removeEventListener('webglcontextlost', onLost)
    canvas.removeEventListener('webgpucontextlost', onLost)
  }
}

function createWebGL2Engine(
  canvas: HTMLCanvasElement,
  engineOptions: ResolvedEngineOptions,
): EngineType {
  if (!Engine.IsSupported) {
    throw new Error('WebGL2 is not supported on this device')
  }
  const engine = new Engine(canvas, undefined, toWebGLEngineOptions(engineOptions))
  attachGpuContextLostHandlers(canvas, engine)
  return engine
}

export async function createEngine(canvas: HTMLCanvasElement): Promise<EngineType | WebGPUEngineType> {
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
  const levels = webgpuFeatureLevelsToTry(engineOptions.featureLevel)
  let lastErr: unknown
  for (const level of levels) {
    try {
      const engine = await WebGPUEngine.CreateAsync(canvas, toWebGPUEngineOptions(engineOptions, level))
      attachGpuContextLostHandlers(canvas, engine)
      if (level !== engineOptions.featureLevel) {
        console.warn(`[Bootstrap] WebGPU featureLevel fell back to ${level}`)
      }
      console.log(`[Bootstrap] Active renderer: ${engine.getClassName()} (featureLevel=${level})`)
      return engine
    } catch (err) {
      lastErr = err
      console.warn(`[Bootstrap] WebGPU init failed at featureLevel=${level}`, err)
    }
  }

  console.warn('[Bootstrap] WebGPU init failed, using WebGL2 fallback', lastErr)
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
