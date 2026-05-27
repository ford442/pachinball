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
  ArcRotateCamera,
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
  DisplayState,
  DisplaySystem,
  EffectsSystem,
  GameObjects,
  BallManager,
  ZoneTriggerSystem,
} from '../game-elements'
import { BallStackVisual } from '../game-elements/ball-stack-visual'
import { CabinetLighting } from '../effects/cabinet-lighting'
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

interface PortalActivatedEventData {
  trackId: AdventureTrackType
  kind: 'success' | 'timeout'
  mode: 'STATIONARY_TABLE' | 'EXTENDED_MAP'
}

interface PortalEnteredEventData {
  id: string
  trackId: AdventureTrackType
  nextTrack: AdventureTrackType
  kind: 'success' | 'timeout'
  position: Vector3
  teleportPosition: Vector3
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
      this.game.stateManager.setDisplaySystem(this.game.display)

      this.game.cabinetLighting = new CabinetLighting(scene, {
        enableEdgeLighting: true,
        enableUnderCabinetGlow: true,
        enableScreenBorder: false, // TODO: implement screen border
        qualityTier: this.game.qualityTier,
      })
      this.game.cabinetLighting.subscribeToEvents(this.game.eventBus)

      this.game.debugHUD = new DebugHUD({
        onVisibilityChange: (visible) => this.game.debugHelper.handleDebugHUDVisibilityChange(visible),
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
      this.game.adventureMode = new AdventureMode(scene, world, rapier)

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
      this.game.adventureCinematicSystem.setCamera(this.game.tableCam as ArcRotateCamera)
      this.game.adventureCinematicTriggers = new AdventureCinematicTriggers(this.game.adventureCinematicSystem)
      this.game.adventureCinematicTriggers.setEventBus(this.game.eventBus)
      this.game.adventureCinematicTriggers.setGoalTracker(this.game.adventureGoalTracker)

      this.game.adventureUIStateManager = new AdventureUIStateManager()
      this.game.adventureUIStateManager.setEventBus(this.game.eventBus)

      this.game.adventureTrackProgression = new AdventureTrackProgression()
      this.game.adventureProgressionSupervisor = new AdventureProgressionSupervisor(
        this.game.eventBus,
        this.game.adventureTrackProgression,
        {
          isAdventureModeActive: () => this.game.adventureMode?.isActive() ?? false,
        },
      )

      // Integration plan:
      // 1) Supervisor emits `portal:open` with track + result kind.
      // 2) AdventureMode activates a dormant physical portal sensor/mesh.
      // 3) On entry, AdventureMode teleports + switchZone and emits `portal:entered`.
      this.game.adventureMode?.setEventListener((event, data) => {
        console.log(`Adventure Event: ${event}`)
        switch (event) {
          case 'START': {
            const trackType = (data as AdventureTrackType | undefined) ?? this.game.adventureTrackProgression?.getCurrentTrack()
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
            this.game.display?.setStoryText(
              portalData.kind === 'success'
                ? `EXIT PORTAL ONLINE: ${portalData.trackId.replace(/_/g, ' ')}`
                : `EMERGENCY EXIT ONLINE: ${portalData.trackId.replace(/_/g, ' ')}`
            )
            this.game.eventBus.emit('effect:bloom', {
              intensity: portalData.kind === 'success' ? 1.35 : 1.05,
              duration: 0.65,
            })
            this.game.eventBus.emit('effect:flash', {
              color: portalData.kind === 'success' ? '#00d9ff' : '#ff4400',
              intensity: portalData.kind === 'success' ? 0.9 : 0.7,
              duration: 0.45,
            })
            break
          }
          case 'PORTAL_ENTERED': {
            const portalData = data as PortalEnteredEventData
            this.game.display?.setStoryText(`WORMHOLE JUMP: ${portalData.nextTrack.replace(/_/g, ' ')}`)
            this.game.eventBus.emit('portal:entered', {
              id: portalData.id,
              trackId: portalData.trackId,
              nextTrack: portalData.nextTrack,
              kind: portalData.kind,
              position: {
                x: portalData.position.x,
                y: portalData.position.y,
                z: portalData.position.z,
              },
              teleportPosition: {
                x: portalData.teleportPosition.x,
                y: portalData.teleportPosition.y,
                z: portalData.teleportPosition.z,
              },
            })
            break
          }
        }
      })

      this.game.eventBus.on('portal:open', ({ trackId, kind, mode }) => {
        const resolvedTrack = this.resolvePortalTrack(trackId)
        const resolvedMode = mode || (this.game.gameMode === 'dynamic' ? 'EXTENDED_MAP' : 'STATIONARY_TABLE')
        this.game.adventureMode?.activateExitPortal(resolvedTrack, kind, resolvedMode)
      })

      this.game.eventBus.on('track:completed', ({ trackId }) => {
        this.game.eventBus.emit('portal:open', {
          trackId,
          kind: 'success',
          mode: this.game.gameMode === 'dynamic' ? 'EXTENDED_MAP' : 'STATIONARY_TABLE',
        })
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
            g.updateHUD()
            g.uiManager?.showMessage(`${reason}: +${points}`, 1000)
            const pos = g.physicsController.getBallPosition()
            if (pos) g.effects?.spawnFloatingNumber(points, pos)
          },
          onAdventureEnd: () => {
            g.score += GAME_TUNING.scoring.adventureEndBonus
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

      g.cabinetManager = new CabinetManager(g.scene!, {
        onPopupShow: (name) => g.mapCabinet.showCabinetPopup(name),
        onUISelect: () => g.mapCabinet.updateCabinetSelectorUI(),
      })
    }, true)
  }
}
