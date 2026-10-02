/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GameSettingsUI, type SettingsUIHost } from '../src/game/game-settings-ui'

/**
 * #441: the static `#levels-btn` / `.cabinet-btn` nodes live in index.html, but their listeners were
 * bound from buildMapSelectorUI, which runs on setup, again after fetchAll() resolves, and on every
 * refresh click. Each run stacked another listener, so one click toggled the level screen twice.
 * Every listener is also tied to the Game's AbortSignal so dispose() removes it.
 */
function makeHost(signal: AbortSignal) {
  const toggleLevelSelect = vi.fn()
  const loadCabinetPreset = vi.fn(() => Promise.resolve())
  const host = {
    signal,
    mapSystem: {
      getAllMaps: () => [],
      getMap: () => undefined,
      fetchAll: () => Promise.resolve(),
      refresh: () => Promise.resolve(),
    },
    mapManager: null,
    soundSystem: { fetchMusicTracks: () => Promise.resolve() },
    toggleLevelSelect,
    loadCabinetPreset,
  }
  return { host: host as unknown as SettingsUIHost, toggleLevelSelect, loadCabinetPreset }
}

function mountDom(): void {
  document.body.innerHTML = `
    <div id="map-selector"></div>
    <div id="cabinet-selector"><button class="cabinet-btn" data-cabinet="neo"></button></div>
    <button id="levels-btn"></button>
  `
}

describe('GameSettingsUI static listeners', () => {
  beforeEach(mountDom)
  afterEach(() => { document.body.innerHTML = '' })

  it('binds #levels-btn and .cabinet-btn once, even after the map selector is rebuilt', async () => {
    const abort = new AbortController()
    const { host, toggleLevelSelect, loadCabinetPreset } = makeHost(abort.signal)
    const ui = new GameSettingsUI(host)

    ui.setupMapSelector()
    await Promise.resolve() // let fetchAll().then(rebuild) run
    await Promise.resolve()

    document.getElementById('levels-btn')!.click()
    document.querySelector<HTMLElement>('.cabinet-btn')!.click()

    expect(toggleLevelSelect).toHaveBeenCalledTimes(1)
    expect(loadCabinetPreset).toHaveBeenCalledTimes(1)
  })

  it('stops reacting once the Game signal aborts', async () => {
    const abort = new AbortController()
    const { host, toggleLevelSelect, loadCabinetPreset } = makeHost(abort.signal)
    const ui = new GameSettingsUI(host)

    ui.setupMapSelector()
    await Promise.resolve()
    await Promise.resolve()
    abort.abort()

    document.getElementById('levels-btn')!.click()
    document.querySelector<HTMLElement>('.cabinet-btn')!.click()

    expect(toggleLevelSelect).not.toHaveBeenCalled()
    expect(loadCabinetPreset).not.toHaveBeenCalled()
  })
})
