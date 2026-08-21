/**
 * TrackManifest registry — single lookup surface for all adventure tracks.
 *
 * Derives TRACK_CATALOG and ZONE_REGISTRY entries from manifest data.
 */

import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { AdventureTrackType } from '../adventure-types'
import type { TrackInfo } from '../adventure-track-progression'
import type { ZoneConfig } from '../zone-registry'
import type { TrackManifest } from './track-manifest-types'
import { MANIFEST_DATA } from './track-manifest-data'
import { getDataTrackSourcePath } from '../track-data-registry'

/**
 * Accept a manifest only if its declared build dispatch actually resolves.
 * A TS entry needs a callable builder; a JSON entry needs its `dataPath` to
 * match the file the data registry loaded for that id — so a typo or a renamed
 * JSON surfaces here at startup instead of as an empty track at play time.
 */
function isDispatchable(manifest: TrackManifest): boolean {
  if (manifest.buildKind === 'ts') {
    if (typeof manifest.loadBuilder !== 'function') {
      console.error(`[track-manifest] Missing TS loadBuilder for ${manifest.id}`)
      return false
    }
    return true
  }

  const sourcePath = getDataTrackSourcePath(manifest.id)
  if (!sourcePath) {
    console.error(
      `[track-manifest] ${manifest.id} declares dataPath ${manifest.dataPath} but no valid ` +
        'track JSON was loaded for that id',
    )
    return false
  }
  if (sourcePath !== manifest.dataPath) {
    console.error(
      `[track-manifest] ${manifest.id} declares dataPath ${manifest.dataPath} but its ` +
        `definition was loaded from ${sourcePath}`,
    )
    return false
  }
  return true
}

function buildManifestRegistry(): ReadonlyMap<AdventureTrackType, TrackManifest> {
  const map = new Map<AdventureTrackType, TrackManifest>()

  for (const manifest of MANIFEST_DATA) {
    if (!isDispatchable(manifest)) continue
    map.set(manifest.id, manifest)
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
