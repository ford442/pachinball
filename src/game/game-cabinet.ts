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
  loadCabinetPreset(type: CabinetType): void {
    if (!this.scene) return

    if (!CABINET_PRESETS[type]) {
      console.warn(`[CabinetManager] Unknown preset: ${type}`)
      return
    }

    this.currentType = type
    const cabinetBuilder = getCabinetBuilder(this.scene)
    cabinetBuilder.loadCabinetPreset(type)

    // Show cabinet name popup
    const presetNames: Record<CabinetType, string> = {
      classic: 'Classic Pinball',
      neo: 'Neo Arcade',
      vertical: 'Vertical Shooter',
      wide: 'Deluxe Wide',
    }
    this.config.onPopupShow?.(presetNames[type])

    // Notify callbacks
    this.config.onPresetChange?.(type, CABINET_PRESETS[type])

    // Update UI
    this.config.onUISelect?.(type)

    console.log(`[CabinetManager] Loaded ${presetNames[type]}`)
  }

  /**
   * Cycle to the next cabinet preset.
   */
  cycleCabinetPreset(): void {
    const types: CabinetType[] = ['classic', 'neo', 'vertical', 'wide']
    const currentIndex = types.indexOf(this.currentType)
    const nextIndex = (currentIndex + 1) % types.length
    this.loadCabinetPreset(types[nextIndex])
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
