import type { EventBus, PachinballEventMap } from '../game/event-bus'
import {
  type TrackInfo,
  type TrackModeType,
  type AdventureTrackProgression,
} from './adventure-track-progression'

export interface AdventureProgressionSupervisorCallbacks {
  isAdventureModeActive?: () => boolean
  getSuccessBonus?: (track: TrackInfo, scoreDelta: number, timeRemaining: number) => number
  onTrackAdvanced?: (nextTrackId: string | null) => void
}

/**
 * Optional spatial context supplied by AdventureMode when the ball
 * physically enters the exit portal.  These fields are merged into the single
 * `portal:entered` EventBus emission so downstream systems receive all data
 * (reward *and* spatial) in one event instead of two. Campaign routing is
 * resolved separately by AdventureTrackProgression.
 */
export interface PortalSpatialContext {
  /** Unique portal instance id (e.g. `NEON_HELIX-exit-portal`). */
  id?: string
  /** World-space portal centre position. */
  position?: { x: number; y: number; z: number }
}

type PortalKind = 'success' | 'timeout'

/**
 * Owns the per-track timer, reward multiplier, and portal lifecycle for the
 * currently running campaign stage.
 *
 * ## Single source of truth — why there is no duplicate "current track" state
 *
 * AdventureTrackProgression is the authoritative record of which track the
 * campaign is on, which tracks are unlocked, and which are completed.  This
 * supervisor deliberately does NOT maintain a parallel "current track ID" field
 * that outlives a single track's execution window.  `activeTrackId` is a local
 * working copy that exists only while a track is in flight and is cleared in
 * `reset()`.  All track lookups go through the `progression` instance injected
 * at construction time.
 *
 * Keeping a second long-lived copy would create dual-state: two places that
 * each claim to know the current track and that can silently diverge on any
 * code path that updates one but not the other.  The previous architecture
 * had exactly this divergence — AdventureMode.currentZone and
 * AdventureTrackProgression.currentTrack were updated independently and could
 * go out of sync after a portal jump.  The fix was to make progression the
 * single authority and have geometry/physics always derive from it.
 */
export class AdventureProgressionSupervisor {
  private activeTrackId: string | null = null
  private activeTrackInfo: TrackInfo | null = null
  private baselineScore = 0
  private timeRemaining = 0
  private initialTimeLimit = 0
  private hasResolvedOutcome = false
  private portalOpen = false
  private portalKind: PortalKind | null = null
  private activeMultiplier = 1
  private elapsedTime = 0
  private readonly unsubscribePortalActivationFailed: () => void

  constructor(
    private readonly eventBus: EventBus,
    private readonly progression: AdventureTrackProgression,
    private readonly callbacks: AdventureProgressionSupervisorCallbacks = {},
  ) {
    this.unsubscribePortalActivationFailed = eventBus.on('portal:activation-failed', (payload) => {
      this.handlePortalActivationFailed(payload)
    })
  }

  startTrack(trackId: string, initialScore = 0): void {
    const trackInfo = this.progression.getTrackInfo(trackId)
    if (!trackInfo || !this.isAdventureModeActive()) {
      this.reset()
      return
    }

    this.activeTrackId = trackId
    this.activeTrackInfo = trackInfo
    this.baselineScore = initialScore
    this.initialTimeLimit = Math.max(0, trackInfo.timeLimitSeconds)
    this.timeRemaining = this.initialTimeLimit
    this.elapsedTime = 0
    this.hasResolvedOutcome = false
    this.portalOpen = false
    this.portalKind = null
    this.activeMultiplier = 1
  }

  update(dt: number, currentTotalScore: number): void {
    if (!this.activeTrackId || !this.activeTrackInfo || this.hasResolvedOutcome || !this.isAdventureModeActive()) {
      return
    }

    const clampedDt = Math.max(0, dt)
    this.elapsedTime += clampedDt
    this.timeRemaining = Math.max(0, this.timeRemaining - clampedDt)

    const scoreDelta = currentTotalScore - this.baselineScore
    if (scoreDelta >= this.activeTrackInfo.recommendedScore) {
      const bonus = Math.max(
        0,
        this.callbacks.getSuccessBonus?.(this.activeTrackInfo, scoreDelta, this.timeRemaining) ?? 0,
      )
      this.activeMultiplier = 1 + bonus
      this.resolveOutcome('success')
      this.eventBus.emit('track:goal-reached', {
        trackId: this.activeTrackId,
        scoreDelta,
        recommendedScore: this.activeTrackInfo.recommendedScore,
        timeRemaining: this.timeRemaining,
      })
      return
    }

    if (this.timeRemaining <= 0) {
      this.activeMultiplier = this.activeTrackInfo.timeoutPenaltyMultiplier
      this.resolveOutcome('timeout')
      this.eventBus.emit('track:timeout', {
        trackId: this.activeTrackId,
        multiplier: this.activeMultiplier,
        timeLimitSeconds: this.initialTimeLimit,
        elapsedSeconds: this.elapsedTime,
      })
    }
  }

  getTimeRemaining(): number {
    return this.activeTrackId ? this.timeRemaining : 0
  }

  getProgress(): number {
    if (!this.activeTrackId || this.initialTimeLimit <= 0) return 0
    return Math.min(1, Math.max(0, 1 - this.timeRemaining / this.initialTimeLimit))
  }

  isPortalOpen(): boolean {
    return this.portalOpen
  }

  getPortalKind(): PortalKind | null {
    return this.portalKind
  }

  getGoalProgressPercent(currentTotalScore: number): number {
    if (!this.activeTrackInfo) return 0
    const scoreDelta = Math.max(0, currentTotalScore - this.baselineScore)
    const target = Math.max(1, this.activeTrackInfo.recommendedScore)
    return Math.min(100, (scoreDelta / target) * 100)
  }

  handlePortalActivationFailed({ trackId, kind }: PachinballEventMap['portal:activation-failed']): boolean {
    if (!this.activeTrackId || !this.activeTrackInfo || !this.hasResolvedOutcome || !this.portalOpen) {
      return false
    }
    if (trackId !== this.activeTrackId || kind !== this.portalKind) {
      return false
    }

    this.hasResolvedOutcome = false
    this.portalOpen = false
    this.portalKind = null
    return true
  }

  getActiveMultiplier(): number {
    return this.activeMultiplier
  }

  getBaselineScore(): number {
    return this.baselineScore
  }

  getActiveTrackId(): string | null {
    return this.activeTrackId
  }

  getScoreDelta(currentTotalScore: number): number {
    return Math.max(0, currentTotalScore - this.baselineScore)
  }

  /** Active campaign track mode — EXTENDED_MAP (descent run) or STATIONARY_TABLE (arena). */
  getActiveModeType(): TrackModeType | null {
    return this.activeTrackInfo?.modeType ?? null
  }

  /**
   * Called exactly once per portal entry by the game orchestrator.
   *
   * Merges reward fields (computed here) with optional spatial context supplied
   * by AdventureMode so that exactly **one** `portal:entered` event is emitted
   * carrying the full payload.  Callers must NOT emit a second `portal:entered`
   * after calling this method.
   *
   * @param finalScore   Player's total score at the moment of entry.
   * @param goldBalls    Gold balls collected during the active track.
   * @param spatial      Optional portal context from AdventureMode.
   */
  onPortalEntered(finalScore: number, goldBalls: number, spatial?: PortalSpatialContext): void {
    if (!this.portalOpen || !this.activeTrackId || !this.activeTrackInfo || !this.portalKind) return

    const baseReward = Math.max(0, finalScore - this.baselineScore)
    const totalReward = Math.round(baseReward * this.activeMultiplier)

    // Capture state before reset so events carry the correct track context.
    const portalKind = this.portalKind
    const activeTrackId = this.activeTrackId
    const elapsedTime = this.elapsedTime

    this.progression.completeTrack(activeTrackId, finalScore, goldBalls, totalReward)
    this.eventBus.emit('portal:entered', {
      kind: portalKind,
      trackId: activeTrackId,
      finalScore,
      goldBalls,
      multiplier: this.activeMultiplier,
      totalReward,
      // Spatial/navigation fields supplied by AdventureMode (optional)
      ...spatial,
    })
    this.eventBus.emit('track:completed', {
      trackId: activeTrackId,
      totalReward,
      duration: elapsedTime,
    })

    // Reset supervisor state before advancing so that the onTrackAdvanced
    // callback can safely call startTrack() for the next track without
    // having it overwritten by the reset that follows.
    this.reset()
    this.advanceToNextTrack()
  }

  reset(): void {
    this.activeTrackId = null
    this.activeTrackInfo = null
    this.baselineScore = 0
    this.timeRemaining = 0
    this.initialTimeLimit = 0
    this.elapsedTime = 0
    this.hasResolvedOutcome = false
    this.portalOpen = false
    this.portalKind = null
    this.activeMultiplier = 1
  }

  /**
   * Clean up resources (alias for reset; provided for consistency with
   * other supervisor classes).
   */
  dispose(): void {
    this.unsubscribePortalActivationFailed()
    this.reset()
  }

  private resolveOutcome(kind: PortalKind): void {
    if (!this.activeTrackId) return
    this.hasResolvedOutcome = true
    this.portalOpen = true
    this.portalKind = kind
    this.eventBus.emit('portal:open', {
      kind,
      trackId: this.activeTrackId,
      mode: this.activeTrackInfo?.modeType,
      multiplier: this.activeMultiplier,
      timeRemaining: this.timeRemaining,
    })
  }

  private advanceToNextTrack(): void {
    const nextTrackId = this.progression.getNextTrackId()
    if (nextTrackId) {
      this.progression.setCurrentTrack(nextTrackId)
    }
    this.callbacks.onTrackAdvanced?.(nextTrackId)
  }

  private isAdventureModeActive(): boolean {
    return this.callbacks.isAdventureModeActive?.() ?? true
  }
}
