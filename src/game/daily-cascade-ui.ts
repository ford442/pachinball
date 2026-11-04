/**
 * Start-screen mode select — Vanilla / Daily Cascade / Weekly Machine / Free Play / Campaign —
 * plus the seed label, Randomize, and the campaign stage label.
 *
 * Campaign is a start mode, not a cascade mode: it plays the vanilla table and
 * enters the campaign's current stage once the game starts, so selecting it
 * puts the Daily Cascade state back to vanilla.
 */

import {
  getDailyCascadeState,
  type DailyCascadeMode,
} from '../cascade/daily-cascade-state'
import { TRACK_CATALOG } from '../adventure/adventure-track-progression'

export type StartMode = DailyCascadeMode | 'campaign'

export interface DailyCascadeMenuOptions {
  getCampaignStageName?: () => string
  /** "Table of the week" (#444 Slice D): play the weekly challenge. */
  onWeekly?: () => void
  /** Campaign start-mode flag (owned by the Game). Without it the Campaign option is inert. */
  isCampaignSelected?: () => boolean
  setCampaignSelected?: (selected: boolean) => void
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

  const weeklyBtn = document.getElementById('weekly-btn')
  if (weeklyBtn && options.onWeekly) {
    const onWeekly = options.onWeekly
    weeklyBtn.addEventListener('click', () => onWeekly(), { signal: options.signal })
  }

  const modeSelect = document.getElementById('cascade-mode') as HTMLSelectElement | null
  const seedLabel = document.getElementById('cascade-seed-label')
  const randomizeBtn = document.getElementById('cascade-randomize-btn') as HTMLButtonElement | null
  const campaignLabel = document.getElementById('campaign-stage-label')
  if (!modeSelect || !seedLabel || !randomizeBtn) return

  const stageName = () => options.getCampaignStageName?.() ?? defaultCampaignStageName()
  const startMode = (): StartMode => (options.isCampaignSelected?.() ? 'campaign' : state.getMode())
  const refresh = () => {
    const mode = startMode()
    modeSelect.value = mode
    seedLabel.textContent = mode === 'campaign' ? `Starts at ${stageName()}` : state.displaySeedLabel()
    randomizeBtn.classList.toggle('hidden', mode !== 'free')
    if (campaignLabel) {
      campaignLabel.textContent = `Campaign: ${stageName()}`
    }
  }

  modeSelect.addEventListener('change', () => {
    const mode = modeSelect.value as StartMode
    options.setCampaignSelected?.(mode === 'campaign')
    if (mode === 'campaign') {
      state.setMode('vanilla')
    } else {
      state.setMode(mode)
      if (mode === 'daily') {
        state.applyDailySeed()
      } else if (mode === 'weekly') {
        state.applyWeeklySeed()
      } else if (mode === 'free' && !state.getSeedId().startsWith('free-')) {
        state.randomize()
      }
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
