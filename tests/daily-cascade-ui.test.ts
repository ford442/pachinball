/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { bindDailyCascadeUI, refreshDailyCascadeUI } from '../src/game/daily-cascade-ui'
import { getDailyCascadeState, resetDailyCascadeState } from '../src/cascade/daily-cascade-state'

function mountDom(): void {
  document.body.innerHTML = `
    <p id="campaign-stage-label"></p>
    <select id="cascade-mode">
      <option value="vanilla">Vanilla</option>
      <option value="daily">Daily Cascade</option>
      <option value="free">Free Play</option>
      <option value="campaign">Campaign</option>
    </select>
    <p id="cascade-seed-label"></p>
    <button id="cascade-randomize-btn" class="hidden"></button>
  `
}

function choose(mode: string): void {
  const select = document.getElementById('cascade-mode') as HTMLSelectElement
  select.value = mode
  select.dispatchEvent(new Event('change'))
}

describe('start-screen mode select', () => {
  let campaignSelected: boolean
  let abort: AbortController

  beforeEach(() => {
    mountDom()
    resetDailyCascadeState()
    campaignSelected = false
    abort = new AbortController()
    bindDailyCascadeUI({
      signal: abort.signal,
      getCampaignStageName: () => 'Storm Lattice',
      isCampaignSelected: () => campaignSelected,
      setCampaignSelected: (selected) => { campaignSelected = selected },
    })
  })

  afterEach(() => {
    abort.abort()
    document.body.innerHTML = ''
  })

  it('Campaign selects the campaign start mode on a vanilla table', () => {
    choose('daily')
    expect(getDailyCascadeState().getMode()).toBe('daily')

    choose('campaign')
    expect(campaignSelected).toBe(true)
    expect(getDailyCascadeState().getMode()).toBe('vanilla')
    expect(document.getElementById('cascade-seed-label')?.textContent).toBe('Starts at Storm Lattice')
    expect(document.getElementById('campaign-stage-label')?.textContent).toBe('Campaign: Storm Lattice')
    expect(document.getElementById('cascade-randomize-btn')?.classList.contains('hidden')).toBe(true)
  })

  it('any other mode leaves Campaign', () => {
    choose('campaign')
    choose('free')

    expect(campaignSelected).toBe(false)
    expect(getDailyCascadeState().getMode()).toBe('free')
    expect(document.getElementById('cascade-randomize-btn')?.classList.contains('hidden')).toBe(false)
  })

  it('refresh shows Campaign when the Game selected it (stage map click)', () => {
    campaignSelected = true
    refreshDailyCascadeUI()

    expect((document.getElementById('cascade-mode') as HTMLSelectElement).value).toBe('campaign')
  })
})
