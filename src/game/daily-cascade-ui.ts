/**
 * Daily Cascade start-screen UI — mode select, seed label, Randomize, campaign stage.
 */

import {
  getDailyCascadeState,
  type DailyCascadeMode,
} from '../cascade/daily-cascade-state'
import { TRACK_CATALOG } from '../adventure/adventure-track-progression'

export interface DailyCascadeMenuOptions {
  getCampaignStageName?: () => string
  /** Aborting removes the menu listeners and detaches the module-level refresh hook. */
  signal?: AbortSignal
}

function defaultCampaignStageName(): string {
  return TRACK_CATALOG['NEON_HELIX']?.name ?? 'Neon Helix'
}

let refreshMenu: (() => void) | null = null

export function refreshDailyCascadeUI(): void {
  refreshMenu?.()
}

/** `?cascade=<u32>`: open on that free-seed cascade table (a shareable table; the replay corpus records with it). */
export function parseCascadeSeedParam(search: string): number | null {
  const raw = new URLSearchParams(search).get('cascade')
  if (!raw || !/^\d{1,10}$/.test(raw)) return null
  const seed = Number(raw)
  return seed <= 0xffffffff ? seed : null
}

export function bindDailyCascadeUI(options: DailyCascadeMenuOptions = {}): void {
  const state = getDailyCascadeState()
  const linkedSeed = parseCascadeSeedParam(window.location.search)
  if (linkedSeed !== null) state.setFreeSeed(linkedSeed)

  const modeSelect = document.getElementById('cascade-mode') as HTMLSelectElement | null
  const seedLabel = document.getElementById('cascade-seed-label')
  const randomizeBtn = document.getElementById('cascade-randomize-btn') as HTMLButtonElement | null
  const campaignLabel = document.getElementById('campaign-stage-label')
  if (!modeSelect || !seedLabel || !randomizeBtn) return

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
  }, { signal: options.signal })

  randomizeBtn.addEventListener('click', () => {
    state.randomize()
    refresh()
  }, { signal: options.signal })

  refresh()
  refreshMenu = refresh
  options.signal?.addEventListener('abort', () => {
    if (refreshMenu === refresh) refreshMenu = null
  }, { once: true })
}
