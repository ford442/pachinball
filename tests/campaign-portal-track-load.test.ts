/**
 * Regression tests for the canonical campaign portal → next-track load path.
 *
 * Flow under test:
 *   goal reached → portal:open → PORTAL_ENTERED → supervisor.onPortalEntered()
 *   → onTrackAdvanced → GameSlotAdventure.switchToTrack()
 *   → LevelLoader.loadCampaignTrack() → AdventureMode.switchToTrack() + map/mode sync
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventBus } from '../src/game/event-bus'
import { AdventureTrackProgression } from '../src/game-elements/adventure-track-progression'
import { AdventureProgressionSupervisor } from '../src/game-elements/adventure-progression-supervisor'
import { LevelLoader } from '../src/game/level-loader'
import { GameSlotAdventure } from '../src/game/game-slot-adventure'
import { AdventureTrackType } from '../src/adventure/adventure-types'
import {
  getTableMapIdForTrack,
  getTrackModeType,
  modeTypeToGameMode,
  resetMapRegistry,
} from '../src/game/map-registry'

describe('map-registry A/B helpers', () => {
  beforeEach(() => resetMapRegistry())

  it('maps campaign track ids to LCD table map ids', () => {
    expect(getTableMapIdForTrack('NEON_HELIX')).toBe('neon-helix')
    expect(getTableMapIdForTrack('PACHINKO_HALL')).toBe('pachinko-hall')
    expect(getTableMapIdForTrack('CYBER_CORE')).toBe('cyber-core')
    expect(getTableMapIdForTrack('QUANTUM_GRID')).toBe('quantum-grid')
  })

  it('resolves EXTENDED_MAP ↔ dynamic and STATIONARY_TABLE ↔ fixed', () => {
    expect(getTrackModeType('NEON_HELIX')).toBe('EXTENDED_MAP')
    expect(modeTypeToGameMode('EXTENDED_MAP')).toBe('dynamic')
    expect(getTrackModeType('CYBER_CORE')).toBe('STATIONARY_TABLE')
    expect(modeTypeToGameMode('STATIONARY_TABLE')).toBe('fixed')
  })
})

describe('LevelLoader.loadCampaignTrack', () => {
  let switchToTrack: ReturnType<typeof vi.fn>
  let rebuildHandleCaches: ReturnType<typeof vi.fn>
  let resetBall: ReturnType<typeof vi.fn>
  let switchTableMap: ReturnType<typeof vi.fn>
  let setGameMode: ReturnType<typeof vi.fn>
  let loader: LevelLoader

  beforeEach(() => {
    resetMapRegistry()
    switchToTrack = vi.fn().mockReturnValue(true)
    rebuildHandleCaches = vi.fn()
    resetBall = vi.fn()
    switchTableMap = vi.fn()
    setGameMode = vi.fn()
    loader = new LevelLoader({
      adventureMode: {
        isActive: vi.fn().mockReturnValue(true),
        switchToTrack,
      } as never,
      ballManager: null,
      ensureAdventureActive: vi.fn(),
      resetBall,
      rebuildHandleCaches,
      mapManager: { switchTableMap } as never,
      setGameMode,
    })
  })

  it('switches A→B with extended→stationary mode and matching LCD map', () => {
    const result = loader.loadCampaignTrack('CYBER_CORE', { resetBallToPlunger: false })

    expect(result.success).toBe(true)
    expect(setGameMode).toHaveBeenCalledWith('fixed')
    expect(switchTableMap).toHaveBeenCalledWith('cyber-core')
    expect(switchToTrack).toHaveBeenCalledWith(AdventureTrackType.CYBER_CORE)
    expect(rebuildHandleCaches).toHaveBeenCalledOnce()
    expect(resetBall).not.toHaveBeenCalled()
  })

  it('switches B→A with stationary→extended mode', () => {
    loader.loadCampaignTrack('QUANTUM_GRID')

    expect(setGameMode).toHaveBeenCalledWith('dynamic')
    expect(switchTableMap).toHaveBeenCalledWith('quantum-grid')
    expect(switchToTrack).toHaveBeenCalledWith(AdventureTrackType.QUANTUM_GRID)
  })

  it('resets ball to plunger for free-map test loads', () => {
    loader.loadCampaignTrack('NEON_HELIX', { resetBallToPlunger: true })
    expect(resetBall).toHaveBeenCalledOnce()
  })
})

describe('Campaign portal → next track (supervisor + slot + loader)', () => {
  it('completes NEON_HELIX portal entry and loads PACHINKO_HALL hub without duplicate physics rebuild', () => {
    const bus = new EventBus()
    const progression = new AdventureTrackProgression()
    const switchToTrack = vi.fn().mockReturnValue(true)
    const rebuildHandleCaches = vi.fn()
    const switchTableMap = vi.fn()
    const setGameMode = vi.fn()
    const onTrackStart = vi.fn()
    const uiReset = vi.fn()
    const goalInit = vi.fn()
    const supervisorStart = vi.fn()

    const loader = new LevelLoader({
      adventureMode: {
        isActive: vi.fn().mockReturnValue(true),
        switchToTrack,
        getCurrentZone: vi.fn().mockReturnValue(AdventureTrackType.PACHINKO_HALL),
      } as never,
      ballManager: null,
      ensureAdventureActive: vi.fn(),
      resetBall: vi.fn(),
      rebuildHandleCaches,
      mapManager: { switchTableMap } as never,
      setGameMode,
    })

    const slot = new GameSlotAdventure({
      display: { setTrackInfo: vi.fn(), setStoryText: vi.fn() },
      effects: null,
      eventBus: bus,
      ballManager: null,
      adventureMode: {
        isActive: vi.fn().mockReturnValue(true),
        switchToTrack,
      } as never,
      adventureTrackProgression: progression,
      gameObjects: null,
      mapManager: { switchTableMap } as never,
      scene: {} as never,
      accessibility: { reducedMotion: false },
      scoreElement: null,
      score: 62_000,
      adventureCinematicTriggers: { onTrackStart } as never,
      adventureCinematicSystem: null,
      adventureUIStateManager: { reset: uiReset } as never,
      adventureGoalTracker: { initializeTrack: goalInit } as never,
      adventureProgressionSupervisor: { startTrack: supervisorStart } as never,
      physicsController: { rebuildHandleCaches } as never,
      levelLoader: loader,
      updateHUD: vi.fn(),
      getBallPosition: vi.fn().mockReturnValue(null),
      triggerJackpot: vi.fn(),
      setGameState: vi.fn(),
      resetBall: vi.fn(),
    })

    const supervisor = new AdventureProgressionSupervisor(bus, progression, {
      onTrackAdvanced: (nextTrackId) => {
        if (nextTrackId) slot.switchToTrack(nextTrackId)
      },
    })

    supervisor.startTrack('NEON_HELIX', 0)
    supervisor.update(0.1, 60_000)
    expect(supervisor.isPortalOpen()).toBe(true)

    supervisor.onPortalEntered(62_000, 1)

    expect(progression.isTrackCompleted('NEON_HELIX')).toBe(true)
    expect(progression.getCurrentTrack()).toBe('PACHINKO_HALL')
    expect(switchToTrack).toHaveBeenCalledWith(AdventureTrackType.PACHINKO_HALL)
    expect(setGameMode).toHaveBeenCalledWith('dynamic')
    expect(switchTableMap).toHaveBeenCalledWith('pachinko-hall')
    expect(rebuildHandleCaches).toHaveBeenCalledOnce()
    expect(onTrackStart).toHaveBeenCalledOnce()
    expect(uiReset).toHaveBeenCalledOnce()
    expect(goalInit).toHaveBeenCalledWith(AdventureTrackType.PACHINKO_HALL)
    expect(supervisorStart).toHaveBeenCalledWith('PACHINKO_HALL', 62_000)
  })

  it('chains A hub → B arena portal loads without accumulating rebuild calls', () => {
    const bus = new EventBus()
    const progression = new AdventureTrackProgression()
    const switchToTrack = vi.fn().mockReturnValue(true)
    const rebuildHandleCaches = vi.fn()

    const loader = new LevelLoader({
      adventureMode: {
        isActive: vi.fn().mockReturnValue(true),
        switchToTrack,
      } as never,
      ballManager: null,
      ensureAdventureActive: vi.fn(),
      resetBall: vi.fn(),
      rebuildHandleCaches,
      mapManager: { switchTableMap: vi.fn() } as never,
      setGameMode: vi.fn(),
    })

    const slot = new GameSlotAdventure({
      display: { setTrackInfo: vi.fn(), setStoryText: vi.fn() },
      effects: null,
      eventBus: bus,
      ballManager: null,
      adventureMode: { isActive: vi.fn().mockReturnValue(true), switchToTrack } as never,
      adventureTrackProgression: progression,
      gameObjects: null,
      mapManager: null,
      scene: {} as never,
      accessibility: { reducedMotion: false },
      scoreElement: null,
      score: 200_000,
      adventureCinematicTriggers: null,
      adventureCinematicSystem: null,
      adventureUIStateManager: { reset: vi.fn() } as never,
      adventureGoalTracker: { initializeTrack: vi.fn() } as never,
      adventureProgressionSupervisor: { startTrack: vi.fn() } as never,
      physicsController: null,
      levelLoader: loader,
      updateHUD: vi.fn(),
      getBallPosition: vi.fn().mockReturnValue(null),
      triggerJackpot: vi.fn(),
      setGameState: vi.fn(),
      resetBall: vi.fn(),
    })

    const supervisor = new AdventureProgressionSupervisor(bus, progression, {
      onTrackAdvanced: (nextTrackId) => {
        if (nextTrackId) slot.switchToTrack(nextTrackId)
      },
    })

    // NEON_HELIX (A) complete → PACHINKO_HALL (A hub)
    supervisor.startTrack('NEON_HELIX', 0)
    supervisor.update(0.1, 60_000)
    supervisor.onPortalEntered(60_000, 0)

    // PACHINKO_HALL (A) complete → CYBER_CORE (B)
    supervisor.startTrack('PACHINKO_HALL', 60_000)
    supervisor.update(0.1, 110_000)
    supervisor.onPortalEntered(110_000, 0)

    expect(progression.getCurrentTrack()).toBe('CYBER_CORE')
    expect(switchToTrack).toHaveBeenCalledTimes(2)
    expect(switchToTrack).toHaveBeenNthCalledWith(1, AdventureTrackType.PACHINKO_HALL)
    expect(switchToTrack).toHaveBeenNthCalledWith(2, AdventureTrackType.CYBER_CORE)
    expect(rebuildHandleCaches).toHaveBeenCalledTimes(2)
  })
})
