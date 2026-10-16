/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiFetch = vi.hoisted(() => vi.fn())
vi.mock('../src/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/config')>()),
  apiFetch,
}))

import { GameUIManager } from '../src/game/game-ui'
import { LeaderboardSystem } from '../src/game-elements/leaderboard-system'
import { GameScenario, type ScenarioHost } from '../src/game/game-scenario'

/**
 * #441: systems schedule popups, polling and cleanup with timers. dispose() must cancel
 * them all (so a late callback cannot touch a torn-down scene, DOM node or field) and
 * must still leave the DOM clean.
 */
describe('timers do not outlive dispose()', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    document.body.innerHTML = '<div id="game-cabinet"></div>'
    apiFetch.mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
    document.head.innerHTML = ''
  })

  it('GameUIManager cancels popup timers and removes popups and their <style> tags', () => {
    const ui = new GameUIManager({} as never)
    ui.showMessage('hello', 5000)
    ui.showCabinetPopup('NEO')
    ui.showMapNamePopup('NEON HELIX', '#00d9ff')
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    expect(document.querySelectorAll('style[data-popup-style]').length).toBe(2)

    ui.dispose()

    expect(vi.getTimerCount()).toBe(0)
    expect(document.getElementById('cabinet-popup')).toBeNull()
    expect(document.getElementById('map-name-popup')).toBeNull()
    expect(document.querySelectorAll('style[data-popup-style]').length).toBe(0)
    expect(() => vi.advanceTimersByTime(60_000)).not.toThrow()
  })

  it('GameUIManager refuses to schedule new popup timers once disposed', () => {
    const ui = new GameUIManager({} as never)
    ui.dispose()
    ui.showMessage('late', 5000)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('LeaderboardSystem does not resume polling from its 5-minute pause after dispose', async () => {
    apiFetch.mockRejectedValue(new Error('backend down'))
    const board = new LeaderboardSystem()

    // maxRetries (5) consecutive failures pause polling and arm a 5-minute resume timer.
    for (let i = 0; i < 5; i++) await board.refresh(true)
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    const callsBefore = apiFetch.mock.calls.length

    board.dispose()
    expect(vi.getTimerCount()).toBe(0)

    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(apiFetch.mock.calls.length).toBe(callsBefore)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('GameScenario removes its popups and cancels their timers', () => {
    const scenario = new GameScenario({} as ScenarioHost)
    const show = scenario as unknown as {
      showModeSwitchPopup(mode: 'fixed' | 'dynamic'): void
      showZoneSystemPopup(message: string): void
      showScenarioSwitchPopup(name: string): void
    }
    show.showModeSwitchPopup('dynamic')
    show.showZoneSystemPopup('ZONE SYSTEM ACTIVE')
    show.showScenarioSwitchPopup('Samurai')
    expect(document.getElementById('mode-switch-popup')).not.toBeNull()
    expect(document.getElementById('zone-system-popup')).not.toBeNull()

    scenario.dispose()

    expect(vi.getTimerCount()).toBe(0)
    expect(document.getElementById('mode-switch-popup')).toBeNull()
    expect(document.getElementById('zone-system-popup')).toBeNull()
    expect(document.querySelectorAll('style').length).toBe(0)
    expect(document.body.textContent).not.toContain('SCENARIO')
  })
})
