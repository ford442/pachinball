import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { Scene } from '@babylonjs/core/scene'
import { resolveAssetUrl } from '../game/game-utils'
import { createNeonDecal } from './decoration/decoration-decal'
import {
  resetSharedMats,
  createPerimeterBezel,
  createCentralReactorMotif,
  createLanePowerRails,
  createSideServerRacks,
  createFloatingHoloShards,
  createFiberOpticWiring,
  createWarningBarricadesAndHazards,
  createMicroLEDField,
  createUpperMaintenanceCluster
} from './decoration/decoration-motifs'

export { DecorationBuilder } from './decoration/decoration-builder'
export { DecorationFactory } from './decoration/decoration-factory'
export { createNeonDecal } from './decoration/decoration-decal'
export type { DecalOptions } from './decoration/decoration-decal'

// -----------------------------------------------------------------------------
// MAIN EXPORT — applyTableDecorations
// This is the single public function called once after the playfield ground exists.
// It builds the entire "Nexus Cascade" premium cyber-neon experience.
// -----------------------------------------------------------------------------

/**
 * applyTableDecorations
 *
 * The complete visual upgrade pass for the playfield.
 * Creates a rich, dense, cohesive "Nexus Cascade" cyber-neon arcade cabinet aesthetic
 * that feels expensive, alive, and perfectly integrated with the existing geometry.
 *
 * Features:
 *  - Projected vector decals (via Babylon Decal API — tilt-correct automatically)
 *  - Multi-layer perimeter bezel + power rails with directional flow chevrons
 *  - Central "reactor core" radial motif (the visual centerpiece)
 *  - Dense but elegant side "server rack" tech clusters with hanging fiber bundles
 *  - Floating holographic crystals + rings in quiet visual pockets
 *  - Artistic snaking data wiring connecting major elements
 *  - Industrial warning barricades near outlanes and drain
 *  - Thousands of micro status LEDs (incredible perceived density)
 *  - Upper maintenance / diagnostic cluster under the backbox
 *
 * Everything lives under a single `playfieldCyberDecor` TransformNode for cleanliness.
 * ZERO physics cost. Highly bloom-friendly. Uses shared materials aggressively.
 */

// Layer 1 decals need PNGs under public/assets/textures/decals/ — keep off until art ships.
const PLAYFIELD_DECAL_TEXTURES_READY = false

export function applyTableDecorations(
  scene: Scene,
  playfieldMesh: Mesh,
  playfieldGroup: TransformNode | null
): void {
  if (!playfieldMesh || !scene) return

  const parent = (playfieldGroup ?? playfieldMesh.parent ?? undefined) as TransformNode | undefined
  if (!parent) return

  // Reset shared material cache for this decoration pass
  resetSharedMats()

  // Root container for the entire decoration layer (easy to inspect / toggle later)
  const decorRoot = new TransformNode('playfieldCyberDecor', scene)
  decorRoot.parent = parent

  // ========================================================================
  // LAYER 1 — PROJECTED DECALS (high-level graphic language)
  // ========================================================================
  if (PLAYFIELD_DECAL_TEXTURES_READY) {
    createNeonDecal(scene, playfieldMesh, new Vector3(0, -0.99, 5), resolveAssetUrl('/assets/textures/decals/circuit-center.png')!, {
      size: new Vector3(7.5, 11, 0.08),
      emissiveIntensity: 1.35,
      zOffset: -0.6
    })
    createNeonDecal(scene, playfieldMesh, new Vector3(-5.5, -0.99, -6), resolveAssetUrl('/assets/textures/decals/lane-arrow-l.png')!, {
      size: new Vector3(2.2, 3.5, 0.06),
      emissiveIntensity: 1.6,
      zOffset: -0.7
    })
    createNeonDecal(scene, playfieldMesh, new Vector3(5.5, -0.99, -6), resolveAssetUrl('/assets/textures/decals/lane-arrow-r.png')!, {
      size: new Vector3(2.2, 3.5, 0.06),
      emissiveIntensity: 1.6,
      zOffset: -0.7
    })
    createNeonDecal(scene, playfieldMesh, new Vector3(0, -0.99, 14), resolveAssetUrl('/assets/textures/decals/hazard-chevron.png')!, {
      size: new Vector3(9, 4, 0.05),
      emissiveIntensity: 1.1,
      zOffset: -0.9
    })
  }

  // ========================================================================
  // LAYER 2 — ARCHITECTURAL BEZEL & POWER RAILS (premium framing)
  // ========================================================================
  createPerimeterBezel(scene, decorRoot)
  createLanePowerRails(scene, decorRoot)

  // ========================================================================
  // LAYER 3 — HERO MOTIF (the thing players remember)
  // ========================================================================
  createCentralReactorMotif(scene, decorRoot)

  // ========================================================================
  // LAYER 4 — SIDE TECH ECOSYSTEM (dense but respectful of play space)
  // ========================================================================
  createSideServerRacks(scene, decorRoot)
  createFiberOpticWiring(scene, decorRoot)

  // ========================================================================
  // LAYER 5 — FLOATING HOLO ACCENTS + MICRO DETAIL
  // ========================================================================
  createFloatingHoloShards(scene, decorRoot)
  createMicroLEDField(scene, decorRoot)

  // ========================================================================
  // LAYER 6 — NARRATIVE DANGER + BACK-OF-CABINET DETAIL
  // ========================================================================
  createWarningBarricadesAndHazards(scene, decorRoot)
  createUpperMaintenanceCluster(scene, decorRoot)

  console.log('[Decoration] Nexus Cascade premium cyber-neon decorations applied — table now feels like a high-end arcade cabinet')
}
