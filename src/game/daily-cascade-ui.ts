/**
 * Daily Cascade start-screen UI — the machine card (name, traits, seed), mode
 * select, Randomize, share link, and the campaign stage line.
 */

import {
  getDailyCascadeState,
  deriveMachineIdentity,
  parseCascadeParam,
  createCascadeShareUrl,
  type DailyCascadeMode,
  type MachineIdentity,
} from '../cascade'
import { TRACK_CATALOG } from '../adventure/adventure-track-progression'

export interface DailyCascadeMenuOptions {
  getCampaignStageName?: () => string
  /** The machine on offer (null for the vanilla table); fired on every refresh. */
  onMachineChanged?: (identity: MachineIdentity | null) => void
  /** Query string to read `?cascade=` from; defaults to the page URL. */
  search?: string
}

function defaultCampaignStageName(): string {
  return TRACK_CATALOG['NEON_HELIX']?.name ?? 'Neon Helix'
}

const HEADINGS: Record<DailyCascadeMode, string> = {
  vanilla: 'Classic table',
  daily: 'Today’s machine',
  free: 'Free machine',
}

let refreshMenu: (() => void) | null = null

export function refreshDailyCascadeUI(): void {
  refreshMenu?.()
}

/** Apply a `?cascade=daily` / `?cascade=<hex>` share link to the cascade state. */
export function applyCascadeLink(search: string): boolean {
  const link = parseCascadeParam(search)
  if (!link) return false
  const state = getDailyCascadeState()
  if (link.mode === 'daily') state.setMode('daily')
  else state.setFreeSeed(link.seed)
  return true
}

export function bindDailyCascadeUI(options: DailyCascadeMenuOptions = {}): void {
  const modeSelect = document.getElementById('cascade-mode') as HTMLSelectElement | null
  const seedLabel = document.getElementById('cascade-seed-label')
  const randomizeBtn = document.getElementById('cascade-randomize-btn') as HTMLButtonElement | null
  const campaignLabel = document.getElementById('campaign-stage-label')
  const heading = document.getElementById('todays-machine-heading')
  const machineName = document.getElementById('cascade-machine-name')
  const machineTraits = document.getElementById('cascade-machine-traits')
  const shareBtn = document.getElementById('cascade-share-btn') as HTMLButtonElement | null
  if (!modeSelect || !seedLabel || !randomizeBtn) return

  const state = getDailyCascadeState()
  applyCascadeLink(options.search ?? (typeof window !== 'undefined' ? window.location.search : ''))

  const refresh = () => {
    const mode = state.getMode()
    modeSelect.value = mode
    seedLabel.textContent = state.displaySeedLabel()
    randomizeBtn.classList.toggle('hidden', mode !== 'free')
    shareBtn?.classList.toggle('hidden', mode === 'vanilla')
    if (heading) heading.textContent = HEADINGS[mode]

    const layout = state.ensureLayout()
    const identity = layout ? deriveMachineIdentity(layout) : null
    if (machineName) {
      machineName.textContent = identity ? identity.title : ''
      machineName.classList.toggle('hidden', !identity)
      if (identity) machineName.style.setProperty('--machine-hue', String(identity.backbox.hue))
    }
    if (machineTraits) {
      machineTraits.textContent = identity ? identity.descriptor : ''
      machineTraits.classList.toggle('hidden', !identity)
    }
    if (campaignLabel) {
      const stage = options.getCampaignStageName?.() ?? defaultCampaignStageName()
      campaignLabel.textContent = `Campaign: ${stage}`
    }

    // Every refresh notifies (boot, mode change, Randomize): the first one runs
    // before the display exists, and setMachineTheme is idempotent.
    options.onMachineChanged?.(identity)
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

  shareBtn?.addEventListener('click', () => {
    const layout = state.ensureLayout()
    if (!layout) return
    const url = createCascadeShareUrl(layout.seed)
    shareBtn.dataset.url = url
    const done = () => {
      const label = shareBtn.textContent
      shareBtn.textContent = 'Link copied'
      setTimeout(() => {
        shareBtn.textContent = label
      }, 1500)
    }
    navigator.clipboard?.writeText(url).then(done, () => prompt('Share this machine:', url))
  })

  refresh()
  refreshMenu = refresh
}
