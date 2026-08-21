import { describe, it, expect, vi } from 'vitest'
import {
  resolveEngineCreationPlan,
  webgpuFeatureLevelsToTry,
  toWebGLEngineOptions,
  toWebGPUEngineOptions,
  attachGpuContextLostHandlers,
} from '../src/engine/create-engine'
import { resolveEngineOptions } from '../src/engine/engine-options'
import { RENDERER_AUTO, RENDERER_WEBGL2, RENDERER_WEBGPU } from '../src/renderers/renderer-selector'

describe('create-engine', () => {
  it('forces WebGL2 when preference is webgl2 regardless of WebGPU support', () => {
    expect(resolveEngineCreationPlan(RENDERER_WEBGL2, true)).toBe('webgl2')
    expect(resolveEngineCreationPlan(RENDERER_WEBGL2, false)).toBe('webgl2')
  })

  it('forces WebGPU when preference is webgpu', () => {
    expect(resolveEngineCreationPlan(RENDERER_WEBGPU, true)).toBe('webgpu')
    expect(resolveEngineCreationPlan(RENDERER_WEBGPU, false)).toBe('webgpu')
  })

  it('defaults to WebGPU when auto preference and WebGPU is supported', () => {
    expect(resolveEngineCreationPlan(RENDERER_AUTO, true)).toBe('webgpu')
    expect(resolveEngineCreationPlan(RENDERER_AUTO, false)).toBe('webgl2')
    expect(resolveEngineCreationPlan(RENDERER_WEBGL2, true)).toBe('webgl2')
  })

  it('tries compatibility after core, but not core after compat', () => {
    expect(webgpuFeatureLevelsToTry('core')).toEqual(['core', 'compatibility'])
    expect(webgpuFeatureLevelsToTry('compatibility')).toEqual(['compatibility'])
  })

  it('maps WebGL options including audioEngine false and SwiftShader-safe caveat', () => {
    const resolved = resolveEngineOptions({
      search: '',
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
      devicePixelRatio: 1,
    })
    const gl = toWebGLEngineOptions(resolved)
    expect(gl.audioEngine).toBe(false)
    expect(gl.failIfMajorPerformanceCaveat).toBe(false)
    expect(gl.premultipliedAlpha).toBe(true)
    expect(gl.doNotHandleContextLost).toBe(false)
  })

  it('maps WebGPU options without enableAllFeatures and remaps default power', () => {
    const resolved = resolveEngineOptions({
      search: '?gpuDebug=1',
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Mobile)',
      devicePixelRatio: 2,
    })
    const gpu = toWebGPUEngineOptions(resolved)
    expect(gpu.powerPreference).toBeUndefined()
    expect(gpu.setMaximumLimits).toBe(true)
    expect(gpu.enableAllFeatures).toBe(false)
    expect(gpu.enableGPUDebugMarkers).toBe(true)
    expect(gpu.audioEngine).toBe(false)
    expect(gpu.featureLevel).toBe('core')
  })

  it('attachGpuContextLostHandlers resizes the engine', () => {
    const listeners = new Map<string, EventListener>()
    const canvas = {
      addEventListener: (type: string, fn: EventListener) => {
        listeners.set(type, fn)
      },
      removeEventListener: (type: string) => {
        listeners.delete(type)
      },
    } as unknown as HTMLCanvasElement
    const resize = vi.fn()
    const detach = attachGpuContextLostHandlers(canvas, { resize })
    listeners.get('webglcontextlost')?.(new Event('webglcontextlost'))
    expect(resize).toHaveBeenCalled()
    detach()
    expect(listeners.has('webglcontextlost')).toBe(false)
  })
})
