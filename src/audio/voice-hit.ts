/**
 * The one message the main thread posts to the pachinko voice worklet, and the constants both
 * sides share. No DOM and no worklet globals in here: `AudioEngine` (main thread) and the
 * processor (AudioWorkletGlobalScope) both import it, and the worklet bundle inlines it.
 *
 * Presentation only. Nothing in the voice path reads or writes sim state.
 */

/** Voices the processor can sound at once. A new hit past this steals the quietest. */
export const VOICE_POOL_SIZE = 24

/** Playfield half-width used before any cabinet has loaded; all four presets are 28 wide. */
const DEFAULT_PLAYFIELD_PAN_HALF_WIDTH = 14

let panHalfWidth = DEFAULT_PLAYFIELD_PAN_HALF_WIDTH

/** Set once per cabinet build from the preset's playfield width: a contact at the wall pans to ±1. */
export function setPlayfieldPanWidth(playfieldWidth: number): void {
  panHalfWidth = playfieldWidth > 0 ? playfieldWidth / 2 : DEFAULT_PLAYFIELD_PAN_HALF_WIDTH
}

/**
 * One impact voice. Every field is already a finite number in range: the sender clamps, the
 * processor does not re-parse.
 */
export interface VoiceHit {
  /** Normalised 0–1 contact velocity. */
  velocity: number
  /** Normalised 0–1 impact energy; gain and length. Below {@link MIN_AUDIBLE_IMPACT} it is dropped. */
  impact: number
  /** 0–1 metallic ring amount (peg 1 … drain 0.12). */
  metal: number
  /** 0–1 ball angular speed, shifts the ring pitch. */
  spin: number
  /** 0 or 1. Opens the low-pass a little. */
  fever: number
  /** -1 (left) … 1 (right). */
  pan: number
}

/** An impact quieter than this is not worth a voice. */
export const MIN_AUDIBLE_IMPACT = 0.02

/** Playfield x → pan in [-1, 1]. */
export function panFromPlayfieldX(x: number, halfWidth: number = panHalfWidth): number {
  if (!Number.isFinite(x)) return 0
  const pan = x / halfWidth
  return pan < -1 ? -1 : pan > 1 ? 1 : pan
}
