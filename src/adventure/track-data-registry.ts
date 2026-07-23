/**
 * Eager registry of declarative track JSON (schema v1).
 *
 * Synced via import.meta.glob so AdventureMode.buildTrack stays synchronous.
 */

import type { TrackDefinition } from './track-schema'
import { validateTrackDefinition } from './track-schema'

const rawModules = import.meta.glob('./track-data/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, unknown>

function buildRegistry(): ReadonlyMap<string, TrackDefinition> {
  const map = new Map<string, TrackDefinition>()

  for (const [path, raw] of Object.entries(rawModules)) {
    const result = validateTrackDefinition(raw)
    if (!result.ok) {
      const detail = result.errors
        .map((e) => (e.path ? `${e.path}: ${e.message}` : e.message))
        .join('; ')
      console.error(`[track-data-registry] Skipping invalid track ${path}: ${detail}`)
      continue
    }
    const def = result.definition
    if (map.has(def.id)) {
      console.error(`[track-data-registry] Duplicate track id ${def.id} from ${path}`)
      continue
    }
    map.set(def.id, def)
  }

  return map
}

/** Validated data-driven track definitions keyed by AdventureTrackType id. */
export const DATA_TRACK_REGISTRY: ReadonlyMap<string, TrackDefinition> = buildRegistry()

export function getDataTrackDefinition(trackId: string): TrackDefinition | undefined {
  return DATA_TRACK_REGISTRY.get(trackId)
}

export function isDataDrivenTrack(trackId: string): boolean {
  return DATA_TRACK_REGISTRY.has(trackId)
}
