/**
 * Per-track manifest definitions — the single registration surface for a track.
 *
 * One entry per AdventureTrackType carries its portal anchor, zone theming,
 * optional campaign catalog metadata, and its build dispatch: either a TS
 * `builder` function or a `dataPath` pointing at declarative JSON.
 *
 * The entries live in two data modules to stay under the file-size limit. The
 * concatenated order IS observable — it equals `AdventureTrackType` order and
 * drives `TRACK_CATALOG` key order — so add a new track to the module that
 * holds its neighbours, in enum position (`tests/track-manifest.test.ts` pins it).
 */

import type { TrackManifest } from './track-manifest-types'
import { CORE_MANIFEST_DATA } from './track-manifest-data-core'
import { EXTENDED_MANIFEST_DATA } from './track-manifest-data-extended'

export const MANIFEST_DATA: TrackManifest[] = [...CORE_MANIFEST_DATA, ...EXTENDED_MANIFEST_DATA]
