/**
 * Campaign track goals — aligned with TRACK_CATALOG timers and recommendedScore.
 * Primary win condition matches AdventureProgressionSupervisor (score delta).
 */

import { TRACK_CATALOG } from './adventure-track-progression'
import type { AdventureGoal, GoalType } from './adventure-goal-system'

export function trackGoalSlug(trackId: string): string {
  return trackId.toLowerCase().replace(/_/g, '-')
}

function createGoal(
  id: string,
  title: string,
  description: string,
  type: GoalType,
  target: number,
  reward: number,
): AdventureGoal {
  return {
    id,
    title,
    description,
    type,
    target,
    current: 0,
    completed: false,
    reward,
  }
}

export interface CampaignGoalTemplate {
  goldTarget: number
  comboTarget: number
  survivalSeconds: number
  bonusReward: number
}

/** Per-track secondary objective tuning (primary score comes from catalog). */
const CAMPAIGN_GOAL_TEMPLATES: Record<string, CampaignGoalTemplate> = {
  NEON_HELIX: { goldTarget: 3, comboTarget: 5, survivalSeconds: 45, bonusReward: 2500 },
  PACHINKO_HALL: { goldTarget: 4, comboTarget: 4, survivalSeconds: 40, bonusReward: 2200 },
  CYBER_CORE: { goldTarget: 4, comboTarget: 6, survivalSeconds: 50, bonusReward: 3000 },
  QUANTUM_GRID: { goldTarget: 5, comboTarget: 8, survivalSeconds: 60, bonusReward: 4000 },
  PACHINKO_SPIRE: { goldTarget: 4, comboTarget: 5, survivalSeconds: 35, bonusReward: 2800 },
  SINGULARITY_WELL: { goldTarget: 6, comboTarget: 10, survivalSeconds: 75, bonusReward: 5000 },
}

const DEFAULT_TEMPLATE: CampaignGoalTemplate = {
  goldTarget: 3,
  comboTarget: 4,
  survivalSeconds: 30,
  bonusReward: 2000,
}

/**
 * Build the PoC goal set for a campaign track.
 * Goal 1 (score) mirrors the portal unlock threshold in the supervisor.
 */
export function buildCampaignGoalsForTrack(trackId: string): AdventureGoal[] {
  const info = TRACK_CATALOG[trackId]
  const template = CAMPAIGN_GOAL_TEMPLATES[trackId] ?? DEFAULT_TEMPLATE
  const slug = trackGoalSlug(trackId)
  const scoreTarget = info?.recommendedScore ?? 50_000
  const timeLimit = info?.timeLimitSeconds ?? 120

  return [
    createGoal(
      `${slug}-score`,
      `Reach ${scoreTarget.toLocaleString()} pts`,
      `Hit ${scoreTarget.toLocaleString()} track points before the ${timeLimit}s timer expires`,
      'score-based',
      scoreTarget,
      Math.round(scoreTarget * 0.1),
    ),
    createGoal(
      `${slug}-gold`,
      `Collect ${template.goldTarget} gold swarms`,
      'Drain gold-plated or solid-gold swarm members into the collection lane',
      'collection-based',
      template.goldTarget,
      template.bonusReward,
    ),
    createGoal(
      `${slug}-combo`,
      `Chain ${template.comboTarget} bumper hits`,
      'Keep the combo alive — consecutive bumper hits without a long gap',
      'combo-based',
      template.comboTarget,
      Math.round(template.bonusReward * 0.6),
    ),
    createGoal(
      `${slug}-survive`,
      `Survive ${template.survivalSeconds}s`,
      'Keep the ball in play without draining',
      'survival',
      template.survivalSeconds,
      Math.round(template.bonusReward * 0.5),
    ),
  ]
}

/**
 * Get goals for a specific track (campaign catalog driven).
 */
export function getGoalsForTrack(trackId: string): AdventureGoal[] {
  if (trackId in TRACK_CATALOG || trackId in CAMPAIGN_GOAL_TEMPLATES) {
    return buildCampaignGoalsForTrack(trackId)
  }
  return buildCampaignGoalsForTrack('NEON_HELIX')
}

export function getCompletionPercentage(goals: AdventureGoal[]): number {
  if (goals.length === 0) return 0
  const completed = goals.filter((g) => g.completed).length
  return (completed / goals.length) * 100
}

export function getTotalReward(goals: AdventureGoal[]): number {
  return goals.filter((g) => g.completed).reduce((sum, g) => sum + g.reward, 0)
}

export function cloneGoals(goals: AdventureGoal[]): AdventureGoal[] {
  return goals.map((g) => ({ ...g }))
}

/** @deprecated Legacy exports kept for barrel compatibility. */
export const NEON_HELIX_GOALS = buildCampaignGoalsForTrack('NEON_HELIX')
export const CYBER_CORE_GOALS = buildCampaignGoalsForTrack('CYBER_CORE')
export const QUANTUM_GRID_GOALS = buildCampaignGoalsForTrack('QUANTUM_GRID')
export const PACHINKO_SPIRE_GOALS = buildCampaignGoalsForTrack('PACHINKO_SPIRE')
export const SINGULARITY_WELL_GOALS = buildCampaignGoalsForTrack('SINGULARITY_WELL')
