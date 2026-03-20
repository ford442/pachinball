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
  Color3,
} from '@babylonjs/core'
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
  roughness?: Texture | null
  metallic?: Texture | null
  emissive?: Texture | null
  ao?: Texture | null
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
  private textureCache: Map<string, Texture> = new Map()
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
    try {
      const envPath = `${this.textureBasePath}/environment.env`
      const envTexture = CubeTexture.CreateFromPrefilteredData(envPath, this.scene)
      this.scene.environmentTexture = envTexture
      this.scene.environmentIntensity = TIER_ENV_INTENSITY[this._qualityTier]
    } catch {
      this.scene.environmentIntensity = Math.min(0.4, TIER_ENV_INTENSITY[this._qualityTier])
    }
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
      if (textures.ao) mat.ambientTexture = textures.ao

      // Roughness variation texture for glossy grid lines vs matte base
      if (this._qualityTier === QualityTier.HIGH && !textures.roughness) {
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
    return {
      albedo: this.tryLoadTexture(`${name}_albedo.png`),
      normal: this.tryLoadTexture(`${name}_normal.png`),
      roughness: this.tryLoadTexture(`${name}_roughness.png`),
      metallic: this.tryLoadTexture(`${name}_metallic.png`),
      emissive: this.tryLoadTexture(`${name}_emissive.png`),
      ao: this.tryLoadTexture(`${name}_ao.png`),
    }
  }

  private tryLoadTexture(path: string): Texture | null {
    const fullPath = `${this.textureBasePath}/${path}`
    if (this.textureCache.has(fullPath)) {
      return this.textureCache.get(fullPath)!
    }
    try {
      const tex = new Texture(fullPath, this.scene)
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
}

// Singleton instance
let instance: MaterialLibrary | null = null

export function getMaterialLibrary(scene: Scene): MaterialLibrary {
  if (!instance || instance['scene'] !== scene) {
    instance = new MaterialLibrary(scene)
  }
  return instance
}

export function resetMaterialLibrary(): void {
  instance?.dispose()
  instance = null
}
