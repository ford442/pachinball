/**
 * Daily Cascade start-screen UI — mode select, seed label, Randomize.
 */

import {
  getDailyCascadeState,
  type DailyCascadeMode,
} from '../game-elements/daily-cascade-state'

export function bindDailyCascadeUI(): void {
  const modeSelect = document.getElementById('cascade-mode') as HTMLSelectElement | null
  const seedLabel = document.getElementById('cascade-seed-label')
  const randomizeBtn = document.getElementById('cascade-randomize-btn') as HTMLButtonElement | null
  if (!modeSelect || !seedLabel || !randomizeBtn) return

  const state = getDailyCascadeState()

  const refresh = () => {
    modeSelect.value = state.getMode()
    seedLabel.textContent = state.displaySeedLabel()
    const showRandomize = state.getMode() === 'free'
    randomizeBtn.classList.toggle('hidden', !showRandomize)
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
}
