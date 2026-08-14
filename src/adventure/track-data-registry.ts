/**
 * Eager registry of declarative track JSON (schema v1).
 *
 * Synced via import.meta.glob so JSON tracks stay off the TS builder code-split.
 */

import type { TrackDefinition } from './track-schema'
import { validateTrackDefinition } from './track-schema'

const rawModules = import.meta.glob('./track-data/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, unknown>

interface BuiltRegistry {
  byId: Map<string, TrackDefinition>
  /** Glob-relative source path of each accepted definition, keyed by track id. */
  pathById: Map<string, string>
}

function buildRegistry(): BuiltRegistry {
  const byId = new Map<string, TrackDefinition>()
  const pathById = new Map<string, string>()

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
    if (byId.has(def.id)) {
      console.error(`[track-data-registry] Duplicate track id ${def.id} from ${path}`)
      continue
    }
    byId.set(def.id, def)
    pathById.set(def.id, path)
  }

  return { byId, pathById }
}

const REGISTRY = buildRegistry()

/** Validated data-driven track definitions keyed by AdventureTrackType id. */
export const DATA_TRACK_REGISTRY: ReadonlyMap<string, TrackDefinition> = REGISTRY.byId

/**
 * Source path each definition was loaded from, keyed by track id. Lets the
 * manifest registry verify a declared `dataPath` actually backs that track.
 */
export const DATA_TRACK_SOURCE_PATHS: ReadonlyMap<string, string> = REGISTRY.pathById

/** Glob-relative source path for a loaded track definition, if any. */
export function getDataTrackSourcePath(trackId: string): string | undefined {
  return REGISTRY.pathById.get(trackId)
}

export function getDataTrackDefinition(trackId: string): TrackDefinition | undefined {
  return DATA_TRACK_REGISTRY.get(trackId)
}

export function isDataDrivenTrack(trackId: string): boolean {
  return DATA_TRACK_REGISTRY.has(trackId)
}
