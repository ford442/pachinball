/**
 * Material Core - Base infrastructure for MaterialLibrary
 *
 * Provides:
 * - TextureSet interface
 * - COMPRESSION_FORMATS constant
 * - MaterialLibraryStats interface
 * - detectQualityTier function
 * - MaterialLibraryBase class with caching infrastructure
 */

import {
  Scene,
  StandardMaterial,
  PBRMaterial,
  Texture,
  DynamicTexture,
  CubeTexture,
  BaseTexture,
} from '@babylonjs/core'
// Import KTX2 loader to register the format (side-effect)
import '@babylonjs/core/Materials/Textures/Loaders/ktxTextureLoader'
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine'
import {
  QualityTier,
  TIER_ENV_INTENSITY,
  TIER_TEXTURE_SIZE,
} from '../game-elements/visual-language'

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
export const COMPRESSION_FORMATS = {
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
export type TextureFormat = keyof typeof COMPRESSION_FORMATS

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

/**
 * Base class for MaterialLibrary with caching infrastructure.
 * Extended by specialized material classes.
 */
export class MaterialLibraryBase {
  protected scene: Scene
  protected textureCache: Map<string, BaseTexture> = new Map()
  protected materialCache: Map<string, StandardMaterial | PBRMaterial> = new Map()

  protected textureBasePath = './textures'
  protected _qualityTier: QualityTier = QualityTier.HIGH

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
  protected get textureSize(): number {
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

      // Set up load handling for the texture
      envTexture.onLoadObservable.add(() => {
        console.log('[MaterialLibrary] Environment texture loaded and cached')
      })

      // Cache for reuse
      this.textureCache.set(envPath, envTexture)

      this.scene.environmentTexture = envTexture
      this.scene.environmentIntensity = TIER_ENV_INTENSITY[this._qualityTier]
    } catch (err) {
      console.warn('[MaterialLibrary] Failed to load environment texture:', err)
      // Fallback: disable environment lighting
      this.scene.environmentTexture = null
      this.scene.environmentIntensity = Math.min(0.4, TIER_ENV_INTENSITY[this._qualityTier])
    }
  }

  getEnvironmentTexture(): CubeTexture | null {
    const envPath = `${this.textureBasePath}/environment.env`
    return this.textureCache.get(envPath) as CubeTexture || null
  }

  /**
   * Get cached PBR material or create new one using factory function.
   */
  protected getCachedPBR(key: string, factory: () => PBRMaterial): PBRMaterial {
    if (this.materialCache.has(key)) {
      return this.materialCache.get(key) as PBRMaterial
    }
    const mat = factory()
    this.materialCache.set(key, mat)
    return mat
  }

  /**
   * Get cached Standard material or create new one using factory function.
   */
  protected getCachedStandard(key: string, factory: () => StandardMaterial): StandardMaterial {
    if (this.materialCache.has(key)) {
      return this.materialCache.get(key) as StandardMaterial
    }
    const mat = factory()
    this.materialCache.set(key, mat)
    return mat
  }

  /**
   * Create a micro-roughness noise texture for chrome/metal surfaces.
   * Blue noise pattern that breaks up unnaturally perfect reflections.
   * Uses POLISHED roughness value (0.05) as base.
   */
  protected createMicroRoughnessTexture(): DynamicTexture {
    const cacheKey = '_micro_roughness_'
    if (this.textureCache.has(cacheKey)) {
      return this.textureCache.get(cacheKey) as DynamicTexture
    }

    const size = 256
    const tex = new DynamicTexture('microRoughness', size, this.scene, true)
    const ctx = tex.getContext()

    // Base smooth metal in green channel (POLISHED = 0.05)
    const baseVal = Math.round(0.05 * 255)
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

  /**
   * Load a texture set (albedo, normal, ORM, emissive) for a material.
   */
  protected loadTextureSet(name: string): TextureSet {
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

  /**
   * Try to load a texture, with KTX2 fallback on HIGH tier.
   */
  protected tryLoadTexture(
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

  /**
   * Apply clear coat to a material based on quality tier.
   */
  protected applyClearCoat(
    mat: PBRMaterial,
    preset: { enabled: boolean; intensity: number; roughness: number }
  ): void {
    if (this._qualityTier === QualityTier.LOW) return
    mat.clearCoat.isEnabled = preset.enabled
    mat.clearCoat.intensity = preset.intensity
    mat.clearCoat.roughness = preset.roughness
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
