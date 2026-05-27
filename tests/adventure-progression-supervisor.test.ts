import { describe, it, expect } from 'vitest'
import { EventBus } from '../src/game/event-bus'
import { AdventureTrackProgression } from '../src/game-elements/adventure-track-progression'
import { AdventureProgressionSupervisor } from '../src/game-elements/adventure-progression-supervisor'

describe('AdventureProgressionSupervisor', () => {
  it('resolves success, opens portal, and completes track with multiplier rewards', () => {
    const bus = new EventBus()
    const progression = new AdventureTrackProgression()
    const advanced: Array<string | null> = []
    const supervisor = new AdventureProgressionSupervisor(bus, progression, {
      getSuccessBonus: () => 0.25,
      onTrackAdvanced: (next) => advanced.push(next),
    })

    let portalKind: 'success' | 'timeout' | null = null
    let completedReward = 0
    bus.on('portal:open', (payload) => { portalKind = payload.kind })
    bus.on('track:completed', (payload) => { completedReward = payload.totalReward })

    supervisor.startTrack('NEON_HELIX', 1000)
    supervisor.update(1, 51000) // 50000 delta => success

    expect(supervisor.isPortalOpen()).toBe(true)
    expect(portalKind).toBe('success')
    expect(supervisor.getActiveMultiplier()).toBe(1.25)

    supervisor.onPortalEntered(61000, 2)

    expect(progression.isTrackCompleted('NEON_HELIX')).toBe(true)
    expect(progression.getBestScore('NEON_HELIX')).toBe(61000)
    expect(progression.getStats().goldBallsCollected).toBe(2)
    expect(progression.getStats().totalRewardsEarned).toBe(75000)
    expect(completedReward).toBe(75000)
    expect(progression.getCurrentTrack()).toBe('CYBER_CORE')
    expect(advanced).toEqual(['CYBER_CORE'])
  })

  it('resolves timeout and applies timeout penalty multiplier', () => {
    const bus = new EventBus()
    const progression = new AdventureTrackProgression()
    const supervisor = new AdventureProgressionSupervisor(bus, progression)

    let timeoutFired = false
    bus.on('track:timeout', () => { timeoutFired = true })

    supervisor.startTrack('NEON_HELIX', 200)
    supervisor.update(200, 1200)

    expect(timeoutFired).toBe(true)
    expect(supervisor.isPortalOpen()).toBe(true)
    expect(supervisor.getActiveMultiplier()).toBe(0.7)

    supervisor.onPortalEntered(1200, 1)
    expect(progression.isTrackCompleted('NEON_HELIX')).toBe(true)
    expect(progression.getStats().totalRewardsEarned).toBe(700)
    expect(progression.getStats().goldBallsCollected).toBe(1)
  })

  it('tracks countdown progress and times out even with no score gain', () => {
    const bus = new EventBus()
    const progression = new AdventureTrackProgression()
    const supervisor = new AdventureProgressionSupervisor(bus, progression)

    supervisor.startTrack('NEON_HELIX', 5000)
    const initialRemaining = supervisor.getTimeRemaining()

    supervisor.update(-1, 5000) // ignored
    expect(supervisor.getTimeRemaining()).toBe(initialRemaining)

    supervisor.update(1, 5000)
    expect(supervisor.getProgress()).toBeGreaterThan(0)
    expect(supervisor.isPortalOpen()).toBe(false)

    supervisor.update(999, 5000)
    expect(supervisor.isPortalOpen()).toBe(true)
    expect(supervisor.getActiveMultiplier()).toBe(0.7)
  })

  it('gracefully no-ops when adventure mode is inactive', () => {
    const bus = new EventBus()
    const progression = new AdventureTrackProgression()
    const supervisor = new AdventureProgressionSupervisor(bus, progression, {
      isAdventureModeActive: () => false,
    })

    let opened = false
    bus.on('portal:open', () => { opened = true })

    supervisor.startTrack('NEON_HELIX', 0)
    supervisor.update(5, 100000)

    expect(supervisor.getTimeRemaining()).toBe(0)
    expect(supervisor.isPortalOpen()).toBe(false)
    expect(opened).toBe(false)
  })
})
