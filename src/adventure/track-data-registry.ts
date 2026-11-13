/**
 * Registry of the declarative track JSON (schema v1), loaded lazily (#505 §A).
 *
 * Every adventure track is a `track-data/<ID>.json`. The glob is not eager:
 * each file is its own chunk, fetched the first time its track is built and
 * parsed then with the Valibot track schema (`src/schemas/track.ts`, itself a
 * lazy chunk). Which tracks exist, and where each file lives, is answered
 * from the glob's keys alone, so the entry chunk carries neither the track
 * data nor the schema. A file's name is its track id.
 */

import type { TrackDefinition } from '../schemas/track'

const TRACK_DATA_PREFIX = './track-data/'
const TRACK_DATA_SUFFIX = '.json'

const loaders = import.meta.glob<unknown>('./track-data/*.json', { import: 'default' })

function idOfPath(path: string): string {
  return path.slice(TRACK_DATA_PREFIX.length, -TRACK_DATA_SUFFIX.length)
}

const PATH_BY_ID: ReadonlyMap<string, string> = new Map(Object.keys(loaders).map((path) => [idOfPath(path), path]))

/** Glob-relative source path of every track file, keyed by track id. */
export const DATA_TRACK_SOURCE_PATHS: ReadonlyMap<string, string> = PATH_BY_ID

/** Glob-relative source path of a track's JSON (`./track-data/<ID>.json`), if one exists. */
export function getDataTrackSourcePath(trackId: string): string | undefined {
  return PATH_BY_ID.get(trackId)
}

export function isDataDrivenTrack(trackId: string): boolean {
  return PATH_BY_ID.has(trackId)
}

/** Every track id with a JSON file, in file-name order. */
export function getDataTrackIds(): string[] {
  return [...PATH_BY_ID.keys()].sort()
}

export type DataTrackLoad = { ok: true; definition: TrackDefinition } | { ok: false; error: string }

const loaded = new Map<string, Promise<DataTrackLoad>>()

/**
 * The parsed definition of a track: its JSON chunk and the schema are fetched
 * on first use, the result is cached. Never rejects; a failure says why. A
 * failed fetch is not cached, so a later call retries it.
 */
export function loadDataTrackDefinition(trackId: string): Promise<DataTrackLoad> {
  let pending = loaded.get(trackId)
  if (!pending) {
    pending = loadOnce(trackId)
    loaded.set(trackId, pending)
  }
  return pending
}

async function loadOnce(trackId: string): Promise<DataTrackLoad> {
  const path = PATH_BY_ID.get(trackId)
  const loader = path !== undefined ? loaders[path] : undefined
  if (path === undefined || !loader) return { ok: false, error: `No track JSON for ${trackId}` }
  let raw: unknown
  let schema: typeof import('../schemas/track')
  try {
    ;[raw, schema] = await Promise.all([loader(), import('../schemas/track')])
  } catch (error) {
    loaded.delete(trackId)
    return { ok: false, error: `Track ${trackId} failed to load: ${error instanceof Error ? error.message : String(error)}` }
  }
  const result = schema.validateTrackDefinition(raw)
  if (!result.ok) {
    console.error(`[track-data-registry] Invalid track ${path}: ${schema.formatTrackValidationErrors(result.errors)}`)
    return { ok: false, error: schema.formatTrackValidationErrors(result.errors) }
  }
  if (result.definition.id !== trackId) {
    return { ok: false, error: `${path} defines ${result.definition.id}, not ${trackId}` }
  }
  return { ok: true, definition: result.definition }
}
