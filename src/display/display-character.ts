/**
 * Character take routing — pure planning for the backbox character layer.
 *
 * A character take is a poster (alpha PNG/WebP composited over the reels) plus
 * an optional loop. The poster is always the base: the LCD emoji walk-by is
 * suppressed only after it loads, and a failed poster restores the state's
 * ordinary image/video media. The loop is motion and is therefore gated by
 * reduced-motion, LOW tier, and photosensitive FEVER/JACKPOT.
 */

import { DisplayState, type StateMediaConfig } from '../game-elements/display-config'
import { QualityTier } from '../game-elements/visual-language'

export type CharacterLoopSkipReason = 'reduced-motion' | 'photosensitive' | 'low-tier'

export interface CharacterMediaPlan {
  /** Poster image for the character take, or null when none is configured. */
  posterUrl: string | null
  /** Loop video to play over the poster, or null when absent or gated off. */
  loopUrl: string | null
  /** Why a configured loop is not played. */
  loopSkippedReason?: CharacterLoopSkipReason
  /**
   * True when the state's own video must not load: the reels are meant to be
   * visible and the alpha poster composites over them, while the state video
   * plane would cover them.
   */
  suppressStateVideo: boolean
  /** State image to show when no poster is configured or the poster fails. */
  fallbackImageUrl: string
  /** State video to play when no poster is configured or the poster fails. */
  fallbackVideoUrl: string
}

export interface CharacterTakeStatus {
  poster: 'none' | 'loading' | 'loaded' | 'failed'
  loop: 'none' | 'skipped' | 'loading' | 'playing' | 'failed'
  /** True while a loaded poster or playing loop suppresses the emoji walk-by. */
  takeActive: boolean
}

const VIDEO_EXT = /\.(webm|mp4)(\?|$)/i
const IMAGE_EXT = /\.(png|jpe?g|webp)(\?|$)/i

/** States whose flashes are the photosensitive risk; their loops stay static. */
const FLASH_STATES: ReadonlySet<DisplayState> = new Set([DisplayState.FEVER, DisplayState.JACKPOT])

export function planCharacterMedia(
  media: StateMediaConfig,
  state: DisplayState,
  accessibility: { reducedMotion: boolean; photosensitive: boolean },
  tier: QualityTier,
): CharacterMediaPlan {
  const character = media.characterLayer?.trim() ?? ''
  let posterUrl: string | null = IMAGE_EXT.test(character) ? character : null
  let loopCandidate = media.characterLoop?.trim() ?? ''
  // Legacy: a characterLayer that names a video is a loop with no poster.
  if (!loopCandidate && VIDEO_EXT.test(character)) {
    loopCandidate = character
    posterUrl = null
  }

  let loopUrl: string | null = null
  let loopSkippedReason: CharacterLoopSkipReason | undefined
  if (loopCandidate) {
    if (accessibility.reducedMotion) {
      loopSkippedReason = 'reduced-motion'
    } else if (accessibility.photosensitive && FLASH_STATES.has(state)) {
      loopSkippedReason = 'photosensitive'
    } else if (tier === QualityTier.LOW) {
      loopSkippedReason = 'low-tier'
    } else {
      loopUrl = loopCandidate
    }
  }

  return {
    posterUrl,
    loopUrl,
    loopSkippedReason,
    suppressStateVideo: posterUrl !== null && (media.showReels ?? true),
    fallbackImageUrl: media.imagePath || '',
    fallbackVideoUrl: media.videoPath || '',
  }
}
