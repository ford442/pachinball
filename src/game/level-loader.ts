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
import type { MapConfig } from './map-registry'
import { getMapConfigById } from './map-registry'

export interface LevelLoaderDeps {
  adventureMode: AdventureMode | null
  ballManager: BallManager | null
  /** Callback to start adventure mode if not yet active. */
  ensureAdventureActive: () => void
  /** Callback to reset ball to plunger position. */
  resetBall: () => void
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

    return this.loadAdventureTrack(config.adventureTrackType, config)
  }

  /**
   * Load an adventure track directly by type.
   */
  loadAdventureTrack(trackType: AdventureTrackType, config?: MapConfig): LoadResult {
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

    // Reset ball to plunger lane
    this.deps.resetBall()

    return { success: true, mapConfig: mapConfig ?? undefined }
  }

  /**
   * Update dependencies (e.g., after systems are initialized).
   */
  updateDeps(partial: Partial<LevelLoaderDeps>): void {
    Object.assign(this.deps, partial)
  }
}
