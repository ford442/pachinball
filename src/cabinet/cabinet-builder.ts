/**
 * Cabinet Builder - Main orchestrator for modular cabinet system
 *
 * This module delegates to preset-specific files:
 * - cabinet-classic.ts: Traditional wooden cabinet
 * - cabinet-neo.ts: Sleek black metal with neon
 * - cabinet-vertical.ts: Tall narrow cabinet
 * - cabinet-wide.ts: Extra wide deluxe cabinet
 *
 * Classic may load from glTF (see cabinet-gltf-loader.ts) with procedural fallback.
 */

import {
  Scene,
  Mesh,
  AbstractMesh,
  PointLight,
  SpotLight,
  PBRMaterial,
  StandardMaterial,
  Color3,
  type AssetContainer,
} from '@babylonjs/core'
import { getMaterialLibrary } from '../materials'
import { PALETTE, color, QualityTier } from '../game-elements/visual-language'
import type { TableMapType } from '../shaders/lcd-table'
import { TABLE_MAPS } from '../shaders/lcd-table'
import type { CabinetType, CabinetPreset } from './cabinet-types'
import { createClassicCabinet, CLASSIC_CONFIG } from './cabinet-classic'
import { createNeoCabinet, NEO_CONFIG } from './cabinet-neo'
import { createVerticalCabinet, VERTICAL_CONFIG } from './cabinet-vertical'
import { createWideCabinet, WIDE_CONFIG } from './cabinet-wide'
import {
  loadCabinetGltfForPreset,
  assertCabinetAlignment,
  type CabinetLoadProgress,
} from './cabinet-gltf-loader'

// Re-export types for backward compatibility
export type { CabinetType, CabinetPreset } from './cabinet-types'

// All cabinet presets in one place for easy access
export const CABINET_PRESETS: Record<CabinetType, CabinetPreset> = {
  classic: CLASSIC_CONFIG,
  neo: NEO_CONFIG,
  vertical: VERTICAL_CONFIG,
  wide: WIDE_CONFIG,
}

// Builder functions registry
const CABINET_BUILDERS: Record<CabinetType, (scene: Scene, materials: ReturnType<typeof getMaterialLibrary>) => Mesh[]> = {
  classic: createClassicCabinet,
  neo: createNeoCabinet,
  vertical: createVerticalCabinet,
  wide: createWideCabinet,
}

// Singleton instance
let cabinetBuilderInstance: CabinetBuilder | null = null

/**
 * Get the singleton CabinetBuilder instance
 */
export function getCabinetBuilder(scene?: Scene): CabinetBuilder {
  if (!cabinetBuilderInstance && scene) {
    cabinetBuilderInstance = new CabinetBuilder(scene)
  }
  return cabinetBuilderInstance!
}

/**
 * Reset and dispose the CabinetBuilder singleton
 */
export function resetCabinetBuilder(): void {
  cabinetBuilderInstance?.dispose()
  cabinetBuilderInstance = null
}

export interface LoadCabinetOptions {
  qualityTier?: QualityTier
  onProgress?: CabinetLoadProgress
}

/**
 * Main CabinetBuilder class
 * Manages cabinet lifecycle, preset switching, and theme updates
 */
export class CabinetBuilder {
  private scene: Scene
  private cabinetMeshes: Mesh[] = []
  private neonMeshes: Mesh[] = []
  private decorationMeshes: Mesh[] = []
  private interiorLights: (PointLight | SpotLight)[] = []
  private marqueeAccentLights: PointLight[] = []
  private currentNeonColor: string = PALETTE.CYAN
  private currentPreset: CabinetPreset = CLASSIC_CONFIG
  private gltfContainer: AssetContainer | null = null
  private loadInFlight = false
  private qualityTier: QualityTier = QualityTier.HIGH

  constructor(scene: Scene) {
    this.scene = scene
  }

  setQualityTier(tier: QualityTier): void {
    this.qualityTier = tier
  }

  getQualityTier(): QualityTier {
    return this.qualityTier
  }

  isLoadInFlight(): boolean {
    return this.loadInFlight
  }

  /**
   * Load a cabinet preset and rebuild the entire cabinet.
   * Playfield position remains constant.
   * Tries glTF when preset.gltf is set; falls back to procedural builders.
   */
  async loadCabinetPreset(type: CabinetType, options: LoadCabinetOptions = {}): Promise<void> {
    if (this.loadInFlight) {
      console.warn(`[Cabinet] Ignoring re-entrant load for ${type}`)
      return
    }

    const preset = CABINET_PRESETS[type]
    if (!preset) {
      console.warn(`[Cabinet] Unknown preset: ${type}`)
      return
    }

    if (options.qualityTier !== undefined) {
      this.qualityTier = options.qualityTier
    }

    this.loadInFlight = true
    try {
      this.currentPreset = preset
      this.disposeMeshesAndLights()

      if (preset.gltf) {
        try {
          await this.buildCabinetFromGltf(preset, options.onProgress)
          console.log(`[Cabinet] Loaded glTF preset: ${preset.name}`)
          return
        } catch (err) {
          console.warn(`[Cabinet] glTF load failed for ${preset.name}, using procedural fallback:`, err)
          this.disposeGltfContainer()
        }
      }

      this.buildCabinetProcedural()
      console.log(`[Cabinet] Loaded procedural preset: ${preset.name}`)
    } finally {
      this.loadInFlight = false
    }
  }

  /**
   * Cycle to the next cabinet preset.
   * Returns the new preset type.
   */
  async cycleCabinetPreset(options: LoadCabinetOptions = {}): Promise<CabinetType> {
    const types: CabinetType[] = ['classic', 'neo', 'vertical', 'wide']
    const currentIndex = types.indexOf(this.currentPreset.type)
    const nextIndex = (currentIndex + 1) % types.length
    const nextType = types[nextIndex]

    await this.loadCabinetPreset(nextType, options)
    return nextType
  }

  /**
   * Get the current preset type.
   */
  getCurrentPreset(): CabinetType {
    return this.currentPreset.type
  }

  /**
   * Get all available presets.
   */
  getAvailablePresets(): { type: CabinetType; name: string; description: string }[] {
    return Object.values(CABINET_PRESETS).map(p => ({
      type: p.type,
      name: p.name,
      description: p.description,
    }))
  }

  getCabinetMeshes(): Mesh[] {
    return this.cabinetMeshes
  }

  private async buildCabinetFromGltf(
    preset: CabinetPreset,
    onProgress?: CabinetLoadProgress,
  ): Promise<void> {
    if (!preset.gltf) {
      throw new Error('No gltf config')
    }

    const result = await loadCabinetGltfForPreset(
      this.scene,
      preset.gltf,
      this.qualityTier,
      { onProgress },
    )
    this.gltfContainer = result.container

    const meshes = result.meshes.filter(
      (m): m is Mesh => m instanceof Mesh && m.name !== '__root__',
    )
    // Include transform-root children that are Mesh; keep AbstractMesh parents out of material loops
    for (const m of meshes) {
      m.isPickable = false
    }

    this.cabinetMeshes = meshes
    this.partitionMeshes(meshes)
    assertCabinetAlignment(result.meshes, preset)
    this.buildInteriorLighting(preset)

    console.log(
      `[Cabinet] Built ${preset.name} from glTF (${result.lod}: ${result.url}, ${meshes.length} meshes)`,
    )
  }

  /**
   * Build the complete cabinet using the current preset (procedural).
   */
  buildCabinet(): void {
    this.buildCabinetProcedural()
  }

  private buildCabinetProcedural(): void {
    const preset = this.currentPreset
    const matLib = getMaterialLibrary(this.scene)

    const builder = CABINET_BUILDERS[preset.type]
    if (!builder) {
      console.warn(`[Cabinet] No builder found for preset: ${preset.type}`)
      return
    }

    const newMeshes = builder(this.scene, matLib)
    this.cabinetMeshes = newMeshes
    this.partitionMeshes(newMeshes)
    this.buildInteriorLighting(preset)

    console.log(`[Cabinet] Built ${preset.name} cabinet (procedural)`)
  }

  private partitionMeshes(meshes: AbstractMesh[]): void {
    this.neonMeshes = meshes.filter(
      (m): m is Mesh =>
        m instanceof Mesh &&
        (m.name.includes('Neon') || m.name.includes('Glow') || m.name.includes('LightBar')),
    )

    this.decorationMeshes = meshes.filter(
      (m): m is Mesh =>
        m instanceof Mesh &&
        (m.name.includes('Detail') ||
          m.name.includes('Plate') ||
          m.name.includes('Grille') ||
          m.name.includes('Circuit') ||
          m.name.includes('Inset') ||
          m.name.includes('Accent')),
    )
  }

  /**
   * Build interior lighting for the cabinet
   */
  private buildInteriorLighting(preset: CabinetPreset): void {
    const points = preset.lightPoints
    const glowColor = color(this.currentNeonColor)

    const interiorGlow = new PointLight('cabinetInteriorGlow', points.interior, this.scene)
    interiorGlow.intensity = 0.6
    interiorGlow.diffuse = glowColor
    interiorGlow.range = 25
    this.interiorLights.push(interiorGlow)

    const marqueeSpot = new SpotLight(
      'cabinetMarqueeSpot',
      points.marqueeSpot.pos,
      points.marqueeSpot.target,
      Math.PI / 3,
      2,
      this.scene,
    )
    marqueeSpot.intensity = 0.8
    marqueeSpot.diffuse = new Color3(1, 1, 0.95)
    this.interiorLights.push(marqueeSpot)

    const leftAccent = new PointLight('cabinetLeftAccent', points.leftAccent, this.scene)
    leftAccent.intensity = 0.4
    leftAccent.diffuse = glowColor
    leftAccent.range = 12
    this.interiorLights.push(leftAccent)

    const rightAccent = new PointLight('cabinetRightAccent', points.rightAccent, this.scene)
    rightAccent.intensity = 0.4
    rightAccent.diffuse = glowColor
    rightAccent.range = 12
    this.interiorLights.push(rightAccent)

    if (points.underGlow) {
      const underGlow = new PointLight('cabinetUnderGlow', points.underGlow, this.scene)
      underGlow.intensity = 0.5
      underGlow.diffuse = glowColor
      underGlow.range = 15
      this.interiorLights.push(underGlow)
    }
  }

  /**
   * Update neon trim and interior lights from explicit theme colors (adventure tracks).
   */
  setThemeFromColors(primaryHex: string, accentHex?: string): void {
    const accent = accentHex ?? primaryHex
    this.currentNeonColor = primaryHex
    const matLib = getMaterialLibrary(this.scene)
    const newNeonMat = matLib.getCabinetNeonMaterial(primaryHex)
    const accentColor = color(accent)
    const primaryColor = color(primaryHex)

    for (const mesh of this.neonMeshes) {
      mesh.material = newNeonMat
    }

    for (const mesh of this.decorationMeshes) {
      if (mesh.name.includes('LightBar')) {
        mesh.material = newNeonMat
      } else if (mesh.name.includes('Circuit')) {
        const circuitMat = mesh.material as StandardMaterial
        if (circuitMat?.emissiveColor) {
          circuitMat.emissiveColor = accentColor.scale(0.18)
        }
      } else if (mesh.name.includes('SidePlate')) {
        const plateMat = mesh.material as PBRMaterial
        if (plateMat?.emissiveColor) {
          plateMat.emissiveColor = primaryColor.scale(0.15)
        }
      }
    }

    for (const light of this.interiorLights) {
      if (light.name === 'cabinetMarqueeSpot') continue
      light.diffuse = light.name.includes('Accent') ? accentColor : primaryColor
    }
  }

  /**
   * Update the neon trim and interior lights to match a new LCD table map.
   */
  setThemeFromMap(mapName: TableMapType): void {
    const map = TABLE_MAPS[mapName]
    if (!map) return

    this.currentNeonColor = map.baseColor
    const matLib = getMaterialLibrary(this.scene)
    const newNeonMat = matLib.getCabinetNeonMaterial(this.currentNeonColor)

    for (const mesh of this.neonMeshes) {
      mesh.material = newNeonMat
    }

    for (const mesh of this.decorationMeshes) {
      if (mesh.name.includes('LightBar')) {
        mesh.material = newNeonMat
      } else if (mesh.name.includes('Circuit')) {
        const circuitMat = mesh.material as StandardMaterial
        if (circuitMat && circuitMat.emissiveColor) {
          circuitMat.emissiveColor = color(this.currentNeonColor).scale(0.15)
        }
      }
    }

    const glowColor = color(this.currentNeonColor)

    for (const mesh of this.decorationMeshes) {
      if (mesh.name.includes('SidePlate')) {
        const plateMat = mesh.material as PBRMaterial
        if (plateMat && plateMat.emissiveColor) {
          plateMat.emissiveColor = glowColor.scale(0.15)
        }
      }
    }

    for (const light of this.interiorLights) {
      if (light.name === 'cabinetMarqueeSpot') continue
      light.diffuse = glowColor
    }

    console.log(`[Cabinet] Theme updated for ${this.currentPreset.name}: ${mapName}`)
  }

  private disposeGltfContainer(): void {
    if (this.gltfContainer) {
      this.gltfContainer.removeAllFromScene()
      this.gltfContainer.dispose()
      this.gltfContainer = null
    }
  }

  private disposeMeshesAndLights(): void {
    const hadGltf = this.gltfContainer !== null
    this.disposeGltfContainer()

    // Procedural meshes are not owned by an AssetContainer
    if (!hadGltf) {
      for (const mesh of this.cabinetMeshes) {
        if (!mesh.isDisposed()) {
          mesh.dispose(false, true)
        }
      }
    }
    this.cabinetMeshes = []
    this.neonMeshes = []
    this.decorationMeshes = []

    for (const light of this.interiorLights) {
      light.dispose()
    }
    this.interiorLights = []

    for (const light of this.marqueeAccentLights) {
      light.dispose()
    }
    this.marqueeAccentLights = []
  }

  /**
   * Clean up all cabinet meshes and lights.
   */
  dispose(): void {
    this.disposeMeshesAndLights()
  }
}
