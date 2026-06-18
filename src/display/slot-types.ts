/**
 * Slot Machine Types
 *
 * Pure TypeScript types/enums for the backbox slot mini-game.
 * No Babylon.js or Rapier dependencies — safe for unit tests.
 */

export enum SlotSymbol {
  SEVEN = '7',
  DIAMOND = 'D',
  BELL = 'B',
  CHERRY = 'C',
  GRAPE = 'G',
  STAR = 'S',
}

export enum SlotActivationMode {
  ALWAYS = 'always',
  CHANCE = 'chance',
  SCORE = 'score',
  HYBRID = 'hybrid',
}

export enum SlotSpinState {
  IDLE = 'idle',
  STARTING = 'starting',
  SPINNING = 'spinning',
  STOPPING = 'stopping',
  STOPPED = 'stopped',
  JACKPOT = 'jackpot',
}

export interface SlotReelConfig {
  baseSpeed: number
  speedVariance: number
  stopDelay: number
}

export interface SlotWinCombination {
  /** Human-readable name for logs/UI */
  name: string
  /**
   * If non-null, the combination requires this many occurrences of the
   * specified symbol. If null, it matches any triple.
   */
  symbol: SlotSymbol | null
  /** How many reels must show the symbol (3 = triple, 2 = double) */
  matchCount: number
  /** Display/payout multiplier */
  multiplier: number
  /** Points awarded = multiplier * basePoints (except jackpot) */
  points: number
  /** Does this combination trigger the main jackpot sequence? */
  isJackpot: boolean
  /** Emit slot:nearmiss instead of slot:win when true */
  isNearMiss?: boolean
}

export interface SlotMachineConfig {
  activationMode: SlotActivationMode
  /** 0.0 - 1.0 chance used in CHANCE / HYBRID modes */
  chancePercent: number
  /** Score interval used in SCORE / HYBRID modes */
  scoreThreshold: number
  /** Minimum total spin time in seconds */
  minSpinDuration: number
  /** Maximum total spin time in seconds */
  maxSpinDuration: number
  /** Per-reel speed + stop-delay configuration */
  reels: SlotReelConfig[]
  /** Ordered symbol set shown on the reels */
  symbols: SlotSymbol[]
  /** Spawn weights — higher = more frequent */
  symbolWeights: Record<SlotSymbol, number>
  /** Winning combinations, evaluated in order */
  winCombinations: SlotWinCombination[]
  /** Base points for non-jackpot wins (points = multiplier * basePoints) */
  basePoints: number
  /** Jackpot flat award */
  jackpotPoints: number
  /** Cooldown between activations in seconds */
  cooldownSeconds: number
  /** Enable synthesized slot SFX */
  enableSounds: boolean
  /** Enable cabinet light chase / flash */
  enableLightEffects: boolean
}

export interface SlotSpinPlan {
  /** Total spin duration before the first reel begins to stop */
  spinDuration: number
  /** Per-reel rotation speed in symbols/sec (approximate) */
  reelSpeeds: number[]
  /** Per-reel delay after spinDuration before this reel locks */
  stopDelays: number[]
  /** Final symbol for each reel */
  targetSymbols: SlotSymbol[]
}

export interface SlotResult {
  /** Winning combination detected, or null */
  combination: SlotWinCombination | null
  /** Final 3 symbols */
  symbols: SlotSymbol[]
  /** Total points to award (0 for near-miss / no win) */
  points: number
  /** True when two sevens appear but the third symbol is not a seven */
  nearMiss: boolean
}

export interface SlotActivationState {
  lastActivationTime: number
  lastActivationScore: number
  isSpinning: boolean
}
