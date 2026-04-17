/**
 * Metallic Materials - Metallic surface material definitions
 */

import { PBRMaterial, Color3, DynamicTexture } from '@babylonjs/core'
import { MaterialLibraryBase } from './material-core'
import {
  SURFACES,
  METALLIC,
  ROUGHNESS,
  CLEARCOAT,
  QualityTier,
  color,
} from '../game-elements/visual-language'

export class MetallicMaterials extends MaterialLibraryBase {
  // ============================================================================
  // BASIC METALLIC
  // ============================================================================

  getChromeMaterial(): PBRMaterial {
    return this.getCachedPBR('chrome', () => {
      const mat = new PBRMaterial('chromeMat', this.scene)
      mat.albedoColor = color(SURFACES.METAL_LIGHT)
      mat.metallic = METALLIC.FULL
      mat.roughness = ROUGHNESS.POLISHED
      mat.environmentIntensity = 1.5

      // Micro-roughness noise to break up perfect reflections
      if (this._qualityTier === QualityTier.HIGH) {
        const microRoughness = this.createMicroRoughnessTexture()
        mat.metallicTexture = microRoughness
        mat.useMetallnessFromMetallicTextureBlue = false
        mat.useRoughnessFromMetallicTextureGreen = true
        mat.useRoughnessFromMetallicTextureAlpha = false
      }

      return mat
    })
  }

  getBrushedMetalMaterial(): PBRMaterial {
    return this.getCachedPBR('brushedMetal', () => {
      const mat = new PBRMaterial('brushedMetalMat', this.scene)
      mat.albedoColor = color(SURFACES.METAL_DARK)
      mat.metallic = METALLIC.HIGH
      mat.roughness = ROUGHNESS.SATIN
      mat.environmentIntensity = 0.8

      // Anisotropy for directional brushed streaks
      if (this._qualityTier !== QualityTier.LOW) {
        mat.anisotropy.isEnabled = true
        mat.anisotropy.intensity = 0.8
        mat.anisotropy.direction.x = 0
        mat.anisotropy.direction.y = 1 // Vertical streaks
      }

      return mat
    })
  }

  /**
   * Update cached brushed metal material emissive color for map reactivity
   */
  updateBrushedMetalMaterialEmissive(mapColorHex: string): void {
    const mat = this.materialCache.get('brushedMetal') as PBRMaterial | undefined
    if (mat) {
      mat.emissiveColor = color(mapColorHex).scale(0.15)
    }
  }

  /**
   * Update cached chrome material emissive color for map reactivity
   */
  updateChromeMaterialEmissive(mapColorHex: string): void {
    const mat = this.materialCache.get('chrome') as PBRMaterial | undefined
    if (mat) {
      mat.emissiveColor = color(mapColorHex).scale(0.12)
    }
  }

  // ============================================================================
  // PRESET MATERIALS
  // ============================================================================

  getMatteBlackMaterial(): PBRMaterial {
    return this.getCachedPBR('matteBlack', () => {
      const mat = new PBRMaterial('matteBlackMat', this.scene)
      mat.albedoColor = new Color3(0.05, 0.05, 0.06)
      mat.metallic = 0.1
      mat.roughness = 0.9
      mat.environmentIntensity = 0.3
      return mat
    })
  }

  getGlossBlackMaterial(): PBRMaterial {
    return this.getCachedPBR('glossBlack', () => {
      const mat = new PBRMaterial('glossBlackMat', this.scene)
      mat.albedoColor = new Color3(0.02, 0.02, 0.03)
      mat.metallic = 0.3
      mat.roughness = 0.2
      mat.environmentIntensity = 1.0
      this.applyClearCoat(mat, { enabled: true, intensity: 0.8, roughness: 0.1 })
      return mat
    })
  }

  getBlackMetalMaterial(): PBRMaterial {
    return this.getCachedPBR('blackMetal', () => {
      const mat = new PBRMaterial('blackMetalMat', this.scene)
      mat.albedoColor = new Color3(0.08, 0.08, 0.1)
      mat.metallic = 0.9
      mat.roughness = 0.4
      mat.environmentIntensity = 0.7
      return mat
    })
  }

  getCarbonFiberMaterial(): PBRMaterial {
    return this.getCachedPBR('carbonFiber', () => {
      const mat = new PBRMaterial('carbonFiberMat', this.scene)
      mat.albedoColor = new Color3(0.1, 0.1, 0.12)
      mat.metallic = 0.4
      mat.roughness = 0.3
      mat.environmentIntensity = 0.5

      // Create carbon fiber weave texture
      const weaveTex = this.createCarbonFiberTexture()
      mat.bumpTexture = weaveTex
      mat.bumpTexture.level = 0.3

      return mat
    })
  }

  private createCarbonFiberTexture(): DynamicTexture {
    const size = 512
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')!

    // Dark background
    ctx.fillStyle = '#1a1a1a'
    ctx.fillRect(0, 0, size, size)

    // Diagonal weave pattern
    ctx.strokeStyle = '#333'
    ctx.lineWidth = 2
    const step = 16

    for (let i = -size; i < size * 2; i += step) {
      ctx.beginPath()
      ctx.moveTo(i, 0)
      ctx.lineTo(i + size, size)
      ctx.stroke()

      ctx.beginPath()
      ctx.moveTo(i + size, 0)
      ctx.lineTo(i, size)
      ctx.stroke()
    }

    const tex = new DynamicTexture('carbonFiberTex', size, this.scene, true)
    const texCtx = tex.getContext()
    texCtx.drawImage(canvas, 0, 0)
    tex.update()
    this.textureCache.set('carbonFiberTex', tex)
    return tex
  }

  getGoldMaterial(): PBRMaterial {
    return this.getCachedPBR('gold', () => {
      const mat = new PBRMaterial('goldMat', this.scene)
      mat.albedoColor = new Color3(1.0, 0.84, 0.0)
      mat.metallic = 1.0
      mat.roughness = 0.15
      mat.environmentIntensity = 1.2
      return mat
    })
  }

  getCopperMaterial(): PBRMaterial {
    return this.getCachedPBR('copper', () => {
      const mat = new PBRMaterial('copperMat', this.scene)
      mat.albedoColor = new Color3(0.72, 0.45, 0.2)
      mat.metallic = 1.0
      mat.roughness = 0.25
      mat.environmentIntensity = 1.0
      return mat
    })
  }

  // ============================================================================
  // PIN MATERIALS
  // ============================================================================

  getPinMaterial(): PBRMaterial {
    return this.getCachedPBR('pin', () => {
      const mat = new PBRMaterial('pinMat', this.scene)
      mat.albedoColor = color(SURFACES.METAL_LIGHT)
      mat.metallic = METALLIC.FULL
      mat.roughness = ROUGHNESS.SMOOTH
      mat.environmentIntensity = 0.9

      // Clear coat - worn factory finish
      this.applyClearCoat(mat, CLEARCOAT.PIN)

      // Pin micro-scratches via noise bump
      if (this._qualityTier === QualityTier.HIGH) {
        const noiseBump = this.createMicroRoughnessTexture()
        mat.bumpTexture = noiseBump
        mat.bumpTexture.level = 0.05
      }

      return mat
    })
  }

  /**
   * Update cached pin material emissive color for map reactivity
   */
  updatePinMaterialEmissive(mapColorHex: string): void {
    const mat = this.materialCache.get('pin') as PBRMaterial | undefined
    if (mat) {
      mat.emissiveColor = color(mapColorHex).scale(0.25)
      mat.emissiveIntensity = 0.4
    }
  }

  /**
   * Enhanced peg material with map-reactive emissive tips
   * Used for pachinko field pins
   */
  getEnhancedPinMaterial(mapColorHex: string = '#00d9ff'): PBRMaterial {
    const cacheKey = `enhancedPin_${mapColorHex}`
    return this.getCachedPBR(cacheKey, () => {
      const mat = new PBRMaterial('enhancedPinMat', this.scene)
      
      // Chrome base
      mat.albedoColor = new Color3(0.9, 0.9, 0.92)
      mat.metallic = 1.0
      mat.roughness = 0.2
      mat.environmentIntensity = 1.2
      
      // Map-reactive tip glow
      const mapColor = color(mapColorHex)
      mat.emissiveColor = mapColor.scale(0.3)
      mat.emissiveIntensity = 0.5
      
      // Polished clear coat
      mat.clearCoat.isEnabled = true
      mat.clearCoat.intensity = 0.8
      mat.clearCoat.roughness = 0.15

      return mat
    })
  }

  /**
   * Update pin material with new map color
   */
  updatePinMaterialColor(mat: PBRMaterial, mapColorHex: string): void {
    const mapColor = color(mapColorHex)
    mat.emissiveColor = mapColor.scale(0.3)
  }

  // ============================================================================
  // RAIL MATERIALS
  // ============================================================================

  /**
   * Enhanced rail material - smooth curved metal with map-reactive accent
   */
  getEnhancedRailMaterial(mapColorHex: string = '#00d9ff'): PBRMaterial {
    const cacheKey = `enhancedRail_${mapColorHex}`
    return this.getCachedPBR(cacheKey, () => {
      const mat = new PBRMaterial('enhancedRailMat', this.scene)
      
      // Polished steel base
      mat.albedoColor = new Color3(0.75, 0.78, 0.82)
      mat.metallic = 0.95
      mat.roughness = 0.2
      mat.environmentIntensity = 1.0
      
      // Map-reactive rim light accent
      const mapColor = color(mapColorHex)
      mat.emissiveColor = mapColor.scale(0.1)
      mat.emissiveIntensity = 0.3
      
      // Polished clear coat
      mat.clearCoat.isEnabled = true
      mat.clearCoat.intensity = 0.7
      mat.clearCoat.roughness = 0.15
      
      // Anisotropy for brushed metal look along rail length
      if (this._qualityTier !== QualityTier.LOW) {
        mat.anisotropy.isEnabled = true
        mat.anisotropy.intensity = 0.6
        mat.anisotropy.direction.x = 1 // Horizontal streaks along rail
        mat.anisotropy.direction.y = 0
      }

      return mat
    })
  }

  /**
   * Update rail material with new map color
   */
  updateRailMaterialColor(mat: PBRMaterial, mapColorHex: string): void {
    const mapColor = color(mapColorHex)
    mat.emissiveColor = mapColor.scale(0.1)
  }
}
