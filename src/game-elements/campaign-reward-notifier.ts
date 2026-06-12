import type { EventBus } from '../game/event-bus'
import type { UnlockedReward } from './types'
import type { CampaignRewardItem } from './campaign-rewards-manager'

export class CampaignRewardNotifier {
  constructor(private readonly eventBus: EventBus) {}

  public recordGrant(reward: CampaignRewardItem, scope: 'track' | 'campaign-complete' = 'track'): void {
    const unlocked: UnlockedReward = {
      kind: reward.type,
      id: reward.id,
      label: reward.name,
      rarity: reward.rarity,
      scope
    }

    // Persist to sessionStorage "unseen-rewards"
    try {
      const existingRaw = sessionStorage.getItem('unseen-rewards')
      const existing: UnlockedReward[] = existingRaw ? JSON.parse(existingRaw) : []
      
      // Avoid duplicate persistence in unseen-rewards
      if (!existing.some(item => item.id === unlocked.id)) {
        existing.push(unlocked)
        sessionStorage.setItem('unseen-rewards', JSON.stringify(existing))
      }
    } catch (e) {
      console.warn('[CampaignRewardNotifier] Failed to persist to sessionStorage:', e)
    }

    // Emit event
    this.eventBus.emit('reward:unlocked', unlocked)
  }

  public flushUnseen(): void {
    try {
      const existingRaw = sessionStorage.getItem('unseen-rewards')
      if (!existingRaw) return

      const existing: UnlockedReward[] = JSON.parse(existingRaw)
      if (existing.length === 0) return

      // Clear the storage
      sessionStorage.removeItem('unseen-rewards')

      // Re-emit any unseen rewards for returning players
      for (const unlocked of existing) {
        this.eventBus.emit('reward:unlocked', unlocked)
      }
    } catch (e) {
      console.warn('[CampaignRewardNotifier] Failed to flush unseen rewards:', e)
    }
  }
}
