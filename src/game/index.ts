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
