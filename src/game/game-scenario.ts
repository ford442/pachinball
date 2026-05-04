/**
 * Game Scenario — Dynamic adventure mode, scenario loading, zone transitions.
 */

import { Vector3, Color3 } from '@babylonjs/core'
import type { Scene } from '@babylonjs/core'
import type { EffectsSystem } from '../effects'
import type { DisplaySystem } from '../display'
import type { BallManager } from '../game-elements/ball-manager'
import type { SoundSystem } from '../game-elements/sound-system'
import type { HapticManager } from '../game-elements/haptics'
import type { ZoneTriggerSystem } from '../game-elements/zone-trigger-system'
import type { AdventureManager } from './game-adventure'
import type { TableMapManager } from './game-maps'
import { getScenario } from '../game-elements'
import { getMaterialLibrary } from '../materials'
import { resolveVideoUrl } from './game-utils'
import { TABLE_MAPS } from '../shaders/lcd-table'
import type { DynamicScenario, ScenarioZone, WorldZone, ZoneMechanic } from '../game-elements'

declare const require: any

export interface ScenarioHost {
  readonly scene: Scene | null
  zoneTriggerSystem: ZoneTriggerSystem | null
  readonly display: DisplaySystem | null
  readonly effects: EffectsSystem | null
  readonly ballManager: BallManager | null
  readonly mapManager: TableMapManager | null
  readonly soundSystem: SoundSystem
  readonly hapticManager: HapticManager | null
  readonly adventureManager: AdventureManager | null

  cabinetNeonLights: import('@babylonjs/core').PointLight[]
  keyLight: import('@babylonjs/core').DirectionalLight | null
  rimLight: import('@babylonjs/core').DirectionalLight | null

  gameMode: 'fixed' | 'dynamic'

  switchTableMap(mapName: string): void
  handleZoneTransition(zone: import('../adventure').AdventureTrackType, previousZone: import('../adventure').AdventureTrackType | null, isMajor: boolean): void
  updateCabinetNeonForZone(baseColor: string, accentColor: string): void
}

export class GameScenario {
  private readonly host: ScenarioHost

  constructor(host: ScenarioHost) {
    this.host = host
  }

  toggleDynamicMode(): void {
    const newMode = this.host.gameMode === 'fixed' ? 'dynamic' : 'fixed'
    this.host.gameMode = newMode
    console.log(`[Game] Switched to ${newMode.toUpperCase()} mode`)
    this.showModeSwitchPopup(newMode)
    if (newMode === 'dynamic') {
      this.startDynamicMode()
    } else {
      this.stopDynamicMode()
    }
  }

  private showModeSwitchPopup(mode: 'fixed' | 'dynamic'): void {
    const existing = document.getElementById('mode-switch-popup')
    if (existing) existing.remove()
    const popup = document.createElement('div')
    popup.id = 'mode-switch-popup'
    popup.textContent = mode === 'dynamic' ? '⚡ DYNAMIC MODE' : '📍 FIXED MODE'
    popup.style.cssText = `
      position: absolute; top: 20%; left: 50%;
      transform: translate(-50%, -50%);
      font-family: 'Orbitron', sans-serif; font-size: 2rem; font-weight: 900;
      color: ${mode === 'dynamic' ? '#00ff88' : '#00d9ff'};
      text-shadow: 0 0 10px currentColor, 0 0 20px currentColor, 0 0 40px currentColor;
      pointer-events: none; z-index: 1000; opacity: 0;
      transition: opacity 0.3s ease; letter-spacing: 4px;
    `
    document.body.appendChild(popup)
    requestAnimationFrame(() => { popup.style.opacity = '1' })
    setTimeout(() => {
      popup.style.opacity = '0'
      setTimeout(() => popup.remove(), 300)
    }, 2000)
  }

  startDynamicMode(): void {
    console.log('[Game] Starting Dynamic Mode with Zone System')
    const ZT = require('../game-elements') as typeof import('../game-elements')
    this.host.zoneTriggerSystem = new ZT.ZoneTriggerSystem(false)
    const scenario = getScenario('samurai-realm')
    if (scenario) {
      this.loadScenario(scenario)
    }
    this.showZoneSystemPopup('ZONE SYSTEM ACTIVE')
  }

  stopDynamicMode(): void {
    console.log('[Game] Stopping Dynamic Mode')
    this.host.zoneTriggerSystem?.dispose()
    ;(this.host as any).zoneTriggerSystem = null
    this.host.switchTableMap('neon-helix')
  }

  loadScenario(scenario: DynamicScenario): void {
    if (!this.host.zoneTriggerSystem) return
    console.log(`[Game] Loading scenario: ${scenario.name}`)
    this.host.zoneTriggerSystem.loadScenario(scenario)
    this.host.zoneTriggerSystem.setCallback({
      onZoneEnter: (zone, fromZone, isMajor) => {
        this.handleScenarioZoneEnter(zone, fromZone, isMajor)
      },
      onZoneExit: () => {},
      onZoneProgress: () => {},
    })
    this.applyScenarioLighting(scenario.globalLighting)
    if (scenario.zones.length > 0) {
      this.applyZoneMapConfig(scenario.zones[0])
    }
    this.host.display?.showZoneStory(
      scenario.name,
      scenario.description,
      resolveVideoUrl(scenario.zones[0]?.videoUrl),
      true
    )
  }

  handleScenarioZoneEnter(zone: ScenarioZone, _fromZone: ScenarioZone | null, isMajor: boolean): void {
    console.log(`[Game] Entered zone: ${zone.name} (${isMajor ? 'MAJOR' : 'minor'})`)
    this.host.display?.showZoneStory(zone.name, zone.storyText, resolveVideoUrl(zone.videoUrl), true)
    this.applyZoneMapConfig(zone)
    if (this.host.ballManager) {
      const scenario = this.host.zoneTriggerSystem?.getAllZones()[0]?.id
        ? getScenario('samurai-realm')
        : null
      if (scenario) {
        this.host.ballManager.updateBallMaterialColor(scenario.ballTrailColor)
      }
    }
    this.host.soundSystem.playMapMusic(zone.musicTrack)
    if (isMajor) {
      this.host.effects?.addCameraShake(0.5)
      this.host.effects?.triggerScreenPulse(zone.mapConfig.baseColor, 0.8, 500)
      this.host.mapManager?.getLCDTableState().triggerFeedbackEffect()
    } else {
      this.host.effects?.addCameraShake(0.25)
      this.host.effects?.triggerScreenPulse(zone.mapConfig.baseColor, 0.4, 300)
    }
    if (isMajor && this.host.hapticManager) {
      this.host.hapticManager.jackpot()
    }
  }

  applyZoneMapConfig(zone: ScenarioZone): void {
    const config = zone.mapConfig
    if (!this.host.scene) return
    const matLib = getMaterialLibrary(this.host.scene)
    matLib.updateLCDTableEmissive(config.baseColor, config.glowIntensity)
    matLib.updateFlipperMaterialEmissive(config.baseColor)
    matLib.updatePinMaterialEmissive(config.accentColor)
    this.updateCabinetNeonForZone(config.baseColor, config.accentColor)
    this.host.mapManager?.getLCDTableState().updateFromMapConfig({
      baseColor: config.baseColor,
      accentColor: config.accentColor,
      scanlineIntensity: config.scanlineIntensity,
      glowIntensity: config.glowIntensity,
      animationSpeed: config.animationSpeed,
    })
  }

  updateCabinetNeonForZone(baseColor: string, accentColor: string): void {
    if (this.host.cabinetNeonLights.length === 0) return
    const base = Color3.FromHexString(baseColor)
    const accent = Color3.FromHexString(accentColor)
    if (this.host.cabinetNeonLights[0]) this.host.cabinetNeonLights[0].diffuse = base
    if (this.host.cabinetNeonLights[1]) this.host.cabinetNeonLights[1].diffuse = accent
    if (this.host.cabinetNeonLights[2]) this.host.cabinetNeonLights[2].diffuse = Color3.Lerp(base, accent, 0.5)
  }

  applyScenarioLighting(lighting: { ambientColor: string; keyLightColor: string; rimLightColor: string }): void {
    if (this.host.keyLight) {
      this.host.keyLight.diffuse = Color3.FromHexString(lighting.keyLightColor)
    }
    if (this.host.rimLight) {
      this.host.rimLight.diffuse = Color3.FromHexString(lighting.rimLightColor)
    }
    if (this.host.scene) {
      const hemiLight = this.host.scene.getLightByName('hemiLight') as import('@babylonjs/core').HemisphericLight
      if (hemiLight) {
        hemiLight.diffuse = Color3.FromHexString(lighting.ambientColor)
      }
    }
  }

  private showZoneSystemPopup(message: string): void {
    const existing = document.getElementById('zone-system-popup')
    if (existing) existing.remove()
    const popup = document.createElement('div')
    popup.id = 'zone-system-popup'
    popup.innerHTML = `
      <div style="font-size: 0.7rem; opacity: 0.7; margin-bottom: 4px;">DYNAMIC MODE</div>
      <div>${message}</div>
    `
    popup.style.cssText = `
      position: absolute; top: 25%; left: 50%;
      transform: translate(-50%, -50%);
      font-family: 'Orbitron', sans-serif; font-size: 1.2rem; font-weight: 700;
      color: #00ff88; text-align: center;
      text-shadow: 0 0 10px #00ff88, 0 0 20px #00ff88;
      pointer-events: none; z-index: 100; opacity: 0;
      animation: zonePopupFade 2s ease-out forwards;
      background: rgba(0, 0, 0, 0.8); padding: 16px 32px;
      border-radius: 8px; border: 1px solid #00ff88;
    `
    const style = document.createElement('style')
    style.textContent = `
      @keyframes zonePopupFade {
        0% { opacity: 0; transform: translate(-50%, -40%); }
        20% { opacity: 1; transform: translate(-50%, -50%); }
        80% { opacity: 1; transform: translate(-50%, -50%); }
        100% { opacity: 0; transform: translate(-50%, -60%); }
      }
    `
    document.head.appendChild(style)
    document.body.appendChild(popup)
    setTimeout(() => {
      popup.remove()
      style.remove()
    }, 2000)
  }

  switchScenario(scenarioId: string): void {
    const scenario = getScenario(scenarioId)
    if (scenario) {
      this.loadScenario(scenario)
      this.showScenarioSwitchPopup(scenario.name)
    }
  }

  private showScenarioSwitchPopup(name: string): void {
    const popup = document.createElement('div')
    popup.style.cssText = `
      position: absolute; top: 30%; left: 50%;
      transform: translate(-50%, -50%);
      font-family: 'Orbitron', sans-serif; font-size: 1.5rem; font-weight: 700;
      color: #ffd700; text-align: center;
      text-shadow: 0 0 10px #ffd700;
      pointer-events: none; z-index: 100;
      animation: fadeInOut 2s ease-out forwards;
    `
    popup.textContent = `SCENARIO: ${name.toUpperCase()}`
    document.body.appendChild(popup)
    setTimeout(() => popup.remove(), 2000)
  }

  cycleScenario(direction: 1 | -1 = 1): void {
    const scenarios = ['samurai-realm', 'cyber-noir', 'quantum-dream', 'movie-gangster', 'fantasy-realm']
    const currentIndex = scenarios.findIndex(id => {
      return this.host.zoneTriggerSystem?.getAllZones()[0]?.id?.startsWith(id.split('-')[0])
    })
    const nextIndex = (Math.max(0, currentIndex) + direction + scenarios.length) % scenarios.length
    this.switchScenario(scenarios[nextIndex])
  }

  initializeDynamicZones(mapName: string, mapConfig: typeof TABLE_MAPS[string]): void {
    if (!this.host.zoneTriggerSystem) return
    const worldLength = mapConfig.worldLength || 200
    const zones = this.createZonesForMap(mapName, worldLength)
    // Dynamic world initialization would go here
    console.log(`[Game] Initialized dynamic world with ${zones.length} zones`)
  }

  private createZonesForMap(mapName: string, worldLength: number): WorldZone[] {
    const zoneCount = 4
    const zoneLength = worldLength / zoneCount
    const zones: WorldZone[] = []
    for (let i = 0; i < zoneCount; i++) {
      const startZ = i * zoneLength
      const endZ = (i + 1) * zoneLength
      const hue = (i * 60) % 360
      const baseColor = `hsl(${hue}, 80%, 50%)`
      zones.push({
        id: `${mapName}-zone-${i}`,
        name: `Sector ${String.fromCharCode(65 + i)}`,
        startZ,
        endZ,
        mapType: mapName,
        mapConfig: {
          baseColor,
          accentColor: `hsl(${(hue + 30) % 360}, 80%, 70%)`,
          glowIntensity: 1.0 + i * 0.2,
        },
        storyText: `Entering Sector ${String.fromCharCode(65 + i)}...`,
        spawnMechanics: this.generateZoneMechanics(i, startZ, endZ),
      })
    }
    return zones
  }

  private generateZoneMechanics(zoneIndex: number, startZ: number, endZ: number): ZoneMechanic[] {
    const mechanics: ZoneMechanic[] = []
    const count = 3 + zoneIndex
    for (let i = 0; i < count; i++) {
      const z = startZ + (endZ - startZ) * ((i + 1) / (count + 1))
      const x = (Math.random() - 0.5) * 8
      const types: Array<'bumper' | 'target' | 'collectible'> = ['bumper', 'target', 'collectible']
      mechanics.push({
        type: types[Math.floor(Math.random() * types.length)],
        position: new Vector3(x, 0.5, -z),
      })
    }
    return mechanics
  }

  handleZoneTransition(
    zone: import('../adventure').AdventureTrackType,
    previousZone: import('../adventure').AdventureTrackType | null,
    isMajor: boolean
  ): void {
    this.host.adventureManager?.handleZoneTransition(zone, previousZone, isMajor)
    if (isMajor) {
      this.host.mapManager?.getLCDTableState().triggerFeedbackEffect()
      const ZT = require('../game-elements') as typeof import('../game-elements')
      const currentZoneConfig = ZT.getZoneConfig(zone)
      if (this.host.scene) {
        const matLib = getMaterialLibrary(this.host.scene)
        matLib.updateLCDTableEmissive(currentZoneConfig.primaryColor, currentZoneConfig.glowIntensity)
        matLib.updateFlipperMaterialEmissive(currentZoneConfig.primaryColor)
      }
    }
  }
}
