import { beforeEach, describe, expect, it } from 'vitest'
import { AdventureTrackProgression } from '../src/game-elements/adventure-track-progression'
import { CampaignRewardsManager } from '../src/game-elements/campaign-rewards-manager'

class MemoryStorage {
  private data = new Map<string, string>()

  getItem(key: string): string | null {
    return this.data.has(key) ? this.data.get(key)! : null
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value)
  }

  removeItem(key: string): void {
    this.data.delete(key)
  }

  clear(): void {
    this.data.clear()
  }
}

describe('CampaignRewardsManager', () => {
  const storage = new MemoryStorage()

  beforeEach(() => {
    storage.clear()
    Object.defineProperty(globalThis, 'localStorage', {
      value: storage,
      configurable: true,
      writable: true,
    })
  })

  it('unlocks rewards based on total shard progression and reports newly unlocked items', () => {
    const progression = new AdventureTrackProgression()
    const manager = new CampaignRewardsManager(progression)

    progression.completeTrack('NEON_HELIX', 60000, 0, 1300)
    const firstReward = manager.applyTrackReward(1300)

    expect(firstReward.totalShards).toBe(1300)
    expect(manager.isUnlocked('ball-skin-cascade')).toBe(true)
    expect(firstReward.newlyUnlocked.map((item) => item.id)).toContain('ball-skin-cascade')

    progression.completeTrack('CYBER_CORE', 125000, 0, 3100)
    const secondReward = manager.applyTrackReward(3100)

    expect(secondReward.totalShards).toBe(4400)
    expect(manager.isUnlocked('ball-skin-aurum')).toBe(true)
    expect(manager.isUnlocked('cabinet-theme-violet')).toBe(true)
  })

  it('supports equip flow only for unlocked rewards', () => {
    const progression = new AdventureTrackProgression()
    const manager = new CampaignRewardsManager(progression)

    expect(manager.equip('ball-skin-aurum')).toBe(false)

    progression.completeTrack('NEON_HELIX', 65000, 0, 3000)
    manager.applyTrackReward(3000)

    expect(manager.equip('ball-skin-aurum')).toBe(true)
    expect(manager.getEquippedReward('ball-skin')?.id).toBe('ball-skin-aurum')
  })

  it('persists progression and reward states across new manager instances', () => {
    const progressionA = new AdventureTrackProgression()
    const managerA = new CampaignRewardsManager(progressionA)

    progressionA.completeTrack('NEON_HELIX', 70000, 2, 4600)
    managerA.applyTrackReward(4600)
    expect(managerA.equip('cabinet-theme-violet')).toBe(true)

    const progressionB = new AdventureTrackProgression()
    const managerB = new CampaignRewardsManager(progressionB)

    expect(progressionB.getStats().totalRewardsEarned).toBe(4600)
    expect(managerB.isUnlocked('cabinet-theme-violet')).toBe(true)
    expect(managerB.getEquippedReward('cabinet-theme')?.id).toBe('cabinet-theme-violet')
  })
})
