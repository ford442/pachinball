import { Game } from "./index"
import { MeshBuilder, StandardMaterial, Color3, MirrorTexture, Plane, Vector3 } from "@babylonjs/core"
import { EffectsSystem } from "../game-elements/effects-system"
import { DisplaySystem, DisplayConfig, DisplayState } from "../game-elements/display-system"
import { CabinetLighting } from "../game-elements/cabinet-lighting"
import { DebugHUD } from "../game-elements/debug-hud"
import { BallStackVisual } from "../game-elements/ball-stack-visual"
import { GameObjects } from "../objects"
import { BallManager } from "../game-elements/ball-manager"
import { AdventureMode } from "../game-elements/adventure-mode"
import { SpinnerBumperBuilder } from "../objects/builders/builder-spinner-bumper"
import { BallTrapBuilder } from "../objects/builders/builder-ball-trap"
import { LauncherBuilder } from "../objects/builders/builder-launcher"
import { MovingGateBuilder } from "../objects/builders/builder-moving-gate"
import { AdventureGoalTracker } from "../game-elements/adventure-goal-tracker"
import { AdventureCinematicSystem } from "../game-elements/adventure-cinematic-system"
import { AdventureCinematicTriggers } from "../game-elements/adventure-cinematic-triggers"
import { AdventureUIStateManager } from "../game-elements/adventure-ui-state-manager"
import { AdventureTrackProgression } from "../game-elements/adventure-track-progression"
import { ZoneTriggerSystem } from "../systems/zone-trigger-system"
import { getDynamicWorld } from "../world/dynamic-world"
import { adaptLegacyConfig } from "../utils/config-adapter"
import { GameConfig } from "../config"
import { PALETTE, INTENSITY, emissive } from "../game-elements/visual-language"
import { QualityTier } from "../types"
import type { AdventureTrackType } from "../game-elements/adventure-state"

export class GameSystemsInitializer {
  constructor(private game: Game) {}

  public async initAll(): Promise<void> {
    if (!this.game.scene) throw new Error("Scene not ready")
    const scene = this.game.scene
    const world = this.game.physics.getWorld()
    const rapier = this.game.physics.getRapier()
    if (!world || !rapier) throw new Error("Physics not ready")

    this.game.uiManager?.showLoadingState(true)

    await this.initCoreSystems(scene)
    await this.initGameplaySystems(scene, world, rapier)
    await this.initOptionalSystems(scene, world, rapier)
    await this.initCriticalSystems()
    await this.initPostProcess()
    await this.initGameplayBuild()
  }

  private async initCoreSystems(scene: any): Promise<void> {
    await this.game.runCheckpointStage("scene_rendering", () => {
      const skybox = MeshBuilder.CreateBox("skybox", { size: GameConfig.visuals.skyboxSize }, scene)
      const skyboxMaterial = new StandardMaterial("skyBox", scene)
      skyboxMaterial.backFaceCulling = false
      skyboxMaterial.diffuseColor = Color3.Black()
      skyboxMaterial.specularColor = Color3.Black()
      skyboxMaterial.emissiveColor = emissive(PALETTE.AMBIENT, INTENSITY.AMBIENT)
      skybox.material = skyboxMaterial

      const mirrorSize = this.game.qualityTier === QualityTier.HIGH
        ? GameConfig.visuals.mirrorSizeHigh
        : GameConfig.visuals.mirrorSizeMedium
      this.game.mirrorTexture = new MirrorTexture("mirror", mirrorSize, scene, true)
      this.game.mirrorTexture.mirrorPlane = new Plane(0, -1, 0, -1.01)
      this.game.mirrorTexture.level = GameConfig.visuals.mirrorTextureLevel

      this.game.effects = new EffectsSystem(scene, this.game.bloomPipeline, this.game.accessibility)
      if (this.game.keyLight && this.game.rimLight && this.game.bounceLight) {
        this.game.effects.registerSceneLights(this.game.keyLight, this.game.rimLight, this.game.bounceLight)
      }
      const displayConfig: DisplayConfig = adaptLegacyConfig(GameConfig.backbox)
      this.game.display = new DisplaySystem(scene, this.game.engine, displayConfig, this.game.qualityTier, this.game.accessibility)
      this.game.display.subscribeToEvents(this.game.eventBus)
      this.game.crtPresetManager.setDisplay(this.game.display)
      this.game.stateManager.setDisplaySystem(this.game.display)

      this.game.cabinetLighting = new CabinetLighting(scene, {
        enableEdgeLighting: true,
        enableUnderCabinetGlow: true,
        enableScreenBorder: false,
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
        console.log("[Game] Level complete: " + level.name)
        if (level.rewards.unlockMap) {
          setTimeout(() => { this.game.mapCabinet.switchTableMap(level.rewards.unlockMap!) }, 2000)
        }
      })
      this.game.adventureState.onGoalUpdateCallback((goals) => {
        const goalText = goals.map(g => g.description + ": " + g.current + "/" + g.target).join("\n")
        this.game.display?.setStoryText(goalText)
      })

      this.game.slotAdventure.setupSlotMachineCallbacks()
      this.game.checkpointDebug.registerToggleHandler("scene_lcd_post", (enabled) => {
        if (enabled) {
          this.game.initLCDTablePostProcess()
          return
        }
        this.game.lcdTablePostProcess?.dispose()
        this.game.lcdTablePostProcess = null
      })
      this.game.checkpointDebug.registerToggleHandler("scene_cosmetic", (enabled) => {
        if (!enabled || this.game.cosmeticSceneBuilt) return
        this.game.scheduleCosmeticSceneBuild()
      })
    })
  }

  private async initGameplaySystems(scene: any, world: any, rapier: any): Promise<void> {
    await this.game.runCheckpointStage("scene_gameplay", () => {
      this.game.gameObjects = new GameObjects(scene, world, rapier, GameConfig)
      this.game.ballManager = new BallManager(scene, world, rapier, this.game.gameObjects.getBindings())
      this.game.ballManager.setOnGoldBallCollected((type, points) => {
        console.log("[Game] Gold ball collected: " + type + ", points: " + points)
      })
      this.game.adventureMode = new AdventureMode(scene, world, rapier)

      this.game.setupFeederEventHandlers()
    })
  }

  private async initOptionalSystems(scene: any, world: any, rapier: any): Promise<void> {
    await this.game.runCheckpointStage("scene_optional", () => {
      if (!this.game.zoneTriggerSystem) {
        this.game.zoneTriggerSystem = new ZoneTriggerSystem(this.game.debugHUDQueryEnabled)
      }

      this.game.spinnerBuilder = new SpinnerBumperBuilder(scene, world, rapier, this.game.qualityTier)
      this.game.spinnerBuilder.setEventBus(this.game.eventBus)
      this.game.spinnerBuilder.setZoneTriggerSystem(this.game.zoneTriggerSystem)

      this.game.ballTrapBuilder = new BallTrapBuilder(scene, world, rapier, this.game.qualityTier)
      this.game.ballTrapBuilder.setEventBus(this.game.eventBus)
      this.game.ballTrapBuilder.setZoneTriggerSystem(this.game.zoneTriggerSystem)

      this.game.launcherBuilder = new LauncherBuilder(scene, world, rapier, this.game.qualityTier)
      this.game.launcherBuilder.setEventBus(this.game.eventBus)
      this.game.launcherBuilder.setZoneTriggerSystem(this.game.zoneTriggerSystem)

      this.game.movingGateBuilder = new MovingGateBuilder(scene, world, rapier, this.game.qualityTier)
      this.game.movingGateBuilder.setEventBus(this.game.eventBus)
      this.game.movingGateBuilder.setZoneTriggerSystem(this.game.zoneTriggerSystem)

      const spinner = this.game.spinnerBuilder.createSpinnerBumper(5, 10, "#00ffff", 1.0)
      this.game.spinnerVisuals.push(spinner.visual)

      const trap = this.game.ballTrapBuilder.createBallTrap(-5, 10, "#ff00ff", 1.0)
      this.game.trapStates.push(trap.state)

      const launcher = this.game.launcherBuilder.createLauncher(2, 16, "#00ff88", 1.0)
      this.game.launcherStates.push(launcher.state)

      const gate = this.game.movingGateBuilder.createMovingGate(-2, 16, "#ffaa00", 1.0, "slide", 2.0, 1.5)
      this.game.gateStates.push(gate.state)

      this.game.adventureGoalTracker = new AdventureGoalTracker()
      this.game.adventureGoalTracker.setEventBus(this.game.eventBus)

      this.game.adventureCinematicSystem = new AdventureCinematicSystem()
      this.game.adventureCinematicSystem.setCamera(this.game.tableCam!)
      this.game.adventureCinematicTriggers = new AdventureCinematicTriggers(this.game.adventureCinematicSystem)
      this.game.adventureCinematicTriggers.setEventBus(this.game.eventBus)
      this.game.adventureCinematicTriggers.setGoalTracker(this.game.adventureGoalTracker)

      this.game.adventureUIStateManager = new AdventureUIStateManager()
      this.game.adventureUIStateManager.setEventBus(this.game.eventBus)

      this.game.adventureTrackProgression = new AdventureTrackProgression()

      this.wireAdventureEvents()
    })
  }

  private wireAdventureEvents(): void {
    this.game.adventureMode?.setEventListener((event, data) => {
      console.log("Adventure Event: " + event)
      switch (event) {
        case "START": {
          const trackType = data as AdventureTrackType | undefined
          this.game.adventureManager?.startAdventure(trackType)
          this.game.eventBus.emit("adventure:start")
          this.game.eventBus.emit("display:set", DisplayState.ADVENTURE)
          const trackName = trackType ? this.game.slotAdventure.getTrackDisplayName(trackType) : "UNKNOWN SECTOR"
          this.game.display?.setTrackInfo(trackName)
          this.game.display?.setStoryText("ENTERING: " + trackName)
          this.game.effects?.setLightingMode("reach", 0.5)
          this.game.effects?.setAtmosphereState("ADVENTURE")
          break
        }
        case "END":
          this.game.adventureManager?.endAdventure()
          this.game.eventBus.emit("adventure:end")
          this.game.eventBus.emit("display:set", DisplayState.IDLE)
          this.game.effects?.setLightingMode("normal", 1.0)
          this.game.effects?.setAtmosphereState("IDLE")
          break
        case "ZONE_ENTER": {
          const zoneData = data as {
            zone: AdventureTrackType
            previousZone: AdventureTrackType | null
            isMajor: boolean
            ballPosition?: Vector3
          }
          this.game.scenarioManager.handleZoneTransition(zoneData.zone, zoneData.previousZone, zoneData.isMajor)
          break
        }
      }
    })
  }

  private async initCriticalSystems(): Promise<void> {
    await this.game.runCheckpointStage("scene_critical", () => {
      this.game.sceneBuilder.buildCriticalScene()
      this.game.cabinetBuilder.updateCabinetLightExclusions()
    })
  }

  private async initPostProcess(): Promise<void> {
    await this.game.runCheckpointStage("scene_lcd_post", () => this.game.initLCDTablePostProcess(), true)
    this.game.ready = true
    this.game.uiManager?.showLoadingState(false, "gameplay")
  }

  private async initGameplayBuild(): Promise<void> {
    await this.game.runCheckpointStage("scene_gameplay_build", async () => {
      await this.game.sceneBuilder.yieldFrame()
      this.game.sceneBuilder.buildGameplayScene()
      this.game.physicsController.rebuildHandleCaches()
      this.game.uiManager?.showLoadingState(false, "cosmetic")
    })
    this.game.scheduleCosmeticSceneBuild()
  }
}