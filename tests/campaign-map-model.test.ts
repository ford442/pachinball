/**
 * Campaign stage map model — the shape the front door renders.
 *
 * The map must show every catalogued stage exactly once: the A/B spine in
 * CAMPAIGN_MAIN_PATH order, and every off-spine stage on a branch hung off the
 * spine stage that unlocks it.
 */

import { describe, expect, it } from 'vitest'
import {
  AdventureTrackProgression,
  CAMPAIGN_MAIN_PATH,
  TRACK_CATALOG,
  type TrackInfo,
} from '../src/adventure/adventure-track-progression'
import { buildCampaignMapModel } from '../src/adventure/ui/campaign-map-model'

function allStageIds(model: ReturnType<typeof buildCampaignMapModel>): string[] {
  return [...model.spine, ...model.branches.flatMap((b) => b.stages)].map((s) => s.id)
}

describe('buildCampaignMapModel — layout', () => {
  const model = buildCampaignMapModel(new AdventureTrackProgression())

  it('lays the spine out in CAMPAIGN_MAIN_PATH order, numbered 1..14', () => {
    expect(model.spine.map((s) => s.id)).toEqual([...CAMPAIGN_MAIN_PATH])
    expect(model.spine.map((s) => s.stageNumber)).toEqual(CAMPAIGN_MAIN_PATH.map((_, i) => i + 1))
  })

  it('places every catalogued stage exactly once', () => {
    const ids = allStageIds(model)
    expect(new Set(ids).size).toBe(ids.length)
    expect([...ids].sort()).toEqual(Object.keys(TRACK_CATALOG).sort())
    expect(model.totalCount).toBe(Object.keys(TRACK_CATALOG).length)
  })

  it('hangs each branch off the spine stage that unlocks it', () => {
    for (const branch of model.branches) {
      expect(branch.anchorTrackId, 'no detached stages in the shipped catalogue').not.toBeNull()
      expect(branch.stages[0]?.unlockedBy).toBe(branch.anchorTrackId)
      expect(branch.anchorStageNumber).toBe(CAMPAIGN_MAIN_PATH.indexOf(branch.anchorTrackId as never) + 1)
      for (const stage of branch.stages) expect(stage.stageNumber).toBeNull()
    }
  })

  it('shows the two optional branches and the post-finale chain in unlock order', () => {
    const byAnchor = Object.fromEntries(model.branches.map((b) => [b.anchorTrackId, b]))

    expect(byAnchor['NEON_HELIX']?.kind).toBe('optional')
    expect(byAnchor['NEON_HELIX']?.stages.map((s) => s.id)).toEqual(['PACHINKO_SPIRE'])
    expect(byAnchor['PACHINKO_HALL']?.kind).toBe('optional')
    expect(byAnchor['PACHINKO_HALL']?.stages.map((s) => s.id)).toEqual(['NEON_STRONGHOLD'])

    const finale = byAnchor['FIREWALL_BREACH']
    expect(finale?.kind).toBe('post-finale')
    const chain = finale?.stages ?? []
    expect(chain.length).toBeGreaterThan(0)
    // Each stage of the chain is unlocked by the one before it.
    chain.slice(1).forEach((stage, i) => expect(stage.unlockedBy).toBe(chain[i]?.id))
  })

  it('labels A (EXTENDED_MAP) and B (STATIONARY_TABLE) slots from the catalogue', () => {
    for (const stage of model.spine) {
      const expected = TRACK_CATALOG[stage.id]?.modeType === 'EXTENDED_MAP' ? 'A' : 'B'
      expect(stage.slot, stage.id).toBe(expected)
    }
  })
})

describe('buildCampaignMapModel — progress', () => {
  it('starts with only NEON_HELIX reachable, as the current stage', () => {
    const model = buildCampaignMapModel(new AdventureTrackProgression())
    const [first, ...rest] = model.spine

    expect(first?.status).toBe('current')
    expect(first?.playable).toBe(true)
    for (const stage of rest) {
      expect(stage.status, stage.id).toBe('locked')
      expect(stage.playable, stage.id).toBe(false)
    }
    expect(model.completedCount).toBe(0)
    expect(model.completionPercent).toBe(0)
  })

  it('reflects completions, unlocks, best scores and the current stage', () => {
    const progression = new AdventureTrackProgression()
    progression.completeTrack('NEON_HELIX', 61_000, 0, 0)
    progression.setCurrentTrack('PACHINKO_HALL')

    const model = buildCampaignMapModel(progression)
    const stage = (id: string) => [...model.spine, ...model.branches.flatMap((b) => b.stages)].find((s) => s.id === id)

    expect(stage('NEON_HELIX')).toMatchObject({ status: 'completed', playable: true, bestScore: 61_000 })
    expect(stage('PACHINKO_HALL')).toMatchObject({ status: 'current', playable: true })
    // NEON_HELIX also unlocks the PACHINKO_SPIRE side branch.
    expect(stage('PACHINKO_SPIRE')).toMatchObject({ status: 'unlocked', playable: true })
    expect(stage('CYBER_CORE')).toMatchObject({ status: 'locked', playable: false })

    expect(model.currentTrackId).toBe('PACHINKO_HALL')
    expect(model.completedCount).toBe(1)
    expect(model.completionPercent).toBe(Math.round((1 / model.totalCount) * 100))
  })
})

describe('buildCampaignMapModel — catalogue edge cases', () => {
  const info = (id: string, unlockedBy?: string): TrackInfo => ({
    id,
    name: id,
    description: '',
    difficulty: 'easy',
    modeType: 'STATIONARY_TABLE',
    recommendedScore: 1,
    timeLimitSeconds: 1,
    timeoutPenaltyMultiplier: 0.5,
    unlockedBy,
    theme: '',
  })
  const progress = {
    isTrackUnlocked: () => false,
    isTrackCompleted: () => false,
    getBestScore: () => 0,
    getCurrentTrack: () => 'S1',
  }

  it('keeps stages nothing on the map unlocks, in a detached branch', () => {
    const catalog = {
      S1: info('S1'),
      S2: info('S2', 'S1'),
      ORPHAN: info('ORPHAN'),
      ORPHAN_CHILD: info('ORPHAN_CHILD', 'ORPHAN'),
      DANGLING: info('DANGLING', 'NOT_IN_CATALOG'),
    }
    const model = buildCampaignMapModel(progress, catalog, ['S1', 'S2'])

    const detached = model.branches.find((b) => b.kind === 'detached')
    expect(detached?.anchorTrackId).toBeNull()
    expect(detached?.stages.map((s) => s.id)).toEqual(['ORPHAN', 'ORPHAN_CHILD', 'DANGLING'])
    expect(model.totalCount).toBe(5)
  })

  it('survives an unlock cycle among off-spine stages', () => {
    const catalog = { S1: info('S1'), X: info('X', 'Y'), Y: info('Y', 'X') }
    const model = buildCampaignMapModel(progress, catalog, ['S1'])
    expect(allStageIds(model).sort()).toEqual(['S1', 'X', 'Y'])
  })
})
