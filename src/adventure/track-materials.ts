/**
 * Babylon material construction for adventure tracks (#383).
 *
 * The purely-visual half of what used to live in track-builder.ts: no
 * geometry, no physics, no collider descriptors. Every material created here
 * is pushed onto the caller's `sink` so clearTrack() can dispose it.
 */

import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import type { Scene } from '@babylonjs/core/scene'

import { PALETTE } from '../game-elements/visual-language'
import { getTrackThemeProfile, type TrackMaterialRole } from './track-theme-profiles'

export type TrackMaterial = StandardMaterial | PBRMaterial

/** Wireframe emissive material — the default adventure track look. */
export function createTrackMaterial(
  scene: Scene,
  sink: TrackMaterial[],
  colorHex: string
): StandardMaterial {
  const mat = new StandardMaterial('trackMat', scene)
  mat.emissiveColor = Color3.FromHexString(colorHex)
  mat.diffuseColor = Color3.Black()
  mat.alpha = 0.6
  mat.wireframe = true
  sink.push(mat)
  return mat
}

/** PBR variant with emissive glow and clear coat, for the premium themes. */
export function createTrackPBRMaterial(
  scene: Scene,
  sink: TrackMaterial[],
  colorHex: string
): PBRMaterial {
  const mat = new PBRMaterial('trackPBRMat', scene)
  mat.albedoColor = Color3.Black()
  mat.emissiveColor = Color3.FromHexString(colorHex)
  mat.emissiveIntensity = 1.2
  mat.metallic = 0.8
  mat.roughness = 0.2
  mat.alpha = 0.85
  mat.wireframe = true
  mat.clearCoat.isEnabled = true
  mat.clearCoat.intensity = 0.4
  mat.clearCoat.roughness = 0.2
  sink.push(mat)
  return mat
}

/** Resolve a track-geometry material from the active track's theme profile. */
export function createThemedTrackMaterial(
  scene: Scene,
  sink: TrackMaterial[],
  role: TrackMaterialRole,
  trackId: string
): TrackMaterial {
  const profile = getTrackThemeProfile(trackId)
  const hex = profile?.materials[role] ?? PALETTE.CYAN
  const usePbr = profile?.usePBRStructure && (role === 'structure' || role === 'glow')
  const mat = usePbr
    ? createTrackPBRMaterial(scene, sink, hex)
    : createTrackMaterial(scene, sink, hex)
  mat.metadata = { ...(mat.metadata ?? {}), trackMaterialRole: role, trackId }
  return mat
}
