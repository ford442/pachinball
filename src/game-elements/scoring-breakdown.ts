export interface ScoringBreakdownSnapshot {
  bumpers: number
  specialObstacles: number
  goldBalls: number
  comboBonus: number
  timeGoalBonus: number
  premiumBonus: number
  other: number
  total: number
}

const SCORE_SOURCES = {
  BUMPER: new Set(['bumper-hit', 'target-hit']),
  SPECIAL_OBSTACLE: new Set([
    'gate-opened',
    'ball-trapped',
    'ball-released',
    'ball-released-timeout',
    'launcher-fired',
    'launcher-triggered',
  ]),
  GOLD: new Set(['gold-ball-collect']),
  COMBO: new Set(['combo-chain-bonus']),
  TIME_GOAL: new Set(['adventure-goal-award', 'adventure-end-bonus']),
  PREMIUM: new Set(['jackpot', 'slot-win']),
} as const

const STORAGE_KEY = 'pachinball.scoring-breakdown'

type MutableBreakdown = Omit<ScoringBreakdownSnapshot, 'total'>

const EMPTY_BREAKDOWN: MutableBreakdown = {
  bumpers: 0,
  specialObstacles: 0,
  goldBalls: 0,
  comboBonus: 0,
  timeGoalBonus: 0,
  premiumBonus: 0,
  other: 0,
}

export class ScoringBreakdownManager {
  private breakdown: MutableBreakdown = { ...EMPTY_BREAKDOWN }

  constructor() {
    this.breakdown = this.loadFromStorage()
  }

  reset(): void {
    this.breakdown = { ...EMPTY_BREAKDOWN }
    this.persist()
  }

  recordScore(points: number, source: string): void {
    if (!Number.isFinite(points) || points <= 0) return

    if (SCORE_SOURCES.BUMPER.has(source)) {
      this.breakdown.bumpers += points
    } else if (SCORE_SOURCES.SPECIAL_OBSTACLE.has(source)) {
      this.breakdown.specialObstacles += points
    } else if (SCORE_SOURCES.GOLD.has(source)) {
      this.breakdown.goldBalls += points
    } else if (SCORE_SOURCES.COMBO.has(source)) {
      this.breakdown.comboBonus += points
    } else if (SCORE_SOURCES.TIME_GOAL.has(source)) {
      this.breakdown.timeGoalBonus += points
    } else if (SCORE_SOURCES.PREMIUM.has(source)) {
      this.breakdown.premiumBonus += points
    } else {
      this.breakdown.other += points
    }

    this.persist()
  }

  getSnapshot(): ScoringBreakdownSnapshot {
    const total =
      this.breakdown.bumpers +
      this.breakdown.specialObstacles +
      this.breakdown.goldBalls +
      this.breakdown.comboBonus +
      this.breakdown.timeGoalBonus +
      this.breakdown.premiumBonus +
      this.breakdown.other

    return {
      ...this.breakdown,
      total,
    }
  }

  private loadFromStorage(): MutableBreakdown {
    if (typeof localStorage === 'undefined') {
      return { ...EMPTY_BREAKDOWN }
    }
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return { ...EMPTY_BREAKDOWN }
      const parsed = JSON.parse(raw) as Partial<MutableBreakdown>
      return {
        bumpers: this.toSafeNumber(parsed.bumpers),
        specialObstacles: this.toSafeNumber(parsed.specialObstacles),
        goldBalls: this.toSafeNumber(parsed.goldBalls),
        comboBonus: this.toSafeNumber(parsed.comboBonus),
        timeGoalBonus: this.toSafeNumber(parsed.timeGoalBonus),
        premiumBonus: this.toSafeNumber(parsed.premiumBonus),
        other: this.toSafeNumber(parsed.other),
      }
    } catch (error) {
      console.warn('[ScoringBreakdown] Failed to load local state:', error)
      return { ...EMPTY_BREAKDOWN }
    }
  }

  private persist(): void {
    if (typeof localStorage === 'undefined') {
      return
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.breakdown))
    } catch (error) {
      console.warn('[ScoringBreakdown] Failed to persist local state:', error)
    }
  }

  private toSafeNumber(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0
  }
}

let scoringBreakdownManagerInstance: ScoringBreakdownManager | null = null

export function getScoringBreakdownManager(): ScoringBreakdownManager {
  scoringBreakdownManagerInstance ||= new ScoringBreakdownManager()
  return scoringBreakdownManagerInstance
}

export function resetScoringBreakdownManager(): void {
  scoringBreakdownManagerInstance = null
}
