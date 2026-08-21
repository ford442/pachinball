/**
 * Ball Type Enumeration
 * Defines the three tiers of collectible balls in the game
 */
export enum BallType {
  STANDARD = 'standard',
  GOLD_PLATED = 'gold_plated',
  SOLID_GOLD = 'solid_gold'
}

/**
 * Ball Spawn Configuration
 * Central configuration for ball spawning weights, points, and fever multipliers
 */
export const BALL_SPAWN_CONFIG = {
  // Spawn weights (must sum to <= 1.0)
  weights: {
    [BallType.STANDARD]: 0.75,      // 75% standard
    [BallType.GOLD_PLATED]: 0.20,   // 20% gold-plated
    [BallType.SOLID_GOLD]: 0.05     // 5% solid gold
  },

  // Points awarded on collection
  points: {
    [BallType.STANDARD]: 0,
    [BallType.GOLD_PLATED]: 1000,
    [BallType.SOLID_GOLD]: 5000
  },

  // Multipliers during fever mode
  feverMultipliers: {
    [BallType.STANDARD]: 1,
    [BallType.GOLD_PLATED]: 2,
    [BallType.SOLID_GOLD]: 5
  }
} as const

/**
 * Gold Ball Bonus Thresholds
 * Defines bonus and jackpot thresholds for collecting gold balls
 */
export const GOLD_BALL_THRESHOLDS = {
  firstBonus: 5,      // 5 gold balls = bonus
  jackpot: 10         // 10 gold balls = jackpot
}

/**
 * Ball Tier Configuration Interface
 * Complete configuration for each ball type including material and effect mapping
 */
export interface BallTierConfig {
  type: BallType
  spawnWeight: number
  basePoints: number
  bonusMultiplier: number
  materialKey: string
  trailColor: string
  collectEffect: string
}

/**
 * Ball Tiers Record
 * Complete tier configuration for all ball types
 */
export const BALL_TIERS: Record<BallType, BallTierConfig> = {
  [BallType.STANDARD]: {
    type: BallType.STANDARD,
    spawnWeight: 0.75,
    basePoints: 0,
    bonusMultiplier: 1,
    materialKey: 'enhancedChrome',
    trailColor: '#00ffff',
    collectEffect: 'standardCollect'
  },
  [BallType.GOLD_PLATED]: {
    type: BallType.GOLD_PLATED,
    spawnWeight: 0.20,
    basePoints: 1000,
    bonusMultiplier: 2,
    materialKey: 'goldPlated',
    trailColor: '#ffd700',
    collectEffect: 'goldCollect'
  },
  [BallType.SOLID_GOLD]: {
    type: BallType.SOLID_GOLD,
    spawnWeight: 0.05,
    basePoints: 5000,
    bonusMultiplier: 5,
    materialKey: 'solidGold',
    trailColor: '#ffb700',
    collectEffect: 'jackpot'
  }
}
