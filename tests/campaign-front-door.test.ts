/**
 * Campaign front door — GameSlotAdventure.enterCampaignStage(), the one path the
 * start screen's Campaign mode, the stage map and H share. It must enter the
 * stage AdventureTrackProgression holds as current, not a cycling cursor.
 */

import { describe, expect, it, vi } from 'vitest'
import { AdventureTrackProgression } from '../src/adventure/adventure-track-progression'
import { GameSlotAdventure, type SlotAdventureHost } from '../src/game/game-slot-adventure'

function makeSlot(progression: AdventureTrackProgression, active = false) {
  const ball = { setEnabled: vi.fn() }
  let isActive = active
  const adventureMode = {
    isActive: vi.fn(() => isActive),
    start: vi.fn(() => { isActive = true; return Promise.resolve() }),
    end: vi.fn(() => { isActive = false }),
    getFollowCamera: vi.fn(() => null),
  }
  const host = {
    display: null,
    effects: null,
    eventBus: { on: vi.fn(), emit: vi.fn() },
    ballManager: { getBallBody: () => ball, getBallBodies: () => [ball] },
    adventureMode,
    adventureTrackProgression: progression,
    gameObjects: { getBindings: () => [], getPinballMeshes: () => [], setTableBodiesEnabled: vi.fn() },
    mapManager: null,
    scene: { activeCamera: {} },
    accessibility: { reducedMotion: false },
    scoreElement: null,
    score: 0,
    adventureCinematicTriggers: null,
    adventureCinematicSystem: null,
    adventureUIStateManager: null,
    adventureGoalTracker: null,
    adventureProgressionSupervisor: null,
    physicsController: null,
    levelLoader: null,
    performanceMonitor: null,
    uiManager: null,
    updateHUD: vi.fn(),
    getBallPosition: vi.fn(() => null),
    triggerJackpot: vi.fn(),
    setGameState: vi.fn(),
    resetBall: vi.fn(),
  }
  return { slot: new GameSlotAdventure(host as unknown as SlotAdventureHost), adventureMode }
}

describe('GameSlotAdventure.enterCampaignStage', () => {
  it('enters NEON_HELIX on a fresh campaign', () => {
    const { slot, adventureMode } = makeSlot(new AdventureTrackProgression())
    slot.enterCampaignStage()

    expect(adventureMode.start).toHaveBeenCalledTimes(1)
    expect(adventureMode.start.mock.calls[0]?.[3]).toBe('NEON_HELIX')
  })

  it('resumes at the progression’s current stage', () => {
    const progression = new AdventureTrackProgression()
    progression.completeTrack('NEON_HELIX', 60_000, 0, 0)
    progression.completeTrack('PACHINKO_HALL', 100_000, 0, 0)
    progression.setCurrentTrack('CYBER_CORE')
    const { slot, adventureMode } = makeSlot(progression)

    slot.enterCampaignStage()
    expect(adventureMode.start.mock.calls[0]?.[3]).toBe('CYBER_CORE')
  })

  it('tears a live holo-deck down before entering, so the stage starts clean', () => {
    const { slot, adventureMode } = makeSlot(new AdventureTrackProgression(), true)
    slot.enterCampaignStage()

    expect(adventureMode.end).toHaveBeenCalledTimes(1)
    expect(adventureMode.end.mock.invocationCallOrder[0]).toBeLessThan(
      adventureMode.start.mock.invocationCallOrder[0] ?? 0,
    )
  })
})
