import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { Scene } from '@babylonjs/core/scene'
import { color, PALETTE } from '../../game-elements/visual-language'

// ============================================================================
// PURE-VISUAL CYBER-NEON DECALS
// Zero physics impact — all elements are emissive + bloom-friendly only.
// Decals automatically follow playfieldGroup tilt via target.parent wiring.
// ============================================================================

export interface DecalOptions {
  size?: Vector3
  normal?: Vector3
  emissiveIntensity?: number
  zOffset?: number
}

/**
 * Creates a projected neon decal on a target mesh (typically the LCD playfield ground).
 * Uses Babylon Decal API so the graphic conforms perfectly to the +18° tilted surface.
 * The decal is re-parented to follow the playfieldGroup.
 *
 * NOTE: texturePath may be a placeholder until real decal PNGs (circuit traces, arrows, etc.)
 * are added under public/assets/textures/decals/. Missing textures result in no-op visuals
 * for that decal; the geometry-based traces in applyTableDecorations provide immediate richness.
 */
export function createNeonDecal(
  scene: Scene,
  targetMesh: Mesh,
  position: Vector3,
  texturePath: string,
  options: DecalOptions = {}
): Mesh {
  const {
    size = new Vector3(4, 4, 0.1),
    normal = new Vector3(0, 1, 0),
    emissiveIntensity = 1.2,
    zOffset = -0.8
  } = options

  const decalMat = new StandardMaterial(`neonDecal-${Date.now()}`, scene)
  decalMat.diffuseTexture = new Texture(texturePath, scene)
  decalMat.diffuseTexture.hasAlpha = true
  decalMat.emissiveColor = color(PALETTE.CYAN).scale(emissiveIntensity)
  decalMat.emissiveTexture = decalMat.diffuseTexture
  decalMat.disableLighting = true
  decalMat.zOffset = zOffset

  const decal = MeshBuilder.CreateDecal('neonDecal', targetMesh, {
    position,
    normal,
    size
  })

  decal.material = decalMat
  decal.parent = targetMesh.parent
  return decal
}
