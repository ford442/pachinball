/**
 * The visual language's plain constants: palette hex strings, emissive intensities and quality
 * tiers. No Babylon import, so gameplay code (scoring, collision handlers, input actions) and the
 * headless replay runner (#528) can name a colour without loading the renderer.
 * `visual-language.ts` re-exports all of it next to the `Color3` helpers.
 */

/** Primary accent colors - used for energy states and interactive elements */
export const PALETTE = {
  /** Primary cyan - main interactive color, neutral/idle state */
  CYAN: '#00d9ff',
  
  /** Magenta/Pink - secondary accent, jackpot/reward states */
  MAGENTA: '#ff00aa',
  
  /** Purple - deep energy, feeders, special elements */
  PURPLE: '#8800ff',
  
  /** Gold/Yellow - fever mode, high energy, success */
  GOLD: '#ffd700',
  
  /** Red/Orange - danger, warning, reach state */
  ALERT: '#ff4400',
  
  /** Green - adventure mode, matrix/cyberpunk aesthetic */
  MATRIX: '#00ff44',
  
  /** White - pure energy, flash effects */
  WHITE: '#ffffff',
  
  /** Ambient dark blue - subtle emissive, background elements */
  AMBIENT: '#001133',
} as const

/** Standardized emissive intensity multipliers */
export const INTENSITY = {
  /** Subtle ambient glow - background elements */
  AMBIENT: 0.2,
  
  /** Normal operational glow - always-on elements */
  NORMAL: 0.5,
  
  /** Active state - interactive elements engaged */
  ACTIVE: 1.0,
  
  /** High energy - fever, jackpot, special modes */
  HIGH: 1.5,
  
  /** Maximum flash - impacts, transitions */
  FLASH: 2.0,
  
  /** Bloom threshold kick - brief spikes */
  BURST: 3.0,
} satisfies Record<string, number>

export enum QualityTier {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
}
