/**
 * Level Loader — thin facade over the canonical `loadPlayfield()` API.
 *
 * Retained for backward compatibility with Game, FreeMapTestMode, and tests.
 * New code should import `loadPlayfield` from `./playfield-loader` directly.
 */

import type { AdventureTrackType } from '../adventure/adventure-types'
import {
  campaignPlayfieldSpec,
  freeMapPlayfieldSpec,
  loadPlayfield,
  type PlayfieldLoaderDeps,
  type PlayfieldLoadResult,
} from './playfield-loader'
import type { MapConfig } from './map-registry'
import { getMapConfigById } from './map-registry'

export type { PlayfieldLoaderDeps as LevelLoaderDeps }
export type { PlayfieldLoadResult as LoadResult }

export interface CampaignLoadOptions {
  /**
   * When true, move the ball to the main-table plunger after load.
   * Free-map test mode uses this; portal campaign jumps keep the ball on the new track start.
   */
  resetBallToPlunger?: boolean
}

/**
 * LevelLoader — Provides a clean interface for switching between layouts.
 */
export class LevelLoader {
  private deps: PlayfieldLoaderDeps

  constructor(deps: PlayfieldLoaderDeps) {
    this.deps = deps
  }

  /**
   * Load a specific layout by MapConfig id (free-map test mode path).
   */
  loadMap(mapId: string): PlayfieldLoadResult {
    return loadPlayfield(freeMapPlayfieldSpec(mapId), this.deps)
  }

  /**
   * Canonical campaign path: portal completion → next track.
   */
  loadCampaignTrack(trackId: string, options: CampaignLoadOptions = {}): PlayfieldLoadResult {
    return loadPlayfield(
      campaignPlayfieldSpec(trackId, options.resetBallToPlunger ?? false),
      this.deps,
    )
  }

  /**
   * Load an adventure track directly by type.
   */
  loadAdventureTrack(
    trackType: AdventureTrackType,
    config?: MapConfig,
    options: CampaignLoadOptions = {},
  ): PlayfieldLoadResult {
    const mapConfig = config ?? getMapConfigById(trackType)
    const trackId = mapConfig?.id ?? trackType

    return loadPlayfield(
      {
        trackId,
        source: 'free-map',
        resetBallToPlunger: options.resetBallToPlunger ?? true,
        syncGameMode: false,
        syncTableMap: false,
      },
      this.deps,
    )
  }

  updateDeps(partial: Partial<PlayfieldLoaderDeps>): void {
    Object.assign(this.deps, partial)
  }
}
