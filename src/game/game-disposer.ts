/**
 * Game Disposer — Centralized teardown for all game subsystems.
 *
 * Extracted from game.ts to decouple cleanup orchestration from
 * the main Game class. Disposal order is critical for Babylon.js
 * memory safety and must be preserved exactly.
 */

import { resetMaterialLibrary } from '../materials'
import { resetCabinetBuilder } from '../cabinet'
import { resetCampaignRewardsManager } from '../adventure/campaign-rewards-manager'
import {
  resetScoringBreakdownManager,
  resetSoundSystem,
  resetMapSystem,
  resetChallengeSystem,
  resetDynamicWorld,
} from '../game-elements'
import { resetTrackThemingSystem } from '../adventure/track-theming-system'
import type { Game } from '../game'

export function disposeGame(game: Game): void {
  // Removes every listener registered with `{ signal: game.signal }` in one go.
  game.abort.abort()

  game.sceneOptimizer?.dispose()
  game.sceneOptimizer = null
  game.cabinetLighting?.dispose()
  game.cabinetLighting = null
  game.celebrationSequencer?.dispose()
  game.celebrationSequencer = null
  game.inputManager?.dispose()
  game.debugHUD?.dispose()
  game.debugHUD = null
  game.eventBusLog.dispose()
  game.uiManager?.dispose()
  game.adventureManager?.dispose()
  game.renderer?.dispose()

  // Subsystems that used to be dropped without a dispose(): they hold DOM nodes,
  // listeners or EventBus subscriptions that outlive the scene.
  game.freeMapTestMode?.dispose()
  game.freeMapTestMode = null
  game.physicsTuningPanel?.dispose()
  game.physicsTuningPanel = null
  game.ghostBallRenderer?.dispose()
  game.ghostBallRenderer = null
  game.zoneTriggerSystem?.dispose()
  game.zoneTriggerSystem = null
  game.mapManager?.dispose()
  game.mapManager = null
  game.physicsController?.dispose()

  // Explicitly null helper references to break cycles
  game.cabinetBuilder = null
  game.sceneBuilder = null
  game.physicsController = null
  game.inputActions = null
  game.scenarioManager = null
  game.slotAdventure = null
  game.settingsUI = null
  game.debugHelper = null
  game.lifecycle = null
  game.hud = null
  game.mapCabinet = null

  game.disposeOverlaySystems()

  game.bloomPipeline?.dispose()
  game.bloomPipeline = null
  game.mirrorTexture?.dispose()
  game.mirrorTexture = null
  game.tableRenderTarget?.dispose()
  game.tableRenderTarget = null
  game.headRenderTarget?.dispose()
  game.headRenderTarget = null
  game.shadowGenerator?.dispose()
  game.shadowGenerator = null
  game.ballAnimator?.dispose()
  game.ballAnimator = null
  game.ballStackVisual?.dispose()
  game.ballStackVisual = null
  game.effects?.dispose()
  game.effects = null
  game.display?.dispose()
  game.display = null
  game.gameObjects?.dispose()
  game.gameObjects = null

  // Dispose obstacle builders
  game.spinnerBuilder?.dispose()
  game.spinnerBuilder = null
  game.ballTrapBuilder?.dispose()
  game.ballTrapBuilder = null
  game.launcherBuilder?.dispose()
  game.launcherBuilder = null
  game.movingGateBuilder?.dispose()
  game.movingGateBuilder = null
  game.spinnerVisuals = []
  game.trapStates = []
  game.launcherStates = []
  game.gateStates = []

  // Dispose adventure systems
  game.adventureGoalTracker?.dispose()
  game.adventureGoalTracker = null
  game.adventureCinematicTriggers?.dispose()
  game.adventureCinematicTriggers = null
  game.adventureCinematicSystem?.dispose()
  game.adventureCinematicSystem = null
  game.adventureUIStateManager?.dispose()
  game.adventureUIStateManager = null
  game.adventureTrackProgression = null
  game.adventureProgressionSupervisor?.reset()
  game.adventureProgressionSupervisor = null
  resetCampaignRewardsManager()
  resetTrackThemingSystem()
  resetScoringBreakdownManager()

  // Module singletons: each would otherwise hand the next Game an instance wired to
  // this one's EventBus, scene or DOM. SoundSystem.dispose() unsubscribes from the
  // bus and closes the AudioContext, so it runs after everything that plays sound.
  // resetAdventureState() is deliberately absent: it wipes campaign progress.
  resetSoundSystem()
  resetMapSystem()
  resetChallengeSystem()
  resetDynamicWorld()
  game.dynamicWorld = null
  game.levelSelectScreen = null

  resetMaterialLibrary()
  // CabinetBuilder is a singleton bound to the scene it was created with; dispose
  // it and drop it so a later Game does not inherit a builder for a dead scene.
  resetCabinetBuilder()
  game.cabinetManager = null
  game.scene?.dispose()
  game.scene = null
  game.physics.dispose()
  game.ready = false

  console.log('[Game] Disposed all resources')
}
