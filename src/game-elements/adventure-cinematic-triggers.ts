/**
 * Adventure Cinematic Triggers
 * Automatically triggers cinematic moments on game events
 */

import type { EventBus } from '../game/event-bus'
import { Color3 } from '@babylonjs/core'
import { AdventureCinematicSystem } from './adventure-cinematic-system'
import type { AdventureGoalTracker } from './adventure-goal-tracker'

export interface CinematicTriggerConfig {
  trackStartEnabled: boolean
  goalCompleteEnabled: boolean
  trackCompleteEnabled: boolean
  jackpotEnabled: boolean
  skipOnUserInput: boolean
}

export class AdventureCinematicTriggers {
  private cinematics: AdventureCinematicSystem
  private goalTracker: AdventureGoalTracker | null = null
  private config: CinematicTriggerConfig = {
    trackStartEnabled: true,
    goalCompleteEnabled: true,
    trackCompleteEnabled: true,
    jackpotEnabled: true,
    skipOnUserInput: true
  }

  private trackState = {
    trackStarted: false,
    completedGoalsCount: 0,
    lastJackpotScore: 0
  }

  private unsubscribers: (() => void)[] = []

  constructor(cinematicSystem: AdventureCinematicSystem) {
    this.cinematics = cinematicSystem
  }

  /**
   * Set EventBus and subscribe to lifecycle events
   */
  setEventBus(eventBus: EventBus): void {
    this.clearEventBus()
    this.unsubscribers.push(
      eventBus.on('adventure:start', () => {
        this.trackState.trackStarted = false
        this.trackState.completedGoalsCount = 0
      }),
      eventBus.on('game:over', () => this.reset()),
      eventBus.on('goal:completed', (payload) => {
        if (this.config.goalCompleteEnabled && !this.cinematics.isPlaying()) {
          this.cinematics.playGoalComplete(payload.title)
        }
      }),
      eventBus.on('jackpot:start', () => {
        if (this.config.jackpotEnabled && !this.cinematics.isPlaying()) {
          this.cinematics.playJackpot(1000)
        }
      })
    )
  }

  private clearEventBus(): void {
    for (const unsub of this.unsubscribers) {
      unsub()
    }
    this.unsubscribers = []
  }

  /**
   * Set goal tracker for monitoring goal completion
   */
  setGoalTracker(tracker: AdventureGoalTracker): void {
    this.goalTracker = tracker
  }

  /**
   * Configure cinematic triggers
   */
  configure(config: Partial<CinematicTriggerConfig>): void {
    this.config = { ...this.config, ...config }
  }

  /**
   * Initialize for a new track
   */
  onTrackStart(trackName: string): void {
    this.trackState.trackStarted = false
    this.trackState.completedGoalsCount = 0

    // Play track start cinematic on next update
    if (this.config.trackStartEnabled) {
      setTimeout(() => {
        if (!this.trackState.trackStarted) {
          this.trackState.trackStarted = true
          this.cinematics.playTrackStart(trackName)
        }
      }, 100)
    }
  }

  /**
   * Update triggers (call from game loop)
   */
  update(): void {
    if (!this.goalTracker) return

    // Check for goal completions
    if (this.config.goalCompleteEnabled) {
      const goals = this.goalTracker.getGoals()
      const nowCompleted = goals.filter(g => g.completed).length

      if (nowCompleted > this.trackState.completedGoalsCount) {
        const newlyCompleted = goals.find(g => g.completed && goals.indexOf(g) >= this.trackState.completedGoalsCount)
        if (newlyCompleted && this.cinematics.isPlaying() === false) {
          this.cinematics.playGoalComplete(newlyCompleted.title)
        }
      }

      this.trackState.completedGoalsCount = nowCompleted
    }

    // Check for track completion
    if (this.config.trackCompleteEnabled && this.goalTracker.isComplete()) {
      if (!this.trackState.trackStarted) {
        this.cinematics.playTrackComplete('Track')
      }
    }
  }

  /**
   * Trigger jackpot cinematic
   */
  triggerJackpot(points: number): void {
    if (this.config.jackpotEnabled && this.cinematics.isPlaying() === false) {
      this.trackState.lastJackpotScore = points
      this.cinematics.playJackpot(points)
    }
  }

  /**
   * Handle user input to skip cinematic
   */
  onUserInput(): void {
    if (this.config.skipOnUserInput && this.cinematics.isPlaying()) {
      this.cinematics.skipCinematic()
    }
  }

  /**
   * Reset trigger state
   */
  reset(): void {
    this.trackState = {
      trackStarted: false,
      completedGoalsCount: 0,
      lastJackpotScore: 0
    }
  }

  /**
   * Check if currently playing cinematic
   */
  isPlayingCinematic(): boolean {
    return this.cinematics.isPlaying()
  }

  /**
   * Request a cinematic beat for campaign reward
   */
  public requestBeat(options: { rarity: 'common' | 'rare' | 'legendary'; maxDurationMs: number }): Promise<void> {
    if (this.cinematics.isPlaying()) {
      return Promise.reject(new Error('Cinematic system is busy'))
    }

    const colors = {
      common: '#00ffff',
      rare: '#8800ff',
      legendary: '#ffd700'
    }
    const colorHex = colors[options.rarity] || '#00ffff'
    const durationSec = Math.min(2000, options.maxDurationMs) / 1000

    this.cinematics.playSequence({
      type: 'special-moment',
      duration: durationSec,
      cameraPath: {
        startAlpha: -Math.PI / 2,
        startBeta: 1.0,
        startRadius: 16,
        endAlpha: -Math.PI / 1.9,
        endBeta: 0.9,
        endRadius: 14
      },
      effects: {
        bloomIntensity: options.rarity === 'legendary' ? 1.0 : 0.5,
        colorFlash: Color3.FromHexString(colorHex),
        flashDuration: 0.4
      },
      easing: (t) => t
    })

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        resolve()
      }, options.maxDurationMs)
    })
  }

  /**
   * Clean up references
   */
  dispose(): void {
    this.clearEventBus()
    this.goalTracker = null
    this.reset()
  }
}
