import { PALETTE, QualityTier } from './visual-language'
import type { AdventureTrackProgression, SerializableProgressionState } from './adventure-track-progression'

export type CampaignRewardType = 'ball-skin' | 'cabinet-theme' | 'backbox-tint'

export interface CampaignRewardItem {
  id: string
  name: string
  description: string
  type: CampaignRewardType
  shardCost: number
  minQualityTier?: QualityTier
  cosmeticId: string
}

interface CampaignRewardsStorageState {
  version: 1
  progression: SerializableProgressionState
  unlockedRewardIds: string[]
  equippedRewards: Partial<Record<CampaignRewardType, string>>
}

interface CampaignRewardAppliers {
  applyBallSkin?: (skinId: string) => void
  applyCabinetTheme?: (themeId: string) => void
  applyBackboxTint?: (tintId: string) => void
}

const STORAGE_KEY = 'pachinball.campaign.rewards.v1'

export const CAMPAIGN_REWARD_CATALOG: CampaignRewardItem[] = [
  {
    id: 'ball-skin-cascade',
    name: 'Cascade Core',
    description: 'Cyan pulse ball skin',
    type: 'ball-skin',
    shardCost: 1200,
    cosmeticId: 'ball-skin-cascade',
  },
  {
    id: 'ball-skin-aurum',
    name: 'Aurum Nova',
    description: 'Gold plasma ball skin',
    type: 'ball-skin',
    shardCost: 2600,
    cosmeticId: 'ball-skin-aurum',
  },
  {
    id: 'ball-skin-prism',
    name: 'Prism Lattice',
    description: 'Iridescent prism skin (high quality)',
    type: 'ball-skin',
    shardCost: 4800,
    minQualityTier: QualityTier.HIGH,
    cosmeticId: 'ball-skin-prism',
  },
  {
    id: 'cabinet-theme-violet',
    name: 'Violet Drive',
    description: 'Cabinet neon theme with purple accents',
    type: 'cabinet-theme',
    shardCost: 2200,
    cosmeticId: 'cabinet-theme-violet',
  },
  {
    id: 'cabinet-theme-solar',
    name: 'Solar Crown',
    description: 'Cabinet neon theme with warm gold accents',
    type: 'cabinet-theme',
    shardCost: 4200,
    cosmeticId: 'cabinet-theme-solar',
  },
  {
    id: 'backbox-tint-aurora',
    name: 'Aurora Tint',
    description: 'Unlocks an aurora backbox tint profile',
    type: 'backbox-tint',
    shardCost: 3000,
    cosmeticId: 'backbox-tint-aurora',
  },
]

export class CampaignRewardsManager {
  private unlockedRewardIds = new Set<string>()
  private equippedRewards: Partial<Record<CampaignRewardType, string>> = {}
  private appliers: CampaignRewardAppliers = {}

  constructor(private readonly progression: AdventureTrackProgression) {
    this.load()
    this.unlockFromShardTotal()
  }

  configureAppliers(appliers: CampaignRewardAppliers): void {
    this.appliers = appliers
    this.applyEquippedRewards()
  }

  getEarnedRewards(): number {
    return this.progression.getStats().totalRewardsEarned
  }

  getTotalShards(): number {
    return this.getEarnedRewards()
  }

  getUnlockCatalog(): CampaignRewardItem[] {
    return CAMPAIGN_REWARD_CATALOG.slice()
  }

  getEquippedReward(type: CampaignRewardType): CampaignRewardItem | null {
    const rewardId = this.equippedRewards[type]
    if (!rewardId) return null
    return CAMPAIGN_REWARD_CATALOG.find((reward) => reward.id === rewardId) ?? null
  }

  isUnlocked(id: string): boolean {
    return this.unlockedRewardIds.has(id)
  }

  unlock(id: string): boolean {
    const reward = CAMPAIGN_REWARD_CATALOG.find((entry) => entry.id === id)
    if (!reward) return false
    if (this.unlockedRewardIds.has(id)) return false
    if (this.getTotalShards() < reward.shardCost) return false

    this.unlockedRewardIds.add(id)
    this.save()
    return true
  }

  equip(id: string): boolean {
    const reward = CAMPAIGN_REWARD_CATALOG.find((entry) => entry.id === id)
    if (!reward || !this.unlockedRewardIds.has(id)) return false

    this.equippedRewards[reward.type] = id
    this.save()
    this.applyReward(reward)
    return true
  }

  getArchiveState(): Array<CampaignRewardItem & { unlocked: boolean; equipped: boolean; remainingShards: number }> {
    const totalShards = this.getTotalShards()
    return CAMPAIGN_REWARD_CATALOG.map((reward) => ({
      ...reward,
      unlocked: this.unlockedRewardIds.has(reward.id),
      equipped: this.equippedRewards[reward.type] === reward.id,
      remainingShards: Math.max(0, reward.shardCost - totalShards),
    }))
  }

  applyTrackReward(_rewardAmount: number): { newlyUnlocked: CampaignRewardItem[]; totalShards: number } {
    const newlyUnlocked = this.unlockFromShardTotal()
    this.save()
    return {
      newlyUnlocked,
      totalShards: this.getTotalShards(),
    }
  }

  applyEquippedRewards(): void {
    for (const rewardId of Object.values(this.equippedRewards)) {
      if (!rewardId) continue
      const reward = CAMPAIGN_REWARD_CATALOG.find((entry) => entry.id === rewardId)
      if (!reward) continue
      this.applyReward(reward)
    }
  }

  private applyReward(reward: CampaignRewardItem): void {
    switch (reward.type) {
      case 'ball-skin':
        this.appliers.applyBallSkin?.(reward.cosmeticId)
        break
      case 'cabinet-theme':
        this.appliers.applyCabinetTheme?.(reward.cosmeticId)
        break
      case 'backbox-tint':
        this.appliers.applyBackboxTint?.(reward.cosmeticId)
        break
    }
  }

  private unlockFromShardTotal(): CampaignRewardItem[] {
    const totalShards = this.getTotalShards()
    const newlyUnlocked: CampaignRewardItem[] = []

    for (const reward of CAMPAIGN_REWARD_CATALOG) {
      if (totalShards >= reward.shardCost && !this.unlockedRewardIds.has(reward.id)) {
        this.unlockedRewardIds.add(reward.id)
        newlyUnlocked.push(reward)
      }
    }

    if (newlyUnlocked.length > 0) {
      this.save()
    }
    return newlyUnlocked
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return

      const parsed = JSON.parse(raw) as Partial<CampaignRewardsStorageState>
      if (parsed.progression) {
        this.progression.loadSerializableState(parsed.progression)
      }
      this.unlockedRewardIds = new Set((parsed.unlockedRewardIds ?? []).filter((id) =>
        CAMPAIGN_REWARD_CATALOG.some((reward) => reward.id === id),
      ))

      this.equippedRewards = {
        ...parsed.equippedRewards,
      }
    } catch (error) {
      console.warn('[CampaignRewards] Failed to load campaign rewards state:', error)
    }
  }

  private save(): void {
    const serializableState: CampaignRewardsStorageState = {
      version: 1,
      progression: this.progression.getSerializableState(),
      unlockedRewardIds: Array.from(this.unlockedRewardIds),
      equippedRewards: { ...this.equippedRewards },
    }

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(serializableState))
    } catch (error) {
      console.warn('[CampaignRewards] Failed to save campaign rewards state:', error)
    }
  }
}

let campaignRewardsManager: CampaignRewardsManager | null = null

export function initializeCampaignRewardsManager(progression: AdventureTrackProgression): CampaignRewardsManager {
  if (!campaignRewardsManager) {
    campaignRewardsManager = new CampaignRewardsManager(progression)
  }
  return campaignRewardsManager
}

export function getCampaignRewardsManager(): CampaignRewardsManager | null {
  return campaignRewardsManager
}

export function resetCampaignRewardsManager(): void {
  campaignRewardsManager = null
}

export const CAMPAIGN_DEFAULT_BACKBOX_TINT = PALETTE.CYAN
