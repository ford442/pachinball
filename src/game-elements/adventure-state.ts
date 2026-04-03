/**
 * Adventure State - Level Goals, Progression, Story System & Unlockable Rewards
 * 
 * Manages adventure mode progression:
 * - Level goals (hit pegs, survive time, reach score)
 * - Story sequences on level complete
 * - Progress persistence (localStorage + backend)
 * - Map unlocking
 * - Unlockable rewards system (ball trails, neon patterns, skins)
 * - Backbox video/text integration
 */

import type { DisplaySystem } from './display'
import type { TableMapType } from '../shaders/lcd-table'

export type GoalType = 'hit-pegs' | 'survive-time' | 'reach-score' | 'collect-items' | 'no-drain'

export type RewardType = 'ball-trail' | 'neon-pattern' | 'skin'

export interface LevelGoal {
  id: string
  type: GoalType
  target: number
  current: number
  completed: boolean
  description: string
}

export interface UnlockableReward {
  id: string
  name: string
  type: RewardType
  unlockedAt: string
  equipped: boolean
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
    unlockRewardId?: string
  }
}

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
const API_ENDPOINT = '/api/adventure/progress'

// Level reward definitions - maps level ID to unlockable reward
export const LEVEL_REWARDS: Record<string, UnlockableReward> = {
  'level-1-neon': {
    id: 'neon-trail',
    name: 'Neon Trail',
    type: 'ball-trail',
    unlockedAt: '',
    equipped: false,
  },
  'level-2-cyber': {
    id: 'cyber-pattern',
    name: 'Cyber Pattern',
    type: 'neon-pattern',
    unlockedAt: '',
    equipped: false,
  },
  'level-3-quantum': {
    id: 'quantum-skin',
    name: 'Quantum Skin',
    type: 'skin',
    unlockedAt: '',
    equipped: false,
  },
  'level-4-singularity': {
    id: 'singularity-trail',
    name: 'Singularity Trail',
    type: 'ball-trail',
    unlockedAt: '',
    equipped: false,
  },
  'level-5-glitch': {
    id: 'glitch-pattern',
    name: 'Glitch Pattern',
    type: 'neon-pattern',
    unlockedAt: '',
    equipped: false,
  },
  'level-6-matrix': {
    id: 'matrix-skin',
    name: 'Matrix Skin',
    type: 'skin',
    unlockedAt: '',
    equipped: false,
  },
  'level-7-cyan': {
    id: 'cyan-trail',
    name: 'Cyan Energy Trail',
    type: 'ball-trail',
    unlockedAt: '',
    equipped: false,
  },
  'level-8-magenta': {
    id: 'master-pattern',
    name: 'Master Neon',
    type: 'neon-pattern',
    unlockedAt: '',
    equipped: false,
  },
}

// Define all adventure levels
export const ADVENTURE_LEVELS: AdventureLevel[] = [
  {
    id: 'level-1-neon',
    name: 'Neon Awakening',
    mapType: 'neon-helix',
    goals: [
      { id: 'g1-1', type: 'hit-pegs', target: 30, current: 0, completed: false, description: 'Hit 30 pegs' },
      { id: 'g1-2', type: 'reach-score', target: 5000, current: 0, completed: false, description: 'Score 5,000 points' },
    ],
    story: {
      intro: `The neon-soaked streets of Sector 7 fade as you jack into the Nexus.\n"Welcome, initiator," a synthetic voice whispers through your neural link.\n"The Cascade awaits your first move. Feel the pulse of the machine."\nYour consciousness expands into a realm of glowing circuits and endless possibility.`,
      complete: `The first node pulses bright, bathing you in electric blue.\n"First light achieved," the voice acknowledges, almost impressed.\n"The Cascade recognizes your potential. Cyber pathways opening."\nYou have taken your first step into the digital pantheon.`,
      videoUrl: '/videos/story/level1-complete.mp4',
    },
    rewards: {
      scoreMultiplier: 1.1,
      unlockMap: 'cyber-core',
      unlockRewardId: 'neon-trail',
    },
  },
  {
    id: 'level-2-cyber',
    name: 'Cyber Infiltration',
    mapType: 'cyber-core',
    goals: [
      { id: 'g2-1', type: 'survive-time', target: 60, current: 0, completed: false, description: 'Survive 60 seconds' },
      { id: 'g2-2', type: 'hit-pegs', target: 50, current: 0, completed: false, description: 'Hit 50 pegs' },
      { id: 'g2-3', type: 'reach-score', target: 10000, current: 0, completed: false, description: 'Score 10,000 points' },
    ],
    story: {
      intro: `Firewalls blaze crimson as you breach the Cyber Core's outer perimeter.\n"Unauthorized access detected," drones a security daemon.\n"Prove your worth, or be purged from the system."\nThe digital architecture shifts around you, testing your resolve.`,
      complete: `The firewall crumbles, dissolving into streams of golden data.\n"Access granted," the daemon concedes, stepping aside.\n"Quantum pathways opening. You may proceed where few have tread."\nThe Core recognizes you as one of its own.`,
      videoUrl: '/videos/story/level2-complete.mp4',
    },
    rewards: {
      scoreMultiplier: 1.2,
      unlockMap: 'quantum-grid',
      unlockRewardId: 'cyber-pattern',
    },
  },
  {
    id: 'level-3-quantum',
    name: 'Quantum Entanglement',
    mapType: 'quantum-grid',
    goals: [
      { id: 'g3-1', type: 'collect-items', target: 10, current: 0, completed: false, description: 'Collect 10 quantum orbs' },
      { id: 'g3-2', type: 'reach-score', target: 15000, current: 0, completed: false, description: 'Score 15,000 points' },
    ],
    story: {
      intro: `Reality destabilizes as you step into the Quantum Grid.\nHere, probability itself becomes tangible, shimmering in iridescent hues.\n"Observation collapses the wave," echoes from everywhere and nowhere.\nYou exist in superposition—every possible you, walking every possible path.`,
      complete: `The quantum state collapses into brilliant coherence.\nAll possibilities converge to this singular triumph.\n"Singularity approaches," the void whispers.\nYou have touched the fabric of existence itself.`,
      videoUrl: '/videos/story/level3-complete.mp4',
    },
    rewards: {
      scoreMultiplier: 1.3,
      unlockMap: 'singularity-well',
      unlockRewardId: 'quantum-skin',
    },
  },
  {
    id: 'level-4-singularity',
    name: 'Event Horizon',
    mapType: 'singularity-well',
    goals: [
      { id: 'g4-1', type: 'no-drain', target: 1, current: 0, completed: false, description: 'Complete without draining' },
      { id: 'g4-2', type: 'reach-score', target: 25000, current: 0, completed: false, description: 'Score 25,000 points' },
    ],
    story: {
      intro: `Gravity becomes infinite at the edge of the Singularity Well.\nLight bends, time dilates, and the void gazes back at you.\n"Many have reached this threshold," the darkness murmurs.\n"Few have returned. What secrets do you seek in the abyss?"`,
      complete: `You emerge from the event horizon transformed, bearing secrets of the void.\n"You have touched the darkness and lived," the system acknowledges.\n"All maps unlocked. The Cascade is yours to traverse."\nThe black hole's power now flows through your digital veins.`,
      videoUrl: '/videos/story/level4-complete.mp4',
    },
    rewards: {
      scoreMultiplier: 1.5,
      unlockMap: 'glitch-spire',
      unlockRewardId: 'singularity-trail',
    },
  },
  {
    id: 'level-5-glitch',
    name: 'System Corruption',
    mapType: 'glitch-spire',
    goals: [
      { id: 'g5-1', type: 'survive-time', target: 120, current: 0, completed: false, description: 'Survive 120 seconds' },
      { id: 'g5-2', type: 'hit-pegs', target: 100, current: 0, completed: false, description: 'Hit 100 pegs' },
      { id: 'g5-3', type: 'reach-score', target: 50000, current: 0, completed: false, description: 'Score 50,000 points' },
    ],
    story: {
      intro: `Reality fragments within the Glitch Spire.\nCorrupted code rains like digital ash, and the architecture rebels against itself.\n"ERROR: REALITY NOT FOUND," screams across your HUD.\nTo survive here, you must become the glitch—embrace the corruption.`,
      complete: `The chaos bends to your will, stabilizing into impossible patterns.\n"The system is yours," whispers the corrupted AI.\n"Master of the Cascade, ruler of broken code."\nYou have turned corruption into art, chaos into power.`,
    },
    rewards: {
      scoreMultiplier: 2.0,
      unlockMap: 'matrix-core',
      unlockRewardId: 'glitch-pattern',
    },
  },
  // Additional levels for remaining maps
  {
    id: 'level-6-matrix',
    name: 'Digital Rain',
    mapType: 'matrix-core',
    goals: [
      { id: 'g6-1', type: 'collect-items', target: 20, current: 0, completed: false, description: 'Collect 20 data shards' },
      { id: 'g6-2', type: 'reach-score', target: 75000, current: 0, completed: false, description: 'Score 75,000 points' },
    ],
    story: {
      intro: `Green cascades of code envelop you in the Matrix Core.\nThe truth reveals itself in streams of ancient programming.\n"Wake up," echoes from a thousand awakened minds.\nYou see through the illusion—reality is merely a construct waiting to be rewritten.`,
      complete: `The code parts before you like a curtain, revealing the source.\n"You see the Matrix," the collective consciousness intones.\n"True mastery achieved. Reality bends to your perception."\nYou are now both the player and the game.`,
    },
    rewards: {
      scoreMultiplier: 2.5,
      unlockMap: 'cyan-void',
      unlockRewardId: 'matrix-skin',
    },
  },
  {
    id: 'level-7-cyan',
    name: 'Void Tranquility',
    mapType: 'cyan-void',
    goals: [
      { id: 'g7-1', type: 'survive-time', target: 180, current: 0, completed: false, description: 'Survive 3 minutes' },
      { id: 'g7-2', type: 'no-drain', target: 1, current: 0, completed: false, description: 'Perfect run - no drains' },
    ],
    story: {
      intro: `Embrace the emptiness of the Cyan Void.\nHere, in perfect silence, the noise of the Cascade fades to nothing.\n"Let go," the void suggests—not a command, but an invitation.\nIn this nothingness, find everything. In stillness, find true power.`,
      complete: `Perfection achieved through absolute focus.\n"Peace through precision," the void acknowledges softly.\n"Enlightenment awaits in the Final Dream."\nYou have mastered yourself, and thus mastered the game.`,
    },
    rewards: {
      scoreMultiplier: 3.0,
      unlockMap: 'magenta-dream',
      unlockRewardId: 'cyan-trail',
    },
  },
  {
    id: 'level-8-magenta',
    name: 'Final Dream',
    mapType: 'magenta-dream',
    goals: [
      { id: 'g8-1', type: 'reach-score', target: 100000, current: 0, completed: false, description: 'Score 100,000 points' },
      { id: 'g8-2', type: 'hit-pegs', target: 200, current: 0, completed: false, description: 'Hit 200 pegs' },
      { id: 'g8-3', type: 'no-drain', target: 1, current: 0, completed: false, description: 'Legendary: No drains' },
    ],
    story: {
      intro: `The ultimate challenge awaits in the Magenta Dream.\nAll paths converge here, in this culmination of the Cascade.\n"One final test," the Nexus whispers, its voice now familiar as your own.\nBecome legend, or be forgotten in the static.`,
      complete: `Golden light erupts as you transcend the final challenge.\n"You are the Nexus," the Cascade itself declares.\n"The game bows to you. You are eternal."\nYour name will echo through the digital realms forever.`,
    },
    rewards: {
      scoreMultiplier: 5.0,
      unlockRewardId: 'master-pattern',
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
    level.goals.forEach(goal => {
      goal.current = 0
      goal.completed = false
    })
    
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
      
      // Check if goal just completed
      if (goal.current >= goal.target && !goal.completed) {
        goal.completed = true
        console.log(`[AdventureState] Goal completed: ${goal.description}`)
      }
      
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
      // Update completed status
      if (goal.current >= goal.target && !goal.completed) {
        goal.completed = true
        console.log(`[AdventureState] Goal completed: ${goal.description}`)
      }
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
    return this.currentLevel.goals.every(goal => goal.completed)
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

    // Unlock reward for this level
    if (level.rewards.unlockRewardId) {
      this.unlockReward(level.rewards.unlockRewardId)
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
    const goalBonus = level.goals.reduce((sum, g) => sum + (g.completed ? 500 : 0), 0)
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

  // =======================================================================
  // REWARD SYSTEM
  // =======================================================================

  /**
   * Unlock a reward by ID
   */
  unlockReward(rewardId: string): boolean {
    // Check if already unlocked
    if (this.progress.unlockedRewards.some(r => r.id === rewardId)) {
      console.log(`[AdventureState] Reward already unlocked: ${rewardId}`)
      return false
    }

    // Find reward definition
    const rewardDef = Object.values(LEVEL_REWARDS).find(r => r.id === rewardId)
    if (!rewardDef) {
      console.warn(`[AdventureState] Unknown reward: ${rewardId}`)
      return false
    }

    // Add to unlocked rewards
    const unlockedReward: UnlockableReward = {
      ...rewardDef,
      unlockedAt: new Date().toISOString(),
      equipped: false,
    }
    this.progress.unlockedRewards.push(unlockedReward)
    this.saveProgress()

    console.log(`[AdventureState] Unlocked reward: ${rewardDef.name} (${rewardDef.type})`)
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

    // Equip this reward
    reward.equipped = true
    this.saveProgress()

    console.log(`[AdventureState] Equipped reward: ${reward.name}`)
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
  // PROGRESS & COMPLETION
  // =======================================================================

  /**
   * Get completion percentage for a level (0-100)
   */
  getCompletionPercent(levelId: string): number {
    const level = ADVENTURE_LEVELS.find(l => l.id === levelId)
    if (!level) return 0

    // If level is completed, return 100
    if (this.progress.completedLevels.includes(levelId)) {
      return 100
    }

    // If this is the current level, calculate based on goals
    if (this.currentLevel?.id === levelId) {
      const totalGoals = level.goals.length
      if (totalGoals === 0) return 0

      const partialProgress = level.goals.reduce((sum, g) => {
        if (g.completed) return sum + 1
        return sum + (g.current / g.target)
      }, 0)

      return Math.min(100, Math.floor((partialProgress / totalGoals) * 100))
    }

    // Level not started
    return 0
  }

  // =======================================================================
  // STORAGE & PERSISTENCE
  // =======================================================================

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
          unlockedRewards: parsed.unlockedRewards || [],
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
      unlockedRewards: [],
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
   * Get overall completion percentage across all levels
   */
  getOverallCompletionPercent(): number {
    const totalLevels = ADVENTURE_LEVELS.length
    if (totalLevels === 0) return 0
    
    const completedCount = this.progress.completedLevels.length
    return (completedCount / totalLevels) * 100
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
      unlockedRewards: [],
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
