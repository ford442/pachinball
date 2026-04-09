// src/game/game-adventure.ts
import { Vector3, Color3 } from '@babylonjs/core'
import type { Scene } from '@babylonjs/core'
import type { PhysicsSystem } from '../game-elements/physics'
import type {
  MagSpinFeeder,
  NanoLoomFeeder,
  PrismCoreFeeder,
  GaussCannonFeeder,
  QuantumTunnelFeeder,
  ZoneConfig,
  AdventureTrackType,
  EffectsSystem,
  DisplaySystem,
  BallManager,
  SoundSystem,
} from '../game-elements'
import type { GameStateManager } from './game-state'
import type { GameUIManager } from './game-ui'
import { getZoneConfig, getTransitionShakeIntensity } from '../game-elements'

export interface AdventureManagerConfig {
  onZoneEnter?: (zone: AdventureTrackType, config: ZoneConfig, isMajor: boolean) => void
  onZoneExit?: (zone: AdventureTrackType) => void
  onAdventureStart?: (trackType?: AdventureTrackType) => void
  onAdventureEnd?: () => void
  onScoreAward?: (points: number, reason: string) => void
}

export interface AdventureManagerSystems {
  effects: EffectsSystem | null
  display: DisplaySystem | null
  ballManager: BallManager | null
  soundSystem: SoundSystem
}

export class AdventureManager {
  // Core references (stored for future extensibility)
  private scene: Scene
  private physics: PhysicsSystem
  private config: AdventureManagerConfig
  private systems: AdventureManagerSystems
  private stateManager: GameStateManager
  private uiManager: GameUIManager

  private currentZone: AdventureTrackType | null = null
  private adventureActive = false
  private adventureScore = 0
  private currentLevel = 0

  // Cabinet lights reference for zone transitions
  private cabinetNeonLights: Array<{ diffuse: Color3; specular: Color3 }> = []

  // Feeder references
  private magSpinFeeder: MagSpinFeeder | null = null
  private nanoLoomFeeder: NanoLoomFeeder | null = null
  private prismCoreFeeder: PrismCoreFeeder | null = null
  private gaussCannon: GaussCannonFeeder | null = null
  private quantumTunnel: QuantumTunnelFeeder | null = null

  constructor(
    scene: Scene,
    physics: PhysicsSystem,
    stateManager: GameStateManager,
    uiManager: GameUIManager,
    systems: AdventureManagerSystems,
    config: AdventureManagerConfig = {}
  ) {
    this.scene = scene
    this.physics = physics
    this.stateManager = stateManager
    this.uiManager = uiManager
    this.systems = systems
    this.config = config
    
    // These are stored for future extensibility
    void this.scene
    void this.physics
    void this.stateManager
  }

  setFeeders(feeders: {
    magSpin?: MagSpinFeeder
    nanoLoom?: NanoLoomFeeder
    prismCore?: PrismCoreFeeder
    gaussCannon?: GaussCannonFeeder
    quantumTunnel?: QuantumTunnelFeeder
  }): void {
    this.magSpinFeeder = feeders.magSpin || null
    this.nanoLoomFeeder = feeders.nanoLoom || null
    this.prismCoreFeeder = feeders.prismCore || null
    this.gaussCannon = feeders.gaussCannon || null
    this.quantumTunnel = feeders.quantumTunnel || null
  }

  setCabinetLights(lights: Array<{ diffuse: Color3; specular: Color3 }>): void {
    this.cabinetNeonLights = lights
  }

  updateSystems(systems: Partial<AdventureManagerSystems>): void {
    this.systems = { ...this.systems, ...systems }
  }

  // ==================== ZONE MANAGEMENT ====================

  handleZoneTransition(
    zone: AdventureTrackType,
    previousZone: AdventureTrackType | null,
    isMajor: boolean
  ): void {
    if (this.currentZone === zone) return

    const oldZone = this.currentZone
    this.currentZone = zone
    const zoneConfig = getZoneConfig(zone)

    // Notify exit
    if (oldZone) {
      this.config.onZoneExit?.(oldZone)
    }

    console.log(`[AdventureManager] Zone transition: ${previousZone} -> ${zone} (${isMajor ? 'MAJOR' : 'minor'})`)

    // 1. Update backbox with zone story video and CRT effect
    this.systems.display?.showZoneStory(
      zoneConfig.name,
      zoneConfig.storyText,
      zoneConfig.videoUrl,
      true // Enable CRT effect
    )

    // 2. Update cabinet neon and interior lights
    this.updateCabinetLightingForZone(zoneConfig)

    // 3. Update ball material color
    this.systems.ballManager?.updateBallMaterialColor(zoneConfig.primaryColor)

    // 4. Cross-fade music to zone track
    this.systems.soundSystem.playMapMusic(zoneConfig.musicTrackId)

    // 5. Trigger screen pulse + cabinet shake (major transitions get stronger effects)
    const shakeIntensity = getTransitionShakeIntensity(previousZone, zone)
    const pulseColor = zoneConfig.primaryColor

    if (isMajor) {
      // Major transition: strong shake + bright pulse
      this.systems.effects?.addCameraShake(shakeIntensity)
      this.systems.effects?.triggerScreenPulse(pulseColor, 0.8, 500)
    } else {
      // Minor transition: subtle shake + gentle pulse
      this.systems.effects?.addCameraShake(shakeIntensity * 0.5)
      this.systems.effects?.triggerScreenPulse(pulseColor, 0.4, 300)
    }

    // Notify enter
    this.config.onZoneEnter?.(zone, zoneConfig, isMajor)
  }

  private updateCabinetLightingForZone(zoneConfig: ZoneConfig): void {
    if (this.cabinetNeonLights.length === 0) return

    const primaryColor = Color3.FromHexString(zoneConfig.primaryColor)
    const accentColor = Color3.FromHexString(zoneConfig.accentColor)
    const interiorColor = Color3.FromHexString(zoneConfig.interiorColor)

    // Left side = primary, Right side = accent, Under = interior
    if (this.cabinetNeonLights[0]) {
      this.cabinetNeonLights[0].diffuse = primaryColor
      this.cabinetNeonLights[0].specular = primaryColor
    }
    if (this.cabinetNeonLights[1]) {
      this.cabinetNeonLights[1].diffuse = accentColor
      this.cabinetNeonLights[1].specular = accentColor
    }
    if (this.cabinetNeonLights[2]) {
      this.cabinetNeonLights[2].diffuse = interiorColor
      this.cabinetNeonLights[2].specular = interiorColor
    }
  }

  getCurrentZone(): AdventureTrackType | null {
    return this.currentZone
  }

  // ==================== ADVENTURE MODE ====================

  startAdventure(trackType?: AdventureTrackType): void {
    this.adventureActive = true
    this.adventureScore = 0

    this.config.onAdventureStart?.(trackType)

    const trackName = trackType ? this.getTrackDisplayName(trackType) : 'ADVENTURE'
    this.uiManager.showMessage(`${trackName} MODE STARTED`, 3000)
  }

  endAdventure(): void {
    if (!this.adventureActive) return

    this.config.onAdventureEnd?.()

    // Bonus Points
    this.adventureScore += 5000
    this.config.onScoreAward?.(5000, 'Adventure Complete')

    this.uiManager.showMessage('ADVENTURE COMPLETE! +5000', 3000)

    this.adventureActive = false
    this.currentZone = null
  }

  addAdventureScore(points: number, reason?: string): void {
    if (!this.adventureActive) return
    this.adventureScore += points
    if (reason) {
      this.config.onScoreAward?.(points, reason)
    }
  }

  isAdventureActive(): boolean {
    return this.adventureActive
  }

  getAdventureScore(): number {
    return this.adventureScore
  }

  getCurrentLevel(): number {
    return this.currentLevel
  }

  // ==================== FEEDER EVENT HANDLERS ====================

  setupFeederEventHandlers(): void {
    if (!this.systems.effects || !this.systems.ballManager) return

    // Note: Feeders are created externally and passed via setFeeders
    // This method sets up the event callbacks if feeders exist

    // MagSpin feeder events
    if (this.magSpinFeeder) {
      this.magSpinFeeder.onStateChange = (state) => {
        switch (state) {
          case 1: // MagSpinState.CATCH
            this.systems.effects?.playBeep(300)
            this.config.onScoreAward?.(500, 'MagSpin Capture')
            break
          case 2: // MagSpinState.SPIN
            this.systems.effects?.playBeep(600)
            break
          case 3: // MagSpinState.RELEASE
            this.systems.effects?.playBeep(1200)
            this.systems.effects?.spawnShardBurst(this.magSpinFeeder?.getPosition() || new Vector3(0, 0, 0))
            this.systems.effects?.setBloomEnergy(2.0)
            this.config.onScoreAward?.(100, 'MagSpin Release')
            break
        }
      }
    }

    // NanoLoom feeder events
    if (this.nanoLoomFeeder) {
      this.nanoLoomFeeder.onStateChange = (state, position) => {
        switch (state) {
          case 1: // NanoLoomState.LIFT
            this.systems.effects?.playBeep(800)
            break
          case 2: // NanoLoomState.WEAVE
            this.systems.effects?.playBeep(1000)
            break
          case 3: // NanoLoomState.EJECT
            this.systems.effects?.playBeep(1200)
            if (position) {
              this.systems.effects?.spawnShardBurst(position)
            }
            this.config.onScoreAward?.(1000, 'NanoLoom Processed')
            break
        }
      }
    }

    // PrismCore feeder events
    if (this.prismCoreFeeder) {
      this.prismCoreFeeder.onStateChange = (state, count) => {
        switch (state) {
          case 1: // PrismCoreState.LOCKED_1
          case 2: // PrismCoreState.LOCKED_2
            this.systems.effects?.playBeep(1500)
            this.systems.display?.setStoryText(`CORE LOCK: ${count}/3`)
            this.systems.effects?.spawnShardBurst(this.prismCoreFeeder?.getPosition() || Vector3.Zero())
            // Spawn a replacement ball at the plunger so play continues
            this.systems.ballManager?.spawnExtraBalls(1, new Vector3(8.5, 0.5, -9)) // Plunger lane approx
            break

          case 3: // PrismCoreState.OVERLOAD
            this.systems.effects?.playBeep(2000)
            this.systems.effects?.startJackpotSequence()
            this.systems.display?.setStoryText('MULTIBALL ENGAGED')
            this.systems.effects?.addCameraShake(0.5)
            this.systems.effects?.spawnShardBurst(this.prismCoreFeeder?.getPosition() || Vector3.Zero())
            this.config.onScoreAward?.(750, 'Prism Overload')
            break
        }
      }
    }

    // GaussCannon events
    if (this.gaussCannon) {
      this.gaussCannon.onStateChange = (state) => {
        switch (state) {
          case 1: // GaussCannonState.LOAD
            this.systems.effects?.playBeep(300)
            break
          case 2: // GaussCannonState.AIM
            this.systems.effects?.playBeep(600)
            break
          case 3: // GaussCannonState.FIRE
            this.systems.effects?.playBeep(2000)
            this.systems.effects?.spawnShardBurst(this.gaussCannon?.getPosition() || Vector3.Zero())
            this.config.onScoreAward?.(500, 'Gauss Shot')
            break
        }
      }
    }

    // QuantumTunnel events
    if (this.quantumTunnel) {
      this.quantumTunnel.onStateChange = (state) => {
        switch (state) {
          case 1: // QuantumTunnelState.CAPTURE
            this.systems.effects?.playBeep(200)
            break
          case 3: // QuantumTunnelState.EJECT
            this.systems.effects?.playBeep(2000)
            this.systems.effects?.spawnShardBurst(this.quantumTunnel?.getPosition() || Vector3.Zero())
            this.config.onScoreAward?.(250, 'Quantum Jump')
            break
        }
      }
    }
  }

  // ==================== UTILITY ====================

  update(dt: number): void {
    // Update any adventure-mode specific logic
    if (this.adventureActive) {
      // Check for timeout, update progress, etc.
      // dt is available for time-based updates
      void dt
    }
  }

  dispose(): void {
    // Clean up event handlers by setting callbacks to null
    if (this.magSpinFeeder) {
      this.magSpinFeeder.onStateChange = null
    }
    if (this.nanoLoomFeeder) {
      this.nanoLoomFeeder.onStateChange = null
    }
    if (this.prismCoreFeeder) {
      this.prismCoreFeeder.onStateChange = null
    }
    if (this.gaussCannon) {
      this.gaussCannon.onStateChange = null
    }
    if (this.quantumTunnel) {
      this.quantumTunnel.onStateChange = null
    }

    // Clear references
    this.magSpinFeeder = null
    this.nanoLoomFeeder = null
    this.prismCoreFeeder = null
    this.gaussCannon = null
    this.quantumTunnel = null
  }

  private getTrackDisplayName(trackType: AdventureTrackType): string {
    const names: Record<string, string> = {
      'neon-helix': 'NEON HELIX',
      'cyber-core': 'CYBER CORE',
      'quantum-grid': 'QUANTUM GRID',
      'singularity-well': 'SINGULARITY WELL',
      'glitch-spire': 'GLITCH SPIRE',
    }
    return names[trackType] || trackType.toUpperCase().replace(/-/g, ' ')
  }
}
