import { describe, expect, it } from 'vitest'
import { TRACK_CATALOG } from '../src/game-elements/adventure-track-progression'
import { buildCampaignGoalsForTrack, getGoalsForTrack, trackGoalSlug } from '../src/game-elements/adventure-track-goals'

const EARLY_TRACKS = ['NEON_HELIX', 'PACHINKO_HALL', 'CYBER_CORE', 'QUANTUM_GRID', 'PACHINKO_SPIRE'] as const

describe('campaign track goals', () => {
  it('aligns primary score goal with TRACK_CATALOG recommendedScore', () => {
    for (const trackId of EARLY_TRACKS) {
      const catalog = TRACK_CATALOG[trackId]
      const goals = buildCampaignGoalsForTrack(trackId)
      const scoreGoal = goals.find((g) => g.id.endsWith('-score'))
      expect(scoreGoal).toBeDefined()
      expect(scoreGoal?.target).toBe(catalog.recommendedScore)
      expect(scoreGoal?.type).toBe('score-based')
    }
  })

  it('uses consistent slug ids for goal tracker wiring', () => {
    for (const trackId of EARLY_TRACKS) {
      const slug = trackGoalSlug(trackId)
      const goals = getGoalsForTrack(trackId)
      expect(goals.every((g) => g.id.startsWith(slug))).toBe(true)
    }
  })

  it('provides 4 lightweight PoC goals per early track', () => {
    for (const trackId of EARLY_TRACKS) {
      const goals = getGoalsForTrack(trackId)
      expect(goals).toHaveLength(4)
      expect(goals.map((g) => g.type).sort()).toEqual(
        ['collection-based', 'combo-based', 'score-based', 'survival'].sort(),
      )
    }
  })

  it('includes PACHINKO_HALL goals on the main spine', () => {
    const goals = getGoalsForTrack('PACHINKO_HALL')
    const scoreGoal = goals.find((g) => g.id === 'pachinko-hall-score')
    expect(scoreGoal?.target).toBe(TRACK_CATALOG.PACHINKO_HALL.recommendedScore)
  })
})
