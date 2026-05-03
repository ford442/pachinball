/**
 * Game Slot & Adventure — Slot machine callbacks and legacy adventure track cycling.
 */

import type { Scene } from '@babylonjs/core'
import type { EffectsSystem } from '../effects'
import type { DisplaySystem } from '../display'
import type { BallManager } from '../game-elements/ball-manager'
import type { GameObjects } from '../objects'
import type { AdventureMode } from '../adventure'
import { AdventureTrackType } from '../adventure'
import type { EventBus } from './event-bus'
import { DisplayState } from '../game-elements'
import { GAME_TUNING } from '../config'
import type { TableMapManager } from './game-maps'

export interface SlotAdventureHost {
  readonly display: DisplaySystem | null
  readonly effects: EffectsSystem | null
  readonly eventBus: EventBus
  readonly ballManager: BallManager | null
  readonly adventureMode: AdventureMode | null
  readonly gameObjects: GameObjects | null
  readonly mapManager: TableMapManager | null
  readonly scene: Scene | null

  scoreElement: HTMLElement | null
  score: number

  updateHUD(): void
  getBallPosition(): import('@babylonjs/core').Vector3 | null
  triggerJackpot(): void
  setGameState(state: import('../game-elements').GameState): void
  resetBall(): void
}

export class GameSlotAdventure {
  private readonly host: SlotAdventureHost
  private nextAdventureTrack: AdventureTrackType = AdventureTrackType.NEON_HELIX

  private static readonly TRACK_ORDER: AdventureTrackType[] = [
    AdventureTrackType.NEON_HELIX,
    AdventureTrackType.CYBER_CORE,
    AdventureTrackType.QUANTUM_GRID,
    AdventureTrackType.SINGULARITY_WELL,
    AdventureTrackType.GLITCH_SPIRE,
    AdventureTrackType.RETRO_WAVE_HILLS,
    AdventureTrackType.CHRONO_CORE,
    AdventureTrackType.HYPER_DRIFT,
    AdventureTrackType.PACHINKO_SPIRE,
    AdventureTrackType.ORBITAL_JUNKYARD,
    AdventureTrackType.FIREWALL_BREACH,
    AdventureTrackType.CPU_CORE,
    AdventureTrackType.CRYO_CHAMBER,
    AdventureTrackType.BIO_HAZARD_LAB,
    AdventureTrackType.GRAVITY_FORGE,
    AdventureTrackType.TIDAL_NEXUS,
    AdventureTrackType.DIGITAL_ZEN_GARDEN,
    AdventureTrackType.SYNTHWAVE_SURF,
    AdventureTrackType.SOLAR_FLARE,
    AdventureTrackType.PRISM_PATHWAY,
    AdventureTrackType.MAGNETIC_STORAGE,
    AdventureTrackType.NEURAL_NETWORK,
    AdventureTrackType.NEON_STRONGHOLD,
    AdventureTrackType.CASINO_HEIST,
    AdventureTrackType.TESLA_TOWER,
    AdventureTrackType.NEON_SKYLINE,
    AdventureTrackType.POLYCHROME_VOID,
  ]

  constructor(host: SlotAdventureHost) {
    this.host = host
  }

  setupSlotMachineCallbacks(): void {
    const { display, effects, score, mapManager } = this.host
    if (!display) return

    display.configureSlotMachine({
      activationMode: 'hybrid' as import('../game-elements/types').SlotActivationMode,
      chancePercent: 0.3,
      scoreThreshold: 10000,
      enableSounds: true,
      enableLightEffects: true,
    })

    display.setSlotEventCallback((event, data) => {
      switch (event) {
        case 'spin-start':
          effects?.playSlotSpinStart()
          effects?.setSlotLightingMode('spin')
          console.log('[Slot] Spin started:', data)
          break
        case 'reel-stop': {
          const reelData = data as { reel: number; symbol: string }
          effects?.playReelStop(reelData.reel)
          if (reelData.reel === 2) {
            effects?.setSlotLightingMode('stop')
          }
          break
        }
        case 'win': {
          const winData = data as { combination: { name: string; multiplier: number }; score: number }
          effects?.playSlotWin(winData.combination.multiplier)
          effects?.setSlotLightingMode('win')
          this.host.score += winData.score
          this.host.updateHUD()
          const pos = this.host.getBallPosition()
          if (pos) effects?.spawnFloatingNumber(winData.score, pos)
          console.log(`[Slot] Win: ${winData.combination.name} - ${winData.score} points`)
          break
        }
        case 'jackpot': {
          const jackpotData = data as { combination: { name: string }; score: number }
          effects?.playSlotJackpot()
          effects?.setSlotLightingMode('jackpot')
          this.host.triggerJackpot()
          console.log(`[Slot] JACKPOT! ${jackpotData.score} points`)
          break
        }
        case 'near-miss':
          effects?.playNearMiss()
          console.log('[Slot] Near miss!')
          break
        case 'activation-chance':
          console.log('[Slot] Activated:', data)
          break
        case 'activation-denied':
          console.log('[Slot] Activation denied:', data)
          break
      }
    })
  }

  tryActivateSlotMachine(): void {
    if (!this.host.display) return
    if (this.host.display.shouldActivateSlotMachine(this.host.score)) {
      this.host.display.startSlotSpin()
    }
  }

  getTrackDisplayName(track: AdventureTrackType): string {
    return track.replace(/_/g, ' ')
  }

  cycleAdventureTrack(direction: number): void {
    if (!this.host.adventureMode?.isActive()) return
    const currentIndex = GameSlotAdventure.TRACK_ORDER.indexOf(this.nextAdventureTrack)
    const prevIndex = (currentIndex - 1 + GameSlotAdventure.TRACK_ORDER.length) % GameSlotAdventure.TRACK_ORDER.length
    const newIndex = (prevIndex + direction + GameSlotAdventure.TRACK_ORDER.length) % GameSlotAdventure.TRACK_ORDER.length
    const newTrack = GameSlotAdventure.TRACK_ORDER[newIndex]
    this.nextAdventureTrack = newTrack
    this.endAdventureMode()
    this.startAdventureMode()
  }

  startAdventureMode(): void {
    if (!this.host.adventureMode || !this.host.scene) return
    const ballBody = this.host.ballManager?.getBallBody()
    const camera = this.host.scene.activeCamera as import('@babylonjs/core').ArcRotateCamera
    const bindings = this.host.gameObjects?.getBindings() || []
    const ballMesh = bindings.find(b => b.rigidBody === ballBody)?.mesh

    if (ballBody && camera) {
      const pinballMeshes = this.host.gameObjects?.getPinballMeshes() || []
      pinballMeshes.forEach(m => m.setEnabled(false))

      const track = this.nextAdventureTrack
      this.host.adventureMode.start(ballBody, camera, ballMesh as any, track)

      const trackName = this.getTrackDisplayName(track)
      if (this.host.scoreElement) {
        this.host.scoreElement.innerText = `HOLO-DECK: ${trackName}`
      }

      this.host.display?.setTrackInfo(trackName)
      this.host.display?.setStoryText(`SECTOR: ${trackName}`)

      const currentIndex = GameSlotAdventure.TRACK_ORDER.indexOf(track)
      this.nextAdventureTrack = GameSlotAdventure.TRACK_ORDER[(currentIndex + 1) % GameSlotAdventure.TRACK_ORDER.length]
    }
  }

  endAdventureMode(): void {
    if (!this.host.adventureMode) return
    const pinballMeshes = this.host.gameObjects?.getPinballMeshes() || []
    pinballMeshes.forEach(m => m.setEnabled(true))
    this.host.adventureMode.end()
    this.host.resetBall()
    this.host.updateHUD()
  }
}
