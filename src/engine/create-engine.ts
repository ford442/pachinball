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
  RENDERER_WEBGL2,
  RENDERER_WEBGPU,
  type RendererPreference,
} from '../renderers/renderer-selector'
import { resolveEngineOptions, type ResolvedEngineOptions } from './engine-options'
import {
  FULL_PIPELINE_UNIFORM_BUFFER_ESTIMATE,
  isWebGPUAdapterStrictForPostProcess,
  readMaxUniformBuffersPerStage,
} from '../game/webgpu-post-process-profile'

export type EngineCreationPlan = 'webgl2' | 'webgpu' | 'webgpu-with-webgl2-fallback'

/** Pure routing for tests — which backend createEngine will attempt. */
export function resolveEngineCreationPlan(
  preference: RendererPreference,
  webgpuSupported: boolean,
): EngineCreationPlan {
  if (preference === RENDERER_WEBGL2) return 'webgl2'
  if (preference === RENDERER_WEBGPU) return 'webgpu'
  return webgpuSupported ? 'webgpu-with-webgl2-fallback' : 'webgl2'
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
    console.log('[Bootstrap] Renderer preference: WebGL2 (forced)')
    const engine = createWebGL2Engine(canvas, engineOptions)
    console.log(`[Bootstrap] Active renderer: ${engine.getClassName()}`)
    return engine
  }

  if (plan === 'webgpu') {
    console.log('[Bootstrap] Renderer preference: webgpu (forced)')
    const engine = await WebGPUEngine.CreateAsync(canvas, toWebGPUEngineOptions(engineOptions))
    console.log(`[Bootstrap] Active renderer: ${engine.getClassName()}`)
    return engine
  }

  if (!engineOptions.preserveDrawingBuffer) {
    console.log('[Bootstrap] preserveDrawingBuffer=false (opt in via ?preserveBuffer=1)')
  }

  if (plan === 'webgpu-with-webgl2-fallback') {
    try {
      const engine = await WebGPUEngine.CreateAsync(canvas, toWebGPUEngineOptions(engineOptions))
      if (isWebGPUAdapterStrictForPostProcess(engine)) {
        const cap = readMaxUniformBuffersPerStage(engine)
        console.warn(
          `[Bootstrap] WebGPU adapter maxUniformBuffersPerShaderStage=${cap} < ${FULL_PIPELINE_UNIFORM_BUFFER_ESTIMATE}; using WebGL2 fallback`,
        )
        engine.dispose()
        const fallback = createWebGL2Engine(canvas, engineOptions)
        console.log(`[Bootstrap] Active renderer: ${fallback.getClassName()} (WebGL fallback)`)
        return fallback
      }
      console.log(`[Bootstrap] Active renderer: ${engine.getClassName()}`)
      return engine
    } catch (err) {
      console.warn('WebGPU init failed, using WebGL fallback', err)
    }
  }

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
