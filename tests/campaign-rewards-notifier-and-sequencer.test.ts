import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { EventBus } from '../src/game/event-bus'
import { CampaignRewardNotifier } from '../src/game-elements/campaign-reward-notifier'
import { CelebrationSequencer } from '../src/effects/celebration-sequencer'
import { QualityTier } from '../src/game-elements/visual-language'
import type { UnlockedReward } from '../src/game-elements/types'
import type { DisplaySystem } from '../src/display'
import type { CabinetLighting } from '../src/effects/cabinet-lighting'
import type { AdventureCinematicTriggers } from '../src/game-elements/adventure-cinematic-triggers'

const mockAccessibility = {
  reducedMotion: false,
}

vi.mock('../src/game-elements/accessibility-config', () => ({
  detectAccessibility: () => mockAccessibility,
}))

// Mock DOM sessionStorage
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

describe('CampaignRewardNotifier', () => {
  let eventBus: EventBus
  let notifier: CampaignRewardNotifier
  const storage = new MemoryStorage()

  beforeEach(() => {
    eventBus = new EventBus()
    notifier = new CampaignRewardNotifier(eventBus)
    storage.clear()
    Object.defineProperty(globalThis, 'sessionStorage', {
      value: storage,
      configurable: true,
      writable: true,
    })
  })

  it('records grants, persists to sessionStorage, and emits event', () => {
    let emittedEvent: UnlockedReward | null = null
    eventBus.on('reward:unlocked', (payload) => {
      emittedEvent = payload
    })

    const mockRewardItem = {
      id: 'ball-skin-cascade',
      name: 'Cascade Core',
      description: 'Cyan pulse ball skin',
      type: 'ball-skin' as const,
      shardCost: 1200,
      cosmeticId: 'ball-skin-cascade',
      rarity: 'common' as const,
    }

    notifier.recordGrant(mockRewardItem, 'track')

    expect(emittedEvent).not.toBeNull()
    expect(emittedEvent.id).toBe('ball-skin-cascade')
    expect(emittedEvent.label).toBe('Cascade Core')
    expect(emittedEvent.rarity).toBe('common')
    expect(emittedEvent.scope).toBe('track')

    const raw = storage.getItem('unseen-rewards')
    expect(raw).not.toBeNull()
    const parsed = JSON.parse(raw!)
    expect(parsed[0].id).toBe('ball-skin-cascade')
  })

  it('flushes unseen rewards and re-emits them on init', () => {
    const mockRewardItem = {
      id: 'ball-skin-aurum',
      name: 'Aurum Nova',
      description: 'Gold plasma skin',
      type: 'ball-skin' as const,
      shardCost: 2600,
      cosmeticId: 'ball-skin-aurum',
      rarity: 'rare' as const,
    }

    notifier.recordGrant(mockRewardItem, 'track')

    // Fresh notifier instance
    const freshNotifier = new CampaignRewardNotifier(eventBus)
    const emittedEvents: UnlockedReward[] = []
    eventBus.on('reward:unlocked', (payload) => {
      emittedEvents.push(payload)
    })

    freshNotifier.flushUnseen()

    expect(emittedEvents.length).toBe(1)
    expect(emittedEvents[0].id).toBe('ball-skin-aurum')
    expect(storage.getItem('unseen-rewards')).toBeNull() // should be cleared after flush
  })
})

describe('CelebrationSequencer', () => {
  let eventBus: EventBus
  let mockDisplay: {
    getQualityTier: ReturnType<typeof vi.fn>
    overlay: {
      show: ReturnType<typeof vi.fn>
      hide: ReturnType<typeof vi.fn>
      isActive: ReturnType<typeof vi.fn>
    }
  }
  let mockCabinetLighting: {
    triggerRewardBurst: ReturnType<typeof vi.fn>
  }
  let mockCinematics: {
    requestBeat: ReturnType<typeof vi.fn>
  }
  let sequencer: CelebrationSequencer

  beforeEach(() => {
    vi.useFakeTimers()
    eventBus = new EventBus()
    mockAccessibility.reducedMotion = false

    mockDisplay = {
      getQualityTier: vi.fn(() => QualityTier.MEDIUM),
      overlay: {
        show: vi.fn(),
        hide: vi.fn(),
        isActive: vi.fn(() => false),
      },
    }

    mockCabinetLighting = {
      triggerRewardBurst: vi.fn(),
    }

    mockCinematics = {
      requestBeat: vi.fn(() => Promise.resolve()),
    }

    sequencer = new CelebrationSequencer(
      eventBus,
      mockDisplay as unknown as DisplaySystem,
      mockCabinetLighting as unknown as CabinetLighting,
      mockCinematics as unknown as AdventureCinematicTriggers,
      { summaryThreshold: 3 }
    )
  })

  afterEach(() => {
    vi.useRealTimers()
    sequencer.dispose()
  })

  it('accumulates simultaneous rewards within 100ms and enters summary mode when threshold is met', async () => {
    const rewards: UnlockedReward[] = [
      { kind: 'ball-skin', id: 'skin-1', label: 'Skin 1', rarity: 'common', scope: 'track' },
      { kind: 'cabinet-theme', id: 'theme-1', label: 'Theme 1', rarity: 'rare', scope: 'track' },
      { kind: 'backbox-tint', id: 'tint-1', label: 'Tint 1', rarity: 'legendary', scope: 'track' },
    ]

    for (const r of rewards) {
      eventBus.emit('reward:unlocked', r)
    }

    // Fast-forward 100ms accumulation window
    vi.advanceTimersByTime(100)

    expect(mockDisplay.overlay.show).toHaveBeenCalledTimes(1)
    const overlayCallArgs = mockDisplay.overlay.show.mock.calls[0][0]
    expect(overlayCallArgs.items.length).toBe(3)
    expect(overlayCallArgs.durationMs).toBe(3000)

    // Highest rarity burst should be triggered
    expect(mockCabinetLighting.triggerRewardBurst).toHaveBeenCalledWith('legendary', 1000)
    // Cinematic beat should NOT play in summary mode
    expect(mockCinematics.requestBeat).not.toHaveBeenCalled()
  })

  it('celebrates individual rewards separately if they do not trigger summary mode', async () => {
    const reward: UnlockedReward = {
      kind: 'ball-skin',
      id: 'skin-1',
      label: 'Skin 1',
      rarity: 'rare',
      scope: 'track',
    }

    eventBus.emit('reward:unlocked', reward)
    vi.advanceTimersByTime(100)

    expect(mockDisplay.overlay.show).toHaveBeenCalledTimes(1)
    const args = mockDisplay.overlay.show.mock.calls[0][0]
    expect(args.items[0].id).toBe('skin-1')
    expect(args.durationMs).toBe(3000)

    expect(mockCabinetLighting.triggerRewardBurst).toHaveBeenCalledWith('rare', 1000)
    expect(mockCinematics.requestBeat).toHaveBeenCalledWith({
      rarity: 'rare',
      maxDurationMs: 3000,
    })
  })

  it('respects reducedMotion path by suppressing camera cinematics and lighting bursts', async () => {
    // Mock reducedMotion setting
    mockAccessibility.reducedMotion = true

    const reward: UnlockedReward = {
      kind: 'ball-skin',
      id: 'skin-1',
      label: 'Skin 1',
      rarity: 'rare',
      scope: 'track',
    }

    eventBus.emit('reward:unlocked', reward)
    vi.advanceTimersByTime(100)

    expect(mockDisplay.overlay.show).toHaveBeenCalled()
    const args = mockDisplay.overlay.show.mock.calls[0][0]
    expect(args.durationMs).toBe(2000) // reducedMotion duration is 2000ms
    expect(args.reducedMotion).toBe(true)

    expect(mockCabinetLighting.triggerRewardBurst).not.toHaveBeenCalled()
    expect(mockCinematics.requestBeat).not.toHaveBeenCalled()
  })

  it('handles cinematic busy/rejection path gracefully without blocking celebration completion', async () => {
    // Force cinematics requestBeat to reject (simulating busy)
    mockCinematics.requestBeat.mockRejectedValue(new Error('Cinematic system busy'))

    const reward: UnlockedReward = {
      kind: 'ball-skin',
      id: 'skin-1',
      label: 'Skin 1',
      rarity: 'legendary',
      scope: 'track',
    }

    eventBus.emit('reward:unlocked', reward)
    vi.advanceTimersByTime(100)

    expect(mockDisplay.overlay.show).toHaveBeenCalled()
    // It should try to request beat
    expect(mockCinematics.requestBeat).toHaveBeenCalled()
    // Even if it fails, it shouldn't crash or prevent continuation
    vi.advanceTimersByTime(3000)
  })
})
