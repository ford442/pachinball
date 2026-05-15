/**
 * Adventure Goal System
 * Manages track-specific goals and progression tracking
 */

import type { EventBus } from '../game/event-bus'

export type GoalType = 'score-based' | 'collection-based' | 'survival' | 'combo-based' | 'hit-all'

export interface AdventureGoal {
  id: string
  title: string
  description: string
  type: GoalType
  target: number
  current: number
  completed: boolean
  reward: number // Points awarded for completion
}

export interface GoalTracker {
  trackId: string
  goals: AdventureGoal[]
  completedCount: number
  allComplete: boolean
}

export class AdventureGoalSystem {
  private tracker: GoalTracker | null = null
  private onGoalProgress: ((goal: AdventureGoal) => void) | null = null
  private onGoalComplete: ((goal: AdventureGoal) => void) | null = null
  private onAllGoalsComplete: (() => void) | null = null
  private eventBus: EventBus | null = null
  private unsubscribers: (() => void)[] = []

  /**
   * Initialize goals for a specific track
   */
  initializeGoals(trackId: string, goals: AdventureGoal[]): void {
    this.tracker = {
      trackId,
      goals: goals.map(g => ({ ...g })), // Clone goals
      completedCount: 0,
      allComplete: false
    }
  }

  /**
   * Set EventBus and subscribe to lifecycle events
   */
  setEventBus(eventBus: EventBus): void {
    this.clearEventBus()
    this.eventBus = eventBus
    this.unsubscribers.push(
      eventBus.on('game:over', () => this.reset()),
      eventBus.on('adventure:end', () => this.reset())
    )
  }

  private clearEventBus(): void {
    for (const unsub of this.unsubscribers) {
      unsub()
    }
    this.unsubscribers = []
    this.eventBus = null
  }

  /**
   * Update a specific goal metric
   */
  updateGoal(goalId: string, currentValue: number): void {
    if (!this.tracker) return

    const goal = this.tracker.goals.find(g => g.id === goalId)
    if (!goal) return

    goal.current = Math.min(currentValue, goal.target)

    // Check if goal just completed
    if (!goal.completed && goal.current >= goal.target) {
      goal.completed = true
      this.tracker.completedCount++
      this.onGoalComplete?.(goal)

      // Emit completion event
      this.eventBus?.emit('goal:completed', {
        goalId: goal.id,
        trackId: this.tracker.trackId,
        title: goal.title,
        reward: goal.reward
      })

      // Check if all goals are complete
      if (this.tracker.completedCount === this.tracker.goals.length) {
        this.tracker.allComplete = true
        this.onAllGoalsComplete?.()
      }
    }

    this.onGoalProgress?.(goal)

    // Emit progress event
    this.eventBus?.emit('goal:progress', {
      goalId: goal.id,
      trackId: this.tracker.trackId,
      current: goal.current,
      target: goal.target,
      progress: Math.min(goal.current / goal.target, 1.0),
      title: goal.title
    })
  }

  /**
   * Increment a goal by a specific amount
   */
  incrementGoal(goalId: string, amount: number = 1): void {
    if (!this.tracker) return
    const goal = this.tracker.goals.find(g => g.id === goalId)
    if (goal) {
      this.updateGoal(goalId, goal.current + amount)
    }
  }

  /**
   * Get current goal progress (0-1)
   */
  getGoalProgress(goalId: string): number {
    if (!this.tracker) return 0
    const goal = this.tracker.goals.find(g => g.id === goalId)
    if (!goal) return 0
    return Math.min(goal.current / goal.target, 1.0)
  }

  /**
   * Get overall progress for track (0-1)
   */
  getOverallProgress(): number {
    if (!this.tracker) return 0
    return this.tracker.completedCount / this.tracker.goals.length
  }

  /**
   * Get all goals for current track
   */
  getGoals(): AdventureGoal[] {
    return this.tracker?.goals ?? []
  }

  /**
   * Check if all goals are complete
   */
  isComplete(): boolean {
    return this.tracker?.allComplete ?? false
  }

  /**
   * Get total reward from completed goals
   */
  getTotalReward(): number {
    if (!this.tracker) return 0
    return this.tracker.goals
      .filter(g => g.completed)
      .reduce((sum, g) => sum + g.reward, 0)
  }

  /**
   * Register callback for goal progress updates
   */
  onProgress(callback: (goal: AdventureGoal) => void): void {
    this.onGoalProgress = callback
  }

  /**
   * Register callback for individual goal completion
   */
  onComplete(callback: (goal: AdventureGoal) => void): void {
    this.onGoalComplete = callback
  }

  /**
   * Register callback for all goals complete
   */
  onAllComplete(callback: () => void): void {
    this.onAllGoalsComplete = callback
  }

  /**
   * Reset goal system
   */
  reset(): void {
    this.tracker = null
  }

  /**
   * Clean up callbacks and state
   */
  dispose(): void {
    this.clearEventBus()
    this.tracker = null
    this.onGoalProgress = null
    this.onGoalComplete = null
    this.onAllGoalsComplete = null
  }
}
