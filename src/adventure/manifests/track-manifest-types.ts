/**
 * TrackManifest — single registration surface for adventure tracks.
 *
 * Each manifest consolidates zone theming, portal anchors, campaign catalog
 * metadata (optional), and build dispatch (TS builder or JSON data path).
 */

import type { AdventureTrackType } from '../adventure-types'
import type { TrackModeType } from '../adventure-types'
import type { VisualThemeColor } from '../../game-elements/visual-language'
import type { TrackBuilder } from '../track-builder'

/** Zone theming / story metadata (derived into ZONE_REGISTRY). */
export interface TrackManifestZone {
  name: string
  storyText: string
  videoUrl?: string
  musicTrackId: string
  primaryColor: string
  accentColor: string
  interiorColor: string
  isMajorTransition: boolean
  glowIntensity: number
}

/** Campaign catalog metadata (derived into TRACK_CATALOG when present). */
export interface TrackManifestCatalog {
  description: string
  difficulty: 'easy' | 'medium' | 'hard' | 'expert'
  modeType: TrackModeType
  recommendedScore: number
  timeLimitSeconds: number
  timeoutPenaltyMultiplier: number
  unlockedBy?: string
  theme: string
  visualTheme?: {
    primary: VisualThemeColor
    accent?: VisualThemeColor
    surfaceTint?: 'PLAYFIELD' | 'PLAYFIELD_DEEP' | 'GLASS'
  }
}

export type TrackBuildKind = 'ts' | 'json'

/** TS track builder function signature. */
export type TrackBuilderFn = (ctx: TrackBuilder) => void

/** Lazy loader for TS track builders (code-split per track). */
export type TrackBuilderLoader = () => Promise<TrackBuilderFn>

/** Fields shared by both build kinds. */
interface TrackManifestBase {
  id: AdventureTrackType
  startAnchor: { x: number; y: number; z: number }
  zone: TrackManifestZone
  /** Present only for campaign / catalog tracks. */
  catalog?: TrackManifestCatalog
  /**
   * Optional CAMERA_PRESETS key. Defaults to the track id, then to DEFAULT.
   * JSON tracks may also override this via the schema's `cameraPresetId`.
   */
  cameraPresetId?: string
}

/** Hand-tuned TS track — geometry emitted by a lazily loaded builder function. */
export interface TsTrackManifest extends TrackManifestBase {
  buildKind: 'ts'
  loadBuilder: TrackBuilderLoader
}

/** Declarative track — geometry compiled from a JSON definition. */
export interface JsonTrackManifest extends TrackManifestBase {
  buildKind: 'json'
  /**
   * Glob-relative path of the backing JSON, as keyed by `track-data-registry`
   * (e.g. `./track-data/GLITCH_SPIRE.json`). Cross-checked at registry build
   * time against the definition actually loaded for this track id.
   */
  dataPath: string
}

/**
 * Complete track manifest — one entry per track in `track-manifest-data.ts`,
 * aggregated in `registry.ts`. The `buildKind` discriminant makes the build
 * dispatch total: a TS track must supply a `loadBuilder`, a JSON track a `dataPath`.
 */
export type TrackManifest = TsTrackManifest | JsonTrackManifest
