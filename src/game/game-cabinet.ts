/**
 * Cabinet Manager - Cabinet preset switching logic
 *
 * Handles:
 * - Cabinet preset loading (classic, neo, vertical, wide)
 * - Cabinet cycling through available presets
 * - UI popup notifications
 * - Integration with shadow generator
 */

import type { Scene, Mesh } from '@babylonjs/core'

import {
  getCabinetBuilder,
  CABINET_PRESETS,
  type CabinetType,
  type CabinetPreset,
  type LoadCabinetOptions,
} from '../cabinet'

export interface CabinetManagerConfig {
  onPresetChange?: (type: CabinetType, preset: CabinetPreset) => void
  onPopupShow?: (name: string) => void
  onCabinetBuild?: (meshes: Mesh[]) => void
  onUISelect?: (type: CabinetType) => void
}

export class CabinetManager {
  private scene: Scene
  private currentType: CabinetType = 'classic'
  private config: CabinetManagerConfig

  constructor(scene: Scene, config: CabinetManagerConfig = {}) {
    this.scene = scene
    this.config = config
  }

  getCurrentType(): CabinetType {
    return this.currentType
  }

  getCurrentPreset(): CabinetPreset {
    return CABINET_PRESETS[this.currentType]
  }

  /**
   * Load a cabinet preset and rebuild the cabinet.
   * @param type - The cabinet preset type ('classic', 'neo', 'vertical', 'wide')
   */
  async loadCabinetPreset(type: CabinetType, options: LoadCabinetOptions = {}): Promise<void> {
    if (!this.scene) return

    if (!CABINET_PRESETS[type]) {
      console.warn(`[CabinetManager] Unknown preset: ${type}`)
      return
    }

    const cabinetBuilder = getCabinetBuilder(this.scene)
    if (cabinetBuilder.isLoadInFlight()) {
      console.warn(`[CabinetManager] Ignoring re-entrant load for ${type}`)
      return
    }

    this.currentType = type
    await cabinetBuilder.loadCabinetPreset(type, options)

    const presetNames: Record<CabinetType, string> = {
      classic: 'Classic Pinball',
      neo: 'Neo Arcade',
      vertical: 'Vertical Shooter',
      wide: 'Deluxe Wide',
    }
    this.config.onPopupShow?.(presetNames[type])
    this.config.onPresetChange?.(type, CABINET_PRESETS[type])
    this.config.onUISelect?.(type)
    this.config.onCabinetBuild?.(cabinetBuilder.getCabinetMeshes())

    console.log(`[CabinetManager] Loaded ${presetNames[type]}`)
  }

  /**
   * Cycle to the next cabinet preset.
   */
  async cycleCabinetPreset(options: LoadCabinetOptions = {}): Promise<void> {
    const types: CabinetType[] = ['classic', 'neo', 'vertical', 'wide']
    const currentIndex = types.indexOf(this.currentType)
    const nextIndex = (currentIndex + 1) % types.length
    await this.loadCabinetPreset(types[nextIndex], options)
  }

  /**
   * Get available cabinet presets for UI
   */
  getAvailablePresets(): { type: CabinetType; name: string; description: string }[] {
    return Object.values(CABINET_PRESETS).map((p) => ({
      type: p.type,
      name: p.name,
      description: p.description,
    }))
  }

  /**
   * Dispose cabinet resources
   */
  dispose(): void {
    const cabinetBuilder = getCabinetBuilder(this.scene)
    cabinetBuilder.dispose()
  }
}

// Re-export types for convenience
export { CABINET_PRESETS, type CabinetType, type CabinetPreset }
