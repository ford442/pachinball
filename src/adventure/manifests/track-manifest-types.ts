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

/**
 * Complete track manifest — one module per track in manifests/*.ts,
 * aggregated in registry.ts.
 */
export interface TrackManifest {
  id: AdventureTrackType
  startAnchor: { x: number; y: number; z: number }
  zone: TrackManifestZone
  /** Present only for campaign / catalog tracks. */
  catalog?: TrackManifestCatalog
  buildKind: TrackBuildKind
  /** Required for buildKind === 'ts'. Omitted for JSON tracks. */
  builder?: TrackBuilderFn
}
