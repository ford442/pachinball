import { describe, expect, it, vi } from 'vitest'
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture'
import { createCanvasTexture } from '../src/materials/canvas-texture'

function sceneWith(engine: Record<string, unknown>) {
  return { getEngine: () => engine } as never
}

describe('createCanvasTexture', () => {
  it('constructs a DynamicTexture with the scene when the engine can create one', () => {
    const scene = sceneWith({ createDynamicTexture: vi.fn(), getClassName: () => 'WebGPUEngine' })
    const tex = createCanvasTexture('lcdGridTexture', 512, scene, true)
    expect(tex).toBeDefined()
    expect(DynamicTexture).toHaveBeenLastCalledWith('lcdGridTexture', 512, scene, true)
  })

  it('names the engine instead of surfacing an opaque TypeError when the extension is missing', () => {
    const scene = sceneWith({ getClassName: () => 'WebGPUEngine' })
    expect(() => createCanvasTexture('lcdGridTexture', 512, scene, true)).toThrow(
      'Cannot build texture "lcdGridTexture": WebGPUEngine has no createDynamicTexture',
    )
  })
})
