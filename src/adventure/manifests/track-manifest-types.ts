/**
 * TrackManifest — single registration surface for adventure tracks.
 *
 * Each manifest consolidates zone theming, portal anchors, campaign catalog
 * metadata (optional), and the JSON data path the track is compiled from.
 */

import type { AdventureTrackType } from '../adventure-types'
import type { TrackModeType } from '../adventure-types'
import type { VisualThemeColor } from '../../game-elements/visual-language'

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

/** Every track is declarative JSON (the TS track modules were converted in #505 §A). */
export type TrackBuildKind = 'json'

/** One track's registration: anchor, zone theming, optional catalog entry, and its JSON. */
export interface TrackManifest {
  id: AdventureTrackType
  startAnchor: { x: number; y: number; z: number }
  zone: TrackManifestZone
  /** Present only for campaign / catalog tracks. */
  catalog?: TrackManifestCatalog
  /**
   * Optional CAMERA_PRESETS key. Defaults to the track id, then to DEFAULT.
   * The track's own `cameraPresetId` (schema) wins over this.
   */
  cameraPresetId?: string
  buildKind: TrackBuildKind
  /**
   * Glob-relative path of the backing JSON, as keyed by `track-data-registry`
   * (e.g. `./track-data/GLITCH_SPIRE.json`). Cross-checked at registry build
   * time against the track files that exist.
   */
  dataPath: string
}

