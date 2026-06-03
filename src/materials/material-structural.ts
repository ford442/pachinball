/**
 * Structural Materials - Cabinet, playfield, and structural surface materials
 */

import { PBRMaterial, StandardMaterial, Color3, DynamicTexture, Texture } from '@babylonjs/core'
import type { TableMapConfig } from '../shaders/lcd-table'

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
  private static readonly LCD_TEXTURE_SIZE = 1024

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

  // ============================================================================
  // LCD TABLE MATERIALS
  // ============================================================================

  private _lcdTableMaterial: PBRMaterial | null = null
  private _lcdEmissiveTexture: DynamicTexture | null = null
  private _lcdCurrentConfig: TableMapConfig | null = null
  private _lcdLastDrawMs = -1
  private _lcdImageCache = new Map<string, HTMLImageElement>()
  private _lcdVideoCache = new Map<string, HTMLVideoElement>()

  private static getLCDContextType(): ReturnType<DynamicTexture['getContext']> | null {
    return null
  }

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
    this._lcdCurrentConfig = {
      name: 'Neon Helix',
      baseColor: PALETTE.CYAN,
      accentColor: PALETTE.MAGENTA,
      scanlineIntensity: 0.2,
      pixelGridIntensity: 0.6,
      subpixelIntensity: 0.35,
      glowIntensity: 1.3,
      backgroundPattern: 'hex',
      animationSpeed: 0.5,
    }

    // Low specular + micro-surface for LCD feel (matte plastic/glass surface)
    mat.metallic = METALLIC.LOW
    mat.roughness = ROUGHNESS.SATIN
    mat.microSurface = 0.3

    // Dark albedo - the LCD emits light, doesn't reflect it
    mat.albedoColor = color(SURFACES.VOID)

    // No transparency - this is a solid LCD panel
    mat.alpha = 1.0
    mat.environmentIntensity = 0.2

    // Clear coat for glass-like surface protection
    this.applyClearCoat(mat, { enabled: true, intensity: 0.85, roughness: 0.11 })

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
    if (this._lcdCurrentConfig) {
      this._lcdCurrentConfig = {
        ...this._lcdCurrentConfig,
        baseColor,
        glowIntensity: intensity,
      }
    }
    if (this._lcdEmissiveTexture && this._lcdCurrentConfig) {
      this.updateLCDTableVisual(this._lcdCurrentConfig, {
        timeSeconds: performance.now() * 0.001,
        flashIntensity: 0,
        rippleIntensity: 0,
        rippleTime: 0,
        reducedMotion: false,
        photosensitiveMode: false,
        forceRedraw: true,
      })
    }
  }

  updateLCDTableVisual(
    config: TableMapConfig,
    runtime: {
      timeSeconds: number
      flashIntensity: number
      rippleIntensity: number
      rippleTime: number
      reducedMotion: boolean
      photosensitiveMode: boolean
      forceRedraw?: boolean
    }
  ): void {
    if (!this._lcdTableMaterial || !this._lcdEmissiveTexture) {
      return
    }

    this._lcdCurrentConfig = { ...config }
    this._lcdTableMaterial.emissiveColor = emissive(config.baseColor, config.glowIntensity)

    const drawStamp = Math.floor(runtime.timeSeconds * (runtime.reducedMotion ? 8 : 24))
    const requiresAnimation = !runtime.reducedMotion
      || runtime.flashIntensity > 0
      || runtime.rippleIntensity > 0
      || !!config.playfieldImage
      || !!config.playfieldVideo
    if (!runtime.forceRedraw && !requiresAnimation && drawStamp === this._lcdLastDrawMs) {
      return
    }
    this._lcdLastDrawMs = drawStamp

    const tex = this._lcdEmissiveTexture
    const ctx = tex.getContext()
    const size = tex.getSize().width
    const baseRgb = this.hexToRgb(config.baseColor)
    const accentRgb = this.hexToRgb(config.accentColor)
    const animatedTime = runtime.reducedMotion ? 0 : runtime.timeSeconds * config.animationSpeed

    ctx.clearRect(0, 0, size, size)
    this.drawLCDBackdrop(ctx, size, baseRgb, accentRgb)
    this.drawLCDMediaLayer(ctx, size, config)
    this.drawMapPattern(ctx, size, config.backgroundPattern, baseRgb, accentRgb, animatedTime)
    this.drawLCDSubpixels(ctx, size, baseRgb, config.subpixelIntensity)
    this.drawLCDGrid(ctx, size, baseRgb, accentRgb, config.pixelGridIntensity)
    this.drawLCDScanlines(ctx, size, config.scanlineIntensity, runtime.photosensitiveMode)
    this.drawLCDGlow(ctx, size, baseRgb, config.glowIntensity)
    if (!runtime.photosensitiveMode) {
      this.drawRipple(ctx, size, baseRgb, runtime.rippleIntensity, runtime.rippleTime)
      this.drawFlash(ctx, size, runtime.flashIntensity)
    }
    this.drawFrame(ctx, size, accentRgb)

    tex.update()
  }

  updatePlayfieldTheme(surfaceTint: string, emissiveTint: string): void {
    const mat = this.materialCache.get('playfield') as PBRMaterial | undefined
    if (!mat) return
    mat.albedoColor = color(surfaceTint).scale(0.9)
    mat.emissiveColor = emissive(emissiveTint, INTENSITY.NORMAL)
  }

  /**
   * Create a procedural LCD grid texture with scanlines
   */
  private createLCDGridTexture(): DynamicTexture {
    const size = Math.min(StructuralMaterials.LCD_TEXTURE_SIZE, this.textureSize * 2)
    const tex = new DynamicTexture('lcdGridTexture', size, this.scene, true)
    this.updateLCDGridTexture(tex, PALETTE.CYAN)
    return tex
  }

  /**
   * Update LCD grid texture with specific color theme
   */
  private updateLCDGridTexture(tex: DynamicTexture, accentColor: string): void {
    const config = this._lcdCurrentConfig ?? {
      name: 'Fallback',
      baseColor: accentColor,
      accentColor,
      scanlineIntensity: 0.2,
      pixelGridIntensity: 0.6,
      subpixelIntensity: 0.35,
      glowIntensity: 1.1,
      backgroundPattern: 'grid',
      animationSpeed: 0,
    }
    this._lcdCurrentConfig = config
    this.updateLCDTableVisual(config, {
      timeSeconds: 0,
      flashIntensity: 0,
      rippleIntensity: 0,
      rippleTime: 0,
      reducedMotion: true,
      photosensitiveMode: false,
      forceRedraw: true,
    })
    tex.update()
  }

  private drawLCDBackdrop(
    ctx: NonNullable<ReturnType<typeof StructuralMaterials.getLCDContextType>>,
    size: number,
    baseRgb: { r: number; g: number; b: number },
    accentRgb: { r: number; g: number; b: number }
  ): void {
    const gradient = ctx.createLinearGradient(0, 0, size, size)
    gradient.addColorStop(0, 'rgb(1, 3, 8)')
    gradient.addColorStop(0.55, `rgb(${Math.round(baseRgb.r * 0.08)}, ${Math.round(baseRgb.g * 0.08)}, ${Math.round(baseRgb.b * 0.08)})`)
    gradient.addColorStop(1, `rgb(${Math.round(accentRgb.r * 0.05)}, ${Math.round(accentRgb.g * 0.05)}, ${Math.round(accentRgb.b * 0.05)})`)
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, size, size)
  }

  private drawLCDMediaLayer(
    ctx: NonNullable<ReturnType<typeof StructuralMaterials.getLCDContextType>>,
    size: number,
    config: TableMapConfig
  ): void {
    const media = this.getLCDMediaSource(config)
    if (!media) {
      return
    }

    try {
      ctx.save()
      ctx.globalAlpha = 0.35
      ctx.drawImage(media, 0, 0, size, size)
      ctx.restore()
    } catch {
      // Ignore media draw failures and keep the procedural fallback.
    }
  }

  private drawMapPattern(
    ctx: NonNullable<ReturnType<typeof StructuralMaterials.getLCDContextType>>,
    size: number,
    pattern: TableMapConfig['backgroundPattern'],
    baseRgb: { r: number; g: number; b: number },
    accentRgb: { r: number; g: number; b: number },
    time: number
  ): void {
    ctx.save()
    ;(ctx as unknown as CanvasRenderingContext2D).globalCompositeOperation = 'screen'

    if (pattern === 'hex') {
      const cell = size / 10
      ctx.strokeStyle = `rgba(${baseRgb.r}, ${baseRgb.g}, ${baseRgb.b}, 0.22)`
      ctx.lineWidth = 2
      for (let row = -1; row < 12; row++) {
        for (let col = -1; col < 12; col++) {
          const offset = row % 2 === 0 ? 0 : cell * 0.5
          const x = col * cell + offset + Math.sin(time + row * 0.3) * 4
          const y = row * (cell * 0.86)
          this.traceHex(ctx, x, y, cell * 0.46)
          ctx.stroke()
        }
      }
    } else if (pattern === 'grid') {
      const step = size / 12
      ctx.strokeStyle = `rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, 0.18)`
      ctx.lineWidth = 2
      for (let i = 0; i <= size; i += step) {
        const wobble = Math.sin(time + i * 0.02) * 10
        ctx.beginPath()
        ctx.moveTo(i + wobble, 0)
        ctx.lineTo(i - wobble, size)
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(0, i + wobble)
        ctx.lineTo(size, i - wobble)
        ctx.stroke()
      }
    } else if (pattern === 'circuit') {
      ctx.strokeStyle = `rgba(${baseRgb.r}, ${baseRgb.g}, ${baseRgb.b}, 0.22)`
      ctx.lineWidth = 3
      const lanes = 7
      for (let lane = 0; lane < lanes; lane++) {
        const y = ((lane + 1) / (lanes + 1)) * size
        ctx.beginPath()
        ctx.moveTo(0, y)
        for (let x = size / 8; x <= size; x += size / 8) {
          const bend = ((lane + Math.floor(x)) % 2 === 0 ? 1 : -1) * size * 0.03
          ctx.lineTo(x - size / 16, y)
          ctx.lineTo(x - size / 16, y + bend)
          ctx.lineTo(x, y + bend)
        }
        ctx.stroke()
      }
      ctx.fillStyle = `rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, 0.35)`
      for (let i = 0; i < 24; i++) {
        const x = (i % 6) * (size / 6) + size / 12
        const y = Math.floor(i / 6) * (size / 4) + size / 8
        ctx.beginPath()
        ctx.arc(x, y, 5 + (i % 3), 0, Math.PI * 2)
        ctx.fill()
      }
    } else if (pattern === 'data-flow') {
      const columns = 18
      ctx.fillStyle = `rgba(${baseRgb.r}, ${baseRgb.g}, ${baseRgb.b}, 0.3)`
      for (let column = 0; column < columns; column++) {
        const x = (column / columns) * size
        for (let j = 0; j < 14; j++) {
          const y = (j / 14) * size
          const pulse = (time * 140 + column * 21 + j * 31) % (size + 120)
          ctx.fillRect(x + Math.sin(j + time) * 2, (y + pulse) % size, 3, 24)
        }
      }
    }

    ctx.restore()
  }

  private drawLCDSubpixels(
    ctx: NonNullable<ReturnType<typeof StructuralMaterials.getLCDContextType>>,
    size: number,
    baseRgb: { r: number; g: number; b: number },
    intensity: number
  ): void {
    const alpha = 0.04 + intensity * 0.08
    ctx.save()
    ;(ctx as unknown as CanvasRenderingContext2D).globalCompositeOperation = 'screen'
    const stripeWidth = Math.max(1, Math.floor(size / 192))
    for (let x = 0; x < size; x += stripeWidth * 3) {
      ctx.fillStyle = `rgba(${baseRgb.r}, 40, 40, ${alpha})`
      ctx.fillRect(x, 0, stripeWidth, size)
      ctx.fillStyle = `rgba(40, ${baseRgb.g}, 40, ${alpha})`
      ctx.fillRect(x + stripeWidth, 0, stripeWidth, size)
      ctx.fillStyle = `rgba(40, 40, ${baseRgb.b}, ${alpha})`
      ctx.fillRect(x + stripeWidth * 2, 0, stripeWidth, size)
    }
    ctx.restore()
  }

  private drawLCDGrid(
    ctx: NonNullable<ReturnType<typeof StructuralMaterials.getLCDContextType>>,
    size: number,
    baseRgb: { r: number; g: number; b: number },
    accentRgb: { r: number; g: number; b: number },
    intensity: number
  ): void {
    const majorStep = size / 16
    const minorStep = majorStep / 4
    ctx.save()
    ctx.strokeStyle = `rgba(${baseRgb.r}, ${baseRgb.g}, ${baseRgb.b}, ${0.12 + intensity * 0.12})`
    ctx.lineWidth = 1.25
    for (let i = 0; i <= size; i += majorStep) {
      ctx.beginPath()
      ctx.moveTo(i, 0)
      ctx.lineTo(i, size)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(0, i)
      ctx.lineTo(size, i)
      ctx.stroke()
    }

    ctx.strokeStyle = `rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, ${0.03 + intensity * 0.05})`
    ctx.lineWidth = 0.5
    for (let i = 0; i <= size; i += minorStep) {
      ctx.beginPath()
      ctx.moveTo(i, 0)
      ctx.lineTo(i, size)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(0, i)
      ctx.lineTo(size, i)
      ctx.stroke()
    }
    ctx.restore()
  }

  private drawLCDScanlines(
    ctx: NonNullable<ReturnType<typeof StructuralMaterials.getLCDContextType>>,
    size: number,
    intensity: number,
    photosensitiveMode: boolean
  ): void {
    const effectiveIntensity = photosensitiveMode ? intensity * 0.35 : intensity
    ctx.save()
    ctx.fillStyle = `rgba(0, 0, 0, ${0.08 + effectiveIntensity * 0.2})`
    for (let y = 0; y < size; y += 4) {
      ctx.fillRect(0, y, size, 2)
    }
    ctx.restore()
  }

  private drawLCDGlow(
    ctx: NonNullable<ReturnType<typeof StructuralMaterials.getLCDContextType>>,
    size: number,
    baseRgb: { r: number; g: number; b: number },
    intensity: number
  ): void {
    const glow = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size * 0.7)
    glow.addColorStop(0, `rgba(${baseRgb.r}, ${baseRgb.g}, ${baseRgb.b}, ${0.1 + intensity * 0.08})`)
    glow.addColorStop(0.55, `rgba(${baseRgb.r}, ${baseRgb.g}, ${baseRgb.b}, 0.03)`)
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)')
    ctx.fillStyle = glow
    ctx.fillRect(0, 0, size, size)
  }

  private drawRipple(
    ctx: NonNullable<ReturnType<typeof StructuralMaterials.getLCDContextType>>,
    size: number,
    baseRgb: { r: number; g: number; b: number },
    intensity: number,
    rippleTime: number
  ): void {
    if (intensity <= 0) {
      return
    }
    ctx.save()
    ctx.strokeStyle = `rgba(${baseRgb.r}, ${baseRgb.g}, ${baseRgb.b}, ${intensity * 0.35})`
    ctx.lineWidth = 6
    const radius = size * (0.08 + (rippleTime % 0.7) * 0.8)
    ctx.beginPath()
    ctx.arc(size / 2, size / 2, radius, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }

  private drawFlash(
    ctx: NonNullable<ReturnType<typeof StructuralMaterials.getLCDContextType>>,
    size: number,
    intensity: number
  ): void {
    if (intensity <= 0) {
      return
    }
    ctx.save()
    ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(0.35, intensity * 0.3)})`
    ctx.fillRect(0, 0, size, size)
    ctx.restore()
  }

  private drawFrame(
    ctx: NonNullable<ReturnType<typeof StructuralMaterials.getLCDContextType>>,
    size: number,
    accentRgb: { r: number; g: number; b: number }
  ): void {
    ctx.save()
    ctx.strokeStyle = `rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, 0.45)`
    ctx.lineWidth = 8
    ctx.strokeRect(4, 4, size - 8, size - 8)
    ctx.restore()
  }

  private traceHex(
    ctx: NonNullable<ReturnType<typeof StructuralMaterials.getLCDContextType>>,
    cx: number,
    cy: number,
    radius: number
  ): void {
    ctx.beginPath()
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i
      const x = cx + Math.cos(angle) * radius
      const y = cy + Math.sin(angle) * radius
      if (i === 0) {
        ctx.moveTo(x, y)
      } else {
        ctx.lineTo(x, y)
      }
    }
    ctx.closePath()
  }

  private getLCDMediaSource(config: TableMapConfig): CanvasImageSource | null {
    if (config.playfieldVideo) {
      const video = this.getOrCreateVideo(config.playfieldVideo)
      if (video.readyState >= 2) {
        return video
      }
    }
    if (config.playfieldImage) {
      const image = this.getOrCreateImage(config.playfieldImage)
      if (image.complete) {
        return image
      }
    }
    return null
  }

  private getOrCreateImage(src: string): HTMLImageElement {
    const cached = this._lcdImageCache.get(src)
    if (cached) {
      return cached
    }
    const image = new Image()
    image.src = src
    this._lcdImageCache.set(src, image)
    return image
  }

  private getOrCreateVideo(src: string): HTMLVideoElement {
    const cached = this._lcdVideoCache.get(src)
    if (cached) {
      return cached
    }
    const video = document.createElement('video')
    video.src = src
    video.loop = true
    video.muted = true
    video.playsInline = true
    void video.play().catch(() => {})
    this._lcdVideoCache.set(src, video)
    return video
  }

  private hexToRgb(hex: string): { r: number; g: number; b: number } {
    const clean = hex.replace('#', '')
    return {
      r: parseInt(clean.substring(0, 2), 16) || 0,
      g: parseInt(clean.substring(2, 4), 16) || 0,
      b: parseInt(clean.substring(4, 6), 16) || 0,
    }
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
