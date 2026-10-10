/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from 'vitest'

/**
 * #441: ensureOverlaySystems() lazy-loads the leaderboard + name-entry chunks. If
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

import { GameFields } from '../src/game/game-fields'

class TestFields extends GameFields {
  async startSpectateReplay(): Promise<boolean> {
    return false
  }
}

describe('ensureOverlaySystems after dispose', () => {
  it('creates the singletons when the Game is still alive', async () => {
    const fields = new TestFields()
    await fields.ensureOverlaySystems()

    expect(mocks.getLeaderboardSystem).toHaveBeenCalledTimes(1)
    expect(mocks.getNameEntryDialog).toHaveBeenCalledTimes(1)
    expect(() => fields.leaderboardSystem).not.toThrow()

    fields.disposeOverlaySystems()
    expect(mocks.resetLeaderboardSystem).toHaveBeenCalledTimes(1)
    expect(mocks.resetNameEntryDialog).toHaveBeenCalledTimes(1)
  })

  it('does not create them when dispose() lands while the chunks are loading', async () => {
    mocks.getLeaderboardSystem.mockClear()
    mocks.getNameEntryDialog.mockClear()
    const fields = new TestFields()

    const loading = fields.ensureOverlaySystems()
    fields.abort.abort()
    fields.disposeOverlaySystems()
    await loading

    expect(mocks.getLeaderboardSystem).not.toHaveBeenCalled()
    expect(mocks.getNameEntryDialog).not.toHaveBeenCalled()
    expect(() => fields.leaderboardSystem).toThrow(/not loaded/)
  })
})
