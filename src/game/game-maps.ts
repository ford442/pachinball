/**
 * Game Maps Manager - Table map switching logic
 *
 * Handles:
 * - Map switching with LCD table state updates
 * - Map cycling through available maps
 * - LCD playfield visual updates
 * - Integration with material library, sound system, and cabinet lighting
 */

import type { Scene } from '@babylonjs/core'

import {
  TABLE_MAPS,
  type TableMapType,
  type TableMapConfig,
  LCDTableState,
  registerMap,
} from '../shaders/lcd-table'
import { computeEffectiveScanlineIntensity } from '../shaders/scanline'
import { SettingsManager } from '../game-elements/settings'
import { getMapSystem } from '../game-elements/map-system'
import { getMaterialLibrary } from '../materials'
import { getCabinetBuilder } from '../cabinet'


export interface MapManagerConfig {
  onMapChange?: (mapType: TableMapType, config: TableMapConfig) => void
  onPopupShow?: (name: string, color: string) => void
  onLevelStart?: (levelId: string) => void
  onMapSelectorUpdate?: () => void
}

export class TableMapManager {
  private scene: Scene
  private currentMap: TableMapType = 'neon-helix'
  private config: MapManagerConfig
  private lcdTableState: LCDTableState
  // Note: bloomPipeline is set but currently unused - reserved for future map-specific bloom effects
  private mapSystem = getMapSystem()
  private scanlineWeight: number

  constructor(scene: Scene, config: MapManagerConfig = {}) {
    this.scene = scene
    this.config = config
    this.lcdTableState = new LCDTableState()
    this.scanlineWeight = SettingsManager.load().scanlineWeight
  }

  setBloomPipeline(): void {
    // Reserved for future map-specific bloom effects
  }

  getCurrentMap(): TableMapType {
    return this.currentMap
  }

  getCurrentConfig(): TableMapConfig {
    return TABLE_MAPS[this.currentMap]
  }

  getLCDTableState(): LCDTableState {
    return this.lcdTableState
  }

  getMapSystem() {
    return this.mapSystem
  }

  /**
   * Switch the LCD table to a different map/theme
   * @param mapName - The map to switch to (e.g., 'neon-helix', 'cyber-core')
   */
  switchTableMap(mapName: TableMapType): void {
    // Ensure the map exists in the runtime registry (hardcoded or dynamic)
    const mapConfig = this.mapSystem.getMap(mapName) || TABLE_MAPS[mapName]
    if (!mapConfig) {
      console.warn(`[MapManager] Unknown table map: ${mapName}`)
      return
    }

    // Register into TABLE_MAPS if it came from MapSystem (ensures LCDTableState can find it)
    if (!TABLE_MAPS[mapName]) {
      registerMap(mapName, mapConfig)
    }

    console.log(`[MapManager] Switching table map to: ${mapName}`)
    this.currentMap = mapName
    this.lcdTableState.switchMap(mapName)

    // Update the material library's LCD material
    const matLib = getMaterialLibrary(this.scene)
    matLib.updateLCDTableEmissive(mapConfig.baseColor, mapConfig.glowIntensity)
    matLib.updateLCDTableVisual(mapConfig, {
      timeSeconds: performance.now() * 0.001,
      flashIntensity: this.lcdTableState.flashIntensity,
      rippleIntensity: this.lcdTableState.rippleIntensity,
      rippleTime: 0,
      reducedMotion: SettingsManager.load().reducedMotion,
      photosensitiveMode: SettingsManager.load().photosensitiveMode,
      forceRedraw: true,
    })

    // Notify callback for ball/flipper material updates
    this.config.onMapChange?.(mapName, mapConfig)

    // Update 3D cabinet mesh neon trim and interior lights to match map
    const cabinetBuilder = getCabinetBuilder(this.scene)
    cabinetBuilder.setThemeFromMap(mapName)

    // Switch music track for this map
    // Note: Sound system call needs to be handled by the game class
    // const musicId = (mapConfig as { musicTrackId?: string }).musicTrackId || this.mapSystem.inferMusicTrackId(mapName)
    // this.soundSystem.playMapMusic(musicId)

    // Show map name popup with CRT effect
    this.config.onPopupShow?.(mapConfig.name, mapConfig.baseColor)

    // Update on-screen map selector highlight
    this.config.onMapSelectorUpdate?.()

    // Configure Dynamic World mode based on map config
    const mapMode = mapConfig.mode || 'fixed'

    if (mapMode === 'dynamic' && mapConfig.worldLength) {
      // Initialize dynamic zones for this map
      // Note: This needs to be handled by the game class with dynamicWorld
      // this.initializeDynamicZones(mapName, mapConfig)
    }
  }

  /**
   * Cycle to the next table map
   */
  cycleTableMap(): void {
    const maps = this.mapSystem.getMapIds()
    const currentIndex = maps.indexOf(this.currentMap)
    const nextIndex = (currentIndex + 1) % maps.length
    this.switchTableMap(maps[nextIndex])
  }

  /**
   * Update the LCD table state (called each frame)
   * @param dt - Delta time in seconds
   */
  update(dt: number): void {
    this.lcdTableState.update(dt)
    const config = this.lcdTableState.getCurrentConfig()
    const effectiveScanlineIntensity = computeEffectiveScanlineIntensity(
      config.scanlineIntensity,
      this.scanlineWeight,
      this.lcdTableState.getScanlineIntensityMultiplier()
    )
    const visualConfig = {
      ...config,
      scanlineIntensity: effectiveScanlineIntensity,
    }
    const settings = SettingsManager.load()
    getMaterialLibrary(this.scene).updateLCDTableVisual(visualConfig, {
      timeSeconds: performance.now() * 0.001,
      flashIntensity: this.lcdTableState.flashIntensity,
      rippleIntensity: this.lcdTableState.rippleIntensity,
      rippleTime: performance.now() * 0.001,
      reducedMotion: settings.reducedMotion,
      photosensitiveMode: settings.photosensitiveMode,
    })
  }

  setScanlineWeight(weight: number): void {
    this.scanlineWeight = Math.min(1, Math.max(0, weight))
  }
  dispose(): void {
    // No-op: LCD playfield visuals render directly onto the table material.
  }
}

// Re-export types for convenience
export { TABLE_MAPS, type TableMapType, type TableMapConfig }
