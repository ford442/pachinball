/**
 * Material Library - Centralized PBR Material System
 * 
 * Provides categorized materials for the pinball table with:
 * - Clear material categories (Playfield, Metal, Glass, Plastic, Neon)
 * - Texture asset support with procedural fallbacks
 * - Consistent cyber/neon aesthetic
 */

import {
  Scene,
  StandardMaterial,
  PBRMaterial,
  Texture,
  Color3,
  DynamicTexture,
  CubeTexture,
} from '@babylonjs/core'

export interface TextureSet {
  albedo?: string
  normal?: string
  roughness?: string
  metallic?: string
  emissive?: string
  ao?: string
}

export class MaterialLibrary {
  private scene: Scene
  private textureCache: Map<string, Texture> = new Map()
  private materialCache: Map<string, StandardMaterial | PBRMaterial> = new Map()
  
  // Texture asset paths (checked at runtime, fallbacks used if missing)
  private textureBasePath = '/textures'
  
  constructor(scene: Scene) {
    this.scene = scene
  }

  /**
   * Load environment texture if available
   */
  loadEnvironmentTexture(): void {
    try {
      const envPath = `${this.textureBasePath}/environment.env`
      const envTexture = CubeTexture.CreateFromPrefilteredData(envPath, this.scene)
      this.scene.environmentTexture = envTexture
      this.scene.environmentIntensity = 0.6
      console.log('MaterialLibrary: Environment texture loaded')
    } catch {
      console.log('MaterialLibrary: No environment.env found, using procedural lighting')
      this.scene.environmentIntensity = 0.4
    }
  }

  /**
   * ============================================================================
   * CATEGORY 1: PLAYFIELD SURFACE
   * Dark polished surface with grid pattern
   * ============================================================================
   */
  getPlayfieldMaterial(): PBRMaterial {
    const cacheKey = 'playfield'
    if (this.materialCache.has(cacheKey)) {
      return this.materialCache.get(cacheKey) as PBRMaterial
    }

    const mat = new PBRMaterial('playfieldMat', this.scene)
    
    // Try to load texture set, fallback to procedural
    const textures = this.loadTextureSet('playfield')
    
    if (textures.albedo) {
      mat.albedoTexture = textures.albedo
      mat.albedoTexture.uScale = 4
      mat.albedoTexture.vScale = 8
    } else {
      // Procedural grid fallback
      mat.albedoTexture = this.createGridTexture()
      mat.albedoTexture.uScale = 4
      mat.albedoTexture.vScale = 8
    }
    
    if (textures.normal) mat.normalTexture = textures.normal
    if (textures.roughness) mat.roughnessTexture = textures.roughness
    if (textures.metallic) mat.metallicTexture = textures.metallic
    if (textures.emissive) {
      mat.emissiveTexture = textures.emissive
      mat.emissiveColor = Color3.White()
    } else {
      mat.emissiveColor = Color3.FromHexString('#6600ff').scale(0.4)
    }
    if (textures.ao) mat.ambientTexture = textures.ao

    // PBR settings for dark polished playfield
    mat.albedoColor = new Color3(0.8, 0.8, 0.9)
    mat.metallic = 0.3
    mat.roughness = 0.25
    mat.alpha = 0.92
    
    // Clear coat for "glass over display" look
    mat.clearCoat.isEnabled = true
    mat.clearCoat.intensity = 0.4
    mat.clearCoat.roughness = 0.1

    this.materialCache.set(cacheKey, mat)
    return mat
  }

  /**
   * ============================================================================
   * CATEGORY 2: METAL TRIM / RAILS
   * Chrome and brushed metal surfaces
   * ============================================================================
   */
  getChromeMaterial(): PBRMaterial {
    const cacheKey = 'chrome'
    if (this.materialCache.has(cacheKey)) {
      return this.materialCache.get(cacheKey) as PBRMaterial
    }

    const mat = new PBRMaterial('chromeMat', this.scene)
    mat.metallic = 1.0
    mat.roughness = 0.15
    mat.albedoColor = new Color3(0.9, 0.9, 0.95)
    mat.environmentIntensity = 1.0
    
    this.materialCache.set(cacheKey, mat)
    return mat
  }

  getBrushedMetalMaterial(): PBRMaterial {
    const cacheKey = 'brushedMetal'
    if (this.materialCache.has(cacheKey)) {
      return this.materialCache.get(cacheKey) as PBRMaterial
    }

    const mat = new PBRMaterial('brushedMetalMat', this.scene)
    mat.metallic = 0.9
    mat.roughness = 0.4
    mat.albedoColor = new Color3(0.15, 0.15, 0.18)
    
    // Try anisotropic texture if available
    const roughnessTex = this.tryLoadTexture('brushed_metal_roughness.png')
    if (roughnessTex) {
      mat.roughnessTexture = roughnessTex
    }
    
    this.materialCache.set(cacheKey, mat)
    return mat
  }

  getPinMaterial(): PBRMaterial {
    const cacheKey = 'pin'
    if (this.materialCache.has(cacheKey)) {
      return this.materialCache.get(cacheKey) as PBRMaterial
    }

    const mat = new PBRMaterial('pinMat', this.scene)
    mat.albedoColor = Color3.FromHexString('#aaaaaa')
    mat.metallic = 1.0
    mat.roughness = 0.25
    mat.clearCoat.isEnabled = true
    mat.clearCoat.intensity = 0.3
    
    this.materialCache.set(cacheKey, mat)
    return mat
  }

  /**
   * ============================================================================
   * CATEGORY 3: SMOKED GLASS / TRANSPARENT BARRIERS
   * Semi-transparent glass walls and tubes
   * ============================================================================
   */
  getSmokedGlassMaterial(): PBRMaterial {
    const cacheKey = 'smokedGlass'
    if (this.materialCache.has(cacheKey)) {
      return this.materialCache.get(cacheKey) as PBRMaterial
    }

    const mat = new PBRMaterial('smokedGlassMat', this.scene)
    mat.albedoColor = Color3.FromHexString('#001122')
    mat.emissiveColor = Color3.FromHexString('#00eeff').scale(0.3)
    mat.metallic = 0.1
    mat.roughness = 0.2
    mat.alpha = 0.35
    mat.indexOfRefraction = 1.4
    mat.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND
    
    this.materialCache.set(cacheKey, mat)
    return mat
  }

  getGlassTubeMaterial(): PBRMaterial {
    const cacheKey = 'glassTube'
    if (this.materialCache.has(cacheKey)) {
      return this.materialCache.get(cacheKey) as PBRMaterial
    }

    const mat = new PBRMaterial('glassTubeMat', this.scene)
    mat.alpha = 0.25
    mat.albedoColor = Color3.White()
    mat.metallic = 0.0
    mat.roughness = 0.1
    mat.indexOfRefraction = 1.5
    mat.clearCoat.isEnabled = true
    mat.clearCoat.intensity = 1.0
    mat.backFaceCulling = false
    
    this.materialCache.set(cacheKey, mat)
    return mat
  }

  /**
   * ============================================================================
   * CATEGORY 4: BLACK PLASTIC CASING
   * Cabinet, panels, non-reflective dark surfaces
   * ============================================================================
   */
  getBlackPlasticMaterial(): PBRMaterial {
    const cacheKey = 'blackPlastic'
    if (this.materialCache.has(cacheKey)) {
      return this.materialCache.get(cacheKey) as PBRMaterial
    }

    const mat = new PBRMaterial('blackPlasticMat', this.scene)
    mat.albedoColor = Color3.FromHexString('#080808')
    mat.metallic = 0.2
    mat.roughness = 0.6
    
    this.materialCache.set(cacheKey, mat)
    return mat
  }

  getCabinetMaterial(): StandardMaterial {
    const cacheKey = 'cabinet'
    if (this.materialCache.has(cacheKey)) {
      return this.materialCache.get(cacheKey) as StandardMaterial
    }

    // Cabinet uses StandardMaterial - doesn't need PBR complexity
    const mat = new StandardMaterial('cabinetMat', this.scene)
    mat.diffuseColor = Color3.FromHexString('#0a0a0a')
    mat.specularColor = new Color3(0.1, 0.1, 0.1)
    
    this.materialCache.set(cacheKey, mat)
    return mat
  }

  getSidePanelMaterial(): StandardMaterial {
    const cacheKey = 'sidePanel'
    if (this.materialCache.has(cacheKey)) {
      return this.materialCache.get(cacheKey) as StandardMaterial
    }

    const mat = new StandardMaterial('sidePanelMat', this.scene)
    mat.diffuseColor = Color3.FromHexString('#050505')
    mat.emissiveColor = Color3.FromHexString('#001133').scale(0.3)
    mat.alpha = 0.9
    
    this.materialCache.set(cacheKey, mat)
    return mat
  }

  /**
   * ============================================================================
   * CATEGORY 5: EMISSIVE NEON INSERTS
   * Glowing elements, bumpers, targets
   * ============================================================================
   */
  getNeonBumperMaterial(baseColor: string): PBRMaterial {
    const cacheKey = `bumper_${baseColor}`
    if (this.materialCache.has(cacheKey)) {
      return this.materialCache.get(cacheKey) as PBRMaterial
    }

    const mat = new PBRMaterial(`bumperMat_${baseColor}`, this.scene)
    mat.albedoColor = Color3.FromHexString(baseColor).scale(0.3)
    mat.emissiveColor = Color3.FromHexString(baseColor)
    mat.metallic = 0.4
    mat.roughness = 0.4
    
    this.materialCache.set(cacheKey, mat)
    return mat
  }

  getNeonFlipperMaterial(): PBRMaterial {
    const cacheKey = 'flipper'
    if (this.materialCache.has(cacheKey)) {
      return this.materialCache.get(cacheKey) as PBRMaterial
    }

    const mat = new PBRMaterial('flipperMat', this.scene)
    mat.albedoColor = Color3.FromHexString('#ffcc00')
    mat.emissiveColor = Color3.FromHexString('#ff8800').scale(0.3)
    mat.metallic = 0.6
    mat.roughness = 0.35
    mat.clearCoat.isEnabled = true
    mat.clearCoat.intensity = 0.4
    
    this.materialCache.set(cacheKey, mat)
    return mat
  }

  getNeonSlingshotMaterial(): PBRMaterial {
    const cacheKey = 'slingshot'
    if (this.materialCache.has(cacheKey)) {
      return this.materialCache.get(cacheKey) as PBRMaterial
    }

    const mat = new PBRMaterial('slingshotMat', this.scene)
    mat.albedoColor = Color3.White()
    mat.emissiveColor = Color3.White()
    mat.emissiveIntensity = 0.6
    mat.metallic = 0.3
    mat.roughness = 0.4
    mat.alpha = 0.75
    
    this.materialCache.set(cacheKey, mat)
    return mat
  }

  getHologramMaterial(colorHex: string, wireframe: boolean = true): StandardMaterial {
    const cacheKey = `hologram_${colorHex}_${wireframe}`
    if (this.materialCache.has(cacheKey)) {
      return this.materialCache.get(cacheKey) as StandardMaterial
    }

    const mat = new StandardMaterial(`hologramMat_${colorHex}`, this.scene)
    mat.wireframe = wireframe
    mat.emissiveColor = Color3.FromHexString(colorHex).scale(1.5)
    mat.alpha = wireframe ? 0.5 : 0.3
    
    this.materialCache.set(cacheKey, mat)
    return mat
  }

  getCatcherMaterial(): PBRMaterial {
    const cacheKey = 'catcher'
    if (this.materialCache.has(cacheKey)) {
      return this.materialCache.get(cacheKey) as PBRMaterial
    }

    const mat = new PBRMaterial('catcherMat', this.scene)
    mat.albedoColor = Color3.FromHexString('#ff00aa').scale(0.2)
    mat.emissiveColor = Color3.FromHexString('#ff00aa')
    mat.emissiveIntensity = 0.8
    mat.metallic = 0.5
    mat.roughness = 0.3
    mat.alpha = 0.85
    
    this.materialCache.set(cacheKey, mat)
    return mat
  }

  /**
   * ============================================================================
   * CATEGORY 6: BALL MATERIALS
   * Chrome ball and special variants
   * ============================================================================
   */
  getChromeBallMaterial(): PBRMaterial {
    const cacheKey = 'chromeBall'
    if (this.materialCache.has(cacheKey)) {
      return this.materialCache.get(cacheKey) as PBRMaterial
    }

    const mat = new PBRMaterial('ballMat', this.scene)
    mat.albedoColor = new Color3(0.95, 0.95, 0.98)
    mat.metallic = 1.0
    mat.roughness = 0.12
    mat.clearCoat.isEnabled = true
    mat.clearCoat.intensity = 1.0
    mat.environmentIntensity = 1.2
    
    this.materialCache.set(cacheKey, mat)
    return mat
  }

  getExtraBallMaterial(): PBRMaterial {
    const cacheKey = 'extraBall'
    if (this.materialCache.has(cacheKey)) {
      return this.materialCache.get(cacheKey) as PBRMaterial
    }

    const mat = new PBRMaterial('xbMat', this.scene)
    mat.albedoColor = Color3.FromHexString('#00ff44')
    mat.metallic = 0.9
    mat.roughness = 0.15
    
    this.materialCache.set(cacheKey, mat)
    return mat
  }

  /**
   * ============================================================================
   * UTILITY METHODS
   * ============================================================================
   */
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
    
    // Check cache first
    if (this.textureCache.has(fullPath)) {
      return this.textureCache.get(fullPath)!
    }

    try {
      const tex = new Texture(fullPath, this.scene)
      tex.onErrorObservable.add(() => {
        // Texture failed to load - remove from cache
        this.textureCache.delete(fullPath)
      })
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
    gradient.addColorStop(0, '#080818')
    gradient.addColorStop(0.5, '#050510')
    gradient.addColorStop(1, '#080818')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, size, size)

    // Main grid lines
    ctx.lineWidth = 2
    ctx.strokeStyle = '#8800ff'
    ctx.shadowBlur = 15
    ctx.shadowColor = '#aa00ff'

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

    // Border highlight
    ctx.lineWidth = 4
    ctx.strokeStyle = '#aa00ff'
    ctx.shadowBlur = 20
    ctx.shadowColor = '#d000ff'
    ctx.strokeRect(0, 0, size, size)

    dynamicTexture.update()
    this.textureCache.set(cacheKey, dynamicTexture)
    return dynamicTexture
  }

  /**
   * Get material by name (for dynamic updates)
   */
  getMaterial(name: string): StandardMaterial | PBRMaterial | null {
    return this.materialCache.get(name) || null
  }

  /**
   * Clear all materials and textures
   */
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
