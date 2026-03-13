/**
 * Material Library - Unified PBR Material System
 * 
 * Provides categorized materials using the Visual Language System
 * for consistent cyber/neon aesthetic across all game objects.
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
import {
  PALETTE,
  SURFACES,
  INTENSITY,
  ROUGHNESS,
  METALLIC,
  CLEARCOAT,
  CATEGORIES,
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

export class MaterialLibrary {
  private scene: Scene
  private textureCache: Map<string, Texture> = new Map()
  private materialCache: Map<string, StandardMaterial | PBRMaterial> = new Map()
  
  private textureBasePath = '/textures'
  
  constructor(scene: Scene) {
    this.scene = scene
  }

  loadEnvironmentTexture(): void {
    try {
      const envPath = `${this.textureBasePath}/environment.env`
      const envTexture = CubeTexture.CreateFromPrefilteredData(envPath, this.scene)
      this.scene.environmentTexture = envTexture
      this.scene.environmentIntensity = 0.6
    } catch {
      this.scene.environmentIntensity = 0.4
    }
  }

  // ============================================================================
  // CATEGORY 1: STRUCTURAL SURFACES
  // ============================================================================

  getCabinetMaterial(): StandardMaterial {
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
      mat.environmentIntensity = 1.0
      return mat
    })
  }

  getBrushedMetalMaterial(): PBRMaterial {
    return this.getCachedPBR('brushedMetal', () => {
      const mat = new PBRMaterial('brushedMetalMat', this.scene)
      mat.albedoColor = color(SURFACES.METAL_DARK)
      mat.metallic = METALLIC.HIGH
      mat.roughness = ROUGHNESS.SATIN
      return mat
    })
  }

  getPinMaterial(): PBRMaterial {
    return this.getCachedPBR('pin', () => {
      const mat = new PBRMaterial('pinMat', this.scene)
      mat.albedoColor = color(SURFACES.METAL_LIGHT)
      mat.metallic = METALLIC.FULL
      mat.roughness = ROUGHNESS.SMOOTH
      mat.clearCoat.isEnabled = true
      mat.clearCoat.intensity = 0.3
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
      
      if (textures.normal) mat.bumpTexture = textures.normal
      if (textures.emissive) {
        mat.emissiveTexture = textures.emissive
        mat.emissiveColor = Color3.White()
      } else {
        mat.emissiveColor = emissive(PALETTE.PURPLE, INTENSITY.AMBIENT)
      }
      if (textures.ao) mat.ambientTexture = textures.ao

      mat.albedoColor = new Color3(0.8, 0.8, 0.9)
      mat.metallic = METALLIC.MID
      mat.roughness = ROUGHNESS.SMOOTH
      mat.alpha = 0.92
      mat.clearCoat.isEnabled = true
      mat.clearCoat.intensity = CLEARCOAT.SCREEN.intensity
      mat.clearCoat.roughness = CLEARCOAT.SCREEN.roughness

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
      mat.clearCoat.isEnabled = true
      mat.clearCoat.intensity = CLEARCOAT.GLASS.intensity
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
      mat.clearCoat.isEnabled = true
      mat.clearCoat.intensity = CLEARCOAT.POLISHED.intensity
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
      mat.clearCoat.isEnabled = true
      mat.clearCoat.intensity = CLEARCOAT.GLASS.intensity
      mat.environmentIntensity = 1.2
      return mat
    })
  }

  getExtraBallMaterial(): PBRMaterial {
    return this.getCachedPBR('extraBall', () => {
      const mat = new PBRMaterial('xbMat', this.scene)
      mat.albedoColor = color(PALETTE.MATRIX)
      mat.metallic = METALLIC.HIGH
      mat.roughness = ROUGHNESS.POLISHED
      return mat
    })
  }

  // ============================================================================
  // CATEGORY 8: STATE-BASED MATERIALS
  // ============================================================================

  getStateBumperMaterial(state: 'IDLE' | 'REACH' | 'FEVER' | 'JACKPOT'): PBRMaterial {
    return this.getNeonBumperMaterial(stateEmissive(state).toHexString())
  }

  getAlertMaterial(): PBRMaterial {
    return this.getCachedPBR('alert', () => {
      const mat = new PBRMaterial('alertMat', this.scene)
      mat.albedoColor = color(PALETTE.ALERT).scale(0.3)
      mat.emissiveColor = emissive(PALETTE.ALERT, INTENSITY.HIGH)
      mat.metallic = METALLIC.MID
      mat.roughness = ROUGHNESS.SATIN
      return mat
    })
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

    const dynamicTexture = new DynamicTexture('gridTexture', 1024, this.scene, true)
    dynamicTexture.hasAlpha = true
    const ctx = dynamicTexture.getContext()
    const size = 1024

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
