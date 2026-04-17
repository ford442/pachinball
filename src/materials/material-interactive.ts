/**
 * Interactive Materials - Interactive element material definitions
 * Bumpers, flippers, slingshots, buttons, energy effects, etc.
 */

import { PBRMaterial, Color3 } from '@babylonjs/core'
import { MaterialLibraryBase } from './material-core'
import {
  PALETTE,
  SURFACES,
  INTENSITY,
  METALLIC,
  ROUGHNESS,
  CLEARCOAT,
  CATEGORIES,
  QualityTier,
  color,
  emissive,
  stateEmissive,
} from '../game-elements/visual-language'

export class InteractiveMaterials extends MaterialLibraryBase {
  // ============================================================================
  // BUMPER MATERIALS
  // ============================================================================

  getNeonBumperMaterial(baseColor?: string): PBRMaterial {
    const colorHex = baseColor || PALETTE.CYAN
    const cacheKey = `bumper_${colorHex}`
    return this.getCachedPBR(cacheKey, () => {
      const mat = new PBRMaterial(`bumperMat_${colorHex}`, this.scene)
      mat.albedoColor = color(colorHex).scale(0.3)
      mat.emissiveColor = emissive(colorHex, INTENSITY.ACTIVE)
      mat.metallic = METALLIC.MID
      mat.roughness = ROUGHNESS.SATIN
      mat.environmentIntensity = 0.6

      // Sheen for soft plastic velvet effect at grazing angles
      if (this._qualityTier !== QualityTier.LOW) {
        mat.sheen.isEnabled = true
        mat.sheen.intensity = 0.6
        mat.sheen.color = color(colorHex).scale(0.5)
      }

      return mat
    })
  }

  /**
   * Enhanced bumper body material - organic rounded look with subsurface scattering
   */
  getEnhancedBumperBodyMaterial(baseColor: string): PBRMaterial {
    const cacheKey = `enhancedBumperBody_${baseColor}`
    return this.getCachedPBR(cacheKey, () => {
      const mat = new PBRMaterial(`enhancedBumperBody_${baseColor}`, this.scene)
      const base = color(baseColor)
      
      // Deep saturated base color
      mat.albedoColor = base.scale(0.4)
      mat.metallic = 0.3
      mat.roughness = 0.25
      mat.environmentIntensity = 0.7
      
      // Strong emissive for neon glow
      mat.emissiveColor = emissive(baseColor, INTENSITY.HIGH)
      mat.emissiveIntensity = 1.0
      
      // Subsurface scattering for organic look
      if (this._qualityTier === QualityTier.HIGH) {
        mat.subSurface.isScatteringEnabled = true
        // tintColor is the available property in this Babylon.js version
        mat.subSurface.tintColor = base
      }
      
      // Clear coat for polished top
      mat.clearCoat.isEnabled = true
      mat.clearCoat.intensity = 0.5
      mat.clearCoat.roughness = 0.2

      return mat
    })
  }

  /**
   * Enhanced bumper ring material - deeper emissive ring around bumper
   */
  getEnhancedBumperRingMaterial(baseColor: string): PBRMaterial {
    const cacheKey = `enhancedBumperRing_${baseColor}`
    return this.getCachedPBR(cacheKey, () => {
      const mat = new PBRMaterial(`enhancedBumperRing_${baseColor}`, this.scene)
      
      // Dark base, strong emissive
      mat.albedoColor = new Color3(0.1, 0.1, 0.1)
      mat.metallic = 0.8
      mat.roughness = 0.3
      
      // Deep emissive ring
      mat.emissiveColor = emissive(baseColor, INTENSITY.BURST)
      mat.emissiveIntensity = 2.0
      mat.environmentIntensity = 0.5

      return mat
    })
  }

  /**
   * Bumpers: update all materials with new map color
   */
  updateBumperMaterialColor(bodyMat: PBRMaterial, ringMat: PBRMaterial, mapColorHex: string): void {
    const mapColor = color(mapColorHex)
    bodyMat.emissiveColor = emissive(mapColorHex, INTENSITY.HIGH)
    if (bodyMat.subSurface.isScatteringEnabled) {
      bodyMat.subSurface.tintColor = mapColor
    }
    ringMat.emissiveColor = emissive(mapColorHex, INTENSITY.BURST)
  }

  // ============================================================================
  // FLIPPER MATERIALS
  // ============================================================================

  getNeonFlipperMaterial(): PBRMaterial {
    return this.getCachedPBR('flipper', () => {
      const mat = new PBRMaterial('flipperMat', this.scene)
      mat.albedoColor = color(PALETTE.GOLD)
      mat.emissiveColor = emissive('#ff8800', INTENSITY.AMBIENT)
      mat.metallic = METALLIC.MID
      mat.roughness = ROUGHNESS.SATIN
      mat.environmentIntensity = 0.7

      this.applyClearCoat(mat, CLEARCOAT.POLISHED)

      // Sheen for golden shimmer
      if (this._qualityTier !== QualityTier.LOW) {
        mat.sheen.isEnabled = true
        mat.sheen.intensity = 0.4
        mat.sheen.color = color(PALETTE.GOLD).scale(0.3)
      }

      return mat
    })
  }

  /**
   * Enhanced flipper material - Wood core with metal plating
   * Classic pinball aesthetic with modern PBR
   */
  getEnhancedFlipperMaterial(): PBRMaterial {
    return this.getCachedPBR('enhancedFlipper', () => {
      const mat = new PBRMaterial('enhancedFlipperMat', this.scene)
      
      // Base: warm wood tone (like classic pinball)
      mat.albedoColor = new Color3(0.4, 0.25, 0.15)
      
      // Metal plating on striking surface
      mat.metallic = 0.4
      mat.roughness = 0.35
      
      // Medium-high environment reflection
      mat.environmentIntensity = 0.8
      
      // Polished clear coat for the "playing surface"
      mat.clearCoat.isEnabled = true
      mat.clearCoat.intensity = 0.6
      mat.clearCoat.roughness = 0.2
      
      // Subtle emissive edge glow (neon accent)
      mat.emissiveColor = emissive('#ff6600', 0.2)
      mat.emissiveIntensity = 0.4

      // Anisotropy for brushed metal look on striking surface
      if (this._qualityTier === QualityTier.HIGH) {
        mat.anisotropy.isEnabled = true
        mat.anisotropy.intensity = 0.3
        mat.anisotropy.direction.x = 1
        mat.anisotropy.direction.y = 0
      }

      return mat
    })
  }

  /**
   * Flipper pivot material - Brushed metal mechanical look
   */
  getFlipperPivotMaterial(): PBRMaterial {
    return this.getCachedPBR('flipperPivot', () => {
      const mat = new PBRMaterial('flipperPivotMat', this.scene)
      
      // Steel/silver metal
      mat.albedoColor = new Color3(0.7, 0.72, 0.75)
      mat.metallic = 0.95
      mat.roughness = 0.25
      
      // High environment reflection for metal
      mat.environmentIntensity = 1.0
      
      // Subtle clear coat for machined metal look
      mat.clearCoat.isEnabled = true
      mat.clearCoat.intensity = 0.4
      mat.clearCoat.roughness = 0.3

      // Anisotropy for brushed metal
      if (this._qualityTier === QualityTier.HIGH) {
        mat.anisotropy.isEnabled = true
        mat.anisotropy.intensity = 0.5
        mat.anisotropy.direction.x = 0
        mat.anisotropy.direction.y = 1
      }

      return mat
    })
  }

  /**
   * Update flipper emissive color to match current LCD map
   */
  updateFlipperMaterialEmissive(mapColorHex: string): void {
    const mat = this.materialCache.get('enhancedFlipper') as PBRMaterial | undefined
    if (mat) {
      mat.emissiveColor = emissive(mapColorHex, 0.25)
    }
  }

  // ============================================================================
  // SLINGSHOT & CATCHER
  // ============================================================================

  getNeonSlingshotMaterial(): PBRMaterial {
    return this.getCachedPBR('slingshot', () => {
      const mat = new PBRMaterial('slingshotMat', this.scene)
      mat.albedoColor = Color3.White()
      mat.emissiveColor = Color3.White()
      mat.emissiveIntensity = INTENSITY.NORMAL
      mat.metallic = METALLIC.MID
      mat.roughness = ROUGHNESS.SATIN
      mat.alpha = 0.75
      mat.environmentIntensity = 0.5
      return mat
    })
  }

  getCatcherMaterial(): PBRMaterial {
    return this.getCachedPBR('catcher', () => {
      const mat = new PBRMaterial('catcherMat', this.scene)
      mat.albedoColor = color(PALETTE.MAGENTA).scale(0.2)
      mat.emissiveColor = emissive(PALETTE.MAGENTA, INTENSITY.ACTIVE)
      mat.metallic = METALLIC.MID
      mat.roughness = ROUGHNESS.SMOOTH
      mat.alpha = 0.85
      mat.environmentIntensity = 0.5

      // Sheen for translucent plastic look
      if (this._qualityTier !== QualityTier.LOW) {
        mat.sheen.isEnabled = true
        mat.sheen.intensity = 0.5
        mat.sheen.color = color(PALETTE.MAGENTA).scale(0.4)
      }

      return mat
    })
  }

  // ============================================================================
  // GLASS MATERIALS
  // ============================================================================

  getSmokedGlassMaterial(): PBRMaterial {
    return this.getCachedPBR('smokedGlass', () => {
      const mat = new PBRMaterial('smokedGlassMat', this.scene)
      mat.albedoColor = color(SURFACES.GLASS)
      mat.emissiveColor = emissive(PALETTE.CYAN, INTENSITY.AMBIENT)
      mat.metallic = METALLIC.LOW
      mat.roughness = ROUGHNESS.SMOOTH
      mat.alpha = CATEGORIES.GLASS.alpha!
      mat.indexOfRefraction = CATEGORIES.GLASS.ior!
      mat.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND
      mat.environmentIntensity = 0.4
      return mat
    })
  }

  getGlassTubeMaterial(): PBRMaterial {
    return this.getCachedPBR('glassTube', () => {
      const mat = new PBRMaterial('glassTubeMat', this.scene)
      mat.alpha = 0.25
      mat.albedoColor = Color3.White()
      mat.metallic = METALLIC.NON_METAL
      mat.roughness = ROUGHNESS.MIRROR
      mat.indexOfRefraction = 1.5
      mat.environmentIntensity = 0.6

      this.applyClearCoat(mat, CLEARCOAT.GLASS)
      mat.backFaceCulling = false

      return mat
    })
  }

  // ============================================================================
  // ENERGY/HOLOGRAM MATERIALS
  // ============================================================================

  getHologramMaterial(colorHex?: string, wireframe: boolean = true): PBRMaterial {
    const baseColor = colorHex || PALETTE.CYAN
    const cacheKey = `hologram_${baseColor}_${wireframe}`
    return this.getCachedPBR(cacheKey, () => {
      const mat = new PBRMaterial(`hologramMat_${baseColor}`, this.scene)
      mat.wireframe = wireframe
      mat.albedoColor = Color3.Black()
      mat.emissiveColor = emissive(baseColor, INTENSITY.HIGH)
      mat.emissiveIntensity = 1.2
      mat.alpha = wireframe ? 0.5 : 0.3
      mat.metallic = METALLIC.FULL
      mat.roughness = ROUGHNESS.MIRROR
      mat.environmentIntensity = 1.0

      // Iridescence for rainbow interference sci-fi hologram effect
      if (this._qualityTier === QualityTier.HIGH) {
        mat.iridescence.isEnabled = true
        mat.iridescence.intensity = 0.8
        mat.iridescence.indexOfRefraction = 1.3
        mat.iridescence.minimumThickness = 100
        mat.iridescence.maximumThickness = 400
      }

      return mat
    })
  }

  getEnergyMaterial(colorHex?: string): PBRMaterial {
    const baseColor = colorHex || PALETTE.CYAN
    const cacheKey = `energy_${baseColor}`
    return this.getCachedPBR(cacheKey, () => {
      const mat = new PBRMaterial(`energyMat_${baseColor}`, this.scene)
      mat.albedoColor = Color3.Black()
      mat.emissiveColor = emissive(baseColor, INTENSITY.HIGH)
      mat.metallic = METALLIC.FULL
      mat.roughness = ROUGHNESS.MIRROR
      mat.environmentIntensity = 1.0

      // Iridescence for rainbow interference sci-fi hologram effect
      if (this._qualityTier === QualityTier.HIGH) {
        mat.iridescence.isEnabled = true
        mat.iridescence.intensity = 0.7
        mat.iridescence.indexOfRefraction = 1.3
        mat.iridescence.minimumThickness = 100
        mat.iridescence.maximumThickness = 400
      }

      return mat
    })
  }

  // ============================================================================
  // STATE-BASED MATERIALS
  // ============================================================================

  getStateBumperMaterial(state: 'IDLE' | 'REACH' | 'FEVER' | 'JACKPOT' | 'ADVENTURE'): PBRMaterial {
    return this.getNeonBumperMaterial(stateEmissive(state).toHexString())
  }

  getAlertMaterial(): PBRMaterial {
    return this.getCachedPBR('alert', () => {
      const mat = new PBRMaterial('alertMat', this.scene)
      mat.albedoColor = color(PALETTE.ALERT).scale(0.3)
      mat.emissiveColor = emissive(PALETTE.ALERT, INTENSITY.HIGH)
      mat.metallic = METALLIC.MID
      mat.roughness = ROUGHNESS.SATIN
      mat.environmentIntensity = 0.5
      return mat
    })
  }

  // ============================================================================
  // CABINET NEON
  // ============================================================================

  getCabinetNeonMaterial(baseColor: string = PALETTE.CYAN): PBRMaterial {
    const cacheKey = `cabinetNeon_${baseColor}`
    return this.getCachedPBR(cacheKey, () => {
      const mat = new PBRMaterial(`cabinetNeonMat_${baseColor}`, this.scene)
      mat.albedoColor = Color3.Black()
      mat.emissiveColor = emissive(baseColor, INTENSITY.HIGH)
      mat.emissiveIntensity = 1.8
      mat.metallic = METALLIC.NON_METAL
      mat.roughness = ROUGHNESS.SMOOTH
      mat.disableLighting = true
      return mat
    })
  }
}
