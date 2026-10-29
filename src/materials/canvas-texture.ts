/**
 * Canvas-backed textures for the material library, built the same way on WebGL2 and WebGPU.
 *
 * `DynamicTexture`'s constructor calls `engine.createDynamicTexture(...)`, and that method is an
 * engine *extension*: `ThinEngine` and `WebGPUEngine` each get their own from a side-effect module,
 * and the constructor only self-registers the `ThinEngine` one. A WebGPU engine whose extension was
 * never loaded fails in `scene_critical` with `engine.createDynamicTexture is not a function`
 * (first seen in `StructuralMaterials.createLCDGridTexture`, docs/RENDER_BUDGET.md). Both extensions
 * are imported here, once, so the material library does not depend on which engine module a bundle
 * happened to keep.
 */

import '@babylonjs/core/Engines/Extensions/engine.dynamicTexture'
import '@babylonjs/core/Engines/WebGPU/Extensions/engine.dynamicTexture'
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture'
import type { Scene } from '@babylonjs/core/scene'

/** A square, canvas-backed `DynamicTexture` of `size` texels, constructed with the scene's engine. */
export function createCanvasTexture(name: string, size: number, scene: Scene, generateMipMaps: boolean): DynamicTexture {
  const engine = scene.getEngine() as { createDynamicTexture?: unknown; getClassName: () => string }
  if (typeof engine.createDynamicTexture !== 'function') {
    throw new Error(`Cannot build texture "${name}": ${engine.getClassName()} has no createDynamicTexture`)
  }
  return new DynamicTexture(name, size, scene, generateMipMaps)
}
