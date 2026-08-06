import { PALETTE } from '../game-elements/visual-language'
import type { PauseMenuHandlers, PauseMenuSettings } from './game-ui-types'
import type { GameUIRuntimeState } from './game-ui'

export function showPauseMenu(
  state: GameUIRuntimeState,
  settings: PauseMenuSettings,
  handlers: PauseMenuHandlers
): void {
  hidePauseMenu(state)
  const overlay = document.getElementById('pause-overlay')
  if (!overlay) return

  const panel = document.createElement('section')
  panel.id = 'pause-menu-panel'
  panel.setAttribute('data-testid', 'pause-menu-panel')
  panel.setAttribute('role', 'dialog')
  panel.setAttribute('aria-modal', 'false')
  panel.setAttribute('aria-label', 'Pause menu')
  panel.tabIndex = 0
  panel.style.cssText = `
    width: min(92vw, 540px);
    max-height: min(86vh, 620px);
    overflow: auto;
    background: rgba(0, 0, 0, 0.92);
    border: 1px solid ${PALETTE.CYAN};
    border-radius: 10px;
    padding: 14px;
    color: ${PALETTE.WHITE};
    font-family: 'Orbitron', sans-serif;
    pointer-events: auto;
    box-shadow: 0 0 18px ${PALETTE.CYAN};
  `

  const quality = settings.qualityPreset
  panel.innerHTML = `
    <h2 style="margin:0 0 8px;color:${PALETTE.CYAN};font-size:1.2rem;">PAUSED</h2>
    <div style="display:flex;gap:8px;margin-bottom:12px;">
      <button type="button" data-testid="pause-resume-btn" data-action="resume" style="margin:0;flex:1;border-color:${PALETTE.CYAN};color:${PALETTE.CYAN};">Resume</button>
      <button type="button" data-action="restart" style="margin:0;flex:1;border-color:${PALETTE.GOLD};color:${PALETTE.GOLD};">Restart Run</button>
    </div>
    <label style="display:flex;flex-direction:column;gap:4px;margin:8px 0;">
      <span>Master Volume</span>
      <input data-testid="pause-master-volume" type="range" min="0" max="1" step="0.05" value="${settings.masterVolume.toFixed(2)}" />
    </label>
    <label style="display:flex;align-items:center;gap:8px;margin:8px 0;">
      <input type="checkbox" data-setting="shakeEnabled" ${settings.shakeEnabled ? 'checked' : ''} />
      <span>Screen Shake</span>
    </label>
    <label style="display:flex;align-items:center;gap:8px;margin:8px 0;">
      <input type="checkbox" data-setting="scanlinesEnabled" ${settings.scanlinesEnabled ? 'checked' : ''} />
      <span>Scanlines</span>
    </label>
    <label style="display:flex;flex-direction:column;gap:4px;margin:8px 0;">
      <span>Quality</span>
      <select data-setting="qualityPreset">
        <option value="low" ${quality === 'low' ? 'selected' : ''}>Low</option>
        <option value="medium" ${quality === 'medium' ? 'selected' : ''}>Medium</option>
        <option value="high" ${quality === 'high' ? 'selected' : ''}>High</option>
      </select>
    </label>
    <label style="display:flex;align-items:center;gap:8px;margin:8px 0;">
      <input data-testid="pause-reduced-motion" type="checkbox" data-setting="reducedMotion" ${settings.reducedMotion ? 'checked' : ''} />
      <span>Reduce Motion</span>
    </label>
    <label style="display:flex;align-items:center;gap:8px;margin:8px 0;">
      <input type="checkbox" data-setting="photosensitiveMode" ${settings.photosensitiveMode ? 'checked' : ''} />
      <span>Photosensitive Mode</span>
    </label>
    <label style="display:flex;align-items:center;gap:8px;margin:8px 0;">
      <input type="checkbox" data-setting="hapticsEnabled" ${settings.hapticsEnabled ? 'checked' : ''} />
      <span>Haptics (vibration)</span>
    </label>
    <p style="margin:10px 0 0;color:${PALETTE.AMBIENT};font-size:0.74rem;">ESC resumes • A/Space select • B/Escape back</p>
  `

  overlay.innerHTML = ''
  overlay.appendChild(panel)
  state.pauseMenuPanel = panel

  const next = (): PauseMenuSettings => ({
    masterVolume: parseFloat((panel.querySelector('input[type="range"]') as HTMLInputElement).value),
    shakeEnabled: (panel.querySelector('input[data-setting="shakeEnabled"]') as HTMLInputElement).checked,
    scanlinesEnabled: (panel.querySelector('input[data-setting="scanlinesEnabled"]') as HTMLInputElement).checked,
    qualityPreset: (panel.querySelector('select[data-setting="qualityPreset"]') as HTMLSelectElement).value as PauseMenuSettings['qualityPreset'],
    reducedMotion: (panel.querySelector('input[data-setting="reducedMotion"]') as HTMLInputElement).checked,
    photosensitiveMode: (panel.querySelector('input[data-setting="photosensitiveMode"]') as HTMLInputElement).checked,
    hapticsEnabled: (panel.querySelector('input[data-setting="hapticsEnabled"]') as HTMLInputElement).checked,
  })

  panel.querySelector('[data-action="resume"]')?.addEventListener('click', handlers.onResume)
  panel.querySelector('[data-action="restart"]')?.addEventListener('click', handlers.onRestart)

  panel.querySelector('input[type="range"]')?.addEventListener('input', () => handlers.onSettingsChange(next()))
  panel.querySelectorAll('input[data-setting],select[data-setting]').forEach((el) => {
    el.addEventListener('change', () => handlers.onSettingsChange(next()))
  })

  const keyHandler = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      handlers.onResume()
    }
  }
  window.addEventListener('keydown', keyHandler)
  panel.setAttribute('data-key-handler', 'active')
  ;(panel as HTMLElement & { __pauseKeyHandler?: (event: KeyboardEvent) => void }).__pauseKeyHandler = keyHandler

  requestAnimationFrame(() => panel.focus())
}

export function hidePauseMenu(state: GameUIRuntimeState): void {
  if (!state.pauseMenuPanel) return
  const typed = state.pauseMenuPanel as HTMLElement & { __pauseKeyHandler?: (event: KeyboardEvent) => void }
  if (typed.__pauseKeyHandler) {
    window.removeEventListener('keydown', typed.__pauseKeyHandler)
  }
  state.pauseMenuPanel.remove()
  state.pauseMenuPanel = null
}
