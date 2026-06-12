export * from './types'
export * from './display-config'
export * from './visual-language'
export { PhysicsSystem } from './physics'
export { SettingsManager, type GameSettings } from './settings'
export { InputHandler } from './input'
// Display system re-exported from new location
export { DisplaySystem } from '../display'
// Effects system re-exported from new location
export { EffectsSystem } from '../effects'
export { GameObjects } from '../objects'
export {
  CabinetBuilder,
  getCabinetBuilder,
  resetCabinetBuilder,
  CABINET_PRESETS,
  type CabinetType,
  type CabinetPreset,
} from '../cabinet'
export { BallManager } from './ball-manager'
export { ComboSystem, type ComboHitType, type ComboSystemConfig, type ComboNamedChain } from './combo-system'
export { ComboMultiplierSystem, type ComboMultiplierConfig } from './combo-multiplier-system'
export { BallSaveSystem, type BallSaveConfig } from './ball-save-system'
export { BonusTallySystem, type BonusTallyConfig } from './bonus-tally-system'
export { GoldBallStreakSystem, type GoldBallStreakConfig, type GoldBallStreakResult } from './gold-ball-streak-system'
// Adventure mode re-exported from new location
export { AdventureMode, AdventureTrackType, CAMERA_PRESETS, type CameraPreset } from '../adventure'
export {
  ZONE_REGISTRY,
  getZoneConfig,
  isMajorTransition,
  getTransitionShakeIntensity,
  type ZoneConfig,
} from './zone-registry'
export {
  AdventureState,
  getAdventureState,
  resetAdventureState,
  ADVENTURE_LEVELS,
  type GoalType,
  type LevelGoal,
  type AdventureLevel,
  type AdventureProgress,
} from './adventure-state'
export { MagSpinFeeder, MagSpinState } from './mag-spin-feeder'
export { NanoLoomFeeder, NanoLoomState } from './nano-loom-feeder'
export { PrismCoreFeeder, PrismCoreState } from './prism-core-feeder'
export { GaussCannonFeeder, GaussCannonState } from './gauss-cannon-feeder'
export { QuantumTunnelFeeder, QuantumTunnelState } from './quantum-tunnel-feeder'
export { MaterialLibrary, getMaterialLibrary, resetMaterialLibrary, detectQualityTier } from '../materials'
export { BallAnimator } from './ball-animator'
export { CameraController, CameraMode, FRAMING_ZONES, DEFAULT_SOFT_FOLLOW, type CameraRuntimePolicy } from './camera-controller'
export {
  detectAccessibility,
  mergeAccessibilityConfig,
  DEFAULT_ACCESSIBILITY,
  REDUCED_MOTION_CONFIG,
  type AccessibilityConfig
} from './accessibility-config'
export { HapticManager, type HapticConfig } from './haptics'
export { GamepadManager, type GamepadConfig, type GamepadState } from './gamepad'
export {
  lcdTablePixelShader,
  TABLE_MAPS,
  LCDTableState,
  type TableMapType,
  type TableMapConfig,
} from '../shaders/lcd-table'
export { SoundSystem, getSoundSystem, resetSoundSystem, type SampleCategory, type MapId } from './sound-system'
export { createImpactVoiceProfile, normalizeImpactVelocity, getPortalMotifFrequencies, type ImpactCategory, type ImpactVoiceOptions, type ImpactVoiceProfile } from './audio-synth'
export { LeaderboardSystem, getLeaderboardSystem, resetLeaderboardSystem, type LeaderboardEntry, type ScoreSubmission } from './leaderboard-system'
export { NameEntryDialog, getNameEntryDialog, type NameEntryResult } from './name-entry-dialog'
export { MapSystem, getMapSystem, resetMapSystem, type DynamicMapConfig } from './map-system'
export {
  LevelSelectScreen,
  getLevelSelectScreen,
  resetLevelSelectScreen,
  type LevelSelectConfig,
} from './level-select-screen'
export {
  PathMechanic,
  MovingGate,
  GateState,
  MagneticField,
  SpinnerLauncher,
  JumpPad,
  ReactivePegCluster,
  PegState,
  PathMechanicsManager,
  type PathMechanicConfig,
  type MovingGateConfig,
  type MagneticFieldConfig,
  type SpinnerLauncherConfig,
  type JumpPadConfig,
  type ReactivePegClusterConfig,
  type ZoneTrigger,
  type PathMechanicsCallbacks,
} from './path-mechanics'
export {
  SAMURAI_REALM_SCENARIO,
  CYBER_NOIR_SCENARIO,
  QUANTUM_DREAM_SCENARIO,
  MOVIE_GANGSTER_SCENARIO,
  FANTASY_REALM_SCENARIO,
  DYNAMIC_SCENARIOS,
  getScenario,
  getAllScenarios,
  getScenarioIds,
  toggleGameMode,
  setScenario,
  createDefaultModeState,
  completeTransition,
  type DynamicScenario,
  type ScenarioZone,
  type GameMode,
  type ModeToggleState,
} from './dynamic-scenarios'
export {
  ZoneTriggerSystem,
  createZoneBounds,
  areZonesAdjacent,
  getZoneTransitionType,
  type ZoneBounds,
  type ZoneTriggerCallback,
  type ActiveZone,
} from './zone-trigger-system'
export {
  DynamicWorld,
  getDynamicWorld,
  resetDynamicWorld,
  type WorldMode,
  type WorldZone,
  type DynamicWorldConfig,
  type ZoneMechanic,
} from './dynamic-world'
export { DebugHUD, type DebugSnapshot } from './debug-hud'
export { PerformanceMonitor, type PerformanceMetrics } from './performance-monitor'

// Adventure goal & progression systems
export { AdventureGoalSystem } from './adventure-goal-system'
export { AdventureGoalTracker } from './adventure-goal-tracker'
export { AdventureCinematicSystem } from './adventure-cinematic-system'
export { AdventureCinematicTriggers } from './adventure-cinematic-triggers'
export { AdventureUIStateManager } from './adventure-ui-state'
export {
  AdventureTrackProgression,
  TRACK_CATALOG,
  type TrackInfo,
  type TrackModeType,
} from './adventure-track-progression'
export {
  TrackThemingSystem,
  initializeTrackThemingSystem,
  getTrackThemingSystem,
  resetTrackThemingSystem,
  TRACK_THEME_OVERRIDES,
  applyThemeEmissiveColor,
  type TrackVisualTheme,
  type TrackThemingSystemDeps,
} from './track-theming-system'
export { AdventureProgressionSupervisor, type PortalSpatialContext } from './adventure-progression-supervisor'
export {
  getGoalsForTrack,
  getCompletionPercentage,
  getTotalReward,
  cloneGoals,
} from './adventure-track-goals'
export {
  CampaignRewardsManager,
  CAMPAIGN_REWARD_CATALOG,
  initializeCampaignRewardsManager,
  getCampaignRewardsManager,
  resetCampaignRewardsManager,
  type CampaignRewardItem,
  type CampaignRewardType,
} from './campaign-rewards-manager'
export { CampaignRewardNotifier } from './campaign-reward-notifier'
export {
  ScoringBreakdownManager,
  getScoringBreakdownManager,
  resetScoringBreakdownManager,
  type ScoringBreakdownSnapshot,
} from './scoring-breakdown'

// EventBus integration shims
export { ObstacleEventBusIntegration } from './obstacle-eventbus-integration'
export { AdventureEventBusIntegration } from './adventure-eventbus-integration'
