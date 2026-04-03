/**
 * Material Library - Unified PBR Material System
 *
 * Provides categorized materials using the Visual Language System
 * for consistent cyber/neon aesthetic across all game objects.
 *
 * Enhanced with:
 * - Quality tier system (LOW/MEDIUM/HIGH) for hardware adaptation
 * - Sheen on interactive plastic elements
 * - Anisotropy for brushed metal surfaces
 * - Per-material environment intensity for visual hierarchy
 * - Procedural normal and roughness maps for surface detail
 * - Iridescence for energy/hologram materials
 * - Micro-roughness noise for metal imperfections
 */

import {
  Scene,
  StandardMaterial,
  PBRMaterial,
  Texture,
  DynamicTexture,
  CubeTexture,
  BaseTexture,
  Color3,
} from '@babylonjs/core'
// Import KTX2 loader to register the format (side-effect)
import '@babylonjs/core/Materials/Textures/Loaders/ktxTextureLoader'
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine'
import {
  PALETTE,
  SURFACES,
  INTENSITY,
  ROUGHNESS,
  METALLIC,
  CLEARCOAT,
  CATEGORIES,
  QualityTier,
  TIER_ENV_INTENSITY,
  TIER_TEXTURE_SIZE,
  color,
  emissive,
  stateEmissive,
} from './visual-language'

export interface TextureSet {
  albedo?: Texture | null
  normal?: Texture | null
  /** Packed ORM texture: R=AO, G=Roughness, B=Metallic */
  orm?: Texture | null
  emissive?: Texture | null
  // Legacy fallbacks - used when ORM is not available
  roughness?: Texture | null
  metallic?: Texture | null
  ao?: Texture | null
}

/**
 * Compression format configuration for KTX2 textures.
 * Different texture types use different Basis Universal formats for optimal quality/size.
 */
const COMPRESSION_FORMATS = {
  /** BC7: High quality RGBA, best for albedo/diffuse textures */
  albedo: 'BC7',
  /** BC5: 2-channel perfect for normals (X,Y derived, Z reconstructed) */
  normal: 'BC5',
  /** BC7: High quality for packed ORM (AO/Roughness/Metallic) */
  orm: 'BC7',
  /** BC1: Acceptable quality for emissive, smallest size */
  emissive: 'BC1'
} as const

/** Texture format type for KTX2 compression selection */
type TextureFormat = keyof typeof COMPRESSION_FORMATS

export interface MaterialLibraryStats {
  materials: number
  textures: number
  estimatedBytes: number
  estimatedMB: number
  textureBreakdown: Array<{
    name: string
    width: number
    height: number
    estimatedBytes: number
  }>
}

/**
 * Detect hardware quality tier from engine capabilities.
 */
export function detectQualityTier(engine: AbstractEngine): QualityTier {
  try {
    const caps = engine.getCaps()
    if (!caps.textureFloat) return QualityTier.LOW
    if (!caps.textureLOD) return QualityTier.MEDIUM
    return QualityTier.HIGH
  } catch {
    return QualityTier.MEDIUM
  }
}

export class MaterialLibrary {
  private scene: Scene
  private textureCache: Map<string, BaseTexture> = new Map()
  private materialCache: Map<string, StandardMaterial | PBRMaterial> = new Map()

  private textureBasePath = './textures'
  private _qualityTier: QualityTier = QualityTier.HIGH

  constructor(scene: Scene) {
    this.scene = scene
  }

  /** Set the hardware quality tier (affects material complexity) */
  set qualityTier(tier: QualityTier) {
    this._qualityTier = tier
  }

  get qualityTier(): QualityTier {
    return this._qualityTier
  }

  /** Get the texture resolution for the current quality tier */
  private get textureSize(): number {
    return TIER_TEXTURE_SIZE[this._qualityTier]
  }

  loadEnvironmentTexture(): void {
    const envPath = `${this.textureBasePath}/environment.env`

    // Check cache first
    if (this.textureCache.has(envPath)) {
      this.scene.environmentTexture = this.textureCache.get(envPath) as CubeTexture
      this.scene.environmentIntensity = TIER_ENV_INTENSITY[this._qualityTier]
      return
    }

    try {
      const envTexture = CubeTexture.CreateFromPrefilteredData(envPath, this.scene)

      // Cache for reuse
      this.textureCache.set(envPath, envTexture)

      this.scene.environmentTexture = envTexture
      this.scene.environmentIntensity = TIER_ENV_INTENSITY[this._qualityTier]

      console.log('[MaterialLibrary] Environment texture loaded and cached')
    } catch (err) {
      console.warn('[MaterialLibrary] Failed to load environment texture:', err)
      this.scene.environmentIntensity = Math.min(0.4, TIER_ENV_INTENSITY[this._qualityTier])
    }
  }

  getEnvironmentTexture(): CubeTexture | null {
    const envPath = `${this.textureBasePath}/environment.env`
    return this.textureCache.get(envPath) as CubeTexture || null
  }

  // ============================================================================
  // CATEGORY 1: STRUCTURAL SURFACES
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
  // CATEGORY 1B: CABINET SURFACES (Full 3D Cabinet)
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

  // ============================================================================
  // CATEGORY 2: METALLIC SURFACES
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

  // ============================================================================
  // CABINET PRESET MATERIALS
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

  private createCarbonFiberTexture(): Texture {
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

    const tex = new DynamicTexture('carbonFiberTex', size, this.scene)
    tex.update()
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

  // ============================================================================
  // CATEGORY 3: PLAYFIELD
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

  // ============================================================================
  // CATEGORY 3b: LCD TABLE PLAYFIELD (Glowing phosphor display)
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
  // CATEGORY 4: GLASS/TRANSPARENT
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
  // CATEGORY 5: INTERACTIVE/NEON ELEMENTS
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
  // CATEGORY 6: ENERGY/HOLOGRAM
  // ============================================================================

  getHologramMaterial(colorHex?: string, wireframe: boolean = true): StandardMaterial {
    const baseColor = colorHex || PALETTE.CYAN
    const cacheKey = `hologram_${baseColor}_${wireframe}`
    return this.getCachedStandard(cacheKey, () => {
      const mat = new StandardMaterial(`hologramMat_${baseColor}`, this.scene)
      mat.wireframe = wireframe
      mat.emissiveColor = emissive(baseColor, INTENSITY.HIGH)
      mat.alpha = wireframe ? 0.5 : 0.3
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
  // CATEGORY 7: BALL MATERIALS
  // ============================================================================

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

  // ============================================================================
  // CATEGORY 8: STATE-BASED MATERIALS
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
   *
   * @param mat - The PBR material to configure
   * @param textures - The texture set containing ORM or separate textures
   * @param uScale - Optional U scale for texture coordinates
   * @param vScale - Optional V scale for texture coordinates
   */
  private applyORMTextures(
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
   * Packs three grayscale textures into RGB channels of a single texture.
   *
   * @param ao - Ambient Occlusion texture (R channel) or null
   * @param roughness - Roughness texture (G channel)
   * @param metallic - Metallic texture (B channel)
   * @param uScale - Optional U scale for the resulting texture
   * @param vScale - Optional V scale for the resulting texture
   * @returns DynamicTexture containing packed ORM data
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
      // _channel: number // Reserved for future texture channel reading
    ): number => {
      if (!texture) return -1 // Use default
      // For now, use default values as reading back from GPU textures is complex
      // In a production implementation, you'd read the texture data
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
    // For a proper implementation, you'd composite the actual texture data
    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`
    ctx.fillRect(0, 0, size, size)

    // Note: In a full implementation, you would:
    // 1. If ao/roughness/metallic are DynamicTextures, get their contexts
    // 2. Use drawImage() to composite them into respective channels
    // 3. Or use getImageData/putImageData with proper channel mixing

    tex.update()

    if (uScale !== undefined) tex.uScale = uScale
    if (vScale !== undefined) tex.vScale = vScale

    this.textureCache.set(cacheKey, tex)
    return tex
  }

  // ============================================================================
  // CLEAR COAT HELPER
  // ============================================================================

  private applyClearCoat(
    mat: PBRMaterial,
    preset: { enabled: boolean; intensity: number; roughness: number }
  ): void {
    if (this._qualityTier === QualityTier.LOW) return
    mat.clearCoat.isEnabled = preset.enabled
    mat.clearCoat.intensity = preset.intensity
    mat.clearCoat.roughness = preset.roughness
  }

  // ============================================================================
  // PROCEDURAL TEXTURE GENERATORS
  // ============================================================================

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

  /**
   * Create a micro-roughness noise texture for chrome/metal surfaces.
   * Blue noise pattern that breaks up unnaturally perfect reflections.
   */
  private createMicroRoughnessTexture(): DynamicTexture {
    const cacheKey = '_micro_roughness_'
    if (this.textureCache.has(cacheKey)) {
      return this.textureCache.get(cacheKey) as DynamicTexture
    }

    const size = 256
    const tex = new DynamicTexture('microRoughness', size, this.scene, true)
    const ctx = tex.getContext()

    // Base smooth metal in green channel
    const baseVal = Math.round(ROUGHNESS.POLISHED * 255)
    ctx.fillStyle = `rgb(0, ${baseVal}, 0)`
    ctx.fillRect(0, 0, size, size)

    // Add random noise variation
    const imageData = ctx.getImageData(0, 0, size, size)
    const data = imageData.data
    for (let i = 0; i < data.length; i += 4) {
      // Subtle roughness noise in green channel
      const noise = (Math.random() - 0.5) * 20
      data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise))
    }
    ctx.putImageData(imageData, 0, 0)

    tex.update()
    this.textureCache.set(cacheKey, tex)
    return tex
  }

  // ============================================================================
  // UTILITY METHODS
  // ============================================================================

  private getCachedStandard(
    key: string,
    factory: () => StandardMaterial
  ): StandardMaterial {
    if (this.materialCache.has(key)) {
      return this.materialCache.get(key) as StandardMaterial
    }
    const mat = factory()
    this.materialCache.set(key, mat)
    return mat
  }

  private getCachedPBR(key: string, factory: () => PBRMaterial): PBRMaterial {
    if (this.materialCache.has(key)) {
      return this.materialCache.get(key) as PBRMaterial
    }
    const mat = factory()
    this.materialCache.set(key, mat)
    return mat
  }

  private loadTextureSet(name: string): TextureSet {
    // Try loading ORM texture first (packed AO/Roughness/Metallic)
    const orm = this.tryLoadTexture(`${name}_orm.png`, { 
      anisotropicLevel: 2, 
      format: 'orm' 
    })

    if (orm) {
      // Use packed ORM texture - 66% VRAM reduction
      return {
        albedo: this.tryLoadTexture(`${name}_albedo.png`, { 
          anisotropicLevel: 4, 
          format: 'albedo' 
        }),
        normal: this.tryLoadTexture(`${name}_normal.png`, { 
          anisotropicLevel: 4, 
          format: 'normal' 
        }),
        orm,
        emissive: this.tryLoadTexture(`${name}_emissive.png`, { 
          format: 'emissive' 
        }),
        // Legacy fallbacks not needed when ORM is present
        roughness: null,
        metallic: null,
        ao: null,
      }
    }

    // Fallback: load separate textures
    return {
      albedo: this.tryLoadTexture(`${name}_albedo.png`, { 
        anisotropicLevel: 4, 
        format: 'albedo' 
      }),
      normal: this.tryLoadTexture(`${name}_normal.png`, { 
        anisotropicLevel: 4, 
        format: 'normal' 
      }),
      orm: null,
      emissive: this.tryLoadTexture(`${name}_emissive.png`, { 
        format: 'emissive' 
      }),
      roughness: this.tryLoadTexture(`${name}_roughness.png`, { 
        anisotropicLevel: 2 
      }),
      metallic: this.tryLoadTexture(`${name}_metallic.png`, { 
        anisotropicLevel: 2 
      }),
      ao: this.tryLoadTexture(`${name}_ao.png`, { 
        anisotropicLevel: 2 
      }),
    }
  }

  private tryLoadTexture(
    path: string,
    options: {
      generateMipmaps?: boolean
      anisotropicLevel?: number
      format?: TextureFormat
    } = {}
  ): Texture | null {
    const fullPath = `${this.textureBasePath}/${path}`
    
    // Try KTX2 first on HIGH tier with format specified
    if (this._qualityTier === QualityTier.HIGH && options.format) {
      const ktxPath = fullPath.replace('.png', '.ktx2')
      
      // Check cache first
      if (this.textureCache.has(ktxPath)) {
        return this.textureCache.get(ktxPath) as Texture
      }
      
      try {
        // KTX2 uses Basis Universal compression - 70-90% VRAM reduction
        // Format is embedded in the KTX2 file, we just load it
        const ktxTexture = new Texture(
          ktxPath,
          this.scene,
          {
            noMipmap: !(options.generateMipmaps ?? true),
            invertY: false,
            samplingMode: Texture.TRILINEAR_SAMPLINGMODE,
          }
        )
        
        // Apply anisotropic filtering
        if (options.anisotropicLevel && options.anisotropicLevel > 0) {
          ktxTexture.anisotropicFilteringLevel = options.anisotropicLevel
        }
        
        ktxTexture.name = `${path}_ktx2`
        this.textureCache.set(ktxPath, ktxTexture)
        console.log(`[MaterialLibrary] Loaded KTX2 (${COMPRESSION_FORMATS[options.format]}): ${ktxPath}`)
        return ktxTexture
      } catch {
        // KTX2 failed, fall through to PNG
        console.log(`[MaterialLibrary] KTX2 not found, falling back to PNG: ${path}`)
      }
    }
    
    // PNG fallback (original behavior)
    if (this.textureCache.has(fullPath)) {
      return this.textureCache.get(fullPath) as Texture
    }

    try {
      // Use ITextureCreationOptions for cleaner configuration
      const creationOptions = {
        noMipmap: !(options.generateMipmaps ?? true),
        invertY: false,
        samplingMode: Texture.TRILINEAR_SAMPLINGMODE,
      }

      const tex = new Texture(
        fullPath,
        this.scene,
        creationOptions
      )

      // Apply anisotropic filtering for better quality at oblique angles
      if (options.anisotropicLevel && options.anisotropicLevel > 0) {
        tex.anisotropicFilteringLevel = options.anisotropicLevel
      }

      this.textureCache.set(fullPath, tex)
      return tex
    } catch {
      return null
    }
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

  getMaterial(name: string): StandardMaterial | PBRMaterial | null {
    return this.materialCache.get(name) || null
  }

  dispose(): void {
    this.materialCache.forEach(mat => mat.dispose())
    this.materialCache.clear()
    this.textureCache.forEach(tex => tex.dispose())
    this.textureCache.clear()
  }

  // ============================================================================
  // STATS & DEBUGGING
  // ============================================================================

  getStats(): MaterialLibraryStats {
    const textureBreakdown = Array.from(this.textureCache.entries()).map(([name, tex]) => {
      const size = tex.getSize()
      // Estimate: width * height * 4 bytes per pixel (RGBA)
      // Mipmaps add ~33% more
      const estimatedBytes = size.width * size.height * 4 * 1.33
      return {
        name: name.split('/').pop() || name, // Just filename
        width: size.width,
        height: size.height,
        estimatedBytes: Math.round(estimatedBytes)
      }
    })

    const estimatedBytes = textureBreakdown.reduce((sum, t) => sum + t.estimatedBytes, 0)

    return {
      materials: this.materialCache.size,
      textures: this.textureCache.size,
      estimatedBytes: Math.round(estimatedBytes),
      estimatedMB: Math.round(estimatedBytes / 1024 / 1024 * 100) / 100,
      textureBreakdown
    }
  }

  logStats(): void {
    const stats = this.getStats()
    console.group('📊 MaterialLibrary Stats')
    console.log(`Materials: ${stats.materials}`)
    console.log(`Textures: ${stats.textures}`)
    console.log(`Estimated VRAM: ${stats.estimatedMB} MB`)
    console.group('Texture Breakdown:')
    stats.textureBreakdown.forEach(t => {
      console.log(`  ${t.name}: ${t.width}x${t.height} (${Math.round(t.estimatedBytes / 1024)} KB)`)
    })
    console.groupEnd()
    console.groupEnd()
  }
}

// Singleton instance
let instance: MaterialLibrary | null = null

export function getMaterialLibrary(scene: Scene): MaterialLibrary {
  if (!instance || instance['scene'] !== scene) {
    instance = new MaterialLibrary(scene)
  }
  // Expose for debugging (dev only)
  if (typeof window !== 'undefined') {
    (window as unknown as Record<string, unknown>).materialLibrary = instance
  }
  return instance
}

export function resetMaterialLibrary(): void {
  instance?.dispose()
  instance = null
}
