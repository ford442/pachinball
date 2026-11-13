/**
 * Stored records parse, not cast (#505 §A): a field an older build wrote with
 * another type reads as absent and takes its default; the rest of the record
 * survives. Covers settings, the campaign save, the unseen-reward list, the
 * map cache entries and replay tapes.
 */
import { describe, expect, it } from 'vitest'
import * as v from 'valibot'
import { parseJsonWith } from '../src/schemas/schema-kit'
import { StoredSettingsSchema } from '../src/schemas/settings'
import { RemoteTableMapListSchema, UnseenRewardsSchema } from '../src/schemas/storage'
import { migrateCampaignStorage, CAMPAIGN_STORAGE_VERSION } from '../src/adventure/adventure-campaign-persistence'
import { ReplayRecorder } from '../src/replay/replay-recorder'

describe('settings', () => {
  it('keeps good fields, drops mistyped ones, reads the legacy scanline key', () => {
    const parsed = parseJsonWith(StoredSettingsSchema, JSON.stringify({ muted: true, masterVolume: 'loud', scanlineIntensity: 0.4, qualityPreset: 'ultra' }))
    expect(parsed).toEqual({ muted: true, masterVolume: undefined, scanlineIntensity: 0.4, qualityPreset: undefined })
  })

  it('rejects a record that is not an object', () => {
    expect(parseJsonWith(StoredSettingsSchema, '5')).toBeNull()
    expect(parseJsonWith(StoredSettingsSchema, 'not json')).toBeNull()
  })
})

describe('campaign save', () => {
  it('migrates a version-1 save whose progression sat at the top level', () => {
    const payload = migrateCampaignStorage({ completedTracks: ['NEON_HELIX'], unlockedTracks: ['NEON_HELIX', 'CYBER_CORE'], currentTrack: 'CYBER_CORE' })
    expect(payload?.version).toBe(CAMPAIGN_STORAGE_VERSION)
    expect(payload?.progression.completedTracks).toEqual(['NEON_HELIX'])
    expect(payload?.progression.currentTrack).toBe('CYBER_CORE')
  })

  it('keeps string reward ids and string equipped slots only', () => {
    const payload = migrateCampaignStorage({
      version: 2,
      progression: { unlockedTracks: ['NEON_HELIX'], totalGoldBallsCollected: 'many' },
      unlockedRewardIds: ['a', 3, 'b'],
      equippedRewards: { ball: 'gold', cabinet: 7 },
    })
    expect(payload?.unlockedRewardIds).toEqual(['a', 'b'])
    expect(payload?.equippedRewards).toEqual({ ball: 'gold' })
    expect(payload?.progression.totalGoldBallsCollected).toBe(0)
  })

  it('is null for a value that is not a record', () => {
    expect(migrateCampaignStorage(null)).toBeNull()
    expect(migrateCampaignStorage('save')).toBeNull()
  })
})

describe('lists drop bad entries, keep good ones', () => {
  it('unseen rewards', () => {
    const good = { kind: 'ball-skin', id: 'gold', label: 'Gold', rarity: 'rare', scope: 'track' }
    expect(v.parse(UnseenRewardsSchema, [good, { id: 'half' }, 'x'])).toEqual([good])
  })

  it('remote maps need an id and a name; a mistyped colour reads as absent', () => {
    const maps = v.parse(RemoteTableMapListSchema, [{ id: 'm', name: 'M', baseColor: 7, glowIntensity: 2 }, { name: 'no id' }])
    expect(maps).toHaveLength(1)
    expect(maps[0]).toMatchObject({ id: 'm', name: 'M', baseColor: undefined, glowIntensity: 2 })
  })
})

describe('replay tapes', () => {
  it('reads the snake_case keys of older tapes', () => {
    const tape = ReplayRecorder.fromJSON({ version: 3, build_id: 'b', map_id: 'neon-helix', seed: 7, final_score: 120, static_hash: null, frames: [] })
    expect(tape).toMatchObject({ buildId: 'b', mapId: 'neon-helix', seed: 7, finalScore: 120, staticHash: null })
  })

  it('a mistyped field takes the default a missing one always had', () => {
    const tape = ReplayRecorder.fromJSON({ version: 3, seed: '7', finalScore: 5, cascade: { mode: 'weekly', seed: 1, seedId: 'x' } })
    expect(tape.seed).toBe(0)
    expect(tape.finalScore).toBe(5)
    expect(tape.cascade).toBeUndefined()
  })

  it('normalises raw schema-1 frames', () => {
    const tape = ReplayRecorder.fromJSON({ version: 1, frames: [{ flipperLeft: true, flipperRight: null, plunger: true, nudge: null, timestamp: 1 }] })
    expect(tape.frames[0]).toMatchObject({ flipperLeft: true, plungerCharge: 0, plunger: true })
  })

  it('round-trips a cascade run with its seed as a u32', () => {
    const tape = ReplayRecorder.fromJSON({ version: 3, cascade: { mode: 'free', seed: 4294967295, seedId: 'free-ffffffff' } })
    expect(tape.cascade).toEqual({ mode: 'free', seed: 4294967295, seedId: 'free-ffffffff' })
  })
})
