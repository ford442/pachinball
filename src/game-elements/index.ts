export * from './types'
export * from './display-config'
export * from './visual-language'
export { PhysicsSystem, PHYSICS_DEGRADE_MARKER, exposeCurrentPhysicsEngine, exposePhysicsDegradeReason } from './physics'
export { SettingsManager, type GameSettings } from './settings'
export { InputHandler } from './input'
export { BallManager } from './ball-manager'
export { ComboSystem, type ComboHitType, type ComboSystemConfig, type ComboNamedChain } from './combo-system'
export { ComboMultiplierSystem, type ComboMultiplierConfig } from './combo-multiplier-system'
export { BallSaveSystem, type BallSaveConfig } from './ball-save-system'
export { BonusTallySystem, type BonusTallyConfig } from './bonus-tally-system'
export { GoldBallStreakSystem, type GoldBallStreakConfig, type GoldBallStreakResult } from './gold-ball-streak-system'
export {
  ZONE_REGISTRY,
  getZoneConfig,
  isMajorTransition,
  getTransitionShakeIntensity,
  type ZoneConfig,
} from './zone-registry'
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
export { SoundSystem, getSoundSystem, resetSoundSystem, type MapId } from './sound-system'
export { createImpactVoiceProfile, normalizeImpactVelocity, getPortalMotifFrequencies, type ImpactCategory, type ImpactVoiceOptions, type ImpactVoiceProfile } from './audio-synth'
export {
  getJackpotPhaseSampleKey,
  getLocalAudioPath,
  getSampleKeyForCategory,
  getSampleKeyForImpact,
  LOCAL_MUSIC_STEMS,
  LOCAL_SAMPLE_BANK,
  type AudioMusicStem,
  type AudioSampleKey,
  type AudioSourceMode,
  type SampleCategory,
} from './audio-sample-bank'
export type { LeaderboardSystem, LeaderboardEntry, ScoreSubmission } from './leaderboard-system'
export type { NameEntryDialog, NameEntryResult } from './name-entry-dialog'
export { MapSystem, getMapSystem, resetMapSystem, type DynamicMapConfig } from './map-system'
export type { LevelSelectScreen, LevelSelectConfig } from './level-select-screen'
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
export { EventBusLog, type EventBusLogEntry } from './event-bus-log'
export {
  getPhysicsTuningValue,
  setPhysicsTuningOverride,
  resetPhysicsTuningOverrides,
  applyPlungerChargeCurve,
  PHYSICS_TUNING_SLIDERS,
  type PhysicsTuningKey,
} from './physics-tuning'
export { PhysicsTuningPanel, isPhysicsTuningQueryEnabled, isPhysicsTuningEnabled } from './physics-tuning-panel'
export { PerformanceMonitor, type PerformanceMetrics } from './performance-monitor'

export {
  ScoringBreakdownManager,
  getScoringBreakdownManager,
  resetScoringBreakdownManager,
  type ScoringBreakdownSnapshot,
} from './scoring-breakdown'

export {
  ReplayRecorder,
  compressInputFrames,
  decompressInputFrames,
  type ReplayMetadata,
  type ReplayPayload,
} from '../replay/replay-recorder'
export { ReplayRunner } from '../replay/replay-runner'
export { GhostBallRenderer } from '../replay/ghost-ball-renderer'
export {
  ChallengeSystem,
  getChallengeSystem,
  resetChallengeSystem,
  type ChallengeConfig,
} from '../replay/challenge-system'
export {
  generateTableLayout,
  validateLayout,
  runSpawnProbes,
  CANONICAL_BUMPERS,
  LAYOUT_CONSTANTS,
  FEEDER_KEYS,
  type TableLayout,
  type FeederKey,
  type PinSpec,
  type BumperSpec,
} from './daily-cascade-layout'
export {
  DailyCascadeState,
  getDailyCascadeState,
  resetDailyCascadeState,
  type DailyCascadeMode,
} from './daily-cascade-state'

export { ObstacleEventBusIntegration } from './obstacle-eventbus-integration'
