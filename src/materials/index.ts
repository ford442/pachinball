/**
 * Materials Barrel Export
 *
 * Unified PBR Material System with modular architecture.
 * Provides categorized materials using the Visual Language System
 * for consistent cyber/neon aesthetic across all game objects.
 */

// Re-export core types and functions
export {
  MaterialLibraryBase,
  type TextureSet,
  type TextureFormat,
  type MaterialLibraryStats,
  COMPRESSION_FORMATS,
  detectQualityTier,
} from './material-core'

// Import QualityTier from visual-language (where it's defined)
import { QualityTier } from '../game-elements/visual-language'
export { QualityTier }

// Export specialized material classes
export { BallMaterials } from './material-ball'
export { MetallicMaterials } from './material-metallic'
export { InteractiveMaterials } from './material-interactive'
export { StructuralMaterials } from './material-structural'

// Import for composition
import { Scene, StandardMaterial, PBRMaterial } from '@babylonjs/core'
import { MaterialLibraryBase } from './material-core'
import { BallMaterials } from './material-ball'
import { MetallicMaterials } from './material-metallic'
import { InteractiveMaterials } from './material-interactive'
import { StructuralMaterials } from './material-structural'

/**
 * Main MaterialLibrary class that composes all specialized material modules.
 * Maintains backward compatibility with the original monolithic API.
 */
export class MaterialLibrary extends MaterialLibraryBase {
  private ballMats: BallMaterials
  private metalMats: MetallicMaterials
  private interactiveMats: InteractiveMaterials
  private structuralMats: StructuralMaterials

  constructor(scene: Scene) {
    super(scene)
    this.ballMats = new BallMaterials(scene)
    this.metalMats = new MetallicMaterials(scene)
    this.interactiveMats = new InteractiveMaterials(scene)
    this.structuralMats = new StructuralMaterials(scene)
    
    // Sync quality tier across all sub-modules
    this.syncQualityTier()
  }

  /** Override quality tier setter to sync across all modules */
  override set qualityTier(tier: QualityTier) {
    this._qualityTier = tier
    this.syncQualityTier()
  }

  private syncQualityTier(): void {
    this.ballMats.qualityTier = this._qualityTier
    this.metalMats.qualityTier = this._qualityTier
    this.interactiveMats.qualityTier = this._qualityTier
    this.structuralMats.qualityTier = this._qualityTier
  }

  // ============================================================================
  // BALL MATERIALS (delegate to BallMaterials)
  // ============================================================================

  getChromeBallMaterial(): PBRMaterial {
    return this.ballMats.getChromeBallMaterial()
  }

  getEnhancedChromeBallMaterial(mapColorHex?: string): PBRMaterial {
    return this.ballMats.getEnhancedChromeBallMaterial(mapColorHex)
  }

  updateBallMaterialColor(mat: PBRMaterial, mapColorHex: string): void {
    return this.ballMats.updateBallMaterialColor(mat, mapColorHex)
  }

  getExtraBallMaterial(): PBRMaterial {
    return this.ballMats.getExtraBallMaterial()
  }

  getGoldPlatedBallMaterial(): PBRMaterial {
    return this.ballMats.getGoldPlatedBallMaterial()
  }

  getSolidGoldBallMaterial(): PBRMaterial {
    return this.ballMats.getSolidGoldBallMaterial()
  }

  // ============================================================================
  // METALLIC MATERIALS (delegate to MetallicMaterials)
  // ============================================================================

  getChromeMaterial(): PBRMaterial {
    return this.metalMats.getChromeMaterial()
  }

  getBrushedMetalMaterial(): PBRMaterial {
    return this.metalMats.getBrushedMetalMaterial()
  }

  updateBrushedMetalMaterialEmissive(mapColorHex: string): void {
    return this.metalMats.updateBrushedMetalMaterialEmissive(mapColorHex)
  }

  updateChromeMaterialEmissive(mapColorHex: string): void {
    return this.metalMats.updateChromeMaterialEmissive(mapColorHex)
  }

  getMatteBlackMaterial(): PBRMaterial {
    return this.metalMats.getMatteBlackMaterial()
  }

  getGlossBlackMaterial(): PBRMaterial {
    return this.metalMats.getGlossBlackMaterial()
  }

  getBlackMetalMaterial(): PBRMaterial {
    return this.metalMats.getBlackMetalMaterial()
  }

  getCarbonFiberMaterial(): PBRMaterial {
    return this.metalMats.getCarbonFiberMaterial()
  }

  getGoldMaterial(): PBRMaterial {
    return this.metalMats.getGoldMaterial()
  }

  getCopperMaterial(): PBRMaterial {
    return this.metalMats.getCopperMaterial()
  }

  getPinMaterial(): PBRMaterial {
    return this.metalMats.getPinMaterial()
  }

  updatePinMaterialEmissive(mapColorHex: string): void {
    return this.metalMats.updatePinMaterialEmissive(mapColorHex)
  }

  getEnhancedPinMaterial(mapColorHex?: string): PBRMaterial {
    return this.metalMats.getEnhancedPinMaterial(mapColorHex)
  }

  updatePinMaterialColor(mat: PBRMaterial, mapColorHex: string): void {
    return this.metalMats.updatePinMaterialColor(mat, mapColorHex)
  }

  getEnhancedRailMaterial(mapColorHex?: string): PBRMaterial {
    return this.metalMats.getEnhancedRailMaterial(mapColorHex)
  }

  updateRailMaterialColor(mat: PBRMaterial, mapColorHex: string): void {
    return this.metalMats.updateRailMaterialColor(mat, mapColorHex)
  }

  // ============================================================================
  // INTERACTIVE MATERIALS (delegate to InteractiveMaterials)
  // ============================================================================

  getNeonBumperMaterial(baseColor?: string): PBRMaterial {
    return this.interactiveMats.getNeonBumperMaterial(baseColor)
  }

  getEnhancedBumperBodyMaterial(baseColor: string): PBRMaterial {
    return this.interactiveMats.getEnhancedBumperBodyMaterial(baseColor)
  }

  getEnhancedBumperRingMaterial(baseColor: string): PBRMaterial {
    return this.interactiveMats.getEnhancedBumperRingMaterial(baseColor)
  }

  updateBumperMaterialColor(bodyMat: PBRMaterial, ringMat: PBRMaterial, mapColorHex: string): void {
    return this.interactiveMats.updateBumperMaterialColor(bodyMat, ringMat, mapColorHex)
  }

  getNeonFlipperMaterial(): PBRMaterial {
    return this.interactiveMats.getNeonFlipperMaterial()
  }

  getEnhancedFlipperMaterial(): PBRMaterial {
    return this.interactiveMats.getEnhancedFlipperMaterial()
  }

  getFlipperPivotMaterial(): PBRMaterial {
    return this.interactiveMats.getFlipperPivotMaterial()
  }

  updateFlipperMaterialEmissive(mapColorHex: string): void {
    return this.interactiveMats.updateFlipperMaterialEmissive(mapColorHex)
  }

  getNeonSlingshotMaterial(): PBRMaterial {
    return this.interactiveMats.getNeonSlingshotMaterial()
  }

  getCatcherMaterial(): PBRMaterial {
    return this.interactiveMats.getCatcherMaterial()
  }

  getSmokedGlassMaterial(): PBRMaterial {
    return this.interactiveMats.getSmokedGlassMaterial()
  }

  getGlassTubeMaterial(): PBRMaterial {
    return this.interactiveMats.getGlassTubeMaterial()
  }

  getHologramMaterial(colorHex?: string, wireframe?: boolean): PBRMaterial {
    return this.interactiveMats.getHologramMaterial(colorHex, wireframe)
  }

  getEnergyMaterial(colorHex?: string): PBRMaterial {
    return this.interactiveMats.getEnergyMaterial(colorHex)
  }

  getStateBumperMaterial(state: 'IDLE' | 'REACH' | 'FEVER' | 'JACKPOT' | 'ADVENTURE'): PBRMaterial {
    return this.interactiveMats.getStateBumperMaterial(state)
  }

  getAlertMaterial(): PBRMaterial {
    return this.interactiveMats.getAlertMaterial()
  }

  getCabinetNeonMaterial(baseColor?: string): PBRMaterial {
    return this.interactiveMats.getCabinetNeonMaterial(baseColor)
  }

  // ============================================================================
  // STRUCTURAL MATERIALS (delegate to StructuralMaterials)
  // ============================================================================

  getCabinetMaterial(): StandardMaterial | PBRMaterial {
    return this.structuralMats.getCabinetMaterial()
  }

  getSidePanelMaterial(): StandardMaterial {
    return this.structuralMats.getSidePanelMaterial()
  }

  getBlackPlasticMaterial(): PBRMaterial {
    return this.structuralMats.getBlackPlasticMaterial()
  }

  getCabinetWoodMaterial(): PBRMaterial {
    return this.structuralMats.getCabinetWoodMaterial()
  }

  getCabinetMetalTrimMaterial(): PBRMaterial {
    return this.structuralMats.getCabinetMetalTrimMaterial()
  }

  getCabinetInteriorMaterial(): PBRMaterial {
    return this.structuralMats.getCabinetInteriorMaterial()
  }

  getPlayfieldMaterial(): PBRMaterial {
    return this.structuralMats.getPlayfieldMaterial()
  }

  getLCDTableMaterial(): PBRMaterial {
    return this.structuralMats.getLCDTableMaterial()
  }

  updateLCDTableEmissive(baseColor: string, intensity?: number): void {
    return this.structuralMats.updateLCDTableEmissive(baseColor, intensity)
  }
}

// ============================================================================
// SINGLETON INSTANCE MANAGEMENT
// ============================================================================

let materialLibrary: MaterialLibrary | null = null

/**
 * Get or create the singleton MaterialLibrary instance.
 * @param scene - The Babylon.js scene (required for first initialization)
 * @returns The MaterialLibrary instance
 */
export function getMaterialLibrary(scene?: Scene): MaterialLibrary {
  if (!materialLibrary && scene) {
    materialLibrary = new MaterialLibrary(scene)
    // Expose for debugging (dev only)
    if (typeof window !== 'undefined') {
      (window as unknown as Record<string, unknown>).materialLibrary = materialLibrary
    }
  }
  if (!materialLibrary) {
    throw new Error('MaterialLibrary not initialized - scene required for first call')
  }
  return materialLibrary
}

/**
 * Reset the MaterialLibrary singleton.
 * Disposes all materials and clears the cache.
 */
export function resetMaterialLibrary(): void {
  materialLibrary?.dispose()
  materialLibrary = null
}
