import { GameConfig } from '../config'
import { INTENSITY, PALETTE, pulse } from '../game-elements/visual-language'
import type { HUDData } from './game-ui-types'
import type { GameUIRuntimeState } from './game-ui'

/** Set up a one-time media-query listener so the cached value stays fresh. */
export function initPrefersReducedMotionListener(state: GameUIRuntimeState): void {
  if (typeof window === 'undefined') return
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
  state.prefersReducedMotion = mq.matches
  mq.addEventListener('change', (e) => { state.prefersReducedMotion = e.matches })
}

/**
 * Bind to existing HUD elements in the DOM.
 */
export function bindHUDElements(state: GameUIRuntimeState): void {
  state.scoreElement = document.getElementById('score')
  state.livesElement = document.getElementById('lives')
  state.ballsElement = document.getElementById('balls')
  state.comboElement = document.getElementById('combo')
  state.bestHudElement = document.getElementById('best')
}

export function ensurePauseButton(state: GameUIRuntimeState): void {
  const cabinet = document.getElementById('game-cabinet')
  if (!cabinet || state.pauseButton) return

  const button = document.createElement('button')
  button.id = 'pause-touch-button'
  button.type = 'button'
  button.setAttribute('aria-label', 'Pause game')
  button.textContent = 'PAUSE'
  button.style.cssText = `
    position: absolute;
    top: 14px;
    right: 14px;
    margin: 0;
    padding: 8px 12px;
    border: 1px solid ${PALETTE.CYAN};
    border-radius: 8px;
    background: rgba(0, 0, 0, 0.72);
    color: ${PALETTE.CYAN};
    font-family: 'Orbitron', sans-serif;
    font-size: 0.72rem;
    letter-spacing: 1px;
    z-index: 180;
    pointer-events: auto;
    touch-action: manipulation;
  `
  button.addEventListener('click', () => state.pauseButtonHandler?.())
  cabinet.appendChild(button)
  state.pauseButton = button
}

export function setPauseButtonHandler(state: GameUIRuntimeState, handler: () => void): void {
  state.pauseButtonHandler = handler
}

/**
 * Update the main HUD display with score, lives, combo, and best score.
 */
export function updateHUD(state: GameUIRuntimeState, data: HUDData): void {
  if (state.scoreElement) state.scoreElement.textContent = String(data.score)
  if (state.livesElement) state.livesElement.textContent = String(data.lives)
  if (state.ballsElement && data.ballsInPlay !== undefined) state.ballsElement.textContent = String(data.ballsInPlay)
  if (state.comboElement) {
    const comboLabel = data.combo && data.combo > 1 ? `Combo ${data.combo}` : ''
    const multiballLabel = data.scoreMultiplier && data.scoreMultiplier > 1
      ? `MB x${Number(data.scoreMultiplier.toFixed(2)).toString()}`
      : ''
    state.comboElement.textContent = [comboLabel, multiballLabel].filter(Boolean).join(' | ')
  }
  if (state.bestHudElement && data.bestScore !== undefined) {
    state.bestHudElement.textContent = String(data.bestScore)
  }
}

export function updateComboChainMeter(
  state: GameUIRuntimeState,
  progress: number,
  target: number,
  pulseHighlight: boolean
): void {
  const safeTarget = Math.max(1, target)
  const clampedProgress = Math.max(0, Math.min(progress, safeTarget))
  let meter = state.comboChainMeter || document.getElementById('combo-chain-meter')

  if (!meter) {
    meter = document.createElement('div')
    meter.id = 'combo-chain-meter'
    meter.setAttribute('data-testid', 'combo-chain-meter')
    meter.style.cssText = `
      position: absolute;
      top: 54px;
      left: 20px;
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 8px;
      border-radius: 6px;
      font-family: 'Orbitron', sans-serif;
      font-size: 11px;
      color: ${PALETTE.GOLD};
      background: rgba(0, 0, 0, 0.65);
      border: 1px solid ${PALETTE.GOLD};
      z-index: 52;
    `
    document.getElementById('game-cabinet')?.appendChild(meter)
    state.comboChainMeter = meter
  }

  const reducedMotion = state.prefersReducedMotion || GameConfig.accessibility.photosensitiveMode
  const glow = pulseHighlight && !reducedMotion
    ? pulse((typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000, 2.5, INTENSITY.AMBIENT, INTENSITY.HIGH)
    : INTENSITY.AMBIENT

  const pips = Array.from({ length: safeTarget }, (_, idx) => {
    const filled = idx < clampedProgress
    const fillColor = filled ? PALETTE.GOLD : PALETTE.AMBIENT
    const borderColor = filled ? PALETTE.GOLD : PALETTE.CYAN
    return `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${fillColor};border:1px solid ${borderColor};"></span>`
  }).join('')

  meter.innerHTML = `<span>CHAIN</span><span style="display:flex;gap:4px;">${pips}</span><span>x${clampedProgress}</span>`
  meter.style.boxShadow = pulseHighlight && !reducedMotion ? `0 0 ${Math.round(glow * 8)}px ${PALETTE.GOLD}` : 'none'
}

/**
 * Update the gold ball counter display.
 */
export function updateGoldBallDisplay(state: GameUIRuntimeState, goldPlated: number, solidGold: number): void {
  // Create or update gold ball counter UI
  let counterEl = document.getElementById('gold-ball-counter')

  if (!counterEl) {
    counterEl = document.createElement('div')
    counterEl.id = 'gold-ball-counter'
    counterEl.style.cssText = `
      position: absolute;
      top: 60px;
      right: 20px;
      background: rgba(0,0,0,0.7);
      border: 2px solid #ffd700;
      border-radius: 8px;
      padding: 10px;
      font-family: 'Orbitron', sans-serif;
      color: #ffd700;
      z-index: 50;
      font-size: 14px;
    `
    document.getElementById('game-cabinet')?.appendChild(counterEl)
    state.goldBallCounter = counterEl
  }

  counterEl.innerHTML = `
    <div style="font-size: 0.7rem; opacity: 0.7;">COLLECTED</div>
    <div style="display: flex; gap: 10px; margin-top: 5px;">
      <span title="Gold-Plated">🥇 ${goldPlated}</span>
      <span title="Solid Gold">👑 ${solidGold}</span>
    </div>
  `
}
