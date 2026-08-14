/**
 * Playfield Materials - the transparent/glass playfield surface and its procedural grid textures
 */

import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { CabinetMaterials } from './material-cabinet'
import {
  PALETTE,
  SURFACES,
  INTENSITY,
  METALLIC,
  ROUGHNESS,
  CLEARCOAT,
  QualityTier,
  emissive,
} from '../game-elements/visual-language'

export class PlayfieldMaterials extends CabinetMaterials {
  // ============================================================================
  // PLAYFIELD MATERIALS
  // ============================================================================

  getPlayfieldMaterial(): PBRMaterial {
    return this.getCachedPBR('playfield', () => {
      const mat = new PBRMaterial('playfieldMat', this.scene)

      const textures = this.loadTextureSet('playfield')

      if (textures.albedo) {
        textures.albedo.uScale = 4
        textures.albedo.vScale = 8
        mat.albedoTexture = textures.albedo
      } else {
        const tex = this.createGridTexture()
        tex.uScale = 4
        tex.vScale = 8
        mat.albedoTexture = tex
      }

      if (textures.normal) {
        mat.bumpTexture = textures.normal
      } else if (this._qualityTier !== QualityTier.LOW) {
        // Generate normal from grid pattern for raised line effect
        const gridNormal = this.createGridNormalTexture()
        gridNormal.uScale = 4
        gridNormal.vScale = 8
        mat.bumpTexture = gridNormal
        mat.bumpTexture.level = 0.3
      }

      if (textures.emissive) {
        mat.emissiveTexture = textures.emissive
        mat.emissiveColor = Color3.White()
      } else {
        mat.emissiveColor = emissive(PALETTE.PURPLE, INTENSITY.NORMAL)
      }
      // Apply ORM (packed) or separate textures for AO/Roughness/Metallic
      this.applyORMTextures(mat, textures, 4, 8)

      // Roughness variation texture for glossy grid lines vs matte base (procedural fallback)
      if (this._qualityTier === QualityTier.HIGH && !textures.orm && !textures.roughness) {
        const roughnessTex = this.createGridRoughnessTexture()
        roughnessTex.uScale = 4
        roughnessTex.vScale = 8
        mat.metallicTexture = roughnessTex
        mat.useMetallnessFromMetallicTextureBlue = false
        mat.useRoughnessFromMetallicTextureGreen = true
        mat.useRoughnessFromMetallicTextureAlpha = false
      }

      mat.albedoColor = new Color3(0.8, 0.8, 0.9)
      mat.metallic = METALLIC.MID
      mat.roughness = ROUGHNESS.SMOOTH
      mat.alpha = 0.92
      mat.environmentIntensity = 0.5

      // Playfield-specific clear coat
      this.applyClearCoat(mat, CLEARCOAT.PLAYFIELD)

      return mat
    })
  }

  /**
   * Generate a normal map from the grid pattern.
   * Creates beveled edge effect so grid lines appear physically raised.
   */
  private createGridNormalTexture(): DynamicTexture {
    const cacheKey = '_grid_normal_'
    if (this.textureCache.has(cacheKey)) {
      return this.textureCache.get(cacheKey) as DynamicTexture
    }

    const size = this.textureSize
    const tex = new DynamicTexture('gridNormal', size, this.scene, true)
    const ctx = tex.getContext()

    // Fill with flat normal (128, 128, 255) = pointing straight up
    ctx.fillStyle = 'rgb(128, 128, 255)'
    ctx.fillRect(0, 0, size, size)

    const step = size / 8
    const bevelWidth = 3

    // For each grid line, draw beveled edges as normal perturbation
    for (let i = 0; i <= size; i += step) {
      // Vertical line - left bevel (normal tilts left)
      ctx.fillStyle = 'rgb(100, 128, 255)'
      ctx.fillRect(i - bevelWidth, 0, bevelWidth, size)
      // Vertical line - right bevel (normal tilts right)
      ctx.fillStyle = 'rgb(156, 128, 255)'
      ctx.fillRect(i, 0, bevelWidth, size)

      // Horizontal line - top bevel (normal tilts up)
      ctx.fillStyle = 'rgb(128, 100, 255)'
      ctx.fillRect(0, i - bevelWidth, size, bevelWidth)
      // Horizontal line - bottom bevel (normal tilts down)
      ctx.fillStyle = 'rgb(128, 156, 255)'
      ctx.fillRect(0, i, size, bevelWidth)
    }

    tex.update()
    this.textureCache.set(cacheKey, tex)
    return tex
  }

  /**
   * Generate a roughness variation texture for the playfield grid.
   * Grid lines are smoother (glossy), base surface is more matte.
   */
  private createGridRoughnessTexture(): DynamicTexture {
    const cacheKey = '_grid_roughness_'
    if (this.textureCache.has(cacheKey)) {
      return this.textureCache.get(cacheKey) as DynamicTexture
    }

    const size = Math.min(512, this.textureSize)
    const tex = new DynamicTexture('gridRoughness', size, this.scene, true)
    const ctx = tex.getContext()

    // Base roughness (matte) - stored in green channel for metallic texture workflow
    const baseRoughness = Math.round(ROUGHNESS.SATIN * 255)
    ctx.fillStyle = `rgb(0, ${baseRoughness}, 0)`
    ctx.fillRect(0, 0, size, size)

    // Smooth grid lines (lower roughness = glossier)
    const smoothVal = Math.round(ROUGHNESS.POLISHED * 255)
    ctx.strokeStyle = `rgb(0, ${smoothVal}, 0)`
    ctx.lineWidth = 4

    const step = size / 8
    for (let i = 0; i <= size; i += step) {
      ctx.beginPath()
      ctx.moveTo(i, 0)
      ctx.lineTo(i, size)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(0, i)
      ctx.lineTo(size, i)
      ctx.stroke()
    }

    tex.update()
    this.textureCache.set(cacheKey, tex)
    return tex
  }

  private createGridTexture(): DynamicTexture {
    const cacheKey = '_grid_texture_'
    if (this.textureCache.has(cacheKey)) {
      return this.textureCache.get(cacheKey) as DynamicTexture
    }

    const size = this.textureSize
    const dynamicTexture = new DynamicTexture('gridTexture', size, this.scene, true)
    dynamicTexture.hasAlpha = true
    const ctx = dynamicTexture.getContext()

    // Dark background with subtle gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, size)
    gradient.addColorStop(0, SURFACES.PLAYFIELD)
    gradient.addColorStop(0.5, SURFACES.PLAYFIELD_DEEP)
    gradient.addColorStop(1, SURFACES.PLAYFIELD)
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, size, size)

    // Main grid lines - unified purple
    ctx.lineWidth = 2
    ctx.strokeStyle = PALETTE.PURPLE
    ctx.shadowBlur = 15
    ctx.shadowColor = PALETTE.PURPLE

    const step = size / 8
    for (let i = 0; i <= size; i += step) {
      ctx.beginPath()
      ctx.moveTo(i, 0)
      ctx.lineTo(i, size)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(0, i)
      ctx.lineTo(size, i)
      ctx.stroke()
    }

    // Secondary finer grid
    ctx.lineWidth = 0.5
    ctx.strokeStyle = '#4400aa'
    ctx.shadowBlur = 0
    const fineStep = step / 4
    for (let i = 0; i <= size; i += fineStep) {
      if (i % step === 0) continue
      ctx.beginPath()
      ctx.moveTo(i, 0)
      ctx.lineTo(i, size)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(0, i)
      ctx.lineTo(size, i)
      ctx.stroke()
    }

    // Border highlight - cyan accent
    ctx.lineWidth = 4
    ctx.strokeStyle = PALETTE.CYAN
    ctx.shadowBlur = 20
    ctx.shadowColor = PALETTE.CYAN
    ctx.strokeRect(0, 0, size, size)

    dynamicTexture.update()
    this.textureCache.set(cacheKey, dynamicTexture)
    return dynamicTexture
  }
}
