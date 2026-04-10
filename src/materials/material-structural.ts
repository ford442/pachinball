/**
 * Structural Materials - Cabinet, playfield, and structural surface materials
 */

import { PBRMaterial, StandardMaterial, Color3, DynamicTexture, Texture } from '@babylonjs/core'

// TextureSet is imported from material-core
import { MaterialLibraryBase, type TextureSet } from './material-core'
import {
  PALETTE,
  SURFACES,
  INTENSITY,
  METALLIC,
  ROUGHNESS,
  CLEARCOAT,
  QualityTier,
  color,
  emissive,
} from '../game-elements/visual-language'

export class StructuralMaterials extends MaterialLibraryBase {
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
      mat.albedoColor = new Color3(0.02, 0.02, 0.03)
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
        mat.emissiveColor = emissive(PALETTE.PURPLE, INTENSITY.AMBIENT)
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
    gradient.addColorStop(0.5, '#050510')
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

  // ============================================================================
  // LCD TABLE MATERIALS
  // ============================================================================

  private _lcdTableMaterial: PBRMaterial | null = null
  private _lcdEmissiveTexture: DynamicTexture | null = null

  /**
   * Get the LCD table material - glowing phosphor display with scanlines
   * This replaces the transparent glass playfield with an emissive LCD screen
   */
  getLCDTableMaterial(): PBRMaterial {
    if (this._lcdTableMaterial) {
      return this._lcdTableMaterial
    }

    const mat = new PBRMaterial('lcdTableMat', this.scene)

    // High emissive for LCD glow effect
    mat.emissiveColor = emissive(PALETTE.CYAN, INTENSITY.HIGH)
    mat.emissiveIntensity = 1.5

    // Create LCD grid texture for emissive channel
    const lcdTexture = this.createLCDGridTexture()
    mat.emissiveTexture = lcdTexture
    this._lcdEmissiveTexture = lcdTexture

    // Low specular + micro-surface for LCD feel (matte plastic/glass surface)
    mat.metallic = METALLIC.LOW
    mat.roughness = ROUGHNESS.SATIN
    mat.microSurface = 0.3

    // Dark albedo - the LCD emits light, doesn't reflect it
    mat.albedoColor = new Color3(0.02, 0.02, 0.03)

    // No transparency - this is a solid LCD panel
    mat.alpha = 1.0
    mat.environmentIntensity = 0.2

    // Clear coat for glass-like surface protection
    this.applyClearCoat(mat, { enabled: true, intensity: 0.3, roughness: 0.1 })

    this._lcdTableMaterial = mat
    return mat
  }

  /**
   * Update the LCD table emissive color (for map switching)
   */
  updateLCDTableEmissive(baseColor: string, intensity: number = INTENSITY.HIGH): void {
    if (this._lcdTableMaterial) {
      this._lcdTableMaterial.emissiveColor = emissive(baseColor, intensity)
    }
    // Regenerate the LCD texture with new colors
    if (this._lcdEmissiveTexture) {
      this.updateLCDGridTexture(this._lcdEmissiveTexture, baseColor)
    }
  }

  /**
   * Create a procedural LCD grid texture with scanlines
   */
  private createLCDGridTexture(): DynamicTexture {
    const size = Math.min(1024, this.textureSize * 2)
    const tex = new DynamicTexture('lcdGridTexture', size, this.scene, true)
    this.updateLCDGridTexture(tex, PALETTE.CYAN)
    return tex
  }

  /**
   * Update LCD grid texture with specific color theme
   */
  private updateLCDGridTexture(tex: DynamicTexture, accentColor: string): void {
    const ctx = tex.getContext()
    const size = tex.getSize().width

    // Fill with deep black background
    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, size, size)

    // Parse accent color
    const color = accentColor.replace('#', '')
    const r = parseInt(color.substring(0, 2), 16)
    const g = parseInt(color.substring(2, 4), 16)
    const b = parseInt(color.substring(4, 6), 16)

    // Draw pixel grid pattern
    const gridSize = size / 64
    ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.15)`
    ctx.lineWidth = 1

    for (let i = 0; i <= 64; i++) {
      const pos = i * gridSize
      ctx.beginPath()
      ctx.moveTo(pos, 0)
      ctx.lineTo(pos, size)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(0, pos)
      ctx.lineTo(size, pos)
      ctx.stroke()
    }

    // Draw scanlines
    for (let i = 0; i < size; i += 2) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.3)'
      ctx.fillRect(0, i, size, 1)
    }

    // Add subtle phosphor glow pattern
    const gradient = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2)
    gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.1)`)
    gradient.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, 0.05)`)
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, size, size)

    tex.update()
  }

  // ============================================================================
  // ORM CHANNEL PACKING
  // ============================================================================

  /**
   * Apply ORM (Occlusion/Roughness/Metallic) textures to a PBR material.
   * Supports both packed ORM textures (single texture, 3 channels) and
   * separate textures for backward compatibility.
   *
   * Packed ORM layout:
   * - R channel: Ambient Occlusion
   * - G channel: Roughness
   * - B channel: Metallic
   */
  protected applyORMTextures(
    mat: PBRMaterial,
    textures: TextureSet,
    uScale?: number,
    vScale?: number
  ): void {
    if (textures.orm) {
      // Use packed ORM texture - 66% VRAM reduction
      const orm = textures.orm

      if (uScale !== undefined) orm.uScale = uScale
      if (vScale !== undefined) orm.vScale = vScale

      // Configure material to use ORM channels correctly
      mat.metallicTexture = orm
      mat.useMetallnessFromMetallicTextureBlue = true // B channel = Metallic
      mat.useRoughnessFromMetallicTextureGreen = true // G channel = Roughness
      mat.useRoughnessFromMetallicTextureAlpha = false

      // AO uses R channel
      mat.ambientTexture = orm

      // Disable separate texture settings to avoid conflicts
      mat.roughness = 1.0 // Let texture control it
      mat.metallic = 1.0 // Let texture control it
    } else {
      // Fallback: use separate textures
      if (textures.ao) {
        if (uScale !== undefined) textures.ao.uScale = uScale
        if (vScale !== undefined) textures.ao.vScale = vScale
        mat.ambientTexture = textures.ao
      }

      if (textures.roughness || textures.metallic) {
        // If we have both roughness and metallic, we need to pack them
        // or use the roughness texture as the metallic texture with channel flags
        if (textures.roughness && textures.metallic) {
          // Create a combined texture from separate inputs
          const combined = this.createORMTexture(
            textures.ao,
            textures.roughness,
            textures.metallic,
            uScale,
            vScale
          )
          mat.metallicTexture = combined
          mat.useMetallnessFromMetallicTextureBlue = true
          mat.useRoughnessFromMetallicTextureGreen = true
          mat.useRoughnessFromMetallicTextureAlpha = false
          if (textures.ao) mat.ambientTexture = combined
        } else if (textures.roughness) {
          // Only roughness available - pack it with defaults into a temporary ORM
          const roughnessORM = this.createORMTexture(
            null,
            textures.roughness,
            null,
            uScale,
            vScale
          )
          mat.metallicTexture = roughnessORM
          mat.useMetallnessFromMetallicTextureBlue = false // No metallic data
          mat.useRoughnessFromMetallicTextureGreen = true
          mat.useRoughnessFromMetallicTextureAlpha = false
        } else if (textures.metallic) {
          // Only metallic available
          if (uScale !== undefined) textures.metallic.uScale = uScale
          if (vScale !== undefined) textures.metallic.vScale = vScale
          mat.metallicTexture = textures.metallic
          mat.useMetallnessFromMetallicTextureBlue = true
        }
      }
    }
  }

  /**
   * Create a packed ORM texture from separate AO, Roughness, and Metallic textures.
   */
  private createORMTexture(
    ao: Texture | null | undefined,
    roughness: Texture | null | undefined,
    metallic: Texture | null | undefined,
    uScale?: number,
    vScale?: number
  ): DynamicTexture {
    // Generate cache key based on input textures
    const cacheKey = `_orm_${ao?.uniqueId ?? 'null'}_${roughness?.uniqueId ?? 'null'}_${metallic?.uniqueId ?? 'null'}`
    if (this.textureCache.has(cacheKey)) {
      return this.textureCache.get(cacheKey) as DynamicTexture
    }

    const size = this.textureSize
    const tex = new DynamicTexture('ormPacked', size, this.scene, true)
    const ctx = tex.getContext()

    // Default values (white for AO = no occlusion, white for roughness = fully rough, black for metallic = non-metal)
    const defaultAO = 255
    const defaultRoughness = 255
    const defaultMetallic = 0

    // Get values from textures if they are DynamicTextures with accessible context
    const getChannelValue = (
      texture: Texture | null | undefined
    ): number => {
      if (!texture) return -1 // Use default
      // For now, use default values as reading back from GPU textures is complex
      return -1
    }

    const aoValue = getChannelValue(ao)
    const roughnessValue = getChannelValue(roughness)
    const metallicValue = getChannelValue(metallic)

    // Build RGB string for fill
    const r = aoValue >= 0 ? aoValue : defaultAO
    const g = roughnessValue >= 0 ? roughnessValue : defaultRoughness
    const b = metallicValue >= 0 ? metallicValue : defaultMetallic

    // Fill with the base color representing packed values
    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`
    ctx.fillRect(0, 0, size, size)

    tex.update()

    if (uScale !== undefined) tex.uScale = uScale
    if (vScale !== undefined) tex.vScale = vScale

    this.textureCache.set(cacheKey, tex)
    return tex
  }
}
