/**
 * Pure config — no Babylon.js dependencies.
 *
 * Campaign tunables (TRACK_CATALOG, manifests) live under src/adventure/, not here.
 * src/config/** may import from src/core and (display-slot.ts only) src/display/slot-types.
 */
export {
  BallType,
  BALL_SPAWN_CONFIG,
  GOLD_BALL_THRESHOLDS,
  BALL_TIERS,
  type BallTierConfig,
} from './balls'
export { SLOT_MACHINE_CONFIG } from './display-slot'
export { API_BASE, ASSET_BASE, resolveBackboxAssetPath, apiFetch, isRemoteApiBase } from './api'
export { EffectsConfig } from './visuals'
export {
  GAME_TUNING,
  getLaneRolloverPoints,
  type LaneRolloverKind,
  type LaneSensorConfig,
  type GameTuning,
} from './gameplay'
export {
  FEEDER_TUNABLES,
  validateFeederTunables,
  type FeederId,
  type FeederTunable,
  type FeederTunables,
  type MagSpinTunables,
  type NanoLoomTunables,
  type PrismCoreTunables,
  type GaussCannonTunables,
  type QuantumTunnelTunables,
} from './feeders'
export { GameConfig, type GameConfigType } from './game-config'
export {
  PhysicsConfig,
  WASM_PHYSICS,
  getPhysicsEnginePreference,
  getWasmPhysicsRuntimeMode,
  type PhysicsConfigType,
  type WasmPhysicsEnginePreference,
  type WasmPhysicsRuntimeMode,
} from './physics'
