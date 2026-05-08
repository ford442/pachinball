/**
 * Adventure Track Progression & Unlock System
 * Manages track progression, unlocking, and difficulty progression
 */

export interface TrackInfo {
  id: string
  name: string
  description: string
  difficulty: 'easy' | 'medium' | 'hard' | 'expert'
  recommendedScore: number
  unlockedBy?: string // Track ID that must be completed to unlock this
  theme: string
}

export interface ProgressionState {
  completedTracks: Set<string>
  unlockedTracks: Set<string>
  bestScores: Record<string, number>
  currentTrack: string
  totalGoldBallsCollected: number
  totalRewardsEarned: number
}

export const TRACK_CATALOG: Record<string, TrackInfo> = {
  'NEON_HELIX': {
    id: 'NEON_HELIX',
    name: 'Neon Helix',
    description: 'A classic descent through spiraling neon light. Perfect for beginners.',
    difficulty: 'easy',
    recommendedScore: 50000,
    theme: 'cyber-neon'
  },
  'CYBER_CORE': {
    id: 'CYBER_CORE',
    name: 'Cyber Core',
    description: 'Fast-paced vertical descent through a digital core. Requires precision timing.',
    difficulty: 'medium',
    recommendedScore: 75000,
    unlockedBy: 'NEON_HELIX',
    theme: 'digital'
  },
  'QUANTUM_GRID': {
    id: 'QUANTUM_GRID',
    name: 'Quantum Grid',
    description: 'Navigate a complex maze of quantum pathways. The ultimate puzzle challenge.',
    difficulty: 'hard',
    recommendedScore: 100000,
    unlockedBy: 'CYBER_CORE',
    theme: 'quantum'
  },
  'PACHINKO_SPIRE': {
    id: 'PACHINKO_SPIRE',
    name: 'Pachinko Spire',
    description: 'Bounce through a classic pin field tower. High-risk, high-reward gameplay.',
    difficulty: 'hard',
    recommendedScore: 65000,
    unlockedBy: 'NEON_HELIX',
    theme: 'retro'
  },
  'SINGULARITY_WELL': {
    id: 'SINGULARITY_WELL',
    name: 'Singularity Well',
    description: 'Enter a black hole. Gravity pulls everything inward. Expert only.',
    difficulty: 'expert',
    recommendedScore: 120000,
    unlockedBy: 'QUANTUM_GRID',
    theme: 'cosmic'
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
}
