import { GOLD_BALL_THRESHOLDS } from './balls'

/** Lane rollover sensor category — maps to GAME_TUNING.scoring.laneRollover keys. */
export type LaneRolloverKind = 'launch' | 'inlane' | 'outlane' | 'drainApproach'

export interface LaneSensorConfig {
  id: string
  kind: LaneRolloverKind
  position: { x: number; y: number; z: number }
  halfExtents: { x: number; y: number; z: number }
}

export interface GameTuning {
  scoring: {
    bumperHitBase: number
    targetHitBase: number
    jackpotBonus: number
    adventureEndBonus: number
    laneRollover: Record<LaneRolloverKind, number>
  }
  obstacle: {
    spinnerHitBase: number
    trapCatchBase: number
    trapReleaseBase: number
    trapTimeoutReleaseBase: number
    launcherFireBase: number
    launcherTriggerBase: number
    gateOpenBase: number
  }
  combo: {
    feverThreshold: number
    expirySeconds: number
    multiplierDivisor: number
    chainWindowSeconds: number
    chainDistinctThreshold: number
    chainMultiplier: number
    chainCooldownSeconds: number
    namedChains: Array<{
      name: string
      sequence: string[]
      bonusPoints: number
      multiplierBonus: number
    }>
  }
  timing: {
    nudgeCooldownMs: number
    storyVideoWaitMs: number
    tiltBloomResetMs: number
    idleCallbackTimeoutMs: number
    cosmeticFallbackDelayMs: number
  }
  multiball: {
    maxChainBalls: number
    multiplierPerExtraBall: number
    triggerGoldThresholds: number[]
    drainGraceMs: number
  }
  feedback: {
    comboWindowSeconds: number
    comboHitsPerMultiplier: number
    comboMaxMultiplier: number
    ballSaveGraceSeconds: number
    bonusTallyComboPeakBase: number
    bonusTallyAnimationMs: number
  }
  /**
   * Gold ball streak bonus.  Consecutive collections within `windowSeconds`
   * earn an escalating multiplier on top of each ball's base points.
   * See GoldBallStreakSystem for implementation.
   */
  goldBall: {
    streakWindowSeconds: number
    streakPerBallBonus: number
    streakMaxMultiplier: number
  }
}

export const GAME_TUNING = {
  scoring: {
    // 100 pts per bumper hit at 1× combo.  At ~3 hits/sec average, the player
    // earns ~300 pts/sec base — climbing to ~900 pts/sec at 3× combo.  This
    // puts NEON_HELIX's 50 000-point goal comfortably within its 120-second
    // window while still requiring consistent play.  Adjust this value first
    // if tracks feel too easy or too hard.
    bumperHitBase: 100,
    targetHitBase: 500,
    jackpotBonus: 100000,
    adventureEndBonus: 5000,
    laneRollover: {
      launch: 25,
      inlane: 15,
      outlane: 10,
      drainApproach: 20,
    },
  },
  obstacle: {
    spinnerHitBase: 150,
    trapCatchBase: 75,
    trapReleaseBase: 200,
    trapTimeoutReleaseBase: 120,
    launcherFireBase: 60,
    launcherTriggerBase: 90,
    gateOpenBase: 35,
  },
  combo: {
    feverThreshold: 12,
    expirySeconds: 2.0,
    multiplierDivisor: 3,
    chainWindowSeconds: 4,
    chainDistinctThreshold: 3,
    chainMultiplier: 1.5,
    chainCooldownSeconds: 0.8,
    namedChains: [
      {
        name: 'SPIN LAUNCH SLAM',
        sequence: ['spinner', 'launcher', 'bumper'],
        bonusPoints: 250,
        multiplierBonus: 0.2,
      },
      {
        name: 'LOCK BREAKER',
        sequence: ['gate', 'trap', 'bumper'],
        bonusPoints: 180,
        multiplierBonus: 0.15,
      },
    ],
  },
  timing: {
    nudgeCooldownMs: 450,
    storyVideoWaitMs: 3000,
    tiltBloomResetMs: 1000,
    idleCallbackTimeoutMs: 500,
    cosmeticFallbackDelayMs: 100,
  },
  multiball: {
    maxChainBalls: 3,
    multiplierPerExtraBall: 0.35,
    triggerGoldThresholds: [GOLD_BALL_THRESHOLDS.jackpot, GOLD_BALL_THRESHOLDS.jackpot * 2],
    drainGraceMs: 4000,
  },
  feedback: {
    comboWindowSeconds: 2.8,
    comboHitsPerMultiplier: 2,
    comboMaxMultiplier: 6,
    ballSaveGraceSeconds: 7,
    bonusTallyComboPeakBase: 250,
    bonusTallyAnimationMs: 1500,
  },
  goldBall: {
    // Second consecutive gold ball within 5 s earns 1.5×, third 2×, etc., capped at 5×.
    streakWindowSeconds: 5.5,
    streakPerBallBonus: 0.55,
    streakMaxMultiplier: 5,
  },
} as const satisfies GameTuning

/** Base points for a lane rollover sensor kind (no magic numbers in dispatch code). */
export function getLaneRolloverPoints(kind: LaneRolloverKind): number {
  return GAME_TUNING.scoring.laneRollover[kind]
}
