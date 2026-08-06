/**
 * Cabinet Materials - cabinet body, side panels, wood trim, and metal trim surfaces
 */

import { PBRMaterial, StandardMaterial, Color3, DynamicTexture } from '@babylonjs/core'
import { ORMTexturePacking } from './material-orm'
import {
  PALETTE,
  SURFACES,
  INTENSITY,
  METALLIC,
  ROUGHNESS,
  QualityTier,
  color,
  emissive,
} from '../game-elements/visual-language'

export class CabinetMaterials extends ORMTexturePacking {
  // ============================================================================
  // CABINET SURFACES
  // ============================================================================

  getCabinetMaterial(): StandardMaterial | PBRMaterial {
    // On HIGH tier, upgrade cabinet to PBR for better integration
    if (this._qualityTier === QualityTier.HIGH) {
      return this.getCachedPBR('cabinet_pbr', () => {
        const mat = new PBRMaterial('cabinetMat', this.scene)
        mat.albedoColor = color(SURFACES.DARK)
        mat.metallic = METALLIC.LOW
        mat.roughness = ROUGHNESS.MATTE
        mat.environmentIntensity = 0.15
        return mat
      })
    }
    return this.getCachedStandard('cabinet', () => {
      const mat = new StandardMaterial('cabinetMat', this.scene)
      mat.diffuseColor = color(SURFACES.DARK)
      mat.specularColor = new Color3(0.1, 0.1, 0.1)
      return mat
    })
  }

  getSidePanelMaterial(): StandardMaterial {
    return this.getCachedStandard('sidePanel', () => {
      const mat = new StandardMaterial('sidePanelMat', this.scene)
      mat.diffuseColor = color(SURFACES.VOID)
      mat.emissiveColor = emissive(PALETTE.AMBIENT, INTENSITY.AMBIENT)
      mat.alpha = 0.9
      return mat
    })
  }

  getBlackPlasticMaterial(): PBRMaterial {
    return this.getCachedPBR('blackPlastic', () => {
      const mat = new PBRMaterial('blackPlasticMat', this.scene)
      mat.albedoColor = color(SURFACES.DARK)
      mat.metallic = METALLIC.LOW
      mat.roughness = ROUGHNESS.MATTE
      mat.environmentIntensity = 0.2
      return mat
    })
  }

  // ============================================================================
  // CABINET WOOD & METAL TRIM
  // ============================================================================

  getCabinetWoodMaterial(): PBRMaterial {
    return this.getCachedPBR('cabinetWood', () => {
      const mat = new PBRMaterial('cabinetWoodMat', this.scene)
      // Dark arcade cabinet wood
      mat.albedoColor = new Color3(0.08, 0.06, 0.05)
      mat.metallic = METALLIC.LOW
      mat.roughness = ROUGHNESS.MATTE
      mat.environmentIntensity = 0.3

      // Procedural wood grain normal on HIGH tier
      if (this._qualityTier === QualityTier.HIGH) {
        const woodNormal = this.createWoodGrainNormalTexture()
        mat.bumpTexture = woodNormal
        mat.bumpTexture.level = 0.15
      }

      // Slight clear coat for aged lacquer finish
      this.applyClearCoat(mat, { enabled: true, intensity: 0.15, roughness: 0.25 })
      return mat
    })
  }

  getCabinetMetalTrimMaterial(): PBRMaterial {
    return this.getCachedPBR('cabinetMetalTrim', () => {
      const mat = new PBRMaterial('cabinetMetalTrimMat', this.scene)
      mat.albedoColor = color(SURFACES.METAL_DARK)
      mat.metallic = METALLIC.HIGH
      mat.roughness = ROUGHNESS.SATIN
      mat.environmentIntensity = 0.7

      // Brushed vertical streaks
      if (this._qualityTier !== QualityTier.LOW) {
        mat.anisotropy.isEnabled = true
        mat.anisotropy.intensity = 0.5
        mat.anisotropy.direction.x = 0
        mat.anisotropy.direction.y = 1
      }

      // Micro-scratches for wear authenticity
      if (this._qualityTier === QualityTier.HIGH) {
        const noise = this.createMicroRoughnessTexture()
        mat.metallicTexture = noise
        mat.useRoughnessFromMetallicTextureGreen = true
      }

      return mat
    })
  }

  getCabinetInteriorMaterial(): PBRMaterial {
    return this.getCachedPBR('cabinetInterior', () => {
      const mat = new PBRMaterial('cabinetInteriorMat', this.scene)
      // Dark felt/plastic interior to absorb light
      mat.albedoColor = color(SURFACES.VOID)
      mat.metallic = METALLIC.LOW
      mat.roughness = ROUGHNESS.ROUGH
      mat.environmentIntensity = 0.1
      return mat
    })
  }

  /**
   * Create a procedural wood grain normal map for cabinet surfaces.
   * Subtle vertical grain with occasional knots for realism.
   */
  private createWoodGrainNormalTexture(): DynamicTexture {
    const cacheKey = '_wood_grain_normal_'
    if (this.textureCache.has(cacheKey)) {
      return this.textureCache.get(cacheKey) as DynamicTexture
    }

    const size = 512
    const tex = new DynamicTexture('woodGrainNormal', size, this.scene, true)
    const ctx = tex.getContext()

    // Base flat normal
    ctx.fillStyle = 'rgb(128, 128, 255)'
    ctx.fillRect(0, 0, size, size)

    // Draw vertical grain lines with normal perturbation
    for (let i = 0; i < 40; i++) {
      const x = Math.random() * size
      const width = 1 + Math.random() * 3
      const tilt = Math.random() > 0.5 ? 110 : 146
      ctx.fillStyle = `rgb(${tilt}, 128, 255)`
      ctx.fillRect(x, 0, width, size)
    }

    // Occasional "knots" (darker normal perturbation)
    for (let i = 0; i < 4; i++) {
      const cx = Math.random() * size
      const cy = Math.random() * size
      const r = 5 + Math.random() * 10
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
      grad.addColorStop(0, 'rgb(100, 128, 255)')
      grad.addColorStop(1, 'rgba(128, 128, 255, 0)')
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.fill()
    }

    tex.update()
    this.textureCache.set(cacheKey, tex)
    return tex
  }
}
