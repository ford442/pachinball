import type { EventBus } from '../game/event-bus'
import type { DisplaySystem } from '../display'
import type { CabinetLighting } from './cabinet-lighting'
import type { AdventureCinematicTriggers } from '../game-elements/adventure-cinematic-triggers'
import type { UnlockedReward } from '../game-elements/types'
import { QualityTier } from '../game-elements/visual-language'
import { detectAccessibility } from '../game-elements/accessibility-config'

export class CelebrationSequencer {
  private queue: UnlockedReward[] = []
  private isPlaying = false
  private accumulationTimer: ReturnType<typeof setTimeout> | null = null
  private summaryThreshold = 3
  private unsubscribes: (() => void)[] = []

  constructor(
    private readonly eventBus: EventBus,
    private readonly display: DisplaySystem | null,
    private readonly cabinetLighting: CabinetLighting | null,
    private readonly cinematics: AdventureCinematicTriggers | null,
    options?: { summaryThreshold?: number }
  ) {
    if (options?.summaryThreshold !== undefined) {
      this.summaryThreshold = options.summaryThreshold
    }
    this.subscribe()
  }

  private subscribe(): void {
    const unsub = this.eventBus.on('reward:unlocked', (reward) => {
      this.enqueue(reward)
    })
    this.unsubscribes.push(unsub)
  }

  public enqueue(reward: UnlockedReward): void {
    this.queue.push(reward)

    if (!this.isPlaying && !this.accumulationTimer) {
      this.accumulationTimer = setTimeout(() => {
        this.accumulationTimer = null
        this.processQueue()
      }, 100)
    }
  }

  private async processQueue(): Promise<void> {
    if (this.isPlaying || this.queue.length === 0) return
    this.isPlaying = true

    const accessibility = detectAccessibility()
    const reducedMotion = accessibility.reducedMotion
    const qualityTier = this.display ? this.display.getQualityTier() : QualityTier.MEDIUM
    const actualThreshold = qualityTier === QualityTier.LOW ? 2 : this.summaryThreshold

    if (this.queue.length >= actualThreshold) {
      const itemsToCelebrate = [...this.queue]
      this.queue = []
      await this.celebrateMultiple(itemsToCelebrate, reducedMotion, qualityTier)
    } else {
      const itemToCelebrate = this.queue.shift()
      if (itemToCelebrate) {
        await this.celebrateSingle(itemToCelebrate, reducedMotion, qualityTier)
      }
    }

    this.isPlaying = false

    if (this.queue.length > 0) {
      this.processQueue()
    }
  }

  private async celebrateSingle(item: UnlockedReward, reducedMotion: boolean, qualityTier: QualityTier): Promise<void> {
    const isCampaignComplete = item.scope === 'campaign-complete'

    let durationMs = 3000
    if (reducedMotion) {
      durationMs = 2000
    } else if (qualityTier === QualityTier.LOW) {
      durationMs = 4000
    }
    if (isCampaignComplete) {
      durationMs += 1000
    }

    if (this.display) {
      this.display.overlay.show({
        items: [item],
        durationMs,
        reducedMotion,
        qualityTier
      })
    }

    if (this.cabinetLighting && !reducedMotion) {
      const rarity = isCampaignComplete ? 'legendary' : item.rarity
      const lightingDuration = qualityTier === QualityTier.LOW ? 200 : 1000
      this.cabinetLighting.triggerRewardBurst(rarity, lightingDuration)
    }

    const shouldPlayCinematic = !reducedMotion && (isCampaignComplete || qualityTier !== QualityTier.LOW)
    if (this.cinematics && shouldPlayCinematic) {
      try {
        const beatRarity = isCampaignComplete ? 'legendary' : item.rarity
        await this.cinematics.requestBeat({
          rarity: beatRarity,
          maxDurationMs: durationMs
        })
      } catch (err) {
        console.log('[CelebrationSequencer] Cinematic system busy, skipping beat.', err)
      }
    }

    await new Promise<void>((resolve) => setTimeout(resolve, durationMs))
  }

  private async celebrateMultiple(items: UnlockedReward[], reducedMotion: boolean, qualityTier: QualityTier): Promise<void> {
    let durationMs = 3000
    if (reducedMotion) {
      durationMs = 2000
    } else if (qualityTier === QualityTier.LOW) {
      durationMs = 4000
    }

    if (this.display) {
      this.display.overlay.show({
        items,
        durationMs,
        reducedMotion,
        qualityTier
      })
    }

    if (this.cabinetLighting && !reducedMotion) {
      let highestRarity: 'common' | 'rare' | 'legendary' = 'common'
      for (const item of items) {
        if (item.rarity === 'legendary') highestRarity = 'legendary'
        else if (item.rarity === 'rare' && highestRarity === 'common') highestRarity = 'rare'
      }
      const lightingDuration = qualityTier === QualityTier.LOW ? 200 : 1000
      this.cabinetLighting.triggerRewardBurst(highestRarity, lightingDuration)
    }

    await new Promise<void>((resolve) => setTimeout(resolve, durationMs))
  }

  public dispose(): void {
    if (this.accumulationTimer) {
      clearTimeout(this.accumulationTimer)
      this.accumulationTimer = null
    }
    for (const unsub of this.unsubscribes) {
      unsub()
    }
    this.unsubscribes = []
    this.queue = []
    this.isPlaying = false
  }
}
