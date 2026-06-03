/**
 * Game Disposer — Centralized teardown for all game subsystems.
 *
 * Extracted from game.ts to decouple cleanup orchestration from
 * the main Game class. Disposal order is critical for Babylon.js
 * memory safety and must be preserved exactly.
 */

import { resetMaterialLibrary } from '../materials'
import { resetCampaignRewardsManager } from '../game-elements/campaign-rewards-manager'
import { resetTrackThemingSystem, resetScoringBreakdownManager } from '../game-elements'
import type { Game } from '../game'

export class GameDisposer {
  constructor(private game: Game) {}

  public disposeAll(): void {
    this.game.sceneOptimizer?.dispose()
    this.game.sceneOptimizer = null
    this.game.cabinetLighting?.dispose()
    this.game.cabinetLighting = null
    this.game.inputManager?.dispose()
    this.game.debugHUD?.dispose()
    this.game.debugHUD = null
    this.game.uiManager?.dispose()
    this.game.adventureManager?.dispose()
    this.game.renderer?.dispose()

    // Explicitly null helper references to break cycles
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.game.cabinetBuilder = null as any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.game.sceneBuilder = null as any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.game.physicsController = null as any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.game.inputActions = null as any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.game.scenarioManager = null as any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.game.slotAdventure = null as any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.game.settingsUI = null as any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.game.debugHelper = null as any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.game.lifecycle = null as any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.game.hud = null as any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.game.mapCabinet = null as any

    this.game.leaderboardSystem.stop()
    this.game.leaderboardSystem.dispose()

    this.game.bloomPipeline?.dispose()
    this.game.bloomPipeline = null
    this.game.mirrorTexture?.dispose()
    this.game.mirrorTexture = null
    this.game.tableRenderTarget?.dispose()
    this.game.tableRenderTarget = null
    this.game.headRenderTarget?.dispose()
    this.game.headRenderTarget = null
    this.game.shadowGenerator?.dispose()
    this.game.shadowGenerator = null
    this.game.ballAnimator?.dispose()
    this.game.ballAnimator = null
    this.game.ballStackVisual?.dispose()
    this.game.ballStackVisual = null
    this.game.effects?.dispose()
    this.game.effects = null
    this.game.gameObjects?.dispose()
    this.game.gameObjects = null

    // Dispose obstacle builders
    this.game.spinnerBuilder?.dispose()
    this.game.spinnerBuilder = null
    this.game.ballTrapBuilder?.dispose()
    this.game.ballTrapBuilder = null
    this.game.launcherBuilder?.dispose()
    this.game.launcherBuilder = null
    this.game.movingGateBuilder?.dispose()
    this.game.movingGateBuilder = null
    this.game.spinnerVisuals = []
    this.game.trapStates = []
    this.game.launcherStates = []
    this.game.gateStates = []

    // Dispose adventure systems
    this.game.adventureGoalTracker?.dispose()
    this.game.adventureGoalTracker = null
    this.game.adventureCinematicTriggers?.dispose()
    this.game.adventureCinematicTriggers = null
    this.game.adventureCinematicSystem?.dispose()
    this.game.adventureCinematicSystem = null
    this.game.adventureUIStateManager?.dispose()
    this.game.adventureUIStateManager = null
    this.game.adventureTrackProgression = null
    this.game.adventureProgressionSupervisor?.reset()
    this.game.adventureProgressionSupervisor = null
    resetCampaignRewardsManager()
    resetTrackThemingSystem()
    resetScoringBreakdownManager()

    resetMaterialLibrary()
    this.game.scene?.dispose()
    this.game.scene = null
    this.game.physics.dispose()
    this.game.ready = false

    console.log('[Game] Disposed all resources')
  }
}
