/**
 * Adventure EventBus Integration
 * Manages event emission for adventure mode systems (goals, progression, cinematics)
 */

import type { EventBus } from '../game/event-bus'

/**
 * Adventure EventBus Manager
 * Provides methods to emit adventure-related events through the EventBus
 */
export class AdventureEventBusIntegration {
  private eventBus: EventBus

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus
  }

  // Goal Progress Events
  emitGoalProgress(goalId: string, trackId: string, current: number, target: number, title: string): void {
    this.eventBus.emit('goal:progress', {
      goalId,
      trackId,
      current,
      target,
      progress: Math.min(current / target, 1.0),
      title
    })
  }

  emitGoalCompleted(goalId: string, trackId: string, title: string, reward: number): void {
    this.eventBus.emit('goal:completed', { goalId, trackId, title, reward })
  }

  emitTrackProgress(trackId: string, completedGoals: number, totalGoals: number): void {
    this.eventBus.emit('track:progress', {
      trackId,
      completedGoals,
      totalGoals,
      progress: totalGoals > 0 ? Math.min(completedGoals / totalGoals, 1.0) : 0
    })
  }

  emitTrackCompleted(trackId: string, totalReward: number, duration: number): void {
    this.eventBus.emit('track:completed', { trackId, totalReward, duration })
  }

  emitTrackUnlocked(trackId: string, name: string): void {
    this.eventBus.emit('track:unlocked', { trackId, name })
  }

  // Cinematic Events
  emitCinematicStarted(cinematicType: 'track-start' | 'goal-complete' | 'track-complete' | 'jackpot' | 'special-moment', duration: number): void {
    this.eventBus.emit('cinematic:started', { cinematicType, duration })
  }

  emitCinematicFinished(cinematicType: string): void {
    this.eventBus.emit('cinematic:finished', { cinematicType })
  }

  // Scoring Events
  emitPointsAwarded(amount: number, source: string, position?: { x: number; y: number; z: number }, multiplier?: number): void {
    this.eventBus.emit('points:awarded', { amount, source, position, multiplier })
  }

  // Effect Events
  emitFlashEffect(intensity: number, color?: string, duration?: number): void {
    this.eventBus.emit('effect:flash', { color, intensity, duration: duration ?? 0.3 })
  }

  emitBloomEffect(intensity: number, duration?: number): void {
    this.eventBus.emit('effect:bloom', { intensity, duration })
  }

  emitShakeEffect(amount: number, duration?: number): void {
    this.eventBus.emit('effect:shake', { amount, duration: duration ?? 0.3 })
  }

  // Sound and Audio Events
  emitPlaySound(soundKey: string, volume?: number, pitch?: number): void {
    this.eventBus.emit('sound:play', { soundKey, volume, pitch })
  }

  emitMusicIntensity(intensity: number, duration?: number): void {
    this.eventBus.emit('music:intensity', { intensity, duration })
  }

  emitMusicTransition(fromIntensity: number, toIntensity: number, duration: number): void {
    this.eventBus.emit('music:transition', { fromIntensity, toIntensity, duration })
  }
}
