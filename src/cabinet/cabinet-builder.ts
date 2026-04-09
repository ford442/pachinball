/**
 * Cabinet Builder - Main orchestrator for modular cabinet system
 *
 * This module delegates to preset-specific files:
 * - cabinet-classic.ts: Traditional wooden cabinet
 * - cabinet-neo.ts: Sleek black metal with neon
 * - cabinet-vertical.ts: Tall narrow cabinet
 * - cabinet-wide.ts: Extra wide deluxe cabinet
 */

import {
  Scene,
  Mesh,
  PointLight,
  SpotLight,
  PBRMaterial,
  StandardMaterial,
  Color3,
} from '@babylonjs/core'
import { getMaterialLibrary } from '../materials'
import { PALETTE, color } from '../game-elements/visual-language'
import type { TableMapType } from '../shaders/lcd-table'
import { TABLE_MAPS } from '../shaders/lcd-table'
import type { CabinetType, CabinetPreset } from './cabinet-types'
import { createClassicCabinet, CLASSIC_CONFIG } from './cabinet-classic'
import { createNeoCabinet, NEO_CONFIG } from './cabinet-neo'
import { createVerticalCabinet, VERTICAL_CONFIG } from './cabinet-vertical'
import { createWideCabinet, WIDE_CONFIG } from './cabinet-wide'

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

  constructor(scene: Scene) {
    this.scene = scene
  }

  /**
   * Load a cabinet preset and rebuild the entire cabinet.
   * Playfield position remains constant.
   */
  loadCabinetPreset(type: CabinetType): void {
    const preset = CABINET_PRESETS[type]
    if (!preset) {
      console.warn(`[Cabinet] Unknown preset: ${type}`)
      return
    }

    this.currentPreset = preset
    this.dispose()
    this.buildCabinet()

    console.log(`[Cabinet] Loaded preset: ${preset.name}`)
  }

  /**
   * Cycle to the next cabinet preset.
   * Returns the new preset type.
   */
  cycleCabinetPreset(): CabinetType {
    const types: CabinetType[] = ['classic', 'neo', 'vertical', 'wide']
    const currentIndex = types.indexOf(this.currentPreset.type)
    const nextIndex = (currentIndex + 1) % types.length
    const nextType = types[nextIndex]

    this.loadCabinetPreset(nextType)
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

  /**
   * Build the complete cabinet using the current preset.
   */
  buildCabinet(): void {
    const preset = this.currentPreset
    const matLib = getMaterialLibrary(this.scene)

    // Get the appropriate builder for this preset
    const builder = CABINET_BUILDERS[preset.type]
    if (!builder) {
      console.warn(`[Cabinet] No builder found for preset: ${preset.type}`)
      return
    }

    // Build the cabinet meshes
    const newMeshes = builder(this.scene, matLib)
    this.cabinetMeshes = newMeshes

    // Separate neon meshes for theme updates
    this.neonMeshes = newMeshes.filter(m =>
      m.name.includes('Neon') ||
      m.name.includes('Glow') ||
      m.name.includes('LightBar')
    )

    // Separate decoration meshes
    this.decorationMeshes = newMeshes.filter(m =>
      m.name.includes('Detail') ||
      m.name.includes('Plate') ||
      m.name.includes('Grille') ||
      m.name.includes('Circuit') ||
      m.name.includes('Inset') ||
      m.name.includes('Accent')
    )

    // Build interior lighting
    this.buildInteriorLighting(preset)

    console.log(`[Cabinet] Built ${preset.name} cabinet`)
  }

  /**
   * Build interior lighting for the cabinet
   */
  private buildInteriorLighting(preset: CabinetPreset): void {
    const points = preset.lightPoints
    const glowColor = color(this.currentNeonColor)

    // Interior point light
    const interiorGlow = new PointLight('cabinetInteriorGlow', points.interior, this.scene)
    interiorGlow.intensity = 0.6
    interiorGlow.diffuse = glowColor
    interiorGlow.range = 25
    this.interiorLights.push(interiorGlow)

    // Marquee spot
    const marqueeSpot = new SpotLight(
      'cabinetMarqueeSpot',
      points.marqueeSpot.pos,
      points.marqueeSpot.target,
      Math.PI / 3,
      2,
      this.scene
    )
    marqueeSpot.intensity = 0.8
    marqueeSpot.diffuse = new Color3(1, 1, 0.95)
    this.interiorLights.push(marqueeSpot)

    // Side accents
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

    // Under glow (if applicable)
    if (points.underGlow) {
      const underGlow = new PointLight('cabinetUnderGlow', points.underGlow, this.scene)
      underGlow.intensity = 0.5
      underGlow.diffuse = glowColor
      underGlow.range = 15
      this.interiorLights.push(underGlow)
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

    // Update all neon meshes
    for (const mesh of this.neonMeshes) {
      mesh.material = newNeonMat
    }

    // Update decoration meshes with neon material
    for (const mesh of this.decorationMeshes) {
      if (mesh.name.includes('LightBar')) {
        mesh.material = newNeonMat
      } else if (mesh.name.includes('Circuit')) {
        // Update circuit trace emissive color to match theme
        const circuitMat = mesh.material as StandardMaterial
        if (circuitMat && circuitMat.emissiveColor) {
          circuitMat.emissiveColor = color(this.currentNeonColor).scale(0.15)
        }
      }
    }

    // Update interior light colors
    const glowColor = color(this.currentNeonColor)

    // Update decoration meshes with side plates (Classic)
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

  /**
   * Clean up all cabinet meshes and lights.
   */
  dispose(): void {
    for (const mesh of this.cabinetMeshes) {
      mesh.dispose(false, true)
    }
    this.cabinetMeshes = []

    for (const mesh of this.neonMeshes) {
      mesh.dispose(false, true)
    }
    this.neonMeshes = []

    for (const mesh of this.decorationMeshes) {
      mesh.dispose(false, true)
    }
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
}
