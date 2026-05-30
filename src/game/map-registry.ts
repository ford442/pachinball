/**
 * Map Registry — Unified layout registry for Free Map Test Mode and level loading.
 *
 * Combines adventure track metadata (from AdventureTrackType + TRACK_CATALOG)
 * with table map info to provide a single lookup for available layouts.
 */

import { AdventureTrackType } from '../adventure/adventure-types'
import { TRACK_CATALOG, type TrackModeType } from '../game-elements/adventure-track-progression'

/**
 * A single layout entry in the map registry.
 */
export interface MapConfig {
  /** Unique identifier (matches AdventureTrackType value or table map name). */
  id: string
  /** Human-readable display name. */
  displayName: string
  /** Layout category: 'extended' (scrolling 3D) or 'stationary' (classic table). */
  layoutType: 'extended' | 'stationary'
  /** If this is an adventure track, the enum value to pass to AdventureMode. */
  adventureTrackType?: AdventureTrackType
  /** Difficulty label for display purposes. */
  difficulty?: string
  /** Optional theme identifier for shader/music matching. */
  theme?: string
}

/**
 * Build the full map registry from the adventure track enum + TRACK_CATALOG.
 * All adventure tracks are included; catalog entries enrich with metadata.
 */
function buildRegistry(): MapConfig[] {
  const registry: MapConfig[] = []

  for (const trackType of Object.values(AdventureTrackType)) {
    const catalogEntry = TRACK_CATALOG[trackType]
    const layoutType = modeTypeToLayout(catalogEntry?.modeType)

    registry.push({
      id: trackType,
      displayName: catalogEntry?.name ?? formatTrackId(trackType),
      layoutType,
      adventureTrackType: trackType as AdventureTrackType,
      difficulty: catalogEntry?.difficulty,
      theme: catalogEntry?.theme,
    })
  }

  return registry
}

function modeTypeToLayout(modeType?: TrackModeType): 'extended' | 'stationary' {
  if (modeType === 'STATIONARY_TABLE') return 'stationary'
  return 'extended'
}

function formatTrackId(id: string): string {
  return id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase())
}

/** Singleton registry instance, lazily built. */
let registryInstance: MapConfig[] | null = null

/**
 * Get the map registry (singleton).
 */
export function getMapRegistry(): MapConfig[] {
  if (!registryInstance) {
    registryInstance = buildRegistry()
  }
  return registryInstance
}

/**
 * Look up a single MapConfig by id.
 */
export function getMapConfigById(id: string): MapConfig | undefined {
  return getMapRegistry().find(m => m.id === id)
}

/**
 * Get all maps filtered by layout type.
 */
export function getMapsByLayout(layoutType: 'extended' | 'stationary'): MapConfig[] {
  return getMapRegistry().filter(m => m.layoutType === layoutType)
}

/**
 * Reset the registry (useful for testing).
 */
export function resetMapRegistry(): void {
  registryInstance = null
}
