/**
 * Adventure Mode Module
 * 
 * Browser-based pinball adventure mode with track building and cinematic camera.
 */

// Main orchestrator
export { AdventureMode } from './adventure-mode'
export { TrackBuilder } from './track-builder'
export { CAMERA_PRESETS } from './camera-presets'

// Types
export {
  AdventureTrackType,
  GROUP_UNIVERSAL,
  GROUP_RED,
  GROUP_GREEN,
  GROUP_BLUE,
  MASK_ALL,
  MASK_RED,
  MASK_GREEN,
  MASK_BLUE,
} from './adventure-types'

export type {
  AdventureCallback,
  CameraPreset,
  TrackConfig,
  TrackProgress,
  GravityWell,
  DampingZone,
  KinematicBinding,
  AnimatedObstacle,
  ConveyorZone,
  ChromaGate,
  TrackModeType,
} from './adventure-types'

export {
  getTrackStartAnchor,
  isAdventureTrackType,
} from './portal-routing'

export {
  getTrackManifest,
  getAllTrackManifests,
  TRACK_MANIFEST_REGISTRY,
} from './manifests'
export type { TrackManifest } from './manifests'

export {
  validateTrackDefinition,
  formatTrackValidationErrors,
  TRACK_SCHEMA_VERSION,
} from './track-schema'
export type {
  TrackDefinition,
  TrackSegment,
  TrackValidationResult,
  TrackValidationIssue,
} from './track-schema'
export { compileTrackDefinition } from './track-compiler'
export type { TrackBuildApi, TrackCursor } from './track-compiler'
export {
  DATA_TRACK_REGISTRY,
  getDataTrackDefinition,
  isDataDrivenTrack,
} from './track-data-registry'

// Campaign catalog (moved from game-elements)
export {
  TRACK_CATALOG,
  AdventureTrackProgression,
  CAMPAIGN_MAIN_PATH,
} from './adventure-track-progression'
export type {
  TrackInfo,
  ProgressionState,
  SerializableProgressionState,
} from './adventure-track-progression'

export {
  ZONE_REGISTRY,
  getZoneConfig,
  isMajorTransition,
  getTransitionShakeIntensity,
  type ZoneConfig,
} from './zone-registry'
export { AdventureState, getAdventureState, resetAdventureState, ADVENTURE_LEVELS } from './adventure-state'
export { AdventureGoalSystem } from './adventure-goal-system'
export { AdventureGoalTracker } from './adventure-goal-tracker'
export { AdventureCinematicSystem } from './adventure-cinematic-system'
export { AdventureCinematicTriggers } from './adventure-cinematic-triggers'
export { AdventureUIStateManager } from './adventure-ui-state'
export { AdventureProgressionSupervisor, type PortalSpatialContext } from './adventure-progression-supervisor'
export {
  getTrackThemeProfile,
  getTrackMaterialColor,
  TRACK_THEME_PROFILES,
  type TrackThemeProfile,
  type TrackMaterialRole,
  type TrackAmbientStyle,
} from './track-theme-profiles'
export {
  TrackThemingSystem,
  initializeTrackThemingSystem,
  getTrackThemingSystem,
  resetTrackThemingSystem,
} from './track-theming-system'
export {
  CampaignRewardsManager,
  CAMPAIGN_REWARD_CATALOG,
  initializeCampaignRewardsManager,
  getCampaignRewardsManager,
  resetCampaignRewardsManager,
} from './campaign-rewards-manager'
export { CampaignRewardNotifier } from './campaign-reward-notifier'

