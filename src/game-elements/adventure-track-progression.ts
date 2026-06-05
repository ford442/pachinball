/**
 * Adventure Track Progression & Unlock System
 * Manages track progression, unlocking, and difficulty progression
 */

import type { VisualThemeColor } from './visual-language'

/** Campaign mode type — alternates A/B across the progression sequence. */
export type TrackModeType = 'EXTENDED_MAP' | 'STATIONARY_TABLE'

export interface TrackInfo {
  id: string
  name: string
  description: string
  difficulty: 'easy' | 'medium' | 'hard' | 'expert'
  /** Mode type: EXTENDED_MAP (scrolling 3D landscape) or STATIONARY_TABLE (classic pinball arena). */
  modeType: TrackModeType
  recommendedScore: number
  /** Time limit in seconds for this stage. */
  timeLimitSeconds: number
  /** Score multiplier applied when the timer expires before the goal is met.
   *  Typical catalog values span 0.35–0.60. */
  timeoutPenaltyMultiplier: number
  unlockedBy?: string // Track ID that must be completed to unlock this
  theme: string
  visualTheme?: {
    primary: VisualThemeColor
    accent?: VisualThemeColor
    surfaceTint?: 'PLAYFIELD' | 'PLAYFIELD_DEEP' | 'GLASS'
  }
}

export interface ProgressionState {
  completedTracks: Set<string>
  unlockedTracks: Set<string>
  bestScores: Record<string, number>
  currentTrack: string
  totalGoldBallsCollected: number
  totalRewardsEarned: number
}

export interface SerializableProgressionState {
  completedTracks: string[]
  unlockedTracks: string[]
  bestScores: Record<string, number>
  currentTrack: string
  totalGoldBallsCollected: number
  totalRewardsEarned: number
}

/**
 * Campaign track catalog — 5 core stages with alternating A/B modeType pattern:
 *   A (EXTENDED_MAP) → B (STATIONARY_TABLE) → A → B → A
 *
 * Campaign sequence (by unlock depth):
 *   1. NEON_HELIX          — A — EXTENDED_MAP
 *   2. CYBER_CORE          — B — STATIONARY_TABLE
 *   2. PACHINKO_SPIRE      — B — STATIONARY_TABLE (parallel branch from NEON_HELIX)
 *   3. QUANTUM_GRID        — A — EXTENDED_MAP
 *   4. SINGULARITY_WELL    — A — EXTENDED_MAP
 */
export const TRACK_CATALOG: Record<string, TrackInfo> = {
  // Score targets are calibrated for bumperHitBase=100 (src/config.ts GAME_TUNING.scoring).
  // Baseline: ~3 hits/sec × 100 pts × average 2× combo = ~600 pts/sec.
  // Each target sits at ~70-80% of what a focused player can earn in the time limit,
  // leaving headroom for gold-ball streak bonuses to feel like acceleration rather
  // than a requirement.
  'NEON_HELIX': {
    id: 'NEON_HELIX',
    name: 'Neon Helix',
    description: 'A classic descent through spiraling neon light. Perfect for beginners.',
    difficulty: 'easy',
    modeType: 'EXTENDED_MAP',
    recommendedScore: 50000,   // 600 pts/s × 120 s × ~70% = ~50 000
    timeLimitSeconds: 120,
    timeoutPenaltyMultiplier: 0.55,
    theme: 'cyber-neon',
    visualTheme: { primary: 'CYAN', accent: 'MAGENTA', surfaceTint: 'PLAYFIELD' },
  },
  'CYBER_CORE': {
    id: 'CYBER_CORE',
    name: 'Cyber Core',
    description: 'Fast-paced vertical descent through a digital core. Requires precision timing.',
    difficulty: 'medium',
    modeType: 'STATIONARY_TABLE',
    recommendedScore: 45000,   // 600 pts/s × 90 s × ~83%
    timeLimitSeconds: 90,
    timeoutPenaltyMultiplier: 0.45,
    unlockedBy: 'NEON_HELIX',
    theme: 'digital',
    visualTheme: { primary: 'MAGENTA', accent: 'PURPLE', surfaceTint: 'PLAYFIELD_DEEP' },
  },
  'QUANTUM_GRID': {
    id: 'QUANTUM_GRID',
    name: 'Quantum Grid',
    description: 'Navigate a complex maze of quantum pathways. The ultimate puzzle challenge.',
    difficulty: 'hard',
    modeType: 'EXTENDED_MAP',
    recommendedScore: 80000,   // 600 pts/s × 150 s × ~89%
    timeLimitSeconds: 150,
    timeoutPenaltyMultiplier: 0.50,
    unlockedBy: 'CYBER_CORE',
    theme: 'quantum',
    visualTheme: { primary: 'PURPLE', accent: 'WHITE', surfaceTint: 'GLASS' },
  },
  'PACHINKO_SPIRE': {
    id: 'PACHINKO_SPIRE',
    name: 'Pachinko Spire',
    description: 'Bounce through a classic pin field tower. High-risk, high-reward gameplay.',
    difficulty: 'hard',
    modeType: 'STATIONARY_TABLE',
    recommendedScore: 38000,   // 600 pts/s × 75 s × ~84%
    timeLimitSeconds: 75,
    timeoutPenaltyMultiplier: 0.40,
    unlockedBy: 'NEON_HELIX',
    theme: 'retro',
    visualTheme: { primary: 'GOLD', accent: 'ALERT', surfaceTint: 'PLAYFIELD' },
  },
  'SINGULARITY_WELL': {
    id: 'SINGULARITY_WELL',
    name: 'Singularity Well',
    description: 'Enter a black hole. Gravity pulls everything inward. Expert only.',
    difficulty: 'expert',
    modeType: 'EXTENDED_MAP',
    recommendedScore: 100000,  // 600 pts/s × 180 s × ~93%
    timeLimitSeconds: 180,
    timeoutPenaltyMultiplier: 0.35,
    unlockedBy: 'QUANTUM_GRID',
    theme: 'cosmic',
    visualTheme: { primary: 'ALERT', accent: 'AMBIENT', surfaceTint: 'PLAYFIELD_DEEP' },
  },
  'GLITCH_SPIRE': {
    id: 'GLITCH_SPIRE',
    name: 'Glitch Spire',
    description: 'Corrupted geometry and unstable lanes demand quick reflexes and reroutes.',
    difficulty: 'expert',
    modeType: 'STATIONARY_TABLE',
    recommendedScore: 65000,   // 600 pts/s × 105 s × ~103% — needs gold ball streak
    timeLimitSeconds: 105,
    timeoutPenaltyMultiplier: 0.42,
    unlockedBy: 'SINGULARITY_WELL',
    theme: 'glitch',
    visualTheme: { primary: 'MATRIX', accent: 'CYAN', surfaceTint: 'GLASS' },
  }
}

export class AdventureTrackProgression {
  private state: ProgressionState

  constructor() {
    this.state = {
      completedTracks: new Set(),
      unlockedTracks: new Set(['NEON_HELIX']), // Start with first track unlocked
      bestScores: {},
      currentTrack: 'NEON_HELIX',
      totalGoldBallsCollected: 0,
      totalRewardsEarned: 0
    }
  }

  /**
   * Check if a track is unlocked
   */
  isTrackUnlocked(trackId: string): boolean {
    return this.state.unlockedTracks.has(trackId)
  }

  /**
   * Check if a track has been completed
   */
  isTrackCompleted(trackId: string): boolean {
    return this.state.completedTracks.has(trackId)
  }

  /**
   * Complete a track and unlock dependent tracks
   */
  completeTrack(trackId: string, score: number, goldBalls: number, rewards: number): void {
    this.state.completedTracks.add(trackId)
    this.state.bestScores[trackId] = Math.max(this.state.bestScores[trackId] ?? 0, score)
    this.state.totalGoldBallsCollected += goldBalls
    this.state.totalRewardsEarned += rewards

    // Unlock dependent tracks
    const trackInfo = TRACK_CATALOG[trackId]
    if (trackInfo) {
      for (const [id, info] of Object.entries(TRACK_CATALOG)) {
        if (info.unlockedBy === trackId) {
          this.state.unlockedTracks.add(id)
        }
      }
    }
  }

  /**
   * Get all available (unlocked) tracks
   */
  getAvailableTracks(): TrackInfo[] {
    return Object.values(TRACK_CATALOG).filter(track => this.isTrackUnlocked(track.id))
  }

  /**
   * Get all locked tracks
   */
  getLockedTracks(): TrackInfo[] {
    return Object.values(TRACK_CATALOG).filter(track => !this.isTrackUnlocked(track.id))
  }

  /**
   * Get track info
   */
  getTrackInfo(trackId: string): TrackInfo | null {
    return TRACK_CATALOG[trackId] ?? null
  }

  /**
   * Get best score for a track
   */
  getBestScore(trackId: string): number {
    return this.state.bestScores[trackId] ?? 0
  }

  /**
   * Get completion percentage
   */
  getCompletionPercentage(): number {
    const completed = this.state.completedTracks.size
    const total = Object.keys(TRACK_CATALOG).length
    return Math.round((completed / total) * 100)
  }

  /**
   * Get progression stats
   */
  getStats() {
    return {
      completedTracks: this.state.completedTracks.size,
      unlockedTracks: this.state.unlockedTracks.size,
      totalTracks: Object.keys(TRACK_CATALOG).length,
      goldBallsCollected: this.state.totalGoldBallsCollected,
      totalRewardsEarned: this.state.totalRewardsEarned,
      completionPercentage: this.getCompletionPercentage()
    }
  }

  /**
   * Set current track
   */
  setCurrentTrack(trackId: string): void {
    if (this.isTrackUnlocked(trackId)) {
      this.state.currentTrack = trackId
    }
  }

  /**
   * Get current track
   */
  getCurrentTrack(): string {
    return this.state.currentTrack
  }

  /**
   * Get current track info
   */
  getCurrentTrackInfo(): TrackInfo | null {
    return this.getTrackInfo(this.state.currentTrack)
  }

  /**
   * Get next unlocked, uncompleted track id
   */
  getNextTrackId(): string | null {
    const nextTrack = Object.values(TRACK_CATALOG).find((track) =>
      this.isTrackUnlocked(track.id) && !this.isTrackCompleted(track.id)
    )
    return nextTrack?.id ?? null
  }

  /**
   * Load progression from saved state
   */
  loadState(state: Partial<ProgressionState>): void {
    if (state.completedTracks) {
      this.state.completedTracks = new Set(state.completedTracks)
    }
    if (state.unlockedTracks) {
      this.state.unlockedTracks = new Set(state.unlockedTracks)
    }
    if (state.bestScores) {
      this.state.bestScores = { ...state.bestScores }
    }
    if (state.currentTrack) {
      this.state.currentTrack = state.currentTrack
    }
    if (state.totalGoldBallsCollected !== undefined) {
      this.state.totalGoldBallsCollected = state.totalGoldBallsCollected
    }
    if (state.totalRewardsEarned !== undefined) {
      this.state.totalRewardsEarned = state.totalRewardsEarned
    }
  }

  loadSerializableState(state: Partial<SerializableProgressionState>): void {
    const validTrackIds = new Set(Object.keys(TRACK_CATALOG))
    const completedTracks = (state.completedTracks ?? []).filter((id) => validTrackIds.has(id))
    const unlockedTracks = (state.unlockedTracks ?? []).filter((id) => validTrackIds.has(id))
    const fallbackUnlocked = unlockedTracks.length > 0 ? unlockedTracks : ['NEON_HELIX']
    const currentTrack =
      state.currentTrack && validTrackIds.has(state.currentTrack) ? state.currentTrack : 'NEON_HELIX'

    this.state.completedTracks = new Set(completedTracks)
    this.state.unlockedTracks = new Set(fallbackUnlocked)
    this.state.bestScores = { ...(state.bestScores ?? {}) }
    this.state.currentTrack = this.state.unlockedTracks.has(currentTrack) ? currentTrack : 'NEON_HELIX'
    this.state.totalGoldBallsCollected = Math.max(0, state.totalGoldBallsCollected ?? 0)
    this.state.totalRewardsEarned = Math.max(0, state.totalRewardsEarned ?? 0)
  }

  /**
   * Get current state for saving
   */
  getState(): ProgressionState {
    return {
      completedTracks: new Set(this.state.completedTracks),
      unlockedTracks: new Set(this.state.unlockedTracks),
      bestScores: { ...this.state.bestScores },
      currentTrack: this.state.currentTrack,
      totalGoldBallsCollected: this.state.totalGoldBallsCollected,
      totalRewardsEarned: this.state.totalRewardsEarned
    }
  }

  getSerializableState(): SerializableProgressionState {
    return {
      completedTracks: Array.from(this.state.completedTracks),
      unlockedTracks: Array.from(this.state.unlockedTracks),
      bestScores: { ...this.state.bestScores },
      currentTrack: this.state.currentTrack,
      totalGoldBallsCollected: this.state.totalGoldBallsCollected,
      totalRewardsEarned: this.state.totalRewardsEarned,
    }
  }

  /**
   * Reset progression
   */
  reset(): void {
    this.state = {
      completedTracks: new Set(),
      unlockedTracks: new Set(['NEON_HELIX']),
      bestScores: {},
      currentTrack: 'NEON_HELIX',
      totalGoldBallsCollected: 0,
      totalRewardsEarned: 0
    }
  }

  /**
   * Clean up (no-op for pure state, provided for consistency)
   */
  dispose(): void {
    this.reset()
  }
}
