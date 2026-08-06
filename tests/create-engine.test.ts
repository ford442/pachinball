import { describe, it, expect } from 'vitest'
import { resolveEngineCreationPlan } from '../src/engine/create-engine'
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

  it('defaults to WebGL2 for auto and when WebGPU is supported', () => {
    expect(resolveEngineCreationPlan(RENDERER_AUTO, true)).toBe('webgl2')
    expect(resolveEngineCreationPlan(RENDERER_AUTO, false)).toBe('webgl2')
    expect(resolveEngineCreationPlan(RENDERER_WEBGL2, true)).toBe('webgl2')
  })
})
