/**
 * @vitest-environment happy-dom
 */
/**
 * #444 Slice D — the campaign cloud save, against a fake arcade service that
 * two devices share once linked:
 *   - a campaign saved on device A resumes on device B at the same stage;
 *   - a cloud save one schema version behind migrates on pull (and goes back up current);
 *   - export → import → export is byte-identical;
 *   - merging two saves never loses progress.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { AdventureTrackProgression } from '../src/adventure/adventure-track-progression'
import { CAMPAIGN_STORAGE_KEY, CAMPAIGN_STORAGE_VERSION, migrateCampaignStorage } from '../src/adventure/adventure-campaign-persistence'
import { CampaignRewardsManager } from '../src/adventure/campaign-rewards-manager'
import { CampaignCloudSync, exportCampaignSave, importCampaignSave, mergeCampaignPayloads } from '../src/adventure/campaign-cloud-sync'

/** One cloud: saves keyed by player, devices linked to a player. */
class FakeCloud {
  saves = new Map<string, { schema_version: number; data: unknown; updated_at: string }>()
  links = new Map<string, string>()
  codes = new Map<string, string>()
  playerOf(device: string): string {
    return this.links.get(device) ?? device
  }
  /** The `arcade-api` surface CampaignCloudSync uses, as `device`. */
  api(device: string) {
    class ArcadeError extends Error {
      offline = false
      status = 0
    }
    return {
      ArcadeError,
      hasArcadeSession: () => true,
      pullSave: async () => {
        const save = this.saves.get(this.playerOf(device))
        return save ? { slot: 'campaign', ...save } : null
      },
      pushSave: async (schemaVersion: number, data: object) => {
        this.saves.set(this.playerOf(device), { schema_version: schemaVersion, data, updated_at: new Date().toISOString() })
        return new Date().toISOString()
      },
      createLinkCode: async () => {
        this.codes.set('K7QX2MZP', this.playerOf(device))
        return { code: 'K7QX2MZP', expires_at: '' }
      },
      redeemLinkCode: async (code: string) => {
        const player = this.codes.get(code)
        if (!player) return false
        this.codes.delete(code)
        this.links.set(device, player)
        return true
      },
    } as unknown as typeof import('../src/arcade/arcade-api')
  }
}

/** A device: its own localStorage-backed campaign. */
function device(storage: Map<string, string>) {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => { storage.set(k, v) },
      removeItem: (k: string) => { storage.delete(k) },
    },
  })
  const progression = new AdventureTrackProgression()
  return { progression, manager: new CampaignRewardsManager(progression) }
}

describe('campaign cloud save (#444 Slice D)', () => {
  let cloud: FakeCloud
  beforeEach(() => {
    cloud = new FakeCloud()
  })

  it('a campaign saved on device A resumes on device B at the same stage', async () => {
    const a = device(new Map())
    const syncA = new CampaignCloudSync(a.manager, cloud.api('device-a'))
    await syncA.start()
    a.progression.completeTrack('NEON_HELIX', 120_000, 3, 500)
    a.manager.persistState()
    await syncA.pullAndMerge()
    const stageOnA = a.progression.getCurrentTrack()
    expect(a.progression.isTrackCompleted('NEON_HELIX')).toBe(true)
    const { code } = await cloud.api('device-a').createLinkCode()

    const b = device(new Map())
    expect(b.progression.isTrackCompleted('NEON_HELIX')).toBe(false)
    const syncB = new CampaignCloudSync(b.manager, cloud.api('device-b'))
    expect(await syncB.linkDevice(code)).toBe(true)
    expect(b.progression.getCurrentTrack()).toBe(stageOnA)
    expect(b.progression.isTrackCompleted('NEON_HELIX')).toBe(true)
    expect(b.progression.getBestScore('NEON_HELIX')).toBe(120_000)
    expect(syncB.getStatus()).toBe('synced')
    syncA.dispose()
    syncB.dispose()
  })

  it('a cloud save one schema version behind migrates on pull and goes back up current', async () => {
    // Schema 1 kept progression fields at the top level.
    cloud.saves.set('device-c', {
      schema_version: 1,
      data: { version: 1, completedTracks: ['NEON_HELIX'], unlockedTracks: ['NEON_HELIX', 'CYBER_CORE'], currentTrack: 'CYBER_CORE', bestScores: { NEON_HELIX: 90_000 } },
      updated_at: '2026-10-01T00:00:00Z',
    })
    const c = device(new Map())
    const sync = new CampaignCloudSync(c.manager, cloud.api('device-c'))
    await sync.start()
    expect(c.progression.isTrackCompleted('NEON_HELIX')).toBe(true)
    expect(c.progression.getCurrentTrack()).toBe('CYBER_CORE')
    const pushed = cloud.saves.get('device-c')!
    expect(pushed.schema_version).toBe(CAMPAIGN_STORAGE_VERSION)
    expect((pushed.data as { version: number }).version).toBe(CAMPAIGN_STORAGE_VERSION)
    sync.dispose()
  })

  it('export → import → export is byte-identical', () => {
    const storage = new Map<string, string>()
    const a = device(storage)
    a.progression.completeTrack('NEON_HELIX', 120_000, 3, 500)
    a.manager.persistState()
    const exported = exportCampaignSave(a.manager)
    expect(exported).toBe(storage.get(CAMPAIGN_STORAGE_KEY))

    const b = device(new Map())
    expect(importCampaignSave(b.manager, exported)).toBe(true)
    expect(exportCampaignSave(b.manager)).toBe(exported)
    expect(importCampaignSave(b.manager, '{"hello":"world"}')).toBe(false)
    expect(importCampaignSave(b.manager, 'not json')).toBe(false)
  })

  it('merging never loses progress, and merging a save with itself changes nothing', () => {
    const base = migrateCampaignStorage({ version: 2, progression: { completedTracks: [], unlockedTracks: ['NEON_HELIX'], bestScores: {}, currentTrack: 'NEON_HELIX' } })!
    const ahead = migrateCampaignStorage({
      version: 2,
      progression: { completedTracks: ['NEON_HELIX'], unlockedTracks: ['NEON_HELIX', 'CYBER_CORE'], bestScores: { NEON_HELIX: 80_000 }, currentTrack: 'CYBER_CORE', totalGoldBallsCollected: 4 },
      unlockedRewardIds: [],
    })!
    const local = migrateCampaignStorage({ version: 2, progression: { ...base.progression, bestScores: { NEON_HELIX: 95_000 } } })!
    const merged = mergeCampaignPayloads(local, ahead)
    expect(merged.progression.completedTracks).toEqual(['NEON_HELIX'])
    expect(merged.progression.unlockedTracks).toEqual(['NEON_HELIX', 'CYBER_CORE'])
    expect(merged.progression.bestScores).toEqual({ NEON_HELIX: 95_000 })
    expect(merged.progression.currentTrack).toBe('CYBER_CORE')
    expect(merged.progression.totalGoldBallsCollected).toBe(4)
    expect(mergeCampaignPayloads(merged, merged)).toEqual(merged)
  })
})
