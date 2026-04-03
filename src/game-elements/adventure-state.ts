/**
 * Adventure State - Level Goals, Progression & Story System
 * 
 * Manages adventure mode progression:
 * - Level goals (hit pegs, survive time, reach score)
 * - Story sequences on level complete
 * - Progress persistence (localStorage + backend)
 * - Map unlocking
 * - Backbox video/text integration
 */

import type { DisplaySystem } from './display'
import type { TableMapType } from '../shaders/lcd-table'

export type GoalType = 'hit-pegs' | 'survive-time' | 'reach-score' | 'collect-items' | 'no-drain'

export interface LevelGoal {
  id: string
  type: GoalType
  target: number
  current: number
  description: string
}

export interface AdventureLevel {
  id: string
  name: string
  mapType: TableMapType
  goals: LevelGoal[]
  story: {
    intro: string
    complete: string
    videoUrl?: string
  }
  rewards: {
    scoreMultiplier: number
    unlockMap?: TableMapType
  }
}

export interface AdventureProgress {
  currentLevel: string
  currentMap: TableMapType
  completedLevels: string[]
  unlockedMaps: TableMapType[]
  totalScore: number
  bestScores: Record<string, number>
  lastPlayed: string
}

const STORAGE_KEY = 'pachinball_adventure_progress'
const API_ENDPOINT = '/api/adventure/progress'

// Define all adventure levels
export const ADVENTURE_LEVELS: AdventureLevel[] = [
  {
    id: 'level-1-neon',
    name: 'Neon Awakening',
    mapType: 'neon-helix',
    goals: [
      { id: 'g1-1', type: 'hit-pegs', target: 30, current: 0, description: 'Hit 30 pegs' },
      { id: 'g1-2', type: 'reach-score', target: 5000, current: 0, description: 'Score 5,000 points' },
    ],
    story: {
      intro: 'The Nexus awakens...',
      complete: 'First light achieved. The Cascade awaits.',
      videoUrl: '/videos/story/level1-complete.mp4',
    },
    rewards: {
      scoreMultiplier: 1.1,
      unlockMap: 'cyber-core',
    },
  },
  {
    id: 'level-2-cyber',
    name: 'Cyber Infiltration',
    mapType: 'cyber-core',
    goals: [
      { id: 'g2-1', type: 'survive-time', target: 60, current: 0, description: 'Survive 60 seconds' },
      { id: 'g2-2', type: 'hit-pegs', target: 50, current: 0, description: 'Hit 50 pegs' },
      { id: 'g2-3', type: 'reach-score', target: 10000, current: 0, description: 'Score 10,000 points' },
    ],
    story: {
      intro: 'Breaching the firewall...',
      complete: 'Access granted. Quantum pathways opening.',
      videoUrl: '/videos/story/level2-complete.mp4',
    },
    rewards: {
      scoreMultiplier: 1.2,
      unlockMap: 'quantum-grid',
    },
  },
  {
    id: 'level-3-quantum',
    name: 'Quantum Entanglement',
    mapType: 'quantum-grid',
    goals: [
      { id: 'g3-1', type: 'collect-items', target: 10, current: 0, description: 'Collect 10 quantum orbs' },
      { id: 'g3-2', type: 'reach-score', target: 15000, current: 0, description: 'Score 15,000 points' },
    ],
    story: {
      intro: 'Reality destabilizes...',
      complete: 'Quantum state collapsed. Singularity approaches.',
      videoUrl: '/videos/story/level3-complete.mp4',
    },
    rewards: {
      scoreMultiplier: 1.3,
      unlockMap: 'singularity-well',
    },
  },
  {
    id: 'level-4-singularity',
    name: 'Event Horizon',
    mapType: 'singularity-well',
    goals: [
      { id: 'g4-1', type: 'no-drain', target: 1, current: 0, description: 'Complete without draining' },
      { id: 'g4-2', type: 'reach-score', target: 25000, current: 0, description: 'Score 25,000 points' },
    ],
    story: {
      intro: 'Gravity becomes infinite...',
      complete: 'You have touched the void. All maps unlocked.',
      videoUrl: '/videos/story/level4-complete.mp4',
    },
    rewards: {
      scoreMultiplier: 1.5,
      unlockMap: 'glitch-spire',
    },
  },
  {
    id: 'level-5-glitch',
    name: 'System Corruption',
    mapType: 'glitch-spire',
    goals: [
      { id: 'g5-1', type: 'survive-time', target: 120, current: 0, description: 'Survive 120 seconds' },
      { id: 'g5-2', type: 'hit-pegs', target: 100, current: 0, description: 'Hit 100 pegs' },
      { id: 'g5-3', type: 'reach-score', target: 50000, current: 0, description: 'Score 50,000 points' },
    ],
    story: {
      intro: 'Reality fragments...',
      complete: 'The system is yours. Master of the Cascade.',
    },
    rewards: {
      scoreMultiplier: 2.0,
      unlockMap: 'matrix-core',
    },
  },
  // Additional levels for remaining maps
  {
    id: 'level-6-matrix',
    name: 'Digital Rain',
    mapType: 'matrix-core',
    goals: [
      { id: 'g6-1', type: 'collect-items', target: 20, current: 0, description: 'Collect 20 data shards' },
      { id: 'g6-2', type: 'reach-score', target: 75000, current: 0, description: 'Score 75,000 points' },
    ],
    story: {
      intro: 'The code reveals itself...',
      complete: 'You see the Matrix. True mastery achieved.',
    },
    rewards: {
      scoreMultiplier: 2.5,
      unlockMap: 'cyan-void',
    },
  },
  {
    id: 'level-7-cyan',
    name: 'Void Tranquility',
    mapType: 'cyan-void',
    goals: [
      { id: 'g7-1', type: 'survive-time', target: 180, current: 0, description: 'Survive 3 minutes' },
      { id: 'g7-2', type: 'no-drain', target: 1, current: 0, description: 'Perfect run - no drains' },
    ],
    story: {
      intro: 'Embrace the emptiness...',
      complete: 'Peace through precision. Enlightenment awaits.',
    },
    rewards: {
      scoreMultiplier: 3.0,
      unlockMap: 'magenta-dream',
    },
  },
  {
    id: 'level-8-magenta',
    name: 'Final Dream',
    mapType: 'magenta-dream',
    goals: [
      { id: 'g8-1', type: 'reach-score', target: 100000, current: 0, description: 'Score 100,000 points' },
      { id: 'g8-2', type: 'hit-pegs', target: 200, current: 0, description: 'Hit 200 pegs' },
      { id: 'g8-3', type: 'no-drain', target: 1, current: 0, description: 'Legendary: No drains' },
    ],
    story: {
      intro: 'The ultimate challenge...',
      complete: 'You are the Nexus. The Cascade bows to you.',
    },
    rewards: {
      scoreMultiplier: 5.0,
    },
  },
]

export class AdventureState {
  private progress: AdventureProgress
  private currentLevel: AdventureLevel | null = null
  private levelStartTime: number = 0
  private display: DisplaySystem | null = null
  private onLevelComplete: ((level: AdventureLevel) => void) | null = null
  private onGoalUpdate: ((goals: LevelGoal[]) => void) | null = null

  constructor() {
    this.progress = this.loadProgress()
  }

  /**
   * Set the display system for backbox integration
   */
  setDisplay(display: DisplaySystem): void {
    this.display = display
  }

  /**
   * Register callback for level completion
   */
  onLevelCompleteCallback(callback: (level: AdventureLevel) => void): void {
    this.onLevelComplete = callback
  }

  /**
   * Register callback for goal updates
   */
  onGoalUpdateCallback(callback: (goals: LevelGoal[]) => void): void {
    this.onGoalUpdate = callback
  }

  /**
   * Get current progress
   */
  getProgress(): AdventureProgress {
    return { ...this.progress }
  }

  /**
   * Get current level
   */
  getCurrentLevel(): AdventureLevel | null {
    return this.currentLevel
  }

  /**
   * Get all levels
   */
  getAllLevels(): AdventureLevel[] {
    return ADVENTURE_LEVELS
  }

  /**
   * Get unlocked levels
   */
  getUnlockedLevels(): AdventureLevel[] {
    return ADVENTURE_LEVELS.filter(
      level => this.progress.unlockedMaps.includes(level.mapType)
    )
  }

  /**
   * Check if a map is unlocked
   */
  isMapUnlocked(mapType: TableMapType): boolean {
    return this.progress.unlockedMaps.includes(mapType)
  }

  /**
   * Start a level
   */
  startLevel(levelId: string): boolean {
    const level = ADVENTURE_LEVELS.find(l => l.id === levelId)
    if (!level) {
      console.warn(`[AdventureState] Level not found: ${levelId}`)
      return false
    }

    if (!this.isMapUnlocked(level.mapType)) {
      console.warn(`[AdventureState] Map locked: ${level.mapType}`)
      return false
    }

    this.currentLevel = level
    this.levelStartTime = performance.now()
    
    // Reset goal progress
    level.goals.forEach(goal => goal.current = 0)
    
    this.progress.currentLevel = levelId
    this.progress.currentMap = level.mapType
    this.saveProgress()

    // Show intro story on backbox
    this.showStory(level.story.intro)

    console.log(`[AdventureState] Started level: ${level.name}`)
    return true
  }

  /**
   * Update goal progress
   */
  updateGoal(goalType: GoalType, amount: number = 1): void {
    if (!this.currentLevel) return

    const goals = this.currentLevel.goals.filter(g => g.type === goalType)
    goals.forEach(goal => {
      const oldCurrent = goal.current
      goal.current = Math.min(goal.current + amount, goal.target)
      
      if (goal.current !== oldCurrent) {
        console.log(`[AdventureState] Goal progress: ${goal.description} - ${goal.current}/${goal.target}`)
      }
    })

    this.onGoalUpdate?.(this.currentLevel.goals)

    // Check if all goals complete
    if (this.checkLevelComplete()) {
      this.completeLevel()
    }
  }

  /**
   * Set goal progress directly (for scores, etc)
   */
  setGoalProgress(goalType: GoalType, value: number): void {
    if (!this.currentLevel) return

    const goals = this.currentLevel.goals.filter(g => g.type === goalType)
    goals.forEach(goal => {
      goal.current = Math.max(goal.current, value)
    })

    this.onGoalUpdate?.(this.currentLevel.goals)

    if (this.checkLevelComplete()) {
      this.completeLevel()
    }
  }

  /**
   * Check if current level is complete
   */
  checkLevelComplete(): boolean {
    if (!this.currentLevel) return false
    return this.currentLevel.goals.every(goal => goal.current >= goal.target)
  }

  /**
   * Complete the current level
   */
  private completeLevel(): void {
    if (!this.currentLevel) return

    const level = this.currentLevel
    const duration = (performance.now() - this.levelStartTime) / 1000

    console.log(`[AdventureState] Level complete: ${level.name} in ${duration.toFixed(1)}s`)

    // Mark as completed
    if (!this.progress.completedLevels.includes(level.id)) {
      this.progress.completedLevels.push(level.id)
    }

    // Update best score
    const levelScore = this.calculateLevelScore(level)
    if (!this.progress.bestScores[level.id] || levelScore > this.progress.bestScores[level.id]) {
      this.progress.bestScores[level.id] = levelScore
    }
    this.progress.totalScore += levelScore

    // Unlock next map
    if (level.rewards.unlockMap) {
      if (!this.progress.unlockedMaps.includes(level.rewards.unlockMap)) {
        this.progress.unlockedMaps.push(level.rewards.unlockMap)
        console.log(`[AdventureState] Unlocked map: ${level.rewards.unlockMap}`)
      }
    }

    this.saveProgress()
    this.syncToBackend()

    // Show completion story on backbox
    this.showLevelComplete(level)

    // Trigger callback
    this.onLevelComplete?.(level)
  }

  /**
   * Show story text on backbox
   */
  private showStory(text: string): void {
    this.display?.setStoryText(text)
  }

  /**
   * Show level complete sequence on backbox
   */
  private showLevelComplete(level: AdventureLevel): void {
    // Show completion text
    this.display?.setStoryText(`LEVEL COMPLETE\n${level.name}\n${level.story.complete}`)

    // Play story video if available
    if (level.story.videoUrl) {
      this.display?.loadAndPlayVideo(level.story.videoUrl)
    }

    // Trigger CRT flash effect
    this.display?.triggerCRTFlash()
  }

  /**
   * Calculate score for level completion
   */
  private calculateLevelScore(level: AdventureLevel): number {
    const baseScore = 1000
    const goalBonus = level.goals.reduce((sum, g) => sum + (g.current >= g.target ? 500 : 0), 0)
    const timeBonus = Math.max(0, 300 - Math.floor((performance.now() - this.levelStartTime) / 1000)) * 10
    const multiplier = level.rewards.scoreMultiplier

    return Math.floor((baseScore + goalBonus + timeBonus) * multiplier)
  }

  /**
   * Get current score multiplier
   */
  getScoreMultiplier(): number {
    return this.currentLevel?.rewards.scoreMultiplier || 1.0
  }

  /**
   * End current level (drain, etc)
   */
  endLevel(failed: boolean = false): void {
    if (!this.currentLevel) return

    if (failed) {
      console.log(`[AdventureState] Level failed: ${this.currentLevel.name}`)
      this.showStory('LEVEL FAILED - TRY AGAIN')
    }

    this.currentLevel = null
  }

  // ========================================================================
  // STORAGE & PERSISTENCE
  // ========================================================================

  private loadProgress(): AdventureProgress {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const parsed = JSON.parse(saved)
        // Validate and merge with defaults
        return {
          currentLevel: parsed.currentLevel || 'level-1-neon',
          currentMap: parsed.currentMap || 'neon-helix',
          completedLevels: parsed.completedLevels || [],
          unlockedMaps: parsed.unlockedMaps || ['neon-helix'],
          totalScore: parsed.totalScore || 0,
          bestScores: parsed.bestScores || {},
          lastPlayed: parsed.lastPlayed || new Date().toISOString(),
        }
      }
    } catch (e) {
      console.warn('[AdventureState] Failed to load progress:', e)
    }

    // Default progress
    return {
      currentLevel: 'level-1-neon',
      currentMap: 'neon-helix',
      completedLevels: [],
      unlockedMaps: ['neon-helix'],
      totalScore: 0,
      bestScores: {},
      lastPlayed: new Date().toISOString(),
    }
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
    try {
      const response = await fetch(API_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.progress),
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      console.log('[AdventureState] Progress synced to backend')
    } catch (e) {
      // Silently fail - local storage is primary
      console.warn('[AdventureState] Backend sync failed:', e)
    }
  }

  /**
   * Fetch progress from backend
   */
  async fetchFromBackend(): Promise<void> {
    try {
      const response = await fetch(API_ENDPOINT)
      if (response.ok) {
        const backendProgress = await response.json()
        // Merge with local (prefer backend if newer)
        if (backendProgress.lastPlayed > this.progress.lastPlayed) {
          this.progress = { ...this.progress, ...backendProgress }
          this.saveProgress()
          console.log('[AdventureState] Progress loaded from backend')
        }
      }
    } catch (e) {
      console.warn('[AdventureState] Backend fetch failed:', e)
    }
  }

  /**
   * Reset all progress
   */
  resetProgress(): void {
    this.progress = {
      currentLevel: 'level-1-neon',
      currentMap: 'neon-helix',
      completedLevels: [],
      unlockedMaps: ['neon-helix'],
      totalScore: 0,
      bestScores: {},
      lastPlayed: new Date().toISOString(),
    }
    this.currentLevel = null
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
