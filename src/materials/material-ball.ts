/**
 * Ball Materials - Ball-specific material definitions
 */

import { PBRMaterial, Color3 } from '@babylonjs/core'
import { MaterialLibraryBase } from './material-core'
import {
  PALETTE,
  METALLIC,
  ROUGHNESS,
  CLEARCOAT,
  QualityTier,
  color,
} from '../game-elements/visual-language'

export class BallMaterials extends MaterialLibraryBase {
  getChromeBallMaterial(): PBRMaterial {
    return this.getCachedPBR('chromeBall', () => {
      const mat = new PBRMaterial('ballMat', this.scene)
      mat.albedoColor = new Color3(0.95, 0.95, 0.98)
      mat.metallic = METALLIC.FULL
      mat.roughness = ROUGHNESS.POLISHED
      mat.environmentIntensity = 1.5

      this.applyClearCoat(mat, CLEARCOAT.WAXED)

      // Micro-imperfections on ball surface
      if (this._qualityTier === QualityTier.HIGH) {
        const microRoughness = this.createMicroRoughnessTexture()
        mat.bumpTexture = microRoughness
        mat.bumpTexture.level = 0.03
      }

      return mat
    })
  }

  /**
   * Enhanced chrome ball with map-reactive emissive glow
   * Creates a glass/metallic hybrid that reacts to the current LCD map color
   */
  getEnhancedChromeBallMaterial(mapColorHex: string = '#00d9ff'): PBRMaterial {
    const cacheKey = `enhancedBall_${mapColorHex}`
    return this.getCachedPBR(cacheKey, () => {
      const mat = new PBRMaterial('enhancedBallMat', this.scene)
      
      // Base: near-white chrome
      mat.albedoColor = new Color3(0.98, 0.98, 1.0)
      mat.metallic = 1.0
      mat.roughness = 0.15
      
      // High environment intensity for reflections
      mat.environmentIntensity = 1.8
      
      // Clear coat for glass-like surface
      mat.clearCoat.isEnabled = true
      mat.clearCoat.intensity = 1.0
      mat.clearCoat.roughness = 0.1
      
      // Map-reactive emissive tint (subtle inner glow)
      const mapColor = color(mapColorHex)
      mat.emissiveColor = mapColor.scale(0.15)
      mat.emissiveIntensity = 0.3
      
      // Subsurface scattering for translucency effect
      if (this._qualityTier === QualityTier.HIGH) {
        mat.subSurface.isRefractionEnabled = true
        mat.subSurface.indexOfRefraction = 1.5
        mat.subSurface.tintColor = mapColor
        
        // Micro-roughness for surface detail
        const microRoughness = this.createMicroRoughnessTexture()
        mat.bumpTexture = microRoughness
        mat.bumpTexture.level = 0.02
      }

      return mat
    })
  }

  /**
   * Update ball material with new map color
   */
  updateBallMaterialColor(mat: PBRMaterial, mapColorHex: string): void {
    const mapColor = color(mapColorHex)
    mat.emissiveColor = mapColor.scale(0.15)
    if (mat.subSurface.isRefractionEnabled) {
      mat.subSurface.tintColor = mapColor
    }
  }

  getExtraBallMaterial(): PBRMaterial {
    return this.getCachedPBR('extraBall', () => {
      const mat = new PBRMaterial('xbMat', this.scene)
      mat.albedoColor = color(PALETTE.MATRIX)
      mat.metallic = METALLIC.HIGH
      mat.roughness = ROUGHNESS.POLISHED
      mat.environmentIntensity = 1.0

      // Iridescence for special ball
      if (this._qualityTier === QualityTier.HIGH) {
        mat.iridescence.isEnabled = true
        mat.iridescence.intensity = 0.5
        mat.iridescence.indexOfRefraction = 1.4
        mat.iridescence.minimumThickness = 200
        mat.iridescence.maximumThickness = 500
      }

      return mat
    })
  }

  /**
   * Gold-plated ball material - lighter, more reflective surface
   * Common premium ball type
   */
  getGoldPlatedBallMaterial(): PBRMaterial {
    return this.getCachedPBR('goldPlatedBall', () => {
      const mat = new PBRMaterial('goldPlatedBallMat', this.scene)
      // Lighter, more reflective surface
      mat.albedoColor = new Color3(0.95, 0.87, 0.65)  // Light gold
      mat.metallic = 0.9
      mat.roughness = 0.15  // Lower for polished look
      mat.environmentIntensity = 1.3  // Higher reflectivity

      // Subtle specular highlights
      mat.emissiveColor = new Color3(0.3, 0.25, 0.1)
      mat.emissiveIntensity = 0.2

      // Clear coat for shine
      mat.clearCoat.isEnabled = true
      mat.clearCoat.intensity = 0.6
      mat.clearCoat.roughness = 0.1

      return mat
    })
  }

  /**
   * Solid gold ball material - deeper, richer gold color
   * Rare jackpot ball type
   */
  getSolidGoldBallMaterial(): PBRMaterial {
    return this.getCachedPBR('solidGoldBall', () => {
      const mat = new PBRMaterial('solidGoldBallMat', this.scene)
      // Deeper, richer gold color
      mat.albedoColor = new Color3(1.0, 0.76, 0.15)  // Rich yellow-gold
      mat.metallic = 1.0  // Full metallic
      mat.roughness = 0.12  // Controlled for precious metal look
      mat.environmentIntensity = 1.5  // Strong reflectivity

      // Warm light response
      mat.emissiveColor = new Color3(0.4, 0.3, 0.05)
      mat.emissiveIntensity = 0.3

      // Strong clear coat for premium look
      mat.clearCoat.isEnabled = true
      mat.clearCoat.intensity = 0.8
      mat.clearCoat.roughness = 0.08

      return mat
    })
  }
}
