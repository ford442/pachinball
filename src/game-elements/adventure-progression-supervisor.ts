import type { EventBus } from '../game/event-bus'
import { type TrackInfo, type AdventureTrackProgression } from './adventure-track-progression'

export interface AdventureProgressionSupervisorCallbacks {
  isAdventureModeActive?: () => boolean
  getSuccessBonus?: (track: TrackInfo, scoreDelta: number, timeRemaining: number) => number
  onTrackAdvanced?: (nextTrackId: string | null) => void
}

type PortalKind = 'success' | 'timeout'

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

  constructor(
    private readonly eventBus: EventBus,
    private readonly progression: AdventureTrackProgression,
    private readonly callbacks: AdventureProgressionSupervisorCallbacks = {},
  ) {}

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

  getActiveMultiplier(): number {
    return this.activeMultiplier
  }

  onPortalEntered(finalScore: number, goldBalls: number): void {
    if (!this.portalOpen || !this.activeTrackId || !this.activeTrackInfo || !this.portalKind) return

    const baseReward = Math.max(0, finalScore - this.baselineScore)
    const totalReward = Math.round(baseReward * this.activeMultiplier)

    this.progression.completeTrack(this.activeTrackId, finalScore, goldBalls, totalReward)
    this.eventBus.emit('portal:entered', {
      kind: this.portalKind,
      trackId: this.activeTrackId,
      finalScore,
      goldBalls,
      multiplier: this.activeMultiplier,
      totalReward,
    })
    this.eventBus.emit('track:completed', {
      trackId: this.activeTrackId,
      totalReward,
      duration: this.elapsedTime,
    })

    this.advanceToNextTrack()
    this.reset()
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
