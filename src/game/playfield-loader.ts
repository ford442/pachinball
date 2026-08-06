/**
 * Canonical playfield load/teardown API.
 *
 * Every adventure-track layout switch (campaign portal, free-map test mode,
 * dev track cycling) MUST go through `loadPlayfield()`.  Teardown is owned
 * exclusively by `AdventureMode.switchToTrack()` → `clearTrack()` plus
 * `deactivateExitPortal()` for exit portal sensors.
 *
 * See `docs/PLAYFIELD_LOAD_API.md` for the full entry-point sequence diagram.
 */

import type { AdventureMode } from '../adventure/adventure-mode'
import type { BallManager } from '../game-elements/ball-manager'
import type { TrackTeardownStats } from '../game-elements/track-teardown-stats'
import { getTrackThemingSystem } from '../game-elements'
import type { TableMapManager } from './game-maps'
import {
  getMapConfigById,
  getTableMapIdForTrack,
  getTrackModeType,
  modeTypeToGameMode,
  type MapConfig,
} from './map-registry'

/** Identifies which code path initiated the layout switch. */
export type PlayfieldLoadSource =
  | 'campaign-portal'
  | 'free-map'
  | 'dev-cycle'
  | 'table-return'

/**
 * Specification for loading a playable adventure layout.
 * Table boot (initial scene build) and table-return (end adventure) are
 * documented separately — they do not call loadPlayfield().
 */
export interface PlayfieldSpec {
  /** Target track id (AdventureTrackType value). */
  trackId: string
  /** Entry path — drives default sync and ball-reset behaviour. */
  source: PlayfieldLoadSource
  /** Move ball to plunger after load. Defaults: true for free-map, false otherwise. */
  resetBallToPlunger?: boolean
  /** Sync campaign A/B runtime game mode. Defaults: true for campaign-portal. */
  syncGameMode?: boolean
  /** Sync LCD table map shader. Defaults: true for campaign-portal. */
  syncTableMap?: boolean
}

export interface PlayfieldLoaderDeps {
  adventureMode: AdventureMode | null
  ballManager: BallManager | null
  ensureAdventureActive: () => void
  resetBall: () => void
  rebuildHandleCaches: () => void
  mapManager?: TableMapManager | null
  setGameMode?: (mode: 'fixed' | 'dynamic') => void
}

export interface PlayfieldLoadResult {
  success: boolean
  trackId?: string
  mapConfig?: MapConfig
  teardown?: TrackTeardownStats | null
  error?: string
}

function resolveOptions(spec: PlayfieldSpec): {
  resetBallToPlunger: boolean
  syncGameMode: boolean
  syncTableMap: boolean
} {
  const isCampaign = spec.source === 'campaign-portal'
  const isFreeMap = spec.source === 'free-map'
  return {
    resetBallToPlunger: spec.resetBallToPlunger ?? isFreeMap,
    syncGameMode: spec.syncGameMode ?? isCampaign,
    syncTableMap: spec.syncTableMap ?? isCampaign,
  }
}

/**
 * Load an adventure-track playfield: tear down prior geometry/physics, build
 * the new track, refresh handle caches, and apply post-load hooks.
 *
 * This is the single authority for in-session adventure layout switches.
 */
export function loadPlayfield(
  spec: PlayfieldSpec,
  deps: PlayfieldLoaderDeps,
): PlayfieldLoadResult {
  const config = getMapConfigById(spec.trackId)
  if (!config?.adventureTrackType) {
    return {
      success: false,
      error: `Unknown map id: ${spec.trackId}`,
    }
  }

  const trackType = config.adventureTrackType
  const options = resolveOptions(spec)

  if (options.syncGameMode) {
    const modeType = getTrackModeType(spec.trackId)
    if (modeType) {
      deps.setGameMode?.(modeTypeToGameMode(modeType))
    }
  }

  if (options.syncTableMap) {
    const tableMapId = getTableMapIdForTrack(spec.trackId)
    if (tableMapId) {
      deps.mapManager?.switchTableMap(tableMapId)
    }
  }

  if (!deps.adventureMode?.isActive()) {
    deps.ensureAdventureActive()
  }

  if (!deps.adventureMode) {
    return { success: false, error: 'AdventureMode not available' }
  }

  // switchToTrack → deactivateExitPortal + clearTrack + buildTrack
  const success = deps.adventureMode.switchToTrack(trackType)
  if (!success) {
    const detail =
      deps.adventureMode.getLastTrackLoadError() ??
      `Failed to switch to track: ${trackType}`
    return { success: false, error: detail }
  }

  deps.rebuildHandleCaches()

  if (options.resetBallToPlunger) {
    deps.resetBall()
  }

  getTrackThemingSystem()?.applyTheme(trackType)

  const teardown = deps.adventureMode.getLastTeardownStats?.() ?? null

  return {
    success: true,
    trackId: spec.trackId,
    mapConfig: config,
    teardown,
  }
}

/** Convenience: build a PlayfieldSpec for campaign portal jumps. */
export function campaignPlayfieldSpec(
  trackId: string,
  resetBallToPlunger = false,
): PlayfieldSpec {
  return { trackId, source: 'campaign-portal', resetBallToPlunger }
}

/** Convenience: build a PlayfieldSpec for free-map test mode. */
export function freeMapPlayfieldSpec(trackId: string): PlayfieldSpec {
  return { trackId, source: 'free-map' }
}
