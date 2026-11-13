/**
 * @deprecated Legacy free-form progress and cosmetic-reward persistence only.
 * Campaign progression truth is AdventureTrackProgression + AdventureProgressionSupervisor.
 * Do not add features here. Do not import this module from campaign catalog/supervisor code.
 *
 * Adventure State — persisted free-form progress (unlocked maps, scores) and the
 * ball-trail / neon-pattern / skin rewards a player earned on the retired
 * level-select flow. The level list that flow ran on (`ADVENTURE_LEVELS`) is
 * gone: the Levels button now opens the campaign stage map. The stored record
 * keeps its shape and key, so earlier saves load and are written back intact.
 */

import type { TableMapType } from '../config/table-maps'
import * as v from 'valibot'
import { apiFetch } from '../config'
import { parseJsonWith, pickDefined } from '../schemas/schema-kit'
import { StoredAdventureProgressSchema, type RewardType, type UnlockableReward } from '../schemas/storage'

export type { RewardType, UnlockableReward } from '../schemas/storage'

export interface AdventureProgress {
  currentLevel: string
  currentMap: TableMapType
  completedLevels: string[]
  unlockedMaps: TableMapType[]
  unlockedRewards: UnlockableReward[]
  totalScore: number
  bestScores: Record<string, number>
  lastPlayed: string
}

const STORAGE_KEY = 'pachinball_adventure_progress'

/** Reward definitions, by reward id. Saves may hold any of these as unlocked. */
export const FREE_FORM_REWARDS: readonly UnlockableReward[] = [
  { id: 'neon-trail', name: 'Neon Trail', type: 'ball-trail', unlockedAt: '', equipped: false },
  { id: 'cyber-pattern', name: 'Cyber Pattern', type: 'neon-pattern', unlockedAt: '', equipped: false },
  { id: 'quantum-skin', name: 'Quantum Skin', type: 'skin', unlockedAt: '', equipped: false },
  { id: 'singularity-trail', name: 'Singularity Trail', type: 'ball-trail', unlockedAt: '', equipped: false },
  { id: 'glitch-pattern', name: 'Glitch Pattern', type: 'neon-pattern', unlockedAt: '', equipped: false },
  { id: 'matrix-skin', name: 'Matrix Skin', type: 'skin', unlockedAt: '', equipped: false },
  { id: 'cyan-trail', name: 'Cyan Energy Trail', type: 'ball-trail', unlockedAt: '', equipped: false },
  { id: 'master-pattern', name: 'Master Neon', type: 'neon-pattern', unlockedAt: '', equipped: false },
]

function defaultProgress(): AdventureProgress {
  return {
    currentLevel: 'level-1-neon',
    currentMap: 'neon-helix',
    completedLevels: [],
    unlockedMaps: ['neon-helix'],
    unlockedRewards: [],
    totalScore: 0,
    bestScores: {},
    lastPlayed: new Date().toISOString(),
  }
}

/**
 * @deprecated Legacy free-form progress / cosmetic-reward persistence only.
 * Campaign progression truth is AdventureTrackProgression + AdventureProgressionSupervisor.
 * Do not add new campaign features here — use TRACK_CATALOG and the supervisor instead.
 */
export class AdventureState {
  private progress: AdventureProgress

  constructor() {
    this.progress = this.loadProgress()
  }

  /**
   * Get current progress
   */
  getProgress(): AdventureProgress {
    return { ...this.progress }
  }

  // =======================================================================
  // REWARD SYSTEM
  // =======================================================================

  /**
   * Unlock a reward by ID
   */
  unlockReward(rewardId: string): boolean {
    if (this.progress.unlockedRewards.some(r => r.id === rewardId)) {
      return false
    }

    const rewardDef = FREE_FORM_REWARDS.find(r => r.id === rewardId)
    if (!rewardDef) {
      console.warn(`[AdventureState] Unknown reward: ${rewardId}`)
      return false
    }

    this.progress.unlockedRewards.push({
      ...rewardDef,
      unlockedAt: new Date().toISOString(),
      equipped: false,
    })
    this.saveProgress()
    return true
  }

  /**
   * Equip a reward by ID
   */
  equipReward(rewardId: string): boolean {
    const reward = this.progress.unlockedRewards.find(r => r.id === rewardId)
    if (!reward) {
      console.warn(`[AdventureState] Cannot equip - reward not unlocked: ${rewardId}`)
      return false
    }

    // Unequip any other reward of the same type
    this.progress.unlockedRewards.forEach(r => {
      if (r.type === reward.type && r.id !== rewardId) {
        r.equipped = false
      }
    })

    reward.equipped = true
    this.saveProgress()
    return true
  }

  /**
   * Get the equipped reward of a specific type
   */
  getEquippedReward(type: RewardType): UnlockableReward | null {
    return this.progress.unlockedRewards.find(r => r.type === type && r.equipped) || null
  }

  /**
   * Get all unlocked rewards
   */
  getUnlockedRewards(): UnlockableReward[] {
    return [...this.progress.unlockedRewards]
  }

  // =======================================================================
  // STORAGE & PERSISTENCE
  // =======================================================================

  private loadProgress(): AdventureProgress {
    try {
      const parsed = parseJsonWith(StoredAdventureProgressSchema, localStorage.getItem(STORAGE_KEY))
      // Each field is checked; a missing or mistyped one takes its default.
      if (parsed) return { ...defaultProgress(), ...pickDefined(parsed) }
    } catch (e) {
      console.warn('[AdventureState] Failed to load progress:', e)
    }

    return defaultProgress()
  }

  private saveProgress(): void {
    try {
      this.progress.lastPlayed = new Date().toISOString()
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.progress))
    } catch (e) {
      console.warn('[AdventureState] Failed to save progress:', e)
    }
  }

  /**
   * Sync progress to backend
   */
  async syncToBackend(): Promise<void> {
    const result = await apiFetch(
      '/adventure/progress',
      v.unknown(),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.progress),
      }
    )

    if (result) {
      console.log('[AdventureState] Progress synced to backend')
    } else {
      console.warn('[AdventureState] Backend sync failed')
    }
  }

  /**
   * Fetch progress from backend
   */
  async fetchFromBackend(): Promise<void> {
    const backendProgress = await apiFetch('/adventure/progress', StoredAdventureProgressSchema)

    if (backendProgress?.lastPlayed !== undefined && backendProgress.lastPlayed > this.progress.lastPlayed) {
      this.progress = { ...this.progress, ...pickDefined(backendProgress) }
      this.saveProgress()
      console.log('[AdventureState] Progress loaded from backend')
    }
  }

  /**
   * Reset all progress
   */
  resetProgress(): void {
    this.progress = defaultProgress()
    this.saveProgress()
    console.log('[AdventureState] Progress reset')
  }
}

// Singleton instance
let adventureStateInstance: AdventureState | null = null

export function getAdventureState(): AdventureState {
  if (!adventureStateInstance) {
    adventureStateInstance = new AdventureState()
  }
  return adventureStateInstance
}

export function resetAdventureState(): void {
  adventureStateInstance?.resetProgress()
  adventureStateInstance = null
}
