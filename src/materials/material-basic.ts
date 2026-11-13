/**
 * Basic (non-PBR) materials — the one place a `StandardMaterial` is constructed (#524).
 *
 * `MaterialLibrary` owns the PBR set. Everything else that used to `new StandardMaterial(...)` at
 * its call site (feeders, decoration, room decor, display layers, ghost ball, ...) goes through the
 * helpers here, and ESLint bans `new StandardMaterial` outside `src/materials/` and `src/cabinet/`
 * (the cabinet presets and the glTF shell keep what they build / what the asset brought).
 *
 * Three tiers, picked by lifetime:
 *
 *  - `createStandardMaterial` / `createUnlitMaterial`: a unique, boot-time material its owner may
 *    animate (alpha, emissive, textures) and dispose. The spec only writes what it names, so a
 *    site converted from `new StandardMaterial` + property assignments keeps Babylon's defaults
 *    for everything it did not set.
 *  - `getSharedMaterial` / `getSharedUnlitMaterial`: one material per distinct look per scene, for
 *    static geometry that never writes it. Callers must not mutate or dispose it (the scene owns it).
 *  - `material-transient.ts` / `material-trail.ts`: materials for things that spawn and expire
 *    during play. Those are never created per spawn; see their headers.
 */

import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import type { Scene } from '@babylonjs/core/scene'

/** The StandardMaterial properties the converted call sites actually set. Unset = Babylon default. */
export interface StandardMaterialSpec {
  diffuse?: Color3
  specular?: Color3
  emissive?: Color3
  alpha?: number
  /** `disableLighting`: no light terms in the shader, emissive (+ ambient) only. */
  unlit?: boolean
  backFaceCulling?: boolean
  wireframe?: boolean
  roughness?: number
  zOffset?: number
  diffuseTexture?: BaseTexture | null
  emissiveTexture?: BaseTexture | null
  opacityTexture?: BaseTexture | null
}

/** A unique `StandardMaterial` with exactly the properties `spec` names. The caller owns it. */
export function createStandardMaterial(
  scene: Scene,
  name: string,
  spec: StandardMaterialSpec = {},
): StandardMaterial {
  const mat = new StandardMaterial(name, scene)
  applySpec(mat, spec)
  return mat
}

/** `createStandardMaterial` with `disableLighting` on and `emissive` as the colour. */
export function createUnlitMaterial(
  scene: Scene,
  name: string,
  emissive: Color3,
  spec: Omit<StandardMaterialSpec, 'emissive' | 'unlit'> = {},
): StandardMaterial {
  return createStandardMaterial(scene, name, { ...spec, emissive, unlit: true })
}

function applySpec(mat: StandardMaterial, spec: StandardMaterialSpec): void {
  if (spec.diffuse !== undefined) mat.diffuseColor = spec.diffuse
  if (spec.specular !== undefined) mat.specularColor = spec.specular
  if (spec.emissive !== undefined) mat.emissiveColor = spec.emissive
  if (spec.alpha !== undefined) mat.alpha = spec.alpha
  if (spec.unlit !== undefined) mat.disableLighting = spec.unlit
  if (spec.backFaceCulling !== undefined) mat.backFaceCulling = spec.backFaceCulling
  if (spec.wireframe !== undefined) mat.wireframe = spec.wireframe
  if (spec.roughness !== undefined) mat.roughness = spec.roughness
  if (spec.zOffset !== undefined) mat.zOffset = spec.zOffset
  if (spec.diffuseTexture !== undefined) mat.diffuseTexture = spec.diffuseTexture
  if (spec.emissiveTexture !== undefined) mat.emissiveTexture = spec.emissiveTexture
  if (spec.opacityTexture !== undefined) mat.opacityTexture = spec.opacityTexture
}

// ---------------------------------------------------------------------------------------------
// Shared, read-only materials
// ---------------------------------------------------------------------------------------------

/** What makes two shared materials the same material. Textures are not shareable by value. */
export type SharedMaterialSpec = Omit<StandardMaterialSpec, 'diffuseTexture' | 'emissiveTexture' | 'opacityTexture'>

const shared = new WeakMap<Scene, Map<string, StandardMaterial>>()

const colorKey = (c: Color3 | undefined): string =>
  c ? `${c.r.toFixed(4)},${c.g.toFixed(4)},${c.b.toFixed(4)}` : '-'

function sharedKey(spec: SharedMaterialSpec): string {
  return [
    colorKey(spec.diffuse),
    colorKey(spec.specular),
    colorKey(spec.emissive),
    spec.alpha ?? '-',
    spec.unlit ?? '-',
    spec.backFaceCulling ?? '-',
    spec.wireframe ?? '-',
    spec.roughness ?? '-',
    spec.zOffset ?? '-',
  ].join('|')
}

/**
 * One material per distinct look per scene, for static meshes that never write their material
 * (decoration, the ball's equatorial ring). Two requests with the same spec get the same
 * instance; `name` only names the first one. The scene owns it: do not mutate it, do not dispose
 * it, never pass it to code that animates `material.alpha` / `emissiveColor`. If it is disposed
 * anyway (a `mesh.dispose(false, true)` somewhere) the next request builds a fresh one.
 */
export function getSharedMaterial(scene: Scene, name: string, spec: SharedMaterialSpec): StandardMaterial {
  let byKey = shared.get(scene)
  if (!byKey) {
    byKey = new Map()
    shared.set(scene, byKey)
  }
  const key = sharedKey(spec)
  const cached = byKey.get(key)
  if (cached) return cached

  // The scene's copy of every colour: the caller's `Color3`s stay theirs.
  const mat = createStandardMaterial(scene, name, {
    ...spec,
    diffuse: spec.diffuse?.clone(),
    specular: spec.specular?.clone(),
    emissive: spec.emissive?.clone(),
  })
  byKey.set(key, mat)
  // Disposed by someone after all: the next request builds a fresh one instead of returning a corpse.
  mat.onDisposeObservable.add(() => {
    if (byKey.get(key) === mat) byKey.delete(key)
  })
  return mat
}

/** `getSharedMaterial` for the unlit emissive case: black diffuse, `disableLighting`, `emissive` as the colour. */
export function getSharedUnlitMaterial(
  scene: Scene,
  name: string,
  spec: Omit<SharedMaterialSpec, 'unlit' | 'diffuse'> & { emissive: Color3 },
): StandardMaterial {
  return getSharedMaterial(scene, name, { ...spec, diffuse: Color3.Black(), unlit: true })
}
