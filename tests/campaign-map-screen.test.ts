/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AdventureTrackProgression,
  CAMPAIGN_MAIN_PATH,
  TRACK_CATALOG,
} from '../src/adventure/adventure-track-progression'
import { CampaignMapScreen } from '../src/adventure/ui/campaign-map'

function makeScreen(progression: AdventureTrackProgression | null = new AdventureTrackProgression()) {
  const abort = new AbortController()
  const onStageSelect = vi.fn()
  const screen = new CampaignMapScreen({
    signal: abort.signal,
    getProgress: () => progression,
    onStageSelect,
  })
  return { screen, abort, onStageSelect, progression }
}

const stageButton = (id: string) =>
  document.querySelector<HTMLButtonElement>(`[data-testid="campaign-stage-${id}"]`)

describe('CampaignMapScreen', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="game-cabinet"></div>'
  })
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('renders the 14-stage spine, every branch stage and the Nexus Archive', () => {
    const { screen } = makeScreen()
    screen.show()

    expect(screen.isShowing()).toBe(true)
    const spine = document.querySelectorAll('[data-testid="campaign-spine"] > li > .campaign-stage')
    expect(Array.from(spine, (el) => (el as HTMLElement).dataset.trackId)).toEqual([...CAMPAIGN_MAIN_PATH])
    expect(document.querySelectorAll('.campaign-stage[data-track-id]').length).toBe(Object.keys(TRACK_CATALOG).length)
    expect(document.querySelector('[data-testid="campaign-branch-FIREWALL_BREACH"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="campaign-archive-panel"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="campaign-map-summary"]')?.textContent).toContain(
      `0 / ${Object.keys(TRACK_CATALOG).length} stages cleared`,
    )
  })

  it('starts a reached stage on click and closes', () => {
    const progression = new AdventureTrackProgression()
    progression.completeTrack('NEON_HELIX', 60_000, 0, 0)
    const { screen, onStageSelect } = makeScreen(progression)
    screen.show()

    expect(stageButton('NEON_HELIX')?.dataset.status).toBe('completed')
    stageButton('PACHINKO_HALL')?.click()

    expect(onStageSelect).toHaveBeenCalledWith('PACHINKO_HALL')
    expect(screen.isShowing()).toBe(false)
    expect(document.getElementById('campaign-map')).toBeNull()
  })

  it('ignores locked stages', () => {
    const { screen, onStageSelect } = makeScreen()
    screen.show()

    const locked = stageButton('CYBER_CORE')
    expect(locked?.disabled).toBe(true)
    locked?.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(onStageSelect).not.toHaveBeenCalled()
    expect(screen.isShowing()).toBe(true)
  })

  it('focuses the current stage so Enter plays it', () => {
    const { screen } = makeScreen()
    screen.show()

    expect(document.activeElement).toBe(stageButton('NEON_HELIX'))
  })

  it('offers a Play button for the current stage', () => {
    const { screen, onStageSelect } = makeScreen()
    screen.show()

    document.querySelector<HTMLButtonElement>('[data-testid="campaign-map-continue"]')?.click()
    expect(onStageSelect).toHaveBeenCalledWith('NEON_HELIX')
  })

  it('closes on Escape without letting game shortcuts see the key', () => {
    const { screen } = makeScreen()
    const gameKeys = vi.fn()
    window.addEventListener('keydown', gameKeys)
    screen.show()

    document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', bubbles: true }))
    expect(gameKeys).not.toHaveBeenCalled()
    expect(screen.isShowing()).toBe(true)

    document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true }))
    expect(screen.isShowing()).toBe(false)
    expect(gameKeys).not.toHaveBeenCalled()

    // Closed: keys reach the game again.
    document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', bubbles: true }))
    expect(gameKeys).toHaveBeenCalledTimes(1)
    window.removeEventListener('keydown', gameKeys)
  })

  it('lets L through so the game can toggle the map closed', () => {
    const { screen } = makeScreen()
    const gameKeys = vi.fn()
    window.addEventListener('keydown', gameKeys)
    screen.show()

    document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyL', bubbles: true }))
    expect(gameKeys).toHaveBeenCalledTimes(1)
    window.removeEventListener('keydown', gameKeys)
  })

  it('closes when the Game signal aborts and will not reopen', () => {
    const { screen, abort } = makeScreen()
    screen.show()
    abort.abort()

    expect(screen.isShowing()).toBe(false)
    screen.show()
    expect(screen.isShowing()).toBe(false)
  })

  it('renders a loading state before the campaign systems exist', () => {
    const { screen } = makeScreen(null)
    screen.show()

    expect(document.querySelector('[data-testid="campaign-map-summary"]')?.textContent).toContain('Campaign loading')
    expect(document.querySelectorAll('.campaign-stage').length).toBe(0)
  })
})
