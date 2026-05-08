/**
 * Adventure Goal Tracker Integration
 * Integrates goal system with ball manager, physics, and game events
 */

import { AdventureGoalSystem } from './adventure-goal-system'
import { getGoalsForTrack } from './adventure-track-goals'

export class AdventureGoalTracker {
  private goalSystem: AdventureGoalSystem
  private currentTrackId: string = ''

  // Event counters
  private bumpersHitCount: number = 0
  private goldBallsCollected: number = 0
  private timeElapsed: number = 0
  private lastComboTime: number = 0
  private currentCombo: number = 0
  private readonly COMBO_TIMEOUT = 2.0

  constructor() {
    this.goalSystem = new AdventureGoalSystem()
  }

  /**
   * Initialize tracker for a specific track
   */
  initializeTrack(trackId: string): void {
    this.currentTrackId = trackId

    // Reset counters
    this.bumpersHitCount = 0
    this.goldBallsCollected = 0
    this.timeElapsed = 0
    this.currentCombo = 0
    this.lastComboTime = 0

    // Initialize goals for this track
    const trackGoals = getGoalsForTrack(trackId)
    this.goalSystem.initializeGoals(trackId, trackGoals)
  }

  /**
   * Update tracker (called from game loop)
   */
  update(deltaTime: number): void {
    this.timeElapsed += deltaTime

    // Update survival goal
    this.goalSystem.updateGoal(`${this.currentTrackId.toLowerCase()}-survive`, Math.floor(this.timeElapsed))

    // Update combo timeout
    if (this.currentCombo > 0 && this.timeElapsed - this.lastComboTime > this.COMBO_TIMEOUT) {
      this.currentCombo = 0
    }
  }

  /**
   * Track bumper hit
   */
  trackBumperHit(): void {
    this.bumpersHitCount++

    // Update hit-all goals
    const hitGoalId = `${this.currentTrackId.toLowerCase()}-hits`
    this.goalSystem.incrementGoal(hitGoalId, 1)

    // Update combo
    this.currentCombo++
    this.lastComboTime = this.timeElapsed

    // Check for combo goal
    const comboGoalId = `${this.currentTrackId.toLowerCase()}-combo`
    if (this.currentCombo >= 3) {
      this.goalSystem.updateGoal(comboGoalId, Math.floor(this.currentCombo / 3))
    }
  }

  /**
   * Track ball collection
   */
  trackBallCollected(ballType: string): void {
    // Check if it's a gold ball
    if (ballType === 'GOLD_PLATED' || ballType === 'SOLID_GOLD') {
      this.goldBallsCollected++
      const goldGoalId = `${this.currentTrackId.toLowerCase()}-gold`
      this.goalSystem.incrementGoal(goldGoalId, 1)
    }
  }

  /**
   * Track ball drained
   */
  trackBallDrained(): void {
    this.currentCombo = 0
  }

  /**
   * Update score-based goal
   */
  updateScore(currentScore: number): void {
    const scoreGoalId = `${this.currentTrackId.toLowerCase()}-score`
    this.goalSystem.updateGoal(scoreGoalId, currentScore)
  }

  /**
   * Track zone completion (for hit-all goals)
   */
  completeZone(zoneCount: number): void {
    const zoneGoalId = `${this.currentTrackId.toLowerCase()}-zones`
    this.goalSystem.updateGoal(zoneGoalId, zoneCount)
  }

  /**
   * Track gate trigger (for gate goals)
   */
  triggerGate(gateCount: number): void {
    const gateGoalId = `${this.currentTrackId.toLowerCase()}-gates`
    this.goalSystem.updateGoal(gateGoalId, gateCount)
  }


  /**
   * Get current goal system
   */
  getGoalSystem(): AdventureGoalSystem {
    return this.goalSystem
  }

  /**
   * Get all goals
   */
  getGoals() {
    return this.goalSystem.getGoals()
  }

  /**
   * Get overall progress
   */
  getProgress(): number {
    return this.goalSystem.getOverallProgress()
  }

  /**
   * Check if track is complete
   */
  isComplete(): boolean {
    return this.goalSystem.isComplete()
  }

  /**
   * Get total reward earned
   */
  getTotalReward(): number {
    return this.goalSystem.getTotalReward()
  }

  /**
   * Get completion percentage
   */
  getCompletionPercentage(): number {
    const progress = this.goalSystem.getOverallProgress()
    return Math.round(progress * 100)
  }

  /**
   * Reset tracker
   */
  reset(): void {
    this.goalSystem.reset()
    this.bumpersHitCount = 0
    this.goldBallsCollected = 0
    this.timeElapsed = 0
    this.currentCombo = 0
  }
}
