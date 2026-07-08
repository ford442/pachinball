/**
 * Level Loader — Handles physics cleanup and track switching for Free Map Test Mode.
 *
 * Responsible for:
 * 1. Disposing prior adventure track bodies/meshes cleanly (Rapier WASM safety).
 * 2. Triggering a fresh track build via AdventureMode.switchToTrack().
 * 3. Resetting ball to plunger lane after switch.
 */

import type { AdventureTrackType } from '../adventure/adventure-types'
import type { AdventureMode } from '../adventure/adventure-mode'
import type { BallManager } from '../game-elements/ball-manager'
import { getTrackThemingSystem } from '../game-elements'
import type { TableMapManager } from './game-maps'
import type { MapConfig } from './map-registry'
import {
  getMapConfigById,
  getTableMapIdForTrack,
  getTrackModeType,
  modeTypeToGameMode,
} from './map-registry'

export interface LevelLoaderDeps {
  adventureMode: AdventureMode | null
  ballManager: BallManager | null
  /** Callback to start adventure mode if not yet active. */
  ensureAdventureActive: () => void
  /** Callback to reset ball to plunger position. */
  resetBall: () => void
  /** Callback to refresh physics handle caches after geometry is rebuilt. */
  rebuildHandleCaches: () => void
  /** LCD table map manager — updated on campaign track switches (A/B alternation). */
  mapManager?: TableMapManager | null
  /** Sync runtime game mode with campaign track modeType (EXTENDED_MAP ↔ dynamic). */
  setGameMode?: (mode: 'fixed' | 'dynamic') => void
}

export interface CampaignLoadOptions {
  /**
   * When true, move the ball to the main-table plunger after load.
   * Free-map test mode uses this; portal campaign jumps keep the ball on the new track start.
   */
  resetBallToPlunger?: boolean
}

export interface LoadResult {
  success: boolean
  mapConfig?: MapConfig
  error?: string
}

/**
 * LevelLoader — Provides a clean interface for switching between layouts.
 */
export class LevelLoader {
  private deps: LevelLoaderDeps

  constructor(deps: LevelLoaderDeps) {
    this.deps = deps
  }

  /**
   * Load a specific layout by MapConfig id.
   * Ensures adventure mode is active, switches track, resets ball.
   */
  loadMap(mapId: string): LoadResult {
    const config = getMapConfigById(mapId)
    if (!config) {
      return { success: false, error: `Unknown map id: ${mapId}` }
    }

    if (!config.adventureTrackType) {
      return { success: false, error: `Map ${mapId} has no adventure track binding` }
    }

    return this.loadAdventureTrack(config.adventureTrackType, config, { resetBallToPlunger: true })
  }

  /**
   * Canonical campaign path: portal completion → next track.
   * Applies A/B mode + LCD table map, tears down prior track geometry/physics, builds the new track.
   */
  loadCampaignTrack(trackId: string, options: CampaignLoadOptions = {}): LoadResult {
    const config = getMapConfigById(trackId)
    if (!config?.adventureTrackType) {
      return { success: false, error: `Unknown or unbound campaign track: ${trackId}` }
    }

    const modeType = getTrackModeType(trackId)
    if (modeType) {
      this.deps.setGameMode?.(modeTypeToGameMode(modeType))
    }

    const tableMapId = getTableMapIdForTrack(trackId)
    if (tableMapId) {
      this.deps.mapManager?.switchTableMap(tableMapId)
    }

    return this.loadAdventureTrack(config.adventureTrackType, config, options)
  }

  /**
   * Load an adventure track directly by type.
   */
  loadAdventureTrack(
    trackType: AdventureTrackType,
    config?: MapConfig,
    options: CampaignLoadOptions = {},
  ): LoadResult {
    const mapConfig = config ?? getMapConfigById(trackType)

    // Ensure adventure mode is running
    if (!this.deps.adventureMode?.isActive()) {
      this.deps.ensureAdventureActive()
    }

    if (!this.deps.adventureMode) {
      return { success: false, error: 'AdventureMode not available' }
    }

    // switchToTrack handles clearTrack() internally (disposes bodies + meshes)
    const success = this.deps.adventureMode.switchToTrack(trackType)
    if (!success) {
      return { success: false, error: `Failed to switch to track: ${trackType}` }
    }

    // Refresh physics handle caches after track geometry is rebuilt so collision
    // dispatch and input actuation use live bodies/joints on every load path.
    this.deps.rebuildHandleCaches()

    if (options.resetBallToPlunger) {
      this.deps.resetBall()
    }
    getTrackThemingSystem()?.applyTheme(trackType)

    return { success: true, mapConfig: mapConfig ?? undefined }
  }

  /**
   * Update dependencies (e.g., after systems are initialized).
   */
  updateDeps(partial: Partial<LevelLoaderDeps>): void {
    Object.assign(this.deps, partial)
  }
}
