import { describe, it, expect } from 'vitest'
import { EventBus } from '../src/game/event-bus'
import { AdventureTrackProgression, TRACK_CATALOG } from '../src/game-elements/adventure-track-progression'
import { AdventureProgressionSupervisor } from '../src/game-elements/adventure-progression-supervisor'

// ─── TRACK_CATALOG / modeType tests ──────────────────────────────────────────

describe('TRACK_CATALOG modeType alternation', () => {
  it('every track has a modeType field', () => {
    for (const track of Object.values(TRACK_CATALOG)) {
      expect(['EXTENDED_MAP', 'STATIONARY_TABLE']).toContain(track.modeType)
    }
  })

  it('NEON_HELIX starts with EXTENDED_MAP (position A)', () => {
    expect(TRACK_CATALOG['NEON_HELIX'].modeType).toBe('EXTENDED_MAP')
  })

  it('CYBER_CORE is STATIONARY_TABLE (position B)', () => {
    expect(TRACK_CATALOG['CYBER_CORE'].modeType).toBe('STATIONARY_TABLE')
  })

  it('QUANTUM_GRID is EXTENDED_MAP (position A)', () => {
    expect(TRACK_CATALOG['QUANTUM_GRID'].modeType).toBe('EXTENDED_MAP')
  })

  it('PACHINKO_SPIRE is STATIONARY_TABLE (position B, parallel branch)', () => {
    expect(TRACK_CATALOG['PACHINKO_SPIRE'].modeType).toBe('STATIONARY_TABLE')
  })

  it('SINGULARITY_WELL is EXTENDED_MAP (position A)', () => {
    expect(TRACK_CATALOG['SINGULARITY_WELL'].modeType).toBe('EXTENDED_MAP')
  })

  it('timeLimitSeconds is in the 75–180 s range for all tracks', () => {
    for (const track of Object.values(TRACK_CATALOG)) {
      expect(track.timeLimitSeconds).toBeGreaterThanOrEqual(75)
      expect(track.timeLimitSeconds).toBeLessThanOrEqual(180)
    }
  })

  it('timeoutPenaltyMultiplier is in the 0.35–0.6 range for all tracks', () => {
    for (const track of Object.values(TRACK_CATALOG)) {
      expect(track.timeoutPenaltyMultiplier).toBeGreaterThanOrEqual(0.35)
      expect(track.timeoutPenaltyMultiplier).toBeLessThanOrEqual(0.6)
    }
  })

  it('uses the expected mode/time/penalty/recommendedScore values', () => {
    // Scores calibrated for bumperHitBase=100; see config.ts GAME_TUNING.scoring.
    expect(TRACK_CATALOG['NEON_HELIX']).toMatchObject({ modeType: 'EXTENDED_MAP', timeLimitSeconds: 120, timeoutPenaltyMultiplier: 0.55, recommendedScore: 50000 })
    expect(TRACK_CATALOG['CYBER_CORE']).toMatchObject({ modeType: 'STATIONARY_TABLE', timeLimitSeconds: 90, timeoutPenaltyMultiplier: 0.45, recommendedScore: 45000 })
    expect(TRACK_CATALOG['QUANTUM_GRID']).toMatchObject({ modeType: 'EXTENDED_MAP', timeLimitSeconds: 150, timeoutPenaltyMultiplier: 0.50, recommendedScore: 80000 })
    expect(TRACK_CATALOG['PACHINKO_SPIRE']).toMatchObject({ modeType: 'STATIONARY_TABLE', timeLimitSeconds: 75, timeoutPenaltyMultiplier: 0.40, recommendedScore: 38000 })
    expect(TRACK_CATALOG['SINGULARITY_WELL']).toMatchObject({ modeType: 'EXTENDED_MAP', timeLimitSeconds: 180, timeoutPenaltyMultiplier: 0.35, recommendedScore: 100000 })
  })

  it('defines at least six distinct track visual themes in catalog entries', () => {
    const themedTracks = Object.values(TRACK_CATALOG).filter((track) => track.visualTheme?.primary)
    const uniquePrimaryThemes = new Set(themedTracks.map((track) => track.visualTheme?.primary))
    expect(themedTracks.length).toBeGreaterThanOrEqual(6)
    expect(uniquePrimaryThemes.size).toBeGreaterThanOrEqual(6)
  })

  it('portal:open event includes the track modeType', () => {
    const bus = new EventBus()
    const progression = new AdventureTrackProgression()
    const supervisor = new AdventureProgressionSupervisor(bus, progression)

    let portalMode: string | undefined
    bus.on('portal:open', (payload) => { portalMode = payload.mode })

    supervisor.startTrack('NEON_HELIX', 0)
    supervisor.update(1, 60000) // exceeds recommendedScore (50 000)

    expect(portalMode).toBe('EXTENDED_MAP')
  })
})

// ─── AdventureProgressionSupervisor tests ────────────────────────────────────

describe('AdventureProgressionSupervisor', () => {
  it('exposes current track info and next track helper accessors', () => {
    const progression = new AdventureTrackProgression()

    expect(progression.getCurrentTrackInfo()?.id).toBe('NEON_HELIX')
    expect(progression.getNextTrackId()).toBe('NEON_HELIX')

    progression.completeTrack('NEON_HELIX', 50000, 0, 0)
    expect(progression.getNextTrackId()).toBe('CYBER_CORE')
  })

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

  it('resolves timeout and applies the track timeoutPenaltyMultiplier', () => {
    const bus = new EventBus()
    const progression = new AdventureTrackProgression()
    const supervisor = new AdventureProgressionSupervisor(bus, progression)

    let timeoutFired = false
    bus.on('track:timeout', () => { timeoutFired = true })

    // NEON_HELIX: timeLimitSeconds=120, timeoutPenaltyMultiplier=0.55
    const neonHelixInfo = TRACK_CATALOG['NEON_HELIX']
    supervisor.startTrack('NEON_HELIX', 200)
    supervisor.update(neonHelixInfo.timeLimitSeconds + 1, 1200) // force timeout

    expect(timeoutFired).toBe(true)
    expect(supervisor.isPortalOpen()).toBe(true)
    expect(supervisor.getActiveMultiplier()).toBe(neonHelixInfo.timeoutPenaltyMultiplier)

    supervisor.onPortalEntered(1200, 1)
    expect(progression.isTrackCompleted('NEON_HELIX')).toBe(true)
    // totalReward = Math.round((1200 - 200) * timeoutPenaltyMultiplier)
    const expectedReward = Math.round(1000 * neonHelixInfo.timeoutPenaltyMultiplier)
    expect(progression.getStats().totalRewardsEarned).toBe(expectedReward)
    expect(progression.getStats().goldBallsCollected).toBe(1)
  })

  it('tracks countdown progress and times out even with no score gain', () => {
    const bus = new EventBus()
    const progression = new AdventureTrackProgression()
    const supervisor = new AdventureProgressionSupervisor(bus, progression)

    const neonHelixInfo = TRACK_CATALOG['NEON_HELIX']
    supervisor.startTrack('NEON_HELIX', 5000)
    const initialRemaining = supervisor.getTimeRemaining()
    expect(initialRemaining).toBe(neonHelixInfo.timeLimitSeconds)

    supervisor.update(-1, 5000) // negative dt is clamped/ignored
    expect(supervisor.getTimeRemaining()).toBe(initialRemaining)

    supervisor.update(1, 5000)
    expect(supervisor.getProgress()).toBeGreaterThan(0)
    expect(supervisor.isPortalOpen()).toBe(false)

    // Advance past the full time limit
    supervisor.update(neonHelixInfo.timeLimitSeconds + 100, 5000)
    expect(supervisor.isPortalOpen()).toBe(true)
    expect(supervisor.getActiveMultiplier()).toBe(neonHelixInfo.timeoutPenaltyMultiplier)
  })

  it('recovers from portal activation failure and retries on the next update', () => {
    const bus = new EventBus()
    const progression = new AdventureTrackProgression()
    const supervisor = new AdventureProgressionSupervisor(bus, progression)
    let portalOpenCount = 0
    let failedOnce = false

    bus.on('portal:open', (payload) => {
      portalOpenCount += 1
      if (!failedOnce) {
        failedOnce = true
        bus.emit('portal:activation-failed', {
          trackId: payload.trackId,
          kind: payload.kind,
          mode: payload.mode,
        })
      }
    })

    supervisor.startTrack('NEON_HELIX', 1000)
    supervisor.update(1, 52000)

    expect(portalOpenCount).toBe(1)
    expect(supervisor.isPortalOpen()).toBe(false)
    expect(progression.isTrackCompleted('NEON_HELIX')).toBe(false)

    const remainingAfterFailure = supervisor.getTimeRemaining()
    supervisor.update(1, 52000)

    expect(portalOpenCount).toBe(2)
    expect(supervisor.isPortalOpen()).toBe(true)
    expect(supervisor.getTimeRemaining()).toBeLessThan(remainingAfterFailure)

    supervisor.onPortalEntered(61000, 0)

    expect(progression.isTrackCompleted('NEON_HELIX')).toBe(true)
    expect(progression.getCurrentTrack()).toBe('CYBER_CORE')
  })

  it('calls onTrackAdvanced after reset so startTrack can safely be used in the callback', () => {
    const bus = new EventBus()
    const progression = new AdventureTrackProgression()

    let callbackState: { portalOpen: boolean; activeTrackId: string | null } | null = null
    const supervisorWithCallback = new AdventureProgressionSupervisor(bus, progression, {
      onTrackAdvanced: () => {
        callbackState = {
          portalOpen: supervisorWithCallback.isPortalOpen(),
          activeTrackId: (supervisorWithCallback as unknown as { activeTrackId: string | null }).activeTrackId,
        }
        // It must be safe to call startTrack() here without it being
        // overwritten by a subsequent reset().
        supervisorWithCallback.startTrack('CYBER_CORE', 5000)
      },
    })

    supervisorWithCallback.startTrack('NEON_HELIX', 1000)
    supervisorWithCallback.update(1, 52000)
    expect(supervisorWithCallback.isPortalOpen()).toBe(true)

    supervisorWithCallback.onPortalEntered(61000, 2)

    // Callback should have been invoked after reset, so supervisor state
    // was clean at that moment.
    expect(callbackState).not.toBeNull()
    expect(callbackState!.portalOpen).toBe(false)
    expect(callbackState!.activeTrackId).toBeNull()

    // And startTrack() called from inside the callback should have stuck.
    expect(supervisorWithCallback.getTimeRemaining()).toBeGreaterThan(0)
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
