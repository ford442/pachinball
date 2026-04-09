/**
 * Game Maps Manager - Table map switching logic
 *
 * Handles:
 * - Map switching with LCD table state updates
 * - Map cycling through available maps
 * - LCD post-process initialization
 * - Integration with material library, sound system, and cabinet lighting
 */

import { PostProcess, Color3, Texture } from '@babylonjs/core'

import type { Scene } from '@babylonjs/core'

import {
  TABLE_MAPS,
  type TableMapType,
  type TableMapConfig,
  LCDTableState,
  registerMap,
} from '../shaders/lcd-table'
import { getMapSystem } from '../game-elements/map-system'
import { getMaterialLibrary } from '../materials'
import { getCabinetBuilder } from '../cabinet'
import { API_BASE } from '../config'

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
  private lcdTablePostProcess: PostProcess | null = null
  // Note: bloomPipeline is set but currently unused - reserved for future map-specific bloom effects
  private mapSystem = getMapSystem(API_BASE)
  private engine: import('@babylonjs/core').AbstractEngine

  constructor(scene: Scene, config: MapManagerConfig = {}) {
    this.scene = scene
    this.config = config
    this.lcdTableState = new LCDTableState()
    this.engine = scene.getEngine() as import('@babylonjs/core').AbstractEngine
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
   * Initialize the LCD table post-process effect
   * @param camera - The camera to attach the post-process to
   */
  initLCDTablePostProcess(
    camera: import('@babylonjs/core').ArcRotateCamera
  ): PostProcess | null {
    if (!this.scene) return null

    // Create LCD table post-process effect
    this.lcdTablePostProcess = new PostProcess(
      'lcdTable',
      'lcdTable',
      [
        'uBaseColor',
        'uAccentColor',
        'uScanlineIntensity',
        'uPixelGridIntensity',
        'uSubpixelIntensity',
        'uGlowIntensity',
        'uMapBlend',
        'uTime',
        'uFlashIntensity',
        'uRippleIntensity',
        'uRippleTime',
      ],
      null,
      1.0,
      camera,
      Texture.BILINEAR_SAMPLINGMODE,
      this.engine
    )

    // Set up uniform updates
    this.lcdTablePostProcess.onApply = (effect) => {
      const config = this.lcdTableState.getCurrentConfig()
      const baseColor = this.hexToColor3(config.baseColor)
      const accentColor = this.hexToColor3(config.accentColor)

      effect.setColor3('uBaseColor', baseColor)
      effect.setColor3('uAccentColor', accentColor)
      effect.setFloat('uScanlineIntensity', config.scanlineIntensity)
      effect.setFloat('uPixelGridIntensity', config.pixelGridIntensity)
      effect.setFloat('uSubpixelIntensity', config.subpixelIntensity)
      effect.setFloat('uGlowIntensity', config.glowIntensity)
      effect.setFloat('uMapBlend', 0.5)
      effect.setFloat('uTime', performance.now() * 0.001)
      effect.setFloat('uFlashIntensity', this.lcdTableState.flashIntensity)
      effect.setFloat('uRippleIntensity', this.lcdTableState.rippleIntensity)
      effect.setFloat('uRippleTime', performance.now() * 0.001)
    }

    console.log('[MapManager] LCD table post-process initialized')
    return this.lcdTablePostProcess
  }

  /**
   * Update the LCD table state (called each frame)
   * @param dt - Delta time in seconds
   */
  update(dt: number): void {
    this.lcdTableState.update(dt)
  }

  private hexToColor3(hex: string): Color3 {
    const clean = hex.replace('#', '')
    const r = parseInt(clean.substring(0, 2), 16) / 255
    const g = parseInt(clean.substring(2, 4), 16) / 255
    const b = parseInt(clean.substring(4, 6), 16) / 255
    return new Color3(r, g, b)
  }

  dispose(): void {
    this.lcdTablePostProcess?.dispose()
    this.lcdTablePostProcess = null
  }
}

// Re-export types for convenience
export { TABLE_MAPS, type TableMapType, type TableMapConfig }
