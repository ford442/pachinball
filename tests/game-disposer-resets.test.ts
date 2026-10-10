import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * #441: Game.dispose() must reset every module singleton a second Game would otherwise
 * inherit, and tear down helpers that own timers. `disposeGame` is driven here with a
 * stub Game (every unset property is a callable no-op) and the reset functions mocked,
 * so the test pins *which* resets run, not how each one works.
 */

const resets = vi.hoisted(() => ({
  resetMaterialLibrary: vi.fn(),
  resetCabinetBuilder: vi.fn(),
  resetCampaignRewardsManager: vi.fn(),
  resetScoringBreakdownManager: vi.fn(),
  resetSoundSystem: vi.fn(),
  resetMapSystem: vi.fn(),
  resetChallengeSystem: vi.fn(),
  resetDynamicWorld: vi.fn(),
  resetTrackThemingSystem: vi.fn(),
  resetDailyCascadeState: vi.fn(),
  resetSessionRng: vi.fn(),
  // Deliberately NOT called by the disposer: it wipes campaign progress.
  resetAdventureState: vi.fn(),
}))

vi.mock('../src/materials', () => ({ resetMaterialLibrary: resets.resetMaterialLibrary }))
vi.mock('../src/cabinet', () => ({ resetCabinetBuilder: resets.resetCabinetBuilder }))
vi.mock('../src/adventure/campaign-rewards-manager', () => ({
  resetCampaignRewardsManager: resets.resetCampaignRewardsManager,
}))
vi.mock('../src/adventure/track-theming-system', () => ({
  resetTrackThemingSystem: resets.resetTrackThemingSystem,
}))
vi.mock('../src/adventure/adventure-state', () => ({ resetAdventureState: resets.resetAdventureState }))
vi.mock('../src/cascade/daily-cascade-state', () => ({
  resetDailyCascadeState: resets.resetDailyCascadeState,
}))
vi.mock('../src/core/seeded-rng', () => ({ resetSessionRng: resets.resetSessionRng }))
vi.mock('../src/game-elements', () => ({
  resetScoringBreakdownManager: resets.resetScoringBreakdownManager,
  resetSoundSystem: resets.resetSoundSystem,
  resetMapSystem: resets.resetMapSystem,
  resetChallengeSystem: resets.resetChallengeSystem,
  resetDynamicWorld: resets.resetDynamicWorld,
}))

import { disposeGame } from '../src/game/game-disposer'
import type { Game } from '../src/game'

/** Callable, infinitely nested no-op: `stub().a.b()` and `stub()?.dispose()` are all fine. */
function stub(): unknown {
  return new Proxy(function () {}, {
    get: (_target, prop) => (prop === 'then' ? undefined : stub()),
    apply: () => undefined,
    set: () => true,
  })
}

function makeGame(overrides: Record<string, unknown> = {}): Game {
  const fields: Record<string | symbol, unknown> = { ...overrides }
  return new Proxy(fields, {
    get: (target, prop) => (prop in target ? target[prop] : stub()),
    set: (target, prop, value) => {
      target[prop] = value
      return true
    },
  }) as unknown as Game
}

describe('disposeGame', () => {
  beforeEach(() => {
    for (const fn of Object.values(resets)) fn.mockClear()
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('resets every module singleton, including Daily Cascade state and the session RNG', () => {
    disposeGame(makeGame())

    for (const [name, fn] of Object.entries(resets)) {
      if (name === 'resetAdventureState') continue
      expect(fn, name).toHaveBeenCalledTimes(1)
    }
  })

  it('never resets AdventureState (that would wipe campaign progress)', () => {
    disposeGame(makeGame())
    expect(resets.resetAdventureState).not.toHaveBeenCalled()
  })

  it('aborts the Game signal and disposes the timer scope first', () => {
    const abort = vi.fn()
    const timersDispose = vi.fn()
    disposeGame(makeGame({ abort: { abort }, timers: { dispose: timersDispose } }))

    expect(abort).toHaveBeenCalledTimes(1)
    expect(timersDispose).toHaveBeenCalledTimes(1)
  })

  it('disposes the Gauss cannon (its flash timer) and drops the reference', () => {
    const dispose = vi.fn()
    const game = makeGame({ gaussCannon: { dispose } })
    disposeGame(game)

    expect(dispose).toHaveBeenCalledTimes(1)
    expect((game as unknown as { gaussCannon: unknown }).gaussCannon).toBeNull()
  })
})
