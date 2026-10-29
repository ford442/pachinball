/**
 * Daily Cascade mode state — seed, layout cache, Randomize.
 */

import {
  dailySeedId,
  randomU32Seed,
  seedFromDailyId,
  seedFromWeeklyId,
  weeklySeedId,
} from '../core/seeded-rng'
import {
  generateTableLayout,
  type TableLayout,
  type FeederKey,
} from './daily-cascade-layout'

/** `weekly` plays this ISO week's machine (docs/DAILY_CASCADE.md → Weekly machine). */
export type DailyCascadeMode = 'vanilla' | 'daily' | 'free' | 'weekly'

export class DailyCascadeState {
  private mode: DailyCascadeMode = 'vanilla'
  private seed = 0
  private seedId = ''
  private layout: TableLayout | null = null
  /** True after a mutator layout was applied; vanilla start must rebuild once. */
  private mutatorApplied = false
  /** The weekly machine built for the current game, whichever way it was selected (mode, share link, replay). */
  private weekly: { seed: number; layout: TableLayout } | null = null
  /** The generator and validator: their own chunk, loaded by `loadWeekly()` (the entry chunk has no budget left for them). */
  private weeklyModule: typeof import('./weekly-machine') | null = null

  getMode(): DailyCascadeMode {
    return this.mode
  }

  getSeed(): number {
    return this.seed
  }

  getSeedId(): string {
    return this.seedId
  }

  /** The mode's seed, rolled over to the current ISO week first in weekly mode (a tab can outlive a week). */
  getModeSeed(): number {
    if (this.mode === 'weekly' && this.seedId !== weeklySeedId()) this.applyWeeklySeed()
    return this.seed
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
    } else if (mode === 'weekly') {
      this.applyWeeklySeed()
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

  applyWeeklySeed(date: Date = new Date()): void {
    const id = weeklySeedId(date)
    this.seedId = id
    this.seed = seedFromWeeklyId(id)
    this.layout = null
  }

  /** Load the weekly machine's generator. `startGame` awaits it before it needs `weeklyLayout()`. */
  async loadWeekly(): Promise<void> {
    this.weeklyModule ??= await import('./weekly-machine')
  }

  /**
   * The weekly machine's table for `seed`, built once per seed (after
   * `loadWeekly()`). Layout streams are keyed by the session seed, so
   * `startGame` seeds the session RNG with `seed` before it asks
   * (`weeklyMachineRng` throws otherwise). The machine stays active — for the
   * leaderboard id — until `clearWeekly()`.
   */
  weeklyLayout(seed: number): TableLayout {
    const wanted = seed >>> 0
    if (this.weekly?.seed !== wanted) {
      if (!this.weeklyModule) throw new Error('weekly machine not loaded: await loadWeekly() first')
      this.weekly = { seed: wanted, layout: this.weeklyModule.generateWeeklyLayout(wanted).layout }
    }
    return this.weekly.layout
  }

  /** A vanilla or cascade game started: the weekly machine no longer applies. */
  clearWeekly(): void {
    this.weekly = null
  }

  /** The weekly machine in play, or null. */
  getWeeklySeed(): number | null {
    return this.weekly?.seed ?? null
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
    // The weekly machine is built by `weeklyLayout()` once the session RNG is seeded; never here.
    if (this.mode === 'weekly') {
      return this.weekly?.layout ?? null
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
    if (this.weekly) {
      return `weekly-machine-${this.weekly.seed.toString(16)}`
    }
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
    if (this.mode === 'weekly') {
      return `Weekly: ${this.seedId || weeklySeedId()}`
    }
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
