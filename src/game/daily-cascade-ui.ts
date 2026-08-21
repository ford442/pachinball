/**
 * Daily Cascade start-screen UI — mode select, seed label, Randomize, campaign stage.
 */

import {
  getDailyCascadeState,
  type DailyCascadeMode,
} from '../game-elements/daily-cascade-state'
import { TRACK_CATALOG } from '../adventure/adventure-track-progression'

export interface DailyCascadeMenuOptions {
  getCampaignStageName?: () => string
}

function defaultCampaignStageName(): string {
  return TRACK_CATALOG['NEON_HELIX']?.name ?? 'Neon Helix'
}

let refreshMenu: (() => void) | null = null

export function refreshDailyCascadeUI(): void {
  refreshMenu?.()
}

export function bindDailyCascadeUI(options: DailyCascadeMenuOptions = {}): void {
  const modeSelect = document.getElementById('cascade-mode') as HTMLSelectElement | null
  const seedLabel = document.getElementById('cascade-seed-label')
  const randomizeBtn = document.getElementById('cascade-randomize-btn') as HTMLButtonElement | null
  const campaignLabel = document.getElementById('campaign-stage-label')
  if (!modeSelect || !seedLabel || !randomizeBtn) return

  const state = getDailyCascadeState()

  const refresh = () => {
    modeSelect.value = state.getMode()
    seedLabel.textContent = state.displaySeedLabel()
    const showRandomize = state.getMode() === 'free'
    randomizeBtn.classList.toggle('hidden', !showRandomize)
    if (campaignLabel) {
      const stage = options.getCampaignStageName?.() ?? defaultCampaignStageName()
      campaignLabel.textContent = `Campaign: ${stage}`
    }
  }

  modeSelect.addEventListener('change', () => {
    const mode = modeSelect.value as DailyCascadeMode
    state.setMode(mode)
    if (mode === 'daily') {
      state.applyDailySeed()
    } else if (mode === 'free' && !state.getSeedId().startsWith('free-')) {
      state.randomize()
    }
    refresh()
  })

  randomizeBtn.addEventListener('click', () => {
    state.randomize()
    refresh()
  })

  refresh()
  refreshMenu = refresh
}
