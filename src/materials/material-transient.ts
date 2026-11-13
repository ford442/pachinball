/**
 * The one material for things that spawn and expire during play (#524): shard bursts, ripple and
 * impact rings, fever-trail quads.
 *
 * They used to build a `StandardMaterial` per particle (and dispose it a moment later), which is a
 * shader-variant lookup, a uniform buffer and a GC allocation per burst. Now there is exactly one,
 * built at boot by `EffectsSystem`: opaque white emissive, alpha blended, unlit. The colour and the
 * fade of each particle are per-instance (`thinInstanceSetBuffer('color', …)`: Babylon multiplies
 * the base colour by `instanceColor.rgb` and the alpha by `instanceColor.a`), so a gold shard and a
 * cyan ring share it and a fade is a number in a Float32Array, never a material write.
 *
 * Do not mutate it and do not dispose it; `getTransientUnlitMaterial` hands the same instance to
 * every caller in the scene.
 */

import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Material } from '@babylonjs/core/Materials/material'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import type { Scene } from '@babylonjs/core/scene'
import { createStandardMaterial } from './material-basic'

export const TRANSIENT_MATERIAL_NAME = 'transientUnlitMat'

const byScene = new WeakMap<Scene, StandardMaterial>()

export function getTransientUnlitMaterial(scene: Scene): StandardMaterial {
  const cached = byScene.get(scene)
  if (cached) return cached

  const mat = createStandardMaterial(scene, TRANSIENT_MATERIAL_NAME, {
    diffuse: Color3.Black(),
    emissive: Color3.White(),
    unlit: true,
    // Instance alpha only blends when the material is explicitly a blend material: nothing about
    // an instance colour tells Babylon the mesh is transparent.
    backFaceCulling: true,
  })
  mat.transparencyMode = Material.MATERIAL_ALPHABLEND
  byScene.set(scene, mat)
  // Disposed by someone after all: the next request builds a fresh one instead of returning a corpse.
  mat.onDisposeObservable.add(() => {
    if (byScene.get(scene) === mat) byScene.delete(scene)
  })
  return mat
}
