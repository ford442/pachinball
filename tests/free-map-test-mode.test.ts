/**
 * Tests for Free Map Test Mode — map-registry, level-loader, free-map-test-mode.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  getMapRegistry,
  getMapConfigById,
  getMapsByLayout,
  resetMapRegistry,
} from '../src/game/map-registry'
import { LevelLoader } from '../src/game/level-loader'
import { FreeMapTestMode } from '../src/game/free-map-test-mode'
import { AdventureTrackType } from '../src/adventure/adventure-types'

// ─── Map Registry Tests ───────────────────────────────────────────────────────

describe('MapRegistry', () => {
  beforeEach(() => {
    resetMapRegistry()
  })

  it('returns all adventure track types in registry', () => {
    const registry = getMapRegistry()
    const allTypes = Object.values(AdventureTrackType)
    expect(registry.length).toBe(allTypes.length)
    for (const trackType of allTypes) {
      expect(registry.find(m => m.id === trackType)).toBeDefined()
    }
  })

  it('looks up a specific map by id', () => {
    const config = getMapConfigById('NEON_HELIX')
    expect(config).toBeDefined()
    expect(config!.displayName).toBe('Neon Helix')
    expect(config!.adventureTrackType).toBe(AdventureTrackType.NEON_HELIX)
  })

  it('returns undefined for unknown map id', () => {
    expect(getMapConfigById('NONEXISTENT')).toBeUndefined()
  })

  it('filters maps by layout type', () => {
    const stationary = getMapsByLayout('stationary')
    const extended = getMapsByLayout('extended')
    // From TRACK_CATALOG: CYBER_CORE and PACHINKO_SPIRE are stationary
    expect(stationary.length).toBeGreaterThan(0)
    expect(extended.length).toBeGreaterThan(0)
    expect(stationary.every(m => m.layoutType === 'stationary')).toBe(true)
    expect(extended.every(m => m.layoutType === 'extended')).toBe(true)
  })

  it('assigns layoutType from TRACK_CATALOG modeType', () => {
    const cyberCore = getMapConfigById('CYBER_CORE')
    expect(cyberCore?.layoutType).toBe('stationary')

    const neonHelix = getMapConfigById('NEON_HELIX')
    expect(neonHelix?.layoutType).toBe('extended')
  })
})

// ─── Level Loader Tests ───────────────────────────────────────────────────────

describe('LevelLoader', () => {
  let mockAdventureMode: {
    isActive: ReturnType<typeof vi.fn>
    switchToTrack: ReturnType<typeof vi.fn>
    getLastTeardownStats?: ReturnType<typeof vi.fn>
  }
  let ensureAdventureActive: ReturnType<typeof vi.fn>
  let resetBall: ReturnType<typeof vi.fn>
  let rebuildHandleCaches: ReturnType<typeof vi.fn>
  let loader: LevelLoader

  beforeEach(() => {
    resetMapRegistry()
    mockAdventureMode = {
      isActive: vi.fn().mockReturnValue(true),
      switchToTrack: vi.fn().mockReturnValue(true),
      getLastTeardownStats: vi.fn().mockReturnValue(null),
    }
    ensureAdventureActive = vi.fn()
    resetBall = vi.fn()
    rebuildHandleCaches = vi.fn()
    loader = new LevelLoader({
      adventureMode: mockAdventureMode as unknown as InstanceType<typeof import('../src/adventure/adventure-mode').AdventureMode>,
      ballManager: null,
      ensureAdventureActive,
      resetBall,
      rebuildHandleCaches,
    })
  })

  it('loads a valid map and calls switchToTrack + rebuildHandleCaches + resetBall', () => {
    const result = loader.loadMap('NEON_HELIX')
    expect(result.success).toBe(true)
    expect(result.mapConfig?.id).toBe('NEON_HELIX')
    expect(mockAdventureMode.switchToTrack).toHaveBeenCalledWith(AdventureTrackType.NEON_HELIX)
    expect(rebuildHandleCaches).toHaveBeenCalled()
    expect(resetBall).toHaveBeenCalled()
  })

  it('surfaces teardown stats from adventure mode on free-map load', () => {
    const teardown = {
      meshesDisposed: 4,
      materialsDisposed: 2,
      bodiesRemoved: 3,
      conveyorZonesRemoved: 0,
      gravityWellsRemoved: 0,
      dampingZonesRemoved: 0,
      resetSensorsRemoved: 0,
      chromaGatesRemoved: 0,
      adventureSensorRemoved: 0,
      exitPortalsRemoved: 0,
      lingeringBodies: 0,
    }
    mockAdventureMode.getLastTeardownStats = vi.fn().mockReturnValue(teardown)
    loader.updateDeps({
      adventureMode: mockAdventureMode as never,
    })

    const result = loader.loadMap('CYBER_CORE')

    expect(result.teardown?.meshesDisposed).toBe(4)
    expect(result.teardown?.bodiesRemoved).toBe(3)
    expect(result.teardown?.lingeringBodies).toBe(0)
  })

  it('returns error for unknown map id', () => {
    const result = loader.loadMap('INVALID_MAP')
    expect(result.success).toBe(false)
    expect(result.error).toContain('Unknown map id')
  })

  it('calls ensureAdventureActive when adventure is not active', () => {
    mockAdventureMode.isActive.mockReturnValue(false)
    loader.loadMap('CYBER_CORE')
    expect(ensureAdventureActive).toHaveBeenCalled()
  })

  it('does not call ensureAdventureActive when already active', () => {
    mockAdventureMode.isActive.mockReturnValue(true)
    loader.loadMap('CYBER_CORE')
    expect(ensureAdventureActive).not.toHaveBeenCalled()
  })

  it('returns error when switchToTrack fails', () => {
    mockAdventureMode.switchToTrack.mockReturnValue(false)
    const result = loader.loadMap('NEON_HELIX')
    expect(result.success).toBe(false)
    expect(result.error).toContain('Failed to switch')
  })

  it('returns error when adventureMode is null', () => {
    loader.updateDeps({ adventureMode: null })
    const result = loader.loadMap('NEON_HELIX')
    expect(result.success).toBe(false)
    expect(result.error).toContain('not available')
  })
})

// ─── Free Map Test Mode Tests ─────────────────────────────────────────────────

describe('FreeMapTestMode', () => {
  let mockAdventureMode: { isActive: ReturnType<typeof vi.fn>; switchToTrack: ReturnType<typeof vi.fn> }
  let testMode: FreeMapTestMode
  let onMessage: ReturnType<typeof vi.fn>
  let onStatusChange: ReturnType<typeof vi.fn>

  beforeEach(() => {
    resetMapRegistry()
    mockAdventureMode = {
      isActive: vi.fn().mockReturnValue(true),
      switchToTrack: vi.fn().mockReturnValue(true),
      getLastTeardownStats: vi.fn().mockReturnValue(null),
    }
    onMessage = vi.fn()
    onStatusChange = vi.fn()

    testMode = new FreeMapTestMode(
      {
        adventureMode: mockAdventureMode as unknown as InstanceType<typeof import('../src/adventure/adventure-mode').AdventureMode>,
        ballManager: null,
        ensureAdventureActive: vi.fn(),
        resetBall: vi.fn(),
        rebuildHandleCaches: vi.fn(),
      },
      { onMessage, onStatusChange }
    )
  })

  afterEach(() => {
    testMode.dispose()
  })

  it('starts inactive', () => {
    expect(testMode.isActive()).toBe(false)
  })

  it('activates and deactivates', () => {
    testMode.activate()
    expect(testMode.isActive()).toBe(true)
    expect(onStatusChange).toHaveBeenCalledWith(true, expect.anything())

    testMode.deactivate()
    expect(testMode.isActive()).toBe(false)
    expect(onStatusChange).toHaveBeenCalledWith(false)
  })

  it('toggle switches between active/inactive', () => {
    testMode.toggle()
    expect(testMode.isActive()).toBe(true)
    testMode.toggle()
    expect(testMode.isActive()).toBe(false)
  })

  it('cycleNext advances through registry', () => {
    testMode.activate()
    const first = testMode.getCurrentMapConfig()
    testMode.cycleNext()
    const second = testMode.getCurrentMapConfig()
    expect(second?.id).not.toBe(first?.id)
  })

  it('cyclePrev goes backward through registry', () => {
    testMode.activate()
    testMode.cycleNext()
    testMode.cycleNext()
    const afterTwo = testMode.getCurrentMapConfig()
    testMode.cyclePrev()
    const afterBack = testMode.getCurrentMapConfig()
    expect(afterBack?.id).not.toBe(afterTwo?.id)
  })

  it('cycleNext wraps around at end', () => {
    testMode.activate()
    const registry = testMode.getAvailableMaps()
    for (let i = 0; i < registry.length; i++) {
      testMode.cycleNext()
    }
    // Should wrap back to first
    expect(testMode.getCurrentMapConfig()?.id).toBe(registry[0].id)
  })

  it('loadById loads a specific map', () => {
    const success = testMode.loadById('CYBER_CORE')
    expect(success).toBe(true)
    expect(testMode.getCurrentMapConfig()?.id).toBe('CYBER_CORE')
    expect(testMode.isActive()).toBe(true)
  })

  it('loadById returns false for unknown id', () => {
    const success = testMode.loadById('NONEXISTENT')
    expect(success).toBe(false)
  })

  it('advanceAfterDrain cycles to the next map while active', () => {
    testMode.activate()
    const first = testMode.getCurrentMapConfig()

    const advanced = testMode.advanceAfterDrain()

    expect(advanced).toBe(true)
    expect(testMode.getCurrentMapConfig()?.id).not.toBe(first?.id)
  })

  it('announces the drain advance hint when activated', () => {
    testMode.activate()
    expect(onMessage).toHaveBeenCalledWith(
      expect.stringContaining('PageUp/PageDown or drain to advance')
    )
  })

  it('does not cycle when inactive', () => {
    testMode.cycleNext()
    // switchToTrack should not be called since mode is inactive
    expect(mockAdventureMode.switchToTrack).not.toHaveBeenCalled()
  })

  it('getAvailableMaps returns full registry', () => {
    const maps = testMode.getAvailableMaps()
    expect(maps.length).toBe(Object.values(AdventureTrackType).length)
  })
})
