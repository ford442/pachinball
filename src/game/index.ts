/**
 * Game Module - Barrel exports
 *
 * Provides centralized game management functionality:
 * - GameStateManager: Handles game state transitions
 * - GameInputManager: Centralized input handling
 * - TableMapManager: Table map switching logic
 * - CabinetManager: Cabinet preset switching
 */

export { GameStateManager } from './game-state'
export { EventBus, type PachinballEventMap, type PachinballEventName, type PachinballEventHandler } from './event-bus'
export { GameInputManager } from './game-input'
export {
  TableMapManager,
  TABLE_MAPS,
  type TableMapType,
  type TableMapConfig,
  type MapManagerConfig,
} from './game-maps'
export {
  CabinetManager,
  CABINET_PRESETS,
  type CabinetType,
  type CabinetPreset,
  type CabinetManagerConfig,
} from './game-cabinet'
export { GameUIManager, type PopupConfig, type HUDData, type GoldBallCounts } from './game-ui'
export {
  AdventureManager,
  type AdventureManagerConfig,
  type AdventureManagerSystems,
} from './game-adventure'

// New helper managers extracted from game.ts
export { GameRenderer, type RendererHost } from './game-renderer'
export { GameCabinetBuilder, type CabinetBuilderHost } from './game-cabinet-builder'
export { GameSceneBuilder, type SceneBuilderHost } from './game-scene-builder'
export { GamePhysicsController, type PhysicsHost } from './game-physics-controller'
export { GameInputActions, type InputActionsHost } from './game-input-actions'
export { GameScenario, type ScenarioHost } from './game-scenario'
export { GameSlotAdventure, type SlotAdventureHost } from './game-slot-adventure'
export { GameSettingsUI, type SettingsUIHost } from './game-settings-ui'
export { GameDebug, type DebugHost } from './game-debug'
export { GameLifecycle, type LifecycleHost } from './game-lifecycle'
export { GameHUD, type HUDHost } from './game-hud'
export { GameMapCabinet, type MapCabinetHost } from './game-map-cabinet'
export { hexToColor3, resolveVideoUrl } from './game-utils'
