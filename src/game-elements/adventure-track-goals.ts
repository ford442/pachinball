/**
 * Adventure Track Goal Definitions
 * Defines goal sets for each adventure track
 */

import type { AdventureGoal, GoalType } from './adventure-goal-system'

/**
 * Create a goal object
 */
function createGoal(
  id: string,
  title: string,
  description: string,
  type: GoalType,
  target: number,
  reward: number
): AdventureGoal {
  return {
    id,
    title,
    description,
    type,
    target,
    current: 0,
    completed: false,
    reward
  }
}

/**
 * Goals for NEON_HELIX track - A classic descent through spiraling light
 */
export const NEON_HELIX_GOALS: AdventureGoal[] = [
  createGoal(
    'helix-score',
    'Reach 50,000 Points',
    'Accumulate 50,000 points by hitting bumpers and collecting gold balls',
    'score-based',
    50000,
    5000
  ),
  createGoal(
    'helix-gold',
    'Collect 5 Gold Balls',
    'Find and collect 5 gold balls during the track',
    'collection-based',
    5,
    3000
  ),
  createGoal(
    'helix-combo',
    'Land 3 Combo Hits',
    'Hit 3 bumpers in quick succession without missing',
    'combo-based',
    3,
    2000
  ),
  createGoal(
    'helix-survive',
    'Survive 30 Seconds',
    'Keep the ball in play for 30 consecutive seconds',
    'survival',
    30,
    4000
  )
]

/**
 * Goals for CYBER_CORE track - Fast-paced vertical descent
 */
export const CYBER_CORE_GOALS: AdventureGoal[] = [
  createGoal(
    'cyber-score',
    'Reach 75,000 Points',
    'Achieve 75,000 points by navigating the core efficiently',
    'score-based',
    75000,
    6000
  ),
  createGoal(
    'cyber-gates',
    'Trigger All Gates',
    'Open all 4 moving gates in the core',
    'hit-all',
    4,
    4000
  ),
  createGoal(
    'cyber-gold',
    'Collect 8 Gold Balls',
    'Locate and collect 8 gold balls from various zones',
    'collection-based',
    8,
    4000
  ),
  createGoal(
    'cyber-survive',
    'Survive 45 Seconds',
    'Maintain ball control for 45 seconds without draining',
    'survival',
    45,
    5000
  )
]

/**
 * Goals for QUANTUM_GRID track - Maze navigation challenge
 */
export const QUANTUM_GRID_GOALS: AdventureGoal[] = [
  createGoal(
    'quantum-score',
    'Reach 100,000 Points',
    'Dominate the grid and accumulate 100,000 points',
    'score-based',
    100000,
    8000
  ),
  createGoal(
    'quantum-zones',
    'Complete All Zones',
    'Visit and activate all 6 color zones in the quantum grid',
    'hit-all',
    6,
    5000
  ),
  createGoal(
    'quantum-gold',
    'Collect 12 Gold Balls',
    'Find all 12 hidden gold balls scattered across the maze',
    'collection-based',
    12,
    6000
  ),
  createGoal(
    'quantum-perfect',
    'Achieve 60 Second Run',
    'Perfect play: maintain control for a full 60 seconds',
    'survival',
    60,
    7000
  )
]

/**
 * Goals for PACHINKO_SPIRE track - Pin field challenge
 */
export const PACHINKO_SPIRE_GOALS: AdventureGoal[] = [
  createGoal(
    'spire-score',
    'Reach 65,000 Points',
    'Navigate the pin field and score 65,000 points',
    'score-based',
    65000,
    5500
  ),
  createGoal(
    'spire-hits',
    'Hit 50 Pins',
    'Bounce off 50 individual pins during descent',
    'hit-all',
    50,
    4500
  ),
  createGoal(
    'spire-gold',
    'Collect 6 Gold Balls',
    'Find 6 gold balls in the pin field',
    'collection-based',
    6,
    3500
  ),
  createGoal(
    'spire-multi',
    'Hit 4 Multi-Bumpers',
    'Successfully trigger all 4 multi-bumper zones',
    'combo-based',
    4,
    3500
  )
]

/**
 * Goals for SINGULARITY_WELL track - Extreme gravity challenge
 */
export const SINGULARITY_WELL_GOALS: AdventureGoal[] = [
  createGoal(
    'well-score',
    'Reach 150,000 Points',
    'Master the singularity and achieve maximum score',
    'score-based',
    150000,
    10000
  ),
  createGoal(
    'well-gold',
    'Collect 15 Gold Balls',
    'Find all 15 rare gold balls in the gravity well',
    'collection-based',
    15,
    8000
  ),
  createGoal(
    'well-survive',
    'Survive 90 Seconds',
    'Maintain perfect control for 90 seconds against gravity',
    'survival',
    90,
    10000
  ),
  createGoal(
    'well-combo',
    'Build 10 Hit Combo',
    'Land 10 consecutive bumper hits without missing',
    'combo-based',
    10,
    6000
  )
]

/**
 * Get goals for a specific track
 */
export function getGoalsForTrack(trackId: string): AdventureGoal[] {
  const goalsMap: Record<string, AdventureGoal[]> = {
    'NEON_HELIX': NEON_HELIX_GOALS,
    'CYBER_CORE': CYBER_CORE_GOALS,
    'QUANTUM_GRID': QUANTUM_GRID_GOALS,
    'PACHINKO_SPIRE': PACHINKO_SPIRE_GOALS,
    'SINGULARITY_WELL': SINGULARITY_WELL_GOALS,
  }

  // Default goals for any unlisted track
  if (!(trackId in goalsMap)) {
    return [
      createGoal(
        `${trackId.toLowerCase()}-score`,
        'Reach 50,000 Points',
        'Accumulate 50,000 points on this track',
        'score-based',
        50000,
        5000
      ),
      createGoal(
        `${trackId.toLowerCase()}-gold`,
        'Collect 5 Gold Balls',
        'Find 5 gold balls on this track',
        'collection-based',
        5,
        3000
      ),
      createGoal(
        `${trackId.toLowerCase()}-survive`,
        'Survive 30 Seconds',
        'Keep the ball in play for 30 seconds',
        'survival',
        30,
        3000
      ),
      createGoal(
        `${trackId.toLowerCase()}-combo`,
        'Build 3 Hit Combo',
        'Land 3 consecutive bumper hits',
        'combo-based',
        3,
        2000
      ),
    ]
  }

  return goalsMap[trackId] ?? []
}

/**
 * Get completion percentage for a set of goals
 */
export function getCompletionPercentage(goals: AdventureGoal[]): number {
  if (goals.length === 0) return 0
  const completed = goals.filter(g => g.completed).length
  return (completed / goals.length) * 100
}

/**
 * Get total reward from a set of goals
 */
export function getTotalReward(goals: AdventureGoal[]): number {
  return goals
    .filter(g => g.completed)
    .reduce((sum, g) => sum + g.reward, 0)
}

/**
 * Create a new goal tracker state from goals
 */
export function cloneGoals(goals: AdventureGoal[]): AdventureGoal[] {
  return goals.map(g => ({ ...g }))
}
