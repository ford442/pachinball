/**
 * Adventure Track Progression & Unlock System
 * Manages track progression, unlocking, and difficulty progression
 */

import { buildTrackCatalogFromManifests } from './manifests'
import type { TrackModeType } from './adventure-types'
import type { VisualThemeColor } from '../game-elements/visual-language'

export type { TrackModeType } from './adventure-types'

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
 * Campaign track catalog — 14 main-spine stages plus 2 optional branches (#321, #424).
 *
 * Campaign sequence (main spine), with A = EXTENDED_MAP, B = STATIONARY_TABLE:
 *    1. NEON_HELIX          — A — spiral descent run
 *    2. PACHINKO_HALL       — A — parlor hub / pin-lane corridor
 *    3. CYBER_CORE          — B — flipper arena
 *    4. QUANTUM_GRID        — A — maze (JSON)
 *    5. STORM_LATTICE       — B — pin-lattice storm arena (JSON, C++ toys; #424)
 *    6. SINGULARITY_WELL    — A
 *    7. GLITCH_SPIRE        — B — (JSON)
 *    8. RETRO_WAVE_HILLS    — A — (JSON)
 *    9. POLYCHROME_VOID     — B — chroma-gate puzzle
 *   10. HYPER_DRIFT         — A — (JSON)
 *   11. CHRONO_CORE         — B — gear arena (JSON)
 *   12. CRYO_CHAMBER        — A — ice slalom
 *   13. CASINO_HEIST        — B — vault arena
 *   14. FIREWALL_BREACH     — A — finale
 *
 * Parallel branches (not on the spine, reachable early):
 *   PACHINKO_SPIRE  — B — unlocks from NEON_HELIX
 *   NEON_STRONGHOLD — B — unlocks from PACHINKO_HALL
 *
 * Stages 2–14 strictly alternate. Before #424 stages 4–5 were an A/A pair
 * (QUANTUM_GRID → SINGULARITY_WELL); STORM_LATTICE is the arena content that
 * splits it, leaving only the historical NEON_HELIX → PACHINKO_HALL opener.
 * The rhythm is bounded by content, not preference: mode type describes what
 * a track physically *is* (a traversal course vs a contained arena), so it is
 * assigned from geometry rather than chosen to fit the pattern.
 */

/** Ordered main campaign spine — used by getNextTrackId() for deterministic A/B flow. */
export const CAMPAIGN_MAIN_PATH = [
  'NEON_HELIX',
  'PACHINKO_HALL',
  'CYBER_CORE',
  'QUANTUM_GRID',
  'STORM_LATTICE',
  'SINGULARITY_WELL',
  'GLITCH_SPIRE',
  'RETRO_WAVE_HILLS',
  'POLYCHROME_VOID',
  'HYPER_DRIFT',
  'CHRONO_CORE',
  'CRYO_CHAMBER',
  'CASINO_HEIST',
  'FIREWALL_BREACH',
] as const

/** Derived from TrackManifest registry — see src/adventure/manifests/ */
export const TRACK_CATALOG: Record<string, TrackInfo> = buildTrackCatalogFromManifests()

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

    this.onProgressChanged?.()
  }

  /** Optional hook for persistence layers (CampaignRewardsManager). */
  onProgressChanged: (() => void) | null = null

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
      this.onProgressChanged?.()
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
    for (const trackId of CAMPAIGN_MAIN_PATH) {
      if (this.isTrackUnlocked(trackId) && !this.isTrackCompleted(trackId)) {
        return trackId
      }
    }
    // Parallel / optional branch tracks (e.g. PACHINKO_SPIRE)
    for (const track of Object.values(TRACK_CATALOG)) {
      if ((CAMPAIGN_MAIN_PATH as readonly string[]).includes(track.id)) continue
      if (this.isTrackUnlocked(track.id) && !this.isTrackCompleted(track.id)) {
        return track.id
      }
    }
    return null
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
    // Re-derive unlocks from completions, so a stage inserted into the spine
    // after a save was written (STORM_LATTICE, #424) is still offered.
    for (const [id, info] of Object.entries(TRACK_CATALOG)) {
      if (info.unlockedBy && this.state.completedTracks.has(info.unlockedBy)) {
        this.state.unlockedTracks.add(id)
      }
    }
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
