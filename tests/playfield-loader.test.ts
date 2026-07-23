/**
 * Canonical playfield load API tests — verifies campaign and free-map paths
 * share the same teardown instrumentation (TrackTeardownStats).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  loadPlayfield,
  campaignPlayfieldSpec,
  freeMapPlayfieldSpec,
  type PlayfieldLoaderDeps,
} from '../src/game/playfield-loader'
import { LevelLoader } from '../src/game/level-loader'
import { AdventureTrackType } from '../src/adventure/adventure-types'
import { resetMapRegistry } from '../src/game/map-registry'
import type { TrackTeardownStats } from '../src/game-elements/track-teardown-stats'
import { createEmptyTeardownStats } from '../src/game-elements/track-teardown-stats'

function makeTeardownStats(overrides: Partial<TrackTeardownStats> = {}): TrackTeardownStats {
  return { ...createEmptyTeardownStats(), meshesDisposed: 3, bodiesRemoved: 2, ...overrides }
}

describe('loadPlayfield', () => {
  let switchToTrack: ReturnType<typeof vi.fn>
  let rebuildHandleCaches: ReturnType<typeof vi.fn>
  let resetBall: ReturnType<typeof vi.fn>
  let setGameMode: ReturnType<typeof vi.fn>
  let switchTableMap: ReturnType<typeof vi.fn>
  let deps: PlayfieldLoaderDeps

  beforeEach(() => {
    resetMapRegistry()
    switchToTrack = vi.fn().mockReturnValue(true)
    rebuildHandleCaches = vi.fn()
    resetBall = vi.fn()
    setGameMode = vi.fn()
    switchTableMap = vi.fn()
    deps = {
      adventureMode: {
        isActive: vi.fn().mockReturnValue(true),
        switchToTrack,
        getLastTeardownStats: vi.fn().mockReturnValue(makeTeardownStats()),
      } as never,
      ballManager: null,
      ensureAdventureActive: vi.fn(),
      resetBall,
      rebuildHandleCaches,
      mapManager: { switchTableMap } as never,
      setGameMode,
    }
  })

  it('campaign-portal path syncs mode, LCD map, and skips ball reset', () => {
    const result = loadPlayfield(campaignPlayfieldSpec('CYBER_CORE'), deps)

    expect(result.success).toBe(true)
    expect(result.trackId).toBe('CYBER_CORE')
    expect(setGameMode).toHaveBeenCalledWith('fixed')
    expect(switchTableMap).toHaveBeenCalledWith('cyber-core')
    expect(switchToTrack).toHaveBeenCalledWith(AdventureTrackType.CYBER_CORE)
    expect(rebuildHandleCaches).toHaveBeenCalledOnce()
    expect(resetBall).not.toHaveBeenCalled()
    expect(result.teardown?.lingeringBodies).toBe(0)
  })

  it('free-map path resets ball and skips campaign sync', () => {
    const result = loadPlayfield(freeMapPlayfieldSpec('NEON_HELIX'), deps)

    expect(result.success).toBe(true)
    expect(setGameMode).not.toHaveBeenCalled()
    expect(switchTableMap).not.toHaveBeenCalled()
    expect(resetBall).toHaveBeenCalledOnce()
    expect(result.teardown?.meshesDisposed).toBe(3)
    expect(result.teardown?.bodiesRemoved).toBe(2)
  })

  it('returns teardown stats from adventure mode on both paths', () => {
    const portalStats = makeTeardownStats({ exitPortalsRemoved: 1 })
    const freeMapStats = makeTeardownStats({ exitPortalsRemoved: 1, meshesDisposed: 5 })

    ;(deps.adventureMode as { getLastTeardownStats: ReturnType<typeof vi.fn> })
      .getLastTeardownStats
      .mockReturnValueOnce(portalStats)
      .mockReturnValueOnce(freeMapStats)

    const portal = loadPlayfield(campaignPlayfieldSpec('PACHINKO_HALL'), deps)
    const freeMap = loadPlayfield(freeMapPlayfieldSpec('QUANTUM_GRID'), deps)

    expect(portal.teardown?.exitPortalsRemoved).toBe(1)
    expect(freeMap.teardown?.exitPortalsRemoved).toBe(1)
    expect(freeMap.teardown?.meshesDisposed).toBe(5)
  })

  it('calls ensureAdventureActive when adventure is not yet running', () => {
    const ensureAdventureActive = vi.fn()
    ;(deps.adventureMode as { isActive: ReturnType<typeof vi.fn> }).isActive.mockReturnValue(false)

    loadPlayfield(freeMapPlayfieldSpec('NEON_HELIX'), { ...deps, ensureAdventureActive })

    expect(ensureAdventureActive).toHaveBeenCalledOnce()
  })

  it('returns error for unknown track without calling switchToTrack', () => {
    const result = loadPlayfield({ trackId: 'NONEXISTENT', source: 'free-map' }, deps)

    expect(result.success).toBe(false)
    expect(switchToTrack).not.toHaveBeenCalled()
  })

  it('does not double-register physics when called twice in succession', () => {
    loadPlayfield(campaignPlayfieldSpec('NEON_HELIX'), deps)
    loadPlayfield(campaignPlayfieldSpec('CYBER_CORE'), deps)

    expect(switchToTrack).toHaveBeenCalledTimes(2)
    expect(rebuildHandleCaches).toHaveBeenCalledTimes(2)
    // Each call is a full teardown+build cycle — never skip teardown
    expect(switchToTrack).toHaveBeenNthCalledWith(1, AdventureTrackType.NEON_HELIX)
    expect(switchToTrack).toHaveBeenNthCalledWith(2, AdventureTrackType.CYBER_CORE)
  })
})

describe('LevelLoader delegates to loadPlayfield', () => {
  it('loadCampaignTrack and loadMap both surface teardown stats', () => {
    resetMapRegistry()
    const teardown = makeTeardownStats({ exitPortalsRemoved: 1 })
    const loader = new LevelLoader({
      adventureMode: {
        isActive: vi.fn().mockReturnValue(true),
        switchToTrack: vi.fn().mockReturnValue(true),
        getLastTeardownStats: vi.fn().mockReturnValue(teardown),
      } as never,
      ballManager: null,
      ensureAdventureActive: vi.fn(),
      resetBall: vi.fn(),
      rebuildHandleCaches: vi.fn(),
    })

    const campaign = loader.loadCampaignTrack('CYBER_CORE')
    const freeMap = loader.loadMap('NEON_HELIX')

    expect(campaign.teardown?.exitPortalsRemoved).toBe(1)
    expect(freeMap.teardown?.exitPortalsRemoved).toBe(1)
    expect(campaign.teardown?.lingeringBodies).toBe(0)
    expect(freeMap.teardown?.lingeringBodies).toBe(0)
  })
})
