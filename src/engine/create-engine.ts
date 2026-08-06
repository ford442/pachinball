/**
 * Babylon engine creation — routes WebGPU vs WebGL2 based on user preference.
 *
 * Babylon's EngineFactory.CreateAsync always prefers WebGPU when supported and
 * ignores a `disableWebGPU` option, so forced WebGL2 must use Engine directly.
 */

import { Engine } from '@babylonjs/core/Engines/engine'
import type { Engine as EngineType } from '@babylonjs/core/Engines/engine'
import { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine'
import type { WebGPUEngine as WebGPUEngineType, WebGPUEngineOptions } from '@babylonjs/core/Engines/webgpuEngine'
import {
  getRendererPreference,
  RENDERER_WEBGPU,
  type RendererPreference,
} from '../renderers/renderer-selector'
import { resolveEngineOptions, type ResolvedEngineOptions } from './engine-options'

export type EngineCreationPlan = 'webgl2' | 'webgpu'

/** Pure routing for tests — which backend createEngine will attempt. */
export function resolveEngineCreationPlan(
  preference: RendererPreference,
  _webgpuSupported: boolean,
): EngineCreationPlan {
  if (preference === RENDERER_WEBGPU) return 'webgpu'
  return 'webgl2'
}

function toWebGPUEngineOptions(options: ResolvedEngineOptions): WebGPUEngineOptions {
  const { powerPreference, ...rest } = options
  const gpuPower =
    powerPreference === 'default' ? undefined : (powerPreference as WebGPUEngineOptions['powerPreference'])
  return { ...rest, powerPreference: gpuPower }
}

function createWebGL2Engine(
  canvas: HTMLCanvasElement,
  engineOptions: ResolvedEngineOptions,
): EngineType {
  if (!Engine.IsSupported) {
    throw new Error('WebGL2 is not supported on this device')
  }
  return new Engine(canvas, undefined, engineOptions)
}

export async function createEngine(canvas: HTMLCanvasElement): Promise<EngineType | WebGPUEngineType> {
  const engineOptions = resolveEngineOptions()
  const preference = getRendererPreference()
  const plan = resolveEngineCreationPlan(preference, await WebGPUEngine.IsSupportedAsync)

  if (plan === 'webgl2') {
    console.log('[Bootstrap] Renderer preference: WebGL2 (default)')
    const engine = createWebGL2Engine(canvas, engineOptions)
    console.log(`[Bootstrap] Active renderer: ${engine.getClassName()}`)
    return engine
  }

  console.log('[Bootstrap] Renderer preference: WebGPU (experimental)')
  try {
    const engine = await WebGPUEngine.CreateAsync(canvas, toWebGPUEngineOptions(engineOptions))
    console.log(`[Bootstrap] Active renderer: ${engine.getClassName()}`)
    return engine
  } catch (err) {
    console.warn('[Bootstrap] WebGPU init failed, using WebGL2 fallback', err)
    const engine = createWebGL2Engine(canvas, engineOptions)
    console.log(`[Bootstrap] Active renderer: ${engine.getClassName()} (WebGL fallback)`)
    return engine
  }
}

/** True if the created engine is actually running on WebGPU. */
export function isWebGPUEngine(engine: EngineType | WebGPUEngineType): boolean {
  return (
    engine.getClassName() === 'WebGPUEngine' ||
    (engine as unknown as { isWebGPU?: boolean }).isWebGPU === true
  )
}
