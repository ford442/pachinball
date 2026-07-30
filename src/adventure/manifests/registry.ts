/**
 * TrackManifest registry — single lookup surface for all adventure tracks.
 *
 * Derives TRACK_CATALOG and ZONE_REGISTRY entries from manifest data.
 */

import { Vector3 } from '@babylonjs/core'
import { AdventureTrackType } from '../adventure-types'
import type { TrackInfo } from '../../game-elements/adventure-track-progression'
import type { ZoneConfig } from '../../game-elements/zone-registry'
import type { TrackManifest } from './track-manifest-types'
import { MANIFEST_DATA } from './track-manifest-data'
import { TS_BUILDERS } from './builders'

function buildManifestRegistry(): ReadonlyMap<AdventureTrackType, TrackManifest> {
  const map = new Map<AdventureTrackType, TrackManifest>()

  for (const data of MANIFEST_DATA) {
    const builder = data.buildKind === 'ts' ? TS_BUILDERS[data.id] : undefined
    if (data.buildKind === 'ts' && !builder) {
      console.error(`[track-manifest] Missing TS builder for ${data.id}`)
      continue
    }
    map.set(data.id, { ...data, builder })
  }

  return map
}

/** All registered track manifests keyed by AdventureTrackType. */
export const TRACK_MANIFEST_REGISTRY: ReadonlyMap<AdventureTrackType, TrackManifest> =
  buildManifestRegistry()

export function getTrackManifest(trackId: AdventureTrackType): TrackManifest | undefined {
  return TRACK_MANIFEST_REGISTRY.get(trackId)
}

export function getAllTrackManifests(): TrackManifest[] {
  return Array.from(TRACK_MANIFEST_REGISTRY.values())
}

/** Derive TRACK_CATALOG from manifests that include catalog metadata. */
export function buildTrackCatalogFromManifests(): Record<string, TrackInfo> {
  const catalog: Record<string, TrackInfo> = {}

  for (const manifest of TRACK_MANIFEST_REGISTRY.values()) {
    if (!manifest.catalog) continue
    catalog[manifest.id] = {
      id: manifest.id,
      name: manifest.zone.name,
      description: manifest.catalog.description,
      difficulty: manifest.catalog.difficulty,
      modeType: manifest.catalog.modeType,
      recommendedScore: manifest.catalog.recommendedScore,
      timeLimitSeconds: manifest.catalog.timeLimitSeconds,
      timeoutPenaltyMultiplier: manifest.catalog.timeoutPenaltyMultiplier,
      unlockedBy: manifest.catalog.unlockedBy,
      theme: manifest.catalog.theme,
      visualTheme: manifest.catalog.visualTheme,
    }
  }

  return catalog
}

/** Derive ZONE_REGISTRY from manifest zone metadata. */
export function buildZoneRegistryFromManifests(): Record<AdventureTrackType, ZoneConfig> {
  const registry = {} as Record<AdventureTrackType, ZoneConfig>

  for (const manifest of TRACK_MANIFEST_REGISTRY.values()) {
    registry[manifest.id] = {
      id: manifest.id,
      name: manifest.zone.name,
      storyText: manifest.zone.storyText,
      videoUrl: manifest.zone.videoUrl,
      musicTrackId: manifest.zone.musicTrackId,
      primaryColor: manifest.zone.primaryColor,
      accentColor: manifest.zone.accentColor,
      interiorColor: manifest.zone.interiorColor,
      isMajorTransition: manifest.zone.isMajorTransition,
      glowIntensity: manifest.zone.glowIntensity,
    }
  }

  return registry
}

/** Derive portal start anchors from manifests. */
export function getManifestStartAnchor(track: AdventureTrackType): Vector3 {
  const manifest = TRACK_MANIFEST_REGISTRY.get(track)
  if (!manifest) {
    return new Vector3(0, 2, 8)
  }
  const { x, y, z } = manifest.startAnchor
  return new Vector3(x, y, z)
}
