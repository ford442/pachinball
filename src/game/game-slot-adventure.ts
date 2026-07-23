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
import type { AdventureTrackProgression } from '../game-elements/adventure-track-progression'
import { TRACK_CATALOG } from '../game-elements/adventure-track-progression'
import { getTrackThemingSystem } from '../game-elements'
import type { EventBus } from './event-bus'
import type { AdventureCinematicTriggers } from '../game-elements/adventure-cinematic-triggers'
import type { AdventureUIStateManager } from '../game-elements/adventure-ui-state'
import type { AdventureGoalTracker } from '../game-elements/adventure-goal-tracker'
import type { AdventureProgressionSupervisor } from '../game-elements/adventure-progression-supervisor'
import type { PerformanceMonitor } from '../game-elements/performance-monitor'

import type { TableMapManager } from './game-maps'
import type { LevelLoader } from './level-loader'

export interface SlotAdventureHost {
  readonly display: DisplaySystem | null
  readonly effects: EffectsSystem | null
  readonly eventBus: EventBus
  readonly ballManager: BallManager | null
  readonly adventureMode: AdventureMode | null
  readonly adventureTrackProgression: AdventureTrackProgression | null
  readonly gameObjects: GameObjects | null
  readonly mapManager: TableMapManager | null
  readonly scene: Scene | null
  readonly accessibility: { reducedMotion: boolean }

  scoreElement: HTMLElement | null
  score: number

  // Optional adventure orchestration systems (populated after init)
  readonly adventureCinematicTriggers: AdventureCinematicTriggers | null
  readonly adventureCinematicSystem: import('../game-elements').AdventureCinematicSystem | null
  readonly adventureUIStateManager: AdventureUIStateManager | null
  readonly adventureGoalTracker: AdventureGoalTracker | null
  readonly adventureProgressionSupervisor: AdventureProgressionSupervisor | null
  readonly physicsController: { rebuildHandleCaches(): void } | null
  readonly levelLoader: LevelLoader | null
  readonly performanceMonitor: PerformanceMonitor | null
  readonly uiManager: { showMessage(message: string, duration?: number): void } | null

  updateHUD(): void
  getBallPosition(): import('@babylonjs/core').Vector3 | null
  triggerJackpot(): void
  setGameState(state: import('../game-elements').GameState): void
  resetBall(): void
}

export class GameSlotAdventure {
  private readonly host: SlotAdventureHost
  private nextAdventureTrack: AdventureTrackType = AdventureTrackType.NEON_HELIX
  private eventUnsubscribers: Array<() => void> = []

  private static readonly TRACK_ORDER: AdventureTrackType[] = [
    AdventureTrackType.NEON_HELIX,
    AdventureTrackType.PACHINKO_HALL,
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
    const { display, effects, eventBus } = this.host
    if (!display) return

    for (const unsub of this.eventUnsubscribers) unsub()
    this.eventUnsubscribers = []

    display.configureSlotMachine({
      enableSounds: true,
      enableLightEffects: true,
    })

    this.eventUnsubscribers.push(
      eventBus.on('slot:win', ({ points, combination }) => {
        const pos = this.host.getBallPosition()
        if (pos) effects?.spawnFloatingNumber(points, pos)
        console.log(`[Slot] Win: ${combination} — ${points} points`)
      }),

      eventBus.on('slot:jackpot', ({ points }) => {
        this.host.triggerJackpot()
        console.log(`[Slot] JACKPOT! ${points} points`)
      }),

      eventBus.on('slot:nearmiss', () => {
        if (!this.host.accessibility.reducedMotion) {
          effects?.addCameraShake(0.25)
          effects?.flashVignette('#ffd700', 400)
        }
        console.log('[Slot] Near miss!')
      })
    )
  }

  /** Attempt slot activation using the current score (REACH / FEVER hook). */
  tryActivateSlotMachine(): void {
    this.host.display?.shouldActivateSlotMachine(this.host.score)
  }

  /** Force a slot spin immediately (debug / dev tooling). */
  forceSlotSpin(): void {
    this.host.display?.startSlotSpin()
  }

  getTrackDisplayName(track: AdventureTrackType): string {
    // Prefer the human-readable name from the campaign catalog; fall back to
    // a simple underscore-to-space conversion for tracks outside the catalog
    // (extended mode tracks that are not part of the 6-stage A/B campaign).
    return TRACK_CATALOG[track]?.name ?? track.replace(/_/g, ' ')
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
    const camera = this.host.scene.activeCamera
    const bindings = this.host.gameObjects?.getBindings() || []
    const ballMesh = bindings.find(b => b.rigidBody === ballBody)?.mesh

    if (ballBody && camera) {
      const pinballMeshes = this.host.gameObjects?.getPinballMeshes() || []
      pinballMeshes.forEach(m => m.setEnabled(false))
      this.host.gameObjects?.setTableBodiesEnabled(false)

      const track = this.nextAdventureTrack
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.host.adventureMode.start(ballBody, camera, ballMesh as any, track)
      this.host.physicsController?.rebuildHandleCaches()
      this.host.adventureCinematicSystem?.setCamera(this.host.adventureMode.getFollowCamera())

      const trackName = this.getTrackDisplayName(track)
      if (this.host.scoreElement) {
        this.host.scoreElement.innerText = `HOLO-DECK: ${trackName}`
      }

      this.host.display?.setTrackInfo(trackName)
      this.host.display?.setStoryText(`SECTOR: ${trackName}`)
      getTrackThemingSystem()?.applyTheme(track)

      const currentIndex = GameSlotAdventure.TRACK_ORDER.indexOf(track)
      this.nextAdventureTrack = GameSlotAdventure.TRACK_ORDER[(currentIndex + 1) % GameSlotAdventure.TRACK_ORDER.length]
    }
  }

  /**
   * Switch to a new track while adventure mode stays live.
   *
   * This is the **single authority** for in-session track switches.  Campaign
   * state is owned exclusively by AdventureTrackProgression; AdventureMode.currentZone
   * is always set from that progression, never managed in parallel.  We deliberately
   * avoid a second "current track" field here so that progression and geometry can
   * never diverge (dual-state would require both to stay in sync on every code path,
   * which is error-prone and was the root cause of the original rebuild gap).
   *
   * Called by the onTrackAdvanced callback wired in GameSystemsInitializer, which
   * receives the next track ID straight from AdventureTrackProgression after a
   * portal entry finalises the completed track.
   */
  switchToTrack(trackId: string): void {
    if (!this.host.adventureMode || !this.host.scene) return
    if (!this.host.adventureMode.isActive()) return

    const trackType = trackId as AdventureTrackType
    if (!Object.values(AdventureTrackType).includes(trackType)) {
      console.warn(`[GameSlotAdventure] Invalid track id: ${trackId}`)
      return
    }

    this.host.performanceMonitor?.markTrackSwitch(trackId)

    // Canonical load path: LevelLoader tears down old track, applies A/B map + mode, builds new geometry.
    const loader = this.host.levelLoader
    if (loader) {
      const result = loader.loadCampaignTrack(trackId, { resetBallToPlunger: false })
      if (!result.success) {
        console.warn(`[GameSlotAdventure] Campaign track load failed: ${result.error}`)
        this.host.uiManager?.showMessage(result.error ?? 'Track load failed', 3000)
        return
      }
    } else {
      const success = this.host.adventureMode.switchToTrack(trackType)
      if (!success) {
        const detail =
          this.host.adventureMode.getLastTrackLoadError() ?? `Failed to switch to track: ${trackId}`
        this.host.uiManager?.showMessage(detail, 3000)
        return
      }
      this.host.physicsController?.rebuildHandleCaches()
      getTrackThemingSystem()?.applyTheme(trackType)
    }

    // Keep the manual-cycling cursor in sync so cycleAdventureTrack() starts
    // from the correct position after a portal jump, not a stale pre-jump value.
    const idx = GameSlotAdventure.TRACK_ORDER.indexOf(trackType)
    if (idx !== -1) {
      this.nextAdventureTrack =
        GameSlotAdventure.TRACK_ORDER[(idx + 1) % GameSlotAdventure.TRACK_ORDER.length]
    }

    const trackName = this.getTrackDisplayName(trackType)

    // Fire track-start cinematic and reset goal UI
    this.host.adventureCinematicTriggers?.onTrackStart(trackName)
    this.host.adventureUIStateManager?.reset()

    // Re-initialize goal tracking and supervisor timer for the new track.
    // startTrack() is safe here because AdventureProgressionSupervisor.reset()
    // was already called inside onPortalEntered() before onTrackAdvanced fires.
    this.host.adventureGoalTracker?.initializeTrack(trackType)
    this.host.adventureProgressionSupervisor?.startTrack(trackType, this.host.score)

    // Update HUD overlays
    if (this.host.scoreElement) {
      this.host.scoreElement.innerText = `HOLO-DECK: ${trackName}`
    }
    this.host.display?.setTrackInfo(trackName)
    this.host.display?.setStoryText(`ENTERING: ${trackName}`)
  }

  endAdventureMode(): void {
    if (!this.host.adventureMode) return
    this.host.gameObjects?.setTableBodiesEnabled(true)
    const pinballMeshes = this.host.gameObjects?.getPinballMeshes() || []
    pinballMeshes.forEach(m => m.setEnabled(true))
    this.host.adventureMode.end()
    this.host.adventureCinematicSystem?.setCamera(null)
    this.host.resetBall()
    this.host.physicsController?.rebuildHandleCaches()
    this.host.updateHUD()
  }
}
