/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from 'vitest'

/**
 * #441: ArcadeOverlays.ensure() lazy-loads the leaderboard + name-entry chunks. If
 * Game.dispose() lands while they load, the continuation must not create the module
 * singletons (their resets would go onto a list disposeGame already drained, leaking
 * them into the next Game).
 */

const mocks = vi.hoisted(() => ({
  getLeaderboardSystem: vi.fn(() => ({ setOnSpectateCallback: vi.fn(), stop: vi.fn() })),
  resetLeaderboardSystem: vi.fn(),
  getNameEntryDialog: vi.fn(() => ({})),
  resetNameEntryDialog: vi.fn(),
}))

vi.mock('../src/game-elements/leaderboard-system', () => ({
  getLeaderboardSystem: mocks.getLeaderboardSystem,
  resetLeaderboardSystem: mocks.resetLeaderboardSystem,
}))
vi.mock('../src/game-elements/name-entry-dialog', () => ({
  getNameEntryDialog: mocks.getNameEntryDialog,
  resetNameEntryDialog: mocks.resetNameEntryDialog,
}))

import { ArcadeOverlays } from '../src/game/arcade-overlays'

function makeOverlays() {
  const abort = new AbortController()
  const onSpectate = vi.fn()
  return { abort, onSpectate, overlays: new ArcadeOverlays({ signal: abort.signal, onSpectate }) }
}

describe('ArcadeOverlays.ensure() after dispose', () => {
  it('creates the singletons when the Game is still alive', async () => {
    const { overlays } = makeOverlays()
    await overlays.ensure()

    expect(mocks.getLeaderboardSystem).toHaveBeenCalledTimes(1)
    expect(mocks.getNameEntryDialog).toHaveBeenCalledTimes(1)
    expect(() => overlays.leaderboard).not.toThrow()
    expect(() => overlays.nameEntry).not.toThrow()

    overlays.dispose()
    expect(mocks.resetLeaderboardSystem).toHaveBeenCalledTimes(1)
    expect(mocks.resetNameEntryDialog).toHaveBeenCalledTimes(1)
  })

  it('does not create them when dispose() lands while the chunks are loading', async () => {
    mocks.getLeaderboardSystem.mockClear()
    mocks.getNameEntryDialog.mockClear()
    const { abort, overlays } = makeOverlays()

    const loading = overlays.ensure()
    abort.abort()
    overlays.dispose()
    await loading

    expect(mocks.getLeaderboardSystem).not.toHaveBeenCalled()
    expect(mocks.getNameEntryDialog).not.toHaveBeenCalled()
    expect(() => overlays.leaderboard).toThrow(/not loaded/)
  })

  it('routes a leaderboard "watch" click to onSpectate', async () => {
    const { overlays, onSpectate } = makeOverlays()
    await overlays.ensure()
    const board = mocks.getLeaderboardSystem.mock.results.at(-1)?.value as { setOnSpectateCallback: ReturnType<typeof vi.fn> }
    const callback = board.setOnSpectateCallback.mock.calls[0]?.[0] as (id: string) => void
    callback('replay-7')
    expect(onSpectate).toHaveBeenCalledWith('replay-7')
  })

  it('is one load however many callers ask', async () => {
    mocks.getLeaderboardSystem.mockClear()
    const { overlays } = makeOverlays()
    await Promise.all([overlays.ensure(), overlays.ensure(), overlays.ensure()])
    expect(mocks.getLeaderboardSystem).toHaveBeenCalledTimes(1)
  })
})
