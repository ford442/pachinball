import { describe, it, expect } from 'vitest'
import {
  migrateCampaignStorage,
  sanitizeProgressionState,
  CAMPAIGN_STORAGE_VERSION,
} from '../src/game-elements/adventure-campaign-persistence'

describe('adventure campaign persistence', () => {
  it('sanitizes unknown tracks and invalid scores', () => {
    const state = sanitizeProgressionState({
      completedTracks: ['NEON_HELIX', 'FAKE_TRACK'],
      unlockedTracks: ['NEON_HELIX'],
      bestScores: { NEON_HELIX: 12000, CYBER_CORE: -5, BAD: NaN },
      currentTrack: 'CYBER_CORE',
      totalGoldBallsCollected: -3,
      totalRewardsEarned: 99.2,
    })

    expect(state.completedTracks).toEqual(['NEON_HELIX'])
    expect(state.unlockedTracks).toEqual(['NEON_HELIX'])
    expect(state.bestScores).toEqual({ NEON_HELIX: 12000 })
    expect(state.currentTrack).toBe('NEON_HELIX')
    expect(state.totalGoldBallsCollected).toBe(0)
    expect(state.totalRewardsEarned).toBe(99)
  })

  it('migrates legacy v1 payloads without a version field', () => {
    const migrated = migrateCampaignStorage({
      progression: {
        completedTracks: ['NEON_HELIX'],
        unlockedTracks: ['NEON_HELIX', 'PACHINKO_HALL'],
        bestScores: { NEON_HELIX: 50000 },
        currentTrack: 'PACHINKO_HALL',
        totalGoldBallsCollected: 2,
        totalRewardsEarned: 500,
      },
      unlockedRewardIds: ['ball-skin-cascade', 'unknown-reward'],
    })

    expect(migrated?.version).toBe(CAMPAIGN_STORAGE_VERSION)
    expect(migrated?.progression.currentTrack).toBe('PACHINKO_HALL')
    expect(migrated?.unlockedRewardIds).toEqual(['ball-skin-cascade', 'unknown-reward'])
  })

  it('returns null for malformed storage', () => {
    expect(migrateCampaignStorage(null)).toBeNull()
    expect(migrateCampaignStorage('bad')).toBeNull()
  })
})