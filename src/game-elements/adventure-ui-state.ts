/**
 * Adventure UI State Manager
 * Manages UI state and feedback display for adventure mode
 */

import type { EventBus } from '../game/event-bus'
import type { AdventureGoal } from './adventure-goal-system'

export interface GoalUIElement {
  goalId: string
  title: string
  description: string
  progress: number // 0-1
  current: number
  target: number
  completed: boolean
  displayX: number
  displayY: number
  displayWidth: number
  displayHeight: number
  animationState: 'idle' | 'filling' | 'complete'
}

export interface AdventureUIState {
  showGoalsPanel: boolean
  showTrackInfo: boolean
  showCinematicUI: boolean
  cinematicTitle?: string
  cinematicSubtitle?: string
  goalElements: GoalUIElement[]
  completionPercentage: number
  selectedGoalId?: string
}

export class AdventureUIStateManager {
  private state: AdventureUIState = {
    showGoalsPanel: true,
    showTrackInfo: true,
    showCinematicUI: false,
    goalElements: [],
    completionPercentage: 0
  }

  private animationTimers: Map<string, number> = new Map()
  private unsubscribers: (() => void)[] = []

  /**
   * Set EventBus and subscribe to lifecycle events
   */
  setEventBus(eventBus: EventBus): void {
    this.clearEventBus()
    this.unsubscribers.push(
      eventBus.on('adventure:start', () => {
        this.toggleGoalsPanel(true)
        this.toggleTrackInfo(true)
      }),
      eventBus.on('adventure:end', () => {
        this.toggleGoalsPanel(false)
        this.toggleTrackInfo(false)
        this.hideCinematicOverlay()
      }),
      eventBus.on('game:over', () => {
        this.toggleGoalsPanel(false)
        this.hideCinematicOverlay()
      }),
      eventBus.on('cinematic:started', (payload) => {
        this.showCinematicOverlay(payload.cinematicType, undefined, payload.duration)
      }),
      eventBus.on('cinematic:finished', () => {
        this.hideCinematicOverlay()
      }),
      eventBus.on('goal:completed', (payload) => {
        this.showCinematicOverlay('GOAL COMPLETE!', payload.title, 1.5)
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
   * Update goal UI elements from goal data
   */
  updateGoalElements(goals: AdventureGoal[]): void {
    this.state.goalElements = goals.map((goal, index) => {
      const existing = this.state.goalElements.find(e => e.goalId === goal.id)
      const progress = Math.min(goal.current / goal.target, 1.0)

      return {
        goalId: goal.id,
        title: goal.title,
        description: goal.description,
        progress,
        current: goal.current,
        target: goal.target,
        completed: goal.completed,
        displayX: 20,
        displayY: 20 + (index * 90),
        displayWidth: 280,
        displayHeight: 80,
        animationState: existing?.animationState ?? 'idle'
      }
    })

    // Update completion percentage
    const completed = goals.filter(g => g.completed).length
    this.state.completionPercentage = goals.length > 0
      ? (completed / goals.length) * 100
      : 0
  }

  /**
   * Update goal animation states
   */
  updateAnimations(deltaTime: number): void {
    for (const element of this.state.goalElements) {
      const timerId = `${element.goalId}-timer`
      const currentTime = this.animationTimers.get(timerId) ?? 0

      if (element.completed && element.animationState === 'idle') {
        element.animationState = 'complete'
        this.animationTimers.set(timerId, 0)
      }

      if (element.animationState === 'complete') {
        const elapsed = currentTime + deltaTime
        const duration = 0.6 // Animation duration
        this.animationTimers.set(timerId, elapsed)

        if (elapsed >= duration) {
          element.animationState = 'idle'
        }
      }
    }
  }

  /**
   * Show cinematic UI overlay
   */
  showCinematicOverlay(title: string, subtitle?: string, duration?: number): void {
    this.state.showCinematicUI = true
    this.state.cinematicTitle = title
    this.state.cinematicSubtitle = subtitle

    if (duration && duration > 0) {
      setTimeout(() => {
        this.hideCinematicOverlay()
      }, duration * 1000)
    }
  }

  /**
   * Hide cinematic UI overlay
   */
  hideCinematicOverlay(): void {
    this.state.showCinematicUI = false
    this.state.cinematicTitle = undefined
    this.state.cinematicSubtitle = undefined
  }

  /**
   * Toggle goals panel visibility
   */
  toggleGoalsPanel(visible?: boolean): void {
    this.state.showGoalsPanel = visible ?? !this.state.showGoalsPanel
  }

  /**
   * Toggle track info visibility
   */
  toggleTrackInfo(visible?: boolean): void {
    this.state.showTrackInfo = visible ?? !this.state.showTrackInfo
  }

  /**
   * Select a goal for detailed view
   */
  selectGoal(goalId: string | undefined): void {
    this.state.selectedGoalId = goalId
  }

  /**
   * Get selected goal
   */
  getSelectedGoal(): GoalUIElement | undefined {
    if (!this.state.selectedGoalId) return undefined
    return this.state.goalElements.find(e => e.goalId === this.state.selectedGoalId)
  }

  /**
   * Get animation progress for a goal (0-1)
   */
  getGoalAnimationProgress(goalId: string): number {
    const element = this.state.goalElements.find(e => e.goalId === goalId)
    if (!element || element.animationState !== 'complete') return 0

    const timerId = `${goalId}-timer`
    const elapsed = this.animationTimers.get(timerId) ?? 0
    return Math.min(elapsed / 0.6, 1.0)
  }

  /**
   * Get current UI state
   */
  getState(): Readonly<AdventureUIState> {
    return Object.freeze({ ...this.state })
  }

  /**
   * Check if goals panel should be visible
   */
  shouldShowGoalsPanel(): boolean {
    return this.state.showGoalsPanel
  }

  /**
   * Check if cinematic UI should be visible
   */
  shouldShowCinematicUI(): boolean {
    return this.state.showCinematicUI
  }

  /**
   * Get completion percentage
   */
  getCompletionPercentage(): number {
    return this.state.completionPercentage
  }

  /**
   * Get goals in display order
   */
  getGoalElements(): readonly GoalUIElement[] {
    return Object.freeze([...this.state.goalElements])
  }

  /**
   * Reset UI state
   */
  reset(): void {
    this.state = {
      showGoalsPanel: true,
      showTrackInfo: true,
      showCinematicUI: false,
      goalElements: [],
      completionPercentage: 0
    }
    this.animationTimers.clear()
  }

  /**
   * Calculate layout for responsive UI
   */
  calculateResponsiveLayout(screenWidth: number, screenHeight: number): void {
    // Adjust goal element positions based on screen size
    const panelWidth = Math.min(300, screenWidth * 0.3)
    const panelHeight = Math.min(450, screenHeight * 0.6)

    for (let i = 0; i < this.state.goalElements.length; i++) {
      const element = this.state.goalElements[i]
      element.displayX = screenWidth - panelWidth - 20
      element.displayY = 20 + (i * (panelHeight / Math.max(this.state.goalElements.length, 1)))
      element.displayWidth = panelWidth - 40
      element.displayHeight = (panelHeight / Math.max(this.state.goalElements.length, 1)) - 10
    }
  }

  /**
   * Get completion state for rendering
   */
  getCompletionState() {
    return {
      percentage: this.state.completionPercentage,
      completed: this.state.goalElements.filter(e => e.completed).length,
      total: this.state.goalElements.length
    }
  }

  /**
   * Clean up timers and state
   */
  dispose(): void {
    this.clearEventBus()
    this.animationTimers.clear()
    this.reset()
  }
}
