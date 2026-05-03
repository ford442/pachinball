/**
 * Game Map & Cabinet — Table map switching, cabinet presets, popups.
 */

import type { Scene } from '@babylonjs/core'
import type { TableMapManager } from './game-maps'
import type { CabinetManager } from './game-cabinet'
import type { GameUIManager } from './game-ui'
import type { EffectsSystem } from '../effects'
import type { DisplaySystem } from '../display'
import type { SoundSystem } from '../game-elements/sound-system'
import type { AdventureState } from '../game-elements/adventure-state'
import { TABLE_MAPS } from '../shaders/lcd-table'

export interface MapCabinetHost {
  readonly scene: Scene | null
  readonly mapManager: TableMapManager | null
  readonly cabinetManager: CabinetManager | null
  readonly uiManager: GameUIManager | null
  readonly effects: EffectsSystem | null
  readonly display: DisplaySystem | null
  readonly soundSystem: SoundSystem
  readonly adventureState: AdventureState
  readonly levelSelectScreen: import('../game-elements/level-select-screen').LevelSelectScreen | null
  readonly dynamicWorld: import('../game-elements/dynamic-world').DynamicWorld | null

  switchTableMap(mapName: string): void
  initializeDynamicZones(mapName: string, mapConfig: typeof TABLE_MAPS[string]): void
  updateCabinetLightingForMap(): void
}

export class GameMapCabinet {
  private readonly host: MapCabinetHost

  constructor(host: MapCabinetHost) {
    this.host = host
  }

  switchTableMap(mapName: string): void {
    const mapConfig = this.host.mapManager?.getMapSystem().getMap(mapName) || TABLE_MAPS[mapName]
    if (!mapConfig) {
      console.warn(`[Game] Unknown table map: ${mapName}`)
      return
    }

    this.host.mapManager?.switchTableMap(mapName)

    const musicId = (mapConfig as { musicTrackId?: string }).musicTrackId || this.host.mapManager?.getMapSystem().inferMusicTrackId(mapName) || '1'
    if (musicId) {
      this.host.soundSystem.playMapMusic(musicId)
    }

    this.host.display?.setStoryText(`MAP: ${mapConfig.name.toUpperCase()}`)

    const levelForMap = this.host.adventureState.getAllLevels().find(l => l.mapType === mapName)
    if (levelForMap && this.host.adventureState.isMapUnlocked(mapName)) {
      this.host.adventureState.startLevel(levelForMap.id)
      if (levelForMap.story?.intro) {
        this.host.display?.setStoryText(levelForMap.story.intro)
      }
    }

    if (this.host.levelSelectScreen?.isShowing()) {
      this.host.levelSelectScreen.updateProgress()
    }

    const mapMode = mapConfig.mode || 'fixed'
    this.host.dynamicWorld?.setMode(mapMode)
    if (mapMode === 'dynamic' && mapConfig.worldLength) {
      this.host.initializeDynamicZones(mapName, mapConfig)
    }
  }

  cycleTableMap(): void {
    this.host.mapManager?.cycleTableMap()
  }

  loadCabinetPreset(type: import('./game-cabinet').CabinetType): void {
    this.host.cabinetManager?.loadCabinetPreset(type)
  }

  cycleCabinetPreset(): void {
    this.host.cabinetManager?.cycleCabinetPreset()
  }

  showMapNamePopup(name: string, color: string): void {
    this.host.uiManager?.showMapNamePopup(name, color)
  }

  showCabinetPopup(name: string): void {
    this.host.uiManager?.showCabinetPopup(name)
  }

  updateCabinetSelectorUI(): void {
    const buttons = document.querySelectorAll('.cabinet-btn')
    buttons.forEach(btn => {
      btn.classList.remove('active')
      if (btn.getAttribute('data-cabinet') === this.host.cabinetManager?.getCurrentType()) {
        btn.classList.add('active')
      }
    })
  }
}
