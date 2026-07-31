/**
 * Zone Registry - Configuration for Dynamic Adventure Mode zones
 *
 * Each zone defines:
 * - Story video URL and narrative text
 * - Color theme (neon, interior lights, ball material)
 * - Music track ID
 * - Transition type (major/minor - affects shake intensity)
 *
 * ZONE_REGISTRY is derived from TrackManifest — edit manifests/track-manifest-data.ts
 * to add or change zone theming.
 */

import { AdventureTrackType } from '../adventure/adventure-types'
import { buildZoneRegistryFromManifests } from '../adventure/manifests'
import { resolveVideoUrl } from '../core/asset-urls'

export interface ZoneConfig {
  /** Zone identifier */
  id: AdventureTrackType
  /** Display name */
  name: string
  /** Story narrative text (shown on backbox) */
  storyText: string
  /** Video URL for backbox (optional) */
  videoUrl?: string
  /** Music track ID to cross-fade to */
  musicTrackId: string
  /** Primary color (cabinet neon, ball) */
  primaryColor: string
  /** Secondary/accent color */
  accentColor: string
  /** Interior lighting color */
  interiorColor: string
  /** Whether this is a major transition (triggers stronger shake/pulse) */
  isMajorTransition: boolean
  /** Glow intensity for materials (0-2) */
  glowIntensity: number
}

/** Derived from TrackManifest registry — see src/adventure/manifests/ */
export const ZONE_REGISTRY: Record<AdventureTrackType, ZoneConfig> = buildZoneRegistryFromManifests()

/**
 * Get zone configuration by track type
 * Returns config with videoUrl resolved for subdirectory deployment
 */
export function getZoneConfig(trackType: AdventureTrackType): ZoneConfig {
  const config = ZONE_REGISTRY[trackType]
  return {
    ...config,
    videoUrl: resolveVideoUrl(config.videoUrl)
  }
}

/**
 * Check if a transition between two zones is major
 * (either source or destination is a major transition zone)
 */
export function isMajorTransition(from: AdventureTrackType | null, to: AdventureTrackType): boolean {
  if (!from) return true // First entry is always major
  const fromConfig = ZONE_REGISTRY[from]
  const toConfig = ZONE_REGISTRY[to]
  return (fromConfig?.isMajorTransition ?? false) || (toConfig?.isMajorTransition ?? false)
}

/**
 * Get shake intensity for a zone transition
 */
export function getTransitionShakeIntensity(from: AdventureTrackType | null, to: AdventureTrackType): number {
  if (isMajorTransition(from, to)) {
    return 0.6 // Strong shake for major transitions
  }
  return 0.25 // Subtle shake for minor transitions
}
