/**
 * Game Systems Initializer — Staged subsystem wiring and setup.
 *
 * Extracted from game.ts to decouple initialization orchestration
 * from the main Game class.
 */

import {
  MeshBuilder,
  StandardMaterial,
  Color3,
  MirrorTexture,
  Plane,
  Vector3,
  AbstractMesh,
} from '@babylonjs/core'

import { GameConfig, GAME_TUNING } from '../config'
import { getMaterialLibrary } from '../materials'
import { adaptLegacyConfig, type DisplayConfig } from '../game-elements/display-config'
import {
  QualityTier,
  PALETTE,
  INTENSITY,
  emissive,
  DebugHUD,
  getDynamicWorld,
  AdventureMode,
  AdventureTrackType,
  AdventureGoalTracker,
  AdventureCinematicSystem,
  AdventureCinematicTriggers,
  AdventureUIStateManager,
  AdventureTrackProgression,
  AdventureProgressionSupervisor,
  initializeTrackThemingSystem,
  initializeCampaignRewardsManager,
  getScoringBreakdownManager,
  DisplayState,
  DisplaySystem,
  EffectsSystem,
  GameObjects,
  BallManager,
  ZoneTriggerSystem,
  SettingsManager,
} from '../game-elements'
import { BallStackVisual } from '../game-elements/ball-stack-visual'
import { CabinetLighting } from '../effects/cabinet-lighting'
import { CelebrationSequencer } from '../effects/celebration-sequencer'
import { CampaignRewardNotifier } from '../game-elements/campaign-reward-notifier'
import { wireCampaignLoop } from './campaign-loop-controller'
import {
  SpinnerBumperBuilder,
  BallTrapBuilder,
  LauncherBuilder,
  MovingGateBuilder,
} from '../objects'

import { AdventureManager } from './game-adventure'
import { TableMapManager } from './game-maps'
import { CabinetManager } from './game-cabinet'
import { isAdventureTrackType } from '../adventure'

import type { Game } from '../game'
import type { PachinballEventMap } from './event-bus'

interface PortalActivatedEventData {
  trackId: AdventureTrackType
  kind: 'success' | 'timeout'
  mode: 'STATIONARY_TABLE' | 'EXTENDED_MAP'
}

interface PortalEnteredEventData {
  id: string
  trackId: AdventureTrackType
  kind: 'success' | 'timeout'
  position: Vector3
}

interface PortalDeactivatedEventData {
  handle: number
}

export class GameSystemsInitializer {
  constructor(private game: Game) {}

  public async initAll(): Promise<void> {
    if (!this.game.scene) throw new Error('Scene not ready')
    const scene = this.game.scene
    const world = this.game.physics.getWorld()
    const rapier = this.game.physics.getRapier()
    if (!world || !rapier) throw new Error('Physics not ready')

    this.game.uiManager?.showLoadingState(true)
    await this.game.runCheckpointStage('scene_rendering', () => {
      const skybox = MeshBuilder.CreateBox('skybox', { size: GameConfig.visuals.skyboxSize }, scene)
      const skyboxMaterial = new StandardMaterial('skyBox', scene)
      skyboxMaterial.backFaceCulling = false
      skyboxMaterial.diffuseColor = Color3.Black()
      skyboxMaterial.specularColor = Color3.Black()
      skyboxMaterial.emissiveColor = emissive(PALETTE.AMBIENT, INTENSITY.AMBIENT)
      skybox.material = skyboxMaterial

      const mirrorSize = this.game.qualityTier === QualityTier.HIGH ? GameConfig.visuals.mirrorSizeHigh : GameConfig.visuals.mirrorSizeMedium
      this.game.mirrorTexture = new MirrorTexture('mirror', mirrorSize, scene, true)
      this.game.mirrorTexture.mirrorPlane = new Plane(0, -1, 0, -1.01)
      this.game.mirrorTexture.level = GameConfig.visuals.mirrorTextureLevel

      this.game.effects = new EffectsSystem(scene, this.game.bloomPipeline, this.game.accessibility)
      if (this.game.keyLight && this.game.rimLight && this.game.bounceLight) {
        this.game.effects.registerSceneLights(this.game.keyLight, this.game.rimLight, this.game.bounceLight)
      }
      const displayConfig: DisplayConfig = adaptLegacyConfig(GameConfig.backbox)
      this.game.display = new DisplaySystem(scene, this.game.engine, displayConfig, this.game.qualityTier, this.game.accessibility)
      this.game.display.subscribeToEvents(this.game.eventBus)
      this.game.display.setSlotScoreProvider(() => this.game.score)
      this.game.display.setEffectsSystem(this.game.effects)
      this.game.stateManager.setDisplaySystem(this.game.display)
      // Apply persisted scanline settings now that the display system exists
      const initialSettings = SettingsManager.load()
      this.game.display.setPlayerScanlineEnabled(initialSettings.scanlineEnabled)
      this.game.display.setScanlineIntensityMultiplier(initialSettings.scanlineIntensityMultiplier)

      this.game.cabinetLighting = new CabinetLighting(scene, {
        enableEdgeLighting: true,
        enableUnderCabinetGlow: true,
        enableScreenBorder: false, // TODO: implement screen border
        qualityTier: this.game.qualityTier,
      })
      this.game.cabinetLighting.subscribeToEvents(this.game.eventBus)

      this.game.eventBusLog.wire(this.game.eventBus)
      this.game.performanceMonitor.setRendererBackend(
        (window as unknown as { currentRenderer?: string }).currentRenderer ??
          (this.game.engine.getClassName().toLowerCase().includes('webgpu') ? 'webgpu' : 'webgl2'),
      )

      this.game.debugHUD = new DebugHUD({
        onVisibilityChange: (visible) => this.game.handleDebugHUDVisibilityChange(visible),
      })
      this.game.debugHUD.setUpdateCadenceHz(4)
      if (this.game.debugHUDEnabledInSettings && this.game.debugHelper.isDebugHUDAvailable()) {
        this.game.debugHUD.show()
      }

      this.game.dynamicWorld = getDynamicWorld(scene, this.game.tableCam!, this.game.display, this.game.soundSystem)
      this.game.ballStackVisual = new BallStackVisual(scene)

      this.game.adventureState.setDisplay(this.game.display)
      this.game.adventureState.onLevelCompleteCallback((level) => {
        console.log(`[Game] Level complete: ${level.name}`)
        if (level.rewards.unlockMap) {
          setTimeout(() => { this.game.mapCabinet.switchTableMap(level.rewards.unlockMap!) }, GAME_TUNING.timing.storyVideoWaitMs)
        }
      })
      this.game.adventureState.onGoalUpdateCallback((goals) => {
        const goalText = goals.map(g => `${g.description}: ${g.current}/${g.target}`).join('\n')
        this.game.display?.setStoryText(goalText)
      })

      this.game.slotAdventure.setupSlotMachineCallbacks()
      this.game.checkpointDebug.registerToggleHandler('scene_cosmetic', (enabled) => {
        if (!enabled || this.game.cosmeticSceneBuilt) return
        this.game.scheduleCosmeticSceneBuild()
      })
    })

    await this.game.runCheckpointStage('scene_gameplay', () => {
      this.game.gameObjects = new GameObjects(scene, world, rapier, GameConfig)
      this.game.ballManager = new BallManager(scene, world, rapier, this.game.gameObjects.getBindings())
      this.game.ballManager.setOnGoldBallCollected((type, points) => {
        console.log(`[Game] Gold ball collected: ${type}, points: ${points}`)
      })
      // Wire fresnel rim event subscriptions (fever:start / fever:end → gold ball rims)
      if (this.game.effects) {
        this.game.effects.setEventBus(this.game.eventBus)
        this.game.effects.setBallMeshProvider(this.game.ballManager)
      }
      this.game.adventureMode = new AdventureMode(scene, world, rapier)
      this.game.adventureMode.setAccessibilityConfig(this.game.accessibility)

      this.game.setupFeederEventHandlers()
    })

    await this.game.runCheckpointStage('scene_optional', () => {
      if (!this.game.zoneTriggerSystem) {
        this.game.zoneTriggerSystem = new ZoneTriggerSystem(this.game.debugHUDQueryEnabled)
      }

      const effectIntensity = this.game.accessibility?.effectIntensity ?? 1.0

      this.game.spinnerBuilder = new SpinnerBumperBuilder(scene, world, rapier, this.game.qualityTier)
      this.game.spinnerBuilder.setEventBus(this.game.eventBus)
      this.game.spinnerBuilder.setZoneTriggerSystem(this.game.zoneTriggerSystem)
      this.game.spinnerBuilder.setEffectIntensity(effectIntensity)

      this.game.ballTrapBuilder = new BallTrapBuilder(scene, world, rapier, this.game.qualityTier)
      this.game.ballTrapBuilder.setEventBus(this.game.eventBus)
      this.game.ballTrapBuilder.setZoneTriggerSystem(this.game.zoneTriggerSystem)
      this.game.ballTrapBuilder.setEffectIntensity(effectIntensity)

      this.game.launcherBuilder = new LauncherBuilder(scene, world, rapier, this.game.qualityTier)
      this.game.launcherBuilder.setEventBus(this.game.eventBus)
      this.game.launcherBuilder.setZoneTriggerSystem(this.game.zoneTriggerSystem)
      this.game.launcherBuilder.setEffectIntensity(effectIntensity)

      this.game.movingGateBuilder = new MovingGateBuilder(scene, world, rapier, this.game.qualityTier)
      this.game.movingGateBuilder.setEventBus(this.game.eventBus)
      this.game.movingGateBuilder.setZoneTriggerSystem(this.game.zoneTriggerSystem)
      this.game.movingGateBuilder.setEffectIntensity(effectIntensity)

      const spinner = this.game.spinnerBuilder.createSpinnerBumper(5, 10, '#00ffff', 1.0)
      this.game.spinnerVisuals.push(spinner.visual)

      const trap = this.game.ballTrapBuilder.createBallTrap(-5, 10, '#ff00ff', 1.0)
      this.game.trapStates.push(trap.state)

      const launcher = this.game.launcherBuilder.createLauncher(2, 16, '#00ff88', 1.0)
      this.game.launcherStates.push(launcher.state)

      const gate = this.game.movingGateBuilder.createMovingGate(-2, 16, '#ffaa00', 1.0, 'slide', 2.0, 1.5)
      this.game.gateStates.push(gate.state)

      // Reparent advanced obstacle visuals into the tilted playfield group so they
      // sit flush with the inclined cabinet face and cast accurate shadows.
      const playfieldGroup = this.game.playfieldGroup
      const obstacleMeshes = [
        ...spinner.bindings.map(b => b.mesh),
        ...trap.bindings.map(b => b.mesh),
        ...launcher.bindings.map(b => b.mesh),
        ...gate.bindings.map(b => b.mesh),
      ]

      if (playfieldGroup) {
        for (const mesh of obstacleMeshes) {
          if (mesh && !mesh.parent) mesh.parent = playfieldGroup
        }
      }

      const shadowGenerator = this.game.shadowGenerator
      if (shadowGenerator) {
        for (const root of obstacleMeshes) {
          if (!root) continue
          if (root instanceof AbstractMesh) {
            shadowGenerator.addShadowCaster(root, true)
          } else {
            for (const child of root.getChildMeshes()) shadowGenerator.addShadowCaster(child, false)
          }
        }
      }

      this.game.adventureGoalTracker = new AdventureGoalTracker()
      this.game.adventureGoalTracker.setEventBus(this.game.eventBus)

      this.game.adventureCinematicSystem = new AdventureCinematicSystem()
      this.game.adventureCinematicTriggers = new AdventureCinematicTriggers(this.game.adventureCinematicSystem)
      this.game.adventureCinematicTriggers.setEventBus(this.game.eventBus)
      this.game.adventureCinematicTriggers.setGoalTracker(this.game.adventureGoalTracker)

      this.game.celebrationSequencer = new CelebrationSequencer(
        this.game.eventBus,
        this.game.display,
        this.game.cabinetLighting,
        this.game.adventureCinematicTriggers
      )

      this.game.adventureUIStateManager = new AdventureUIStateManager()
      this.game.adventureUIStateManager.setEventBus(this.game.eventBus)

      this.game.adventureTrackProgression = new AdventureTrackProgression()
      this.game.adventureProgressionSupervisor = new AdventureProgressionSupervisor(
        this.game.eventBus,
        this.game.adventureTrackProgression,
        {
          // Pause the supervisor when the game is paused or over so phantom
          // timeouts cannot fire while the game is not in the PLAYING state.
          isAdventureModeActive: () =>
            (this.game.adventureMode?.isActive() ?? false) &&
            this.game.stateManager.isPlaying(),
          // When the campaign advances to the next track, tear down the old
          // playfield and build the new one via the slot-adventure orchestrator.
          // switchToTrack() calls rebuildHandleCaches() internally; do NOT call
          // it again here — a double rebuild mid-frame corrupts handle ordering.
          onTrackAdvanced: (nextTrackId) => {
            if (nextTrackId) {
              this.game.slotAdventure.switchToTrack(nextTrackId)
            }
          },
        },
      )
      const campaignRewards = initializeCampaignRewardsManager(this.game.adventureTrackProgression, this.game.eventBus)
      campaignRewards.configureAppliers({
        applyBallSkin: (skinId) => this.game.ballManager?.applyBallSkin(skinId),
        applyCabinetTheme: (themeId) => this.game.cabinetBuilder.applyCampaignCabinetTheme(themeId),
        applyBackboxTint: (_tintId) => {
          // Future-proof hook for a dedicated backbox tint pipeline.
        },
      })
      campaignRewards.applyEquippedRewards()

      wireCampaignLoop(this.game, this.game.eventBus, campaignRewards)

      const notifier = new CampaignRewardNotifier(this.game.eventBus)
      notifier.flushUnseen()

      // Integration plan:
      // 1) Supervisor emits `portal:open` with track + result kind.
      // 2) AdventureMode activates a dormant physical portal sensor/mesh.
      // 3) On entry, AdventureMode teleports + switchZone and emits `portal:entered`.
      this.game.adventureMode?.setEventListener((event, data) => {
        console.log(`Adventure Event: ${event}`)
        switch (event) {
          case 'START': {
            const currentTrack = this.game.adventureTrackProgression?.getCurrentTrack()
            const fallbackTrackType = currentTrack && isAdventureTrackType(currentTrack) ? currentTrack : undefined
            const trackType = (data as AdventureTrackType | undefined) ?? fallbackTrackType
            this.game.adventureManager?.startAdventure(trackType)
            this.game.eventBus.emit('adventure:start')
            this.game.eventBus.emit('display:set', DisplayState.ADVENTURE)
            const trackName = trackType ? this.game.slotAdventure.getTrackDisplayName(trackType) : 'UNKNOWN SECTOR'
            this.game.display?.setTrackInfo(trackName)
            this.game.display?.setStoryText(`ENTERING: ${trackName}`)
            this.game.effects?.setLightingMode('reach', 0.5)
            this.game.effects?.setAtmosphereState('ADVENTURE')
            if (trackType) {
              this.game.adventureTrackProgression?.setCurrentTrack(trackType)
              this.game.adventureGoalTracker?.initializeTrack(trackType)
              this.game.adventureProgressionSupervisor?.startTrack(trackType, this.game.score)
            }
            break
          }
          case 'END':
            this.game.adventureManager?.endAdventure()
            this.game.eventBus.emit('adventure:end')
            this.game.eventBus.emit('display:set', DisplayState.IDLE)
            this.game.effects?.setLightingMode('normal', 1.0)
            this.game.effects?.setAtmosphereState('IDLE')
            this.game.adventureProgressionSupervisor?.reset()
            break
          case 'ZONE_ENTER': {
            const zoneData = data as {
              zone: AdventureTrackType
              previousZone: AdventureTrackType | null
              isMajor: boolean
              ballPosition?: Vector3
            }
            this.game.scenarioManager.handleZoneTransition(zoneData.zone, zoneData.previousZone, zoneData.isMajor)
            break
          }
          case 'PORTAL_ACTIVATED': {
            const portalData = data as PortalActivatedEventData
            const shouldUseFlashes = this.shouldUseFlashEffects()
            this.game.display?.setStoryText(
              portalData.kind === 'success'
                ? `EXIT PORTAL ONLINE: ${portalData.trackId.replace(/_/g, ' ')}`
                : `EMERGENCY EXIT ONLINE: ${portalData.trackId.replace(/_/g, ' ')}`
            )
            this.game.eventBus.emit('effect:bloom', {
              intensity: portalData.kind === 'success' ? 1.35 : 1.05,
              duration: 0.65,
            })
            if (shouldUseFlashes) {
              this.game.eventBus.emit('effect:flash', {
                color: portalData.kind === 'success' ? '#00d9ff' : '#ff4400',
                intensity: portalData.kind === 'success' ? 0.9 : 0.7,
                duration: 0.45,
              })
            }
            this.game.eventBus.emit('sound:play', {
              soundKey: portalData.kind === 'success' ? 'portal-open-success' : 'portal-open-timeout',
            })
            break
          }
          case 'PORTAL_ENTERED': {
            const portalData = data as PortalEnteredEventData
            this.game.display?.setStoryText(`WORMHOLE JUMP: ${portalData.trackId.replace(/_/g, ' ')}`)
            this.game.eventBus.emit('sound:play', { soundKey: 'portal-enter' })
            // Finalize the completed track through the supervisor.
            // The supervisor's onTrackAdvanced callback (wired above) will drive
            // teardown of the old track, build of the new track, cinematic start,
            // and UI reset via slotAdventure.switchToTrack().
            //
            // Portal sensor unregistration is handled by the PORTAL_DEACTIVATED
            // case below.  During the onPortalEntered() call chain, switchToTrack()
            // → adventureMode.switchToTrack() → deactivateExitPortal() fires
            // PORTAL_DEACTIVATED with the valid handle.  Calling getPortalSensorHandle()
            // here would already return -1 (portal nulled mid-chain), so a second
            // unregisterPortalSensor call would always be a no-op.
            this.game.adventureProgressionSupervisor?.onPortalEntered(
              this.game.score,
              this.game.sessionGoldBalls,
              {
                id: portalData.id,
                position: portalData.position,
              },
            )
            break
          }
          case 'PORTAL_DEACTIVATED': {
            const portalData = data as PortalDeactivatedEventData
            this.game.physicsController?.unregisterPortalSensor(portalData.handle)
            break
          }
        }
      })

      this.game.eventBus.on('portal:open', (payload) => this.handlePortalOpen(payload))

      // Note: 'track:completed' is emitted by the supervisor inside onPortalEntered().
      // The old subscription that re-emitted 'portal:open' here was removed because
      // the supervisor already emits 'portal:open' via resolveOutcome() when the score
      // goal is hit — reactivating the portal after entry would be incorrect.
      this.game.eventBus.on('track:completed', ({ totalReward }) => {
        const scoringBreakdown = getScoringBreakdownManager()
        const rewardResult = campaignRewards.applyTrackReward(totalReward)
        this.game.uiManager?.showRewardToast(
          totalReward,
          rewardResult.totalShards,
          rewardResult.newlyUnlocked.map((reward) => reward.name),
        )
        const bestDelta = Math.max(0, this.game.score - this.game.bestScore)
        this.game.uiManager?.showScoringBreakdown(scoringBreakdown.getSnapshot(), {
          finalScore: this.game.score,
          bestScore: this.game.bestScore,
          bestDelta,
          rewardShards: totalReward,
          autoDismissMs: 6000,
        })
        scoringBreakdown.reset()
      })

      // Hide countdown when adventure ends cleanly (END event resets supervisor)
      this.game.eventBus.on('adventure:end', () => {
        this.game.uiManager?.hideCountdownTimer()
        this.game.uiManager?.hidePortalOverlay()
      })

      // Reset the supervisor on game over so the timer cannot keep running in the
      // background and stale track state cannot leak into the next game session.
      this.game.eventBus.on('game:over', () => {
        this.game.adventureProgressionSupervisor?.reset()
        this.game.uiManager?.hideCountdownTimer()
        this.game.uiManager?.hidePortalOverlay()
      })
    }, true)

    await this.game.runCheckpointStage('scene_critical', () => {
      this.game.sceneBuilder.buildCriticalScene()
      this.game.cabinetBuilder.updateCabinetLightExclusions()
    })
    this.game.ready = true
    this.game.uiManager?.showLoadingState(false, 'gameplay')

    await this.game.runCheckpointStage('scene_gameplay_build', async () => {
      await this.game.sceneBuilder.yieldFrame()
      this.game.sceneBuilder.buildGameplayScene()
      this.game.physicsController.rebuildHandleCaches()
      this.game.uiManager?.showLoadingState(false, 'cosmetic')
    })
    this.game.scheduleCosmeticSceneBuild()
  }

  /**
   * Handles the `portal:open` event: activates the exit portal sensor and
   * drives the portal overlay/display state. If `AdventureMode.activateExitPortal()`
   * fails (e.g. adventure mode is no longer active), no sensor is registered and
   * no portal UI/display change occurs — `portal:activation-failed` is emitted
   * so the supervisor can re-attempt on the next tick.
   */
  public handlePortalOpen({ trackId, kind, mode }: PachinballEventMap['portal:open']): void {
    const resolvedTrack = this.resolvePortalTrack(trackId)
    const resolvedMode = mode || (this.game.gameMode === 'dynamic' ? 'EXTENDED_MAP' : 'STATIONARY_TABLE')
    const shouldUseFlashes = this.shouldUseFlashEffects()
    const ok = this.game.adventureMode?.activateExitPortal(resolvedTrack, kind, resolvedMode) ?? false
    if (!ok) {
      console.warn('[portal:open] activation failed', { trackId, kind, mode })
      this.game.uiManager?.showMessage('Portal failed — retrying...', 2000)
      this.game.eventBus.emit('portal:activation-failed', { trackId, kind, mode })
      return
    }
    // Register the portal sensor handle so the collision dispatcher skips it.
    // Portal contact is detected via intersectionPair queries; Rapier collision
    // events for the sensor body must not reach other handlers.
    const openedHandle = this.game.adventureMode?.getPortalSensorHandle() ?? -1
    if (openedHandle >= 0) {
      this.game.physicsController?.registerPortalSensor(openedHandle)
    }
    // Show the portal overlay on the HUD
    this.game.uiManager?.showPortalOverlay(kind, trackId)
    // The countdown timer is no longer needed once the portal is open
    this.game.uiManager?.hideCountdownTimer()
    // Backbox display: dramatic portal announcement + state switch
    if (kind === 'success') {
      this.game.display?.setStoryText('PORTAL OPEN\nSHOOT TO ADVANCE')
      this.game.eventBus.emit('display:set', DisplayState.PORTAL_OPEN)
      this.game.uiManager?.showMessage('Portal open — advance now!', 2000)
    } else {
      this.game.display?.setStoryText('TIME OUT — EMERGENCY ESCAPE\nREWARD PENALTY ACTIVE')
      this.game.eventBus.emit('display:set', DisplayState.ESCAPE)
      this.game.uiManager?.showMessage('Time out! Enter the portal to continue (reduced rewards).', 2400)
    }
    if (shouldUseFlashes) {
      this.game.display?.triggerCRTFlash()
    }
  }

  private resolvePortalTrack(trackId: string): AdventureTrackType {
    if (isAdventureTrackType(trackId)) {
      return trackId
    }

    const activeZone = this.game.adventureMode?.getCurrentZone()
    if (activeZone && isAdventureTrackType(activeZone)) {
      return activeZone
    }

    return AdventureTrackType.NEON_HELIX
  }

  private shouldUseFlashEffects(): boolean {
    // Gate rapid flash effects behind both reduced-motion and safety threshold
    // preferences so portal transitions stay accessible.
    return !this.game.accessibility.reducedMotion && this.game.accessibility.flashFrequencyMax > 1
  }

  public async postInitManagers(): Promise<void> {
    const g = this.game

    await g.runCheckpointStage('managers_postinit', () => {
      g.adventureManager = new AdventureManager(
        g.scene!,
        g.physics,
        g.stateManager,
        g.uiManager!,
        {
          effects: g.effects,
          display: g.display,
          ballManager: g.ballManager,
          soundSystem: g.soundSystem,
        },
        {
          onZoneEnter: (_zone, config, isMajor) => {
            g.effects?.updateEnvironmentColor?.(config.primaryColor)
            if (isMajor && g.hapticManager) {
              g.hapticManager.jackpot()
            }
          },
          onScoreAward: (points, reason) => {
            g.score += points
            getScoringBreakdownManager().recordScore(points, 'adventure-goal-award')
            g.updateHUD()
            g.uiManager?.showMessage(`${reason}: +${points}`, 1000)
            const pos = g.physicsController.getBallPosition()
            if (pos) g.effects?.spawnFloatingNumber(points, pos)
          },
          onReachTriggered: () => g.tryActivateSlotMachine(),
          onAdventureEnd: () => {
            g.score += GAME_TUNING.scoring.adventureEndBonus
            getScoringBreakdownManager().recordScore(GAME_TUNING.scoring.adventureEndBonus, 'adventure-end-bonus')
            g.updateHUD()
            g.effects?.startJackpotSequence()
            const pos = g.physicsController.getBallPosition()
            if (pos) g.effects?.spawnFloatingNumber(GAME_TUNING.scoring.adventureEndBonus, pos)
          },
        }
      )

      g.mapManager = new TableMapManager(g.scene!, {
        onMapChange: (_type, config) => {
          g.ballManager?.updateBallMaterialColor(config.baseColor)
          const matLib = getMaterialLibrary(g.scene!)
          matLib.updateFlipperMaterialEmissive(config.baseColor)
          matLib.updatePinMaterialEmissive(config.baseColor)
          matLib.updateBrushedMetalMaterialEmissive(config.baseColor)
          matLib.updateChromeMaterialEmissive(config.baseColor)
          g.gameObjects?.updateBumperColors(config.baseColor)
          g.effects?.setCabinetColor(config.baseColor)
          g.cabinetBuilder.updateCabinetLightingForMap()
        },
        onPopupShow: (name, color) => g.mapCabinet.showMapNamePopup(name, color),
        onMapSelectorUpdate: () => g.settingsUI.updateMapSelectorUI(),
      })
      g.mapManager.setBloomPipeline()

      g.levelLoader = g.createLevelLoader()

      const trackThemingSystem = initializeTrackThemingSystem({
        gameObjects: g.gameObjects,
        ballManager: g.ballManager,
        spinnerVisuals: g.spinnerVisuals,
        gateStates: g.gateStates,
        cabinetNeonLights: g.cabinetNeonLights,
        display: g.display,
        effects: g.effects,
        mapManager: g.mapManager,
        qualityTier: g.qualityTier,
        scene: g.scene!,
        adventureMode: g.adventureMode,
      })
      g.scene?.onBeforeRenderObservable.add(() => {
        const activeTrack = g.adventureMode?.getCurrentZone() ?? null
        trackThemingSystem.update(activeTrack)
      })

      g.cabinetManager = new CabinetManager(g.scene!, {
        onPopupShow: (name) => g.mapCabinet.showCabinetPopup(name),
        onUISelect: () => g.mapCabinet.updateCabinetSelectorUI(),
      })

      g.wireFeederEventHandlers()
    }, true)
  }
}
