/**
 * Daily Cascade mode state — seed, layout cache, Randomize.
 */

import {
  dailySeedId,
  randomU32Seed,
  seedFromDailyId,
} from './seeded-rng'
import {
  generateTableLayout,
  type TableLayout,
  type FeederKey,
} from './daily-cascade-layout'

export type DailyCascadeMode = 'vanilla' | 'daily' | 'free'

export class DailyCascadeState {
  private mode: DailyCascadeMode = 'vanilla'
  private seed = 0
  private seedId = ''
  private layout: TableLayout | null = null
  /** True after a mutator layout was applied; vanilla start must rebuild once. */
  private mutatorApplied = false

  getMode(): DailyCascadeMode {
    return this.mode
  }

  getSeed(): number {
    return this.seed
  }

  getSeedId(): string {
    return this.seedId
  }

  getLayout(): TableLayout | null {
    return this.layout
  }

  wasMutatorApplied(): boolean {
    return this.mutatorApplied
  }

  markMutatorApplied(applied: boolean): void {
    this.mutatorApplied = applied
  }

  setMode(mode: DailyCascadeMode): void {
    if (this.mode === mode) return
    this.mode = mode
    this.layout = null
    if (mode === 'daily') {
      this.applyDailySeed()
    } else if (mode === 'free') {
      if (!this.seedId.startsWith('free-')) {
        this.randomize()
      }
    } else {
      this.seed = 0
      this.seedId = ''
      this.layout = null
    }
  }

  applyDailySeed(date: Date = new Date()): void {
    const id = dailySeedId(date)
    this.seedId = id
    this.seed = seedFromDailyId(id)
    this.layout = null
  }

  randomize(): void {
    this.mode = 'free'
    this.seed = randomU32Seed()
    this.seedId = `free-${this.seed.toString(16)}`
    this.layout = null
  }

  setFreeSeed(seed: number): void {
    this.mode = 'free'
    this.seed = seed >>> 0
    this.seedId = `free-${this.seed.toString(16)}`
    this.layout = null
  }

  /**
   * Generate + cache layout for current seed (daily/free). Vanilla returns null.
   */
  ensureLayout(): TableLayout | null {
    if (this.mode === 'vanilla') {
      return null
    }
    if (this.mode === 'daily') {
      const today = dailySeedId()
      if (this.seedId !== today) {
        this.applyDailySeed()
      }
    }
    if (!this.layout) {
      this.layout = generateTableLayout({
        seed: this.seed,
        seedId: this.seedId,
      })
    }
    return this.layout
  }

  /** Leaderboard map_id for current mode. */
  getLeaderboardMapId(fallbackMapId: string): string {
    if (this.mode === 'daily') {
      return `daily-cascade-${this.seedId || dailySeedId()}`
    }
    if (this.mode === 'free') {
      return `free-cascade-${(this.seed >>> 0).toString(16)}`
    }
    return fallbackMapId
  }

  getFeedersEnabled(): Record<FeederKey, boolean> | null {
    const layout = this.ensureLayout()
    return layout?.feedersEnabled ?? null
  }

  displaySeedLabel(): string {
    if (this.mode === 'daily') {
      return `Daily: ${this.seedId || dailySeedId()}`
    }
    if (this.mode === 'free') {
      return `Seed: ${(this.seed >>> 0).toString(16)}`
    }
    return 'Vanilla table'
  }
}

let instance: DailyCascadeState | null = null

export function getDailyCascadeState(): DailyCascadeState {
  if (!instance) instance = new DailyCascadeState()
  return instance
}

export function resetDailyCascadeState(): void {
  instance = null
}
