import { GameConfig } from '../config'
import type { ScoringBreakdownSnapshot } from '../game-elements/scoring-breakdown'
import { TIMER_COLORS, PALETTE } from '../game-elements/visual-language'
import type { ScoringBreakdownDisplayOptions } from './game-ui-types'
import type { GameUIRuntimeState } from './game-ui'
function isReducedMotionActive(state: GameUIRuntimeState): boolean {
  return (
    state.prefersReducedMotion ||
    GameConfig.camera.reducedMotion ||
    GameConfig.accessibility.photosensitiveMode
  )
}
function ensureTimerPulseKeyframe(): void {
  if (document.getElementById('campaign-timer-pulse-style')) return
  const style = document.createElement('style')
  style.id = 'campaign-timer-pulse-style'
  style.textContent = `
    @keyframes campaignTimerPulse {
      0%, 100% { opacity: 1; transform: translateX(-50%) scale(1); }
      50%       { opacity: 0.6; transform: translateX(-50%) scale(1.06); }
    }
  `
  document.head.appendChild(style)
}

export function showCabinetPopup(state: GameUIRuntimeState, name: string): void {
  const existing = document.getElementById('cabinet-popup')
  if (existing) existing.remove()

  const popup = document.createElement('div')
  popup.id = 'cabinet-popup'
  popup.innerHTML = `
    <div style="font-size: 0.7rem; opacity: 0.7; margin-bottom: 4px;">CABINET</div>
    <div>${name}</div>
  `
  popup.style.cssText = `
    position: absolute;
    top: 40%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-family: 'Orbitron', sans-serif;
    font-size: 1.5rem;
    font-weight: 700;
    color: #ffffff;
    text-align: center;
    text-shadow: 0 0 20px rgba(255,255,255,0.5);
    pointer-events: none;
    z-index: 100;
    opacity: 0;
    animation: cabinetPopupFade 1.5s ease-out forwards;
    background: rgba(0,0,0,0.7);
    padding: 12px 24px;
    border-radius: 8px;
    border: 1px solid rgba(255,255,255,0.2);
  `

  const style = document.createElement('style')
  style.textContent = `
    @keyframes cabinetPopupFade {
      0% { opacity: 0; transform: translate(-50%, -40%); }
      20% { opacity: 1; transform: translate(-50%, -50%); }
      80% { opacity: 1; transform: translate(-50%, -50%); }
      100% { opacity: 0; transform: translate(-50%, -60%); }
    }
  `
  document.head.appendChild(style)
  document.body.appendChild(popup)
  state.activePopups.set('cabinet', popup)

  setTimeout(() => {
    popup.remove()
    style.remove()
    state.activePopups.delete('cabinet')
  }, 1500)
}

export function showMapNamePopup(state: GameUIRuntimeState, name: string, color: string): void {
  const existing = document.getElementById('map-name-popup')
  if (existing) existing.remove()

  const popup = document.createElement('div')
  popup.id = 'map-name-popup'
  popup.textContent = name
  popup.style.cssText = `
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%) scale(0.8);
    font-family: 'Orbitron', sans-serif;
    font-size: 2.5rem;
    font-weight: 900;
    color: ${color};
    text-shadow:
      0 0 10px ${color},
      0 0 20px ${color},
      0 0 40px ${color},
      2px 0 0 rgba(255,0,0,0.3),
      -2px 0 0 rgba(0,255,255,0.3);
    pointer-events: none;
    z-index: 100;
    opacity: 0;
    transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
    letter-spacing: 4px;
    text-transform: uppercase;
    animation: mapPopupCRT 2s ease-out forwards;
  `

  const style = document.createElement('style')
  style.textContent = `
    @keyframes mapPopupCRT {
      0% {
        opacity: 0;
        transform: translate(-50%, -50%) scale(0.6);
        filter: blur(10px) brightness(3);
      }
      15% {
        opacity: 1;
        transform: translate(-50%, -50%) scale(1.1);
        filter: blur(0) brightness(1.5);
      }
      25% {
        transform: translate(-50%, -50%) scale(1);
        filter: blur(0) brightness(1);
      }
      80% {
        opacity: 1;
        transform: translate(-50%, -50%) scale(1);
      }
      100% {
        opacity: 0;
        transform: translate(-50%, -40%) scale(0.95);
      }
    }
  `
  document.head.appendChild(style)

  const cabinet = document.getElementById('game-cabinet')
  cabinet?.appendChild(popup)
  state.activePopups.set('map', popup)

  requestAnimationFrame(() => {
    popup.style.opacity = '1'
    popup.style.transform = 'translate(-50%, -50%) scale(1)'
  })

  setTimeout(() => {
    popup.remove()
    style.remove()
    state.activePopups.delete('map')
  }, 2000)
}

export function showLoadingState(
  state: GameUIRuntimeState,
  show: boolean,
  _phase?: 'gameplay' | 'cosmetic'
): void {
  if (show) {
    if (!state.loadingOverlay) {
      state.loadingOverlay = document.createElement('div')
      state.loadingOverlay.id = 'loading-overlay'
      state.loadingOverlay.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(0, 0, 0, 0.8);
        color: #00d9ff;
        padding: 20px 40px;
        border-radius: 8px;
        font-family: monospace;
        font-size: 16px;
        z-index: 1000;
        pointer-events: none;
        border: 1px solid #00d9ff;
        box-shadow: 0 0 20px rgba(0, 217, 255, 0.3);
      `
      document.body.appendChild(state.loadingOverlay)
    }
    state.loadingOverlay.textContent = 'LOADING...'
    state.loadingOverlay.style.display = 'block'
  } else if (state.loadingOverlay) {
    state.loadingOverlay.style.transition = 'opacity 0.5s'
    state.loadingOverlay.style.opacity = '0'
    setTimeout(() => {
      state.loadingOverlay?.remove()
      state.loadingOverlay = null
    }, 500)
  }
}

export function showMessage(state: GameUIRuntimeState, message: string, duration = 2000): void {
  const msgEl = document.createElement('div')
  msgEl.textContent = message
  msgEl.style.cssText = `
    position: absolute;
    bottom: 100px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(0,0,0,0.8);
    border: 1px solid #00d9ff;
    border-radius: 4px;
    padding: 10px 20px;
    font-family: 'Orbitron', sans-serif;
    color: #00d9ff;
    z-index: 100;
  `
  document.body.appendChild(msgEl)
  state.activePopups.set('message', msgEl)

  setTimeout(() => {
    msgEl.remove()
    state.activePopups.delete('message')
  }, duration)
}

export function showTrackUnlockToast(state: GameUIRuntimeState, trackName: string, scoreGoal: number): void {
  showMessage(state, `Unlocked: ${trackName} — reach ${scoreGoal.toLocaleString()} pts`, 3500)
}

export function showCampaignIntermission(state: GameUIRuntimeState, clearedTrackName: string): void {
  showMessage(state, `TRACK CLEARED — ${clearedTrackName.toUpperCase()}`, 2800)
}

export function showRewardToast(
  state: GameUIRuntimeState,
  shardsEarned: number,
  totalShards: number,
  unlockedRewards: string[] = []
): void {
  const existing = document.getElementById('campaign-reward-toast')
  existing?.remove()

  const toast = document.createElement('div')
  toast.id = 'campaign-reward-toast'
  toast.setAttribute('data-testid', 'campaign-reward-toast')

  const unlockedText =
    unlockedRewards.length > 0 ? `<div class="campaign-reward-unlocked">Unlocked: ${unlockedRewards.join(', ')}</div>` : ''
  toast.innerHTML = `
    <div class="campaign-reward-earned">+${Math.round(shardsEarned).toLocaleString()} Shards</div>
    <div class="campaign-reward-total">Total: ${Math.round(totalShards).toLocaleString()}</div>
    ${unlockedText}
  `

  const reducedMotion = state.prefersReducedMotion || GameConfig.accessibility.photosensitiveMode
  toast.style.cssText = `
    position: absolute;
    top: 18px;
    right: 20px;
    min-width: 220px;
    background: rgba(0, 0, 0, 0.86);
    border: 1px solid ${PALETTE.GOLD};
    border-radius: 8px;
    padding: 10px 12px;
    color: ${PALETTE.GOLD};
    font-family: 'Orbitron', sans-serif;
    z-index: 210;
    pointer-events: none;
    box-shadow: ${reducedMotion ? 'none' : `0 0 12px ${PALETTE.GOLD}`};
    opacity: 0;
    transform: translateY(-8px);
    transition: opacity 120ms linear, transform 120ms linear;
  `

  const style = document.createElement('style')
  style.id = 'campaign-reward-toast-style'
  style.textContent = `
    #campaign-reward-toast .campaign-reward-earned {
      font-size: 1rem;
      font-weight: 700;
      letter-spacing: 0.4px;
    }
    #campaign-reward-toast .campaign-reward-total {
      margin-top: 2px;
      font-size: 0.78rem;
      color: ${PALETTE.WHITE};
      opacity: 0.9;
    }
    #campaign-reward-toast .campaign-reward-unlocked {
      margin-top: 6px;
      font-size: 0.74rem;
      color: ${PALETTE.CYAN};
    }
  `

  if (!document.getElementById(style.id)) {
    document.head.appendChild(style)
  } else {
    style.remove()
  }

  document.getElementById('game-cabinet')?.appendChild(toast)
  state.activePopups.set('campaign-reward', toast)

  requestAnimationFrame(() => {
    toast.style.opacity = '1'
    toast.style.transform = 'translateY(0)'
  })

  const dismissDelay = unlockedRewards.length > 0 ? 3200 : 2200
  setTimeout(() => {
    toast.style.opacity = '0'
    toast.style.transform = reducedMotion ? 'translateY(0)' : 'translateY(-6px)'
    setTimeout(() => {
      toast.remove()
      state.activePopups.delete('campaign-reward')
    }, 180)
  }, dismissDelay)
}

export function showPortalOverlay(
  state: GameUIRuntimeState,
  kind: 'success' | 'timeout',
  trackId: string,
  autoDismissMs = 3500
): void {
  const existingOverlay = document.getElementById('campaign-portal-overlay')
  if (existingOverlay) {
    existingOverlay.remove()
    state.activePopups.delete('portal-overlay')
  }

  const overlay = document.createElement('div')
  overlay.id = 'campaign-portal-overlay'

  const reducedMotion = isReducedMotionActive(state)
  const isSuccess = kind === 'success'
  const headline = isSuccess ? 'PORTAL OPEN' : 'TIME OUT — ESCAPE'
  const subtitle = trackId.replace(/_/g, ' ')
  const accentColor = isSuccess ? '#00d9ff' : '#ff4400'
  const subColor = isSuccess ? '#aaffee' : '#ffaa88'
  const headlineGlow = reducedMotion
    ? `0 0 8px ${accentColor}`
    : `0 0 18px ${accentColor}, 0 0 40px ${accentColor},
                   2px 0 0 rgba(255,0,0,0.25), -2px 0 0 rgba(0,255,255,0.25)`

  overlay.innerHTML = `
    <div class="cpo-headline" data-testid="campaign-portal-headline" style="
      font-family: 'Orbitron', monospace;
      font-size: clamp(1.8rem, 5vw, 3.2rem);
      font-weight: 900;
      letter-spacing: 6px;
      text-transform: uppercase;
      color: ${accentColor};
      text-shadow: ${headlineGlow};
    ">${headline}</div>
    <div class="cpo-subtitle" style="
      margin-top: 10px;
      font-family: 'Orbitron', monospace;
      font-size: clamp(0.9rem, 2vw, 1.3rem);
      letter-spacing: 3px;
      color: ${subColor};
      opacity: 0.85;
    ">${subtitle}</div>
  `
  overlay.style.cssText = `
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    z-index: 200;
    animation: ${reducedMotion ? 'none' : 'cpoFadeIn 0.35s ease-out forwards'};
    opacity: ${reducedMotion ? '1' : ''};
  `

  if (!document.getElementById('campaign-portal-overlay-style')) {
    const style = document.createElement('style')
    style.id = 'campaign-portal-overlay-style'
    style.textContent = `
      @keyframes cpoFadeIn {
        from { opacity: 0; transform: scale(0.92); }
        to   { opacity: 1; transform: scale(1); }
      }
      @keyframes cpoFadeOut {
        from { opacity: 1; }
        to   { opacity: 0; }
      }
    `
    document.head.appendChild(style)
  }

  document.getElementById('game-cabinet')?.appendChild(overlay)
  state.activePopups.set('portal-overlay', overlay)

  setTimeout(() => hidePortalOverlay(state), autoDismissMs)
}

export function hidePortalOverlay(state: GameUIRuntimeState): void {
  const existing = document.getElementById('campaign-portal-overlay')
  if (!existing) return
  existing.style.animation = 'cpoFadeOut 0.3s ease-in forwards'
  setTimeout(() => {
    existing.remove()
    state.activePopups.delete('portal-overlay')
  }, 300)
}

export function showScoringBreakdown(
  state: GameUIRuntimeState,
  snapshot: ScoringBreakdownSnapshot,
  options: ScoringBreakdownDisplayOptions = {}
): void {
  hideScoringBreakdown(state)

  const panel = document.createElement('section')
  panel.id = 'scoring-breakdown-panel'
  panel.setAttribute('data-testid', 'scoring-breakdown-panel')
  panel.setAttribute('role', 'dialog')
  panel.setAttribute('aria-modal', 'false')
  panel.setAttribute('aria-label', 'Scoring breakdown')
  panel.tabIndex = 0

  const rows = [
    { label: 'Bumpers', value: snapshot.bumpers, color: PALETTE.CYAN },
    { label: 'Special Obstacles', value: snapshot.specialObstacles, color: PALETTE.MAGENTA },
    { label: 'Gold Balls', value: snapshot.goldBalls, color: PALETTE.GOLD },
    { label: 'Combo Bonus', value: snapshot.comboBonus, color: PALETTE.GOLD },
    { label: 'Time / Goal Bonus', value: snapshot.timeGoalBonus, color: PALETTE.MATRIX },
    { label: 'Jackpot / Slot', value: snapshot.premiumBonus, color: PALETTE.PURPLE },
  ]

  const rowHtml = rows.map((row) => `
    <div style="display:flex;justify-content:space-between;gap:16px;margin:4px 0;">
      <span style="color:${row.color};">${row.label}</span>
      <strong>${Math.round(row.value).toLocaleString()}</strong>
    </div>
  `).join('')

  const finalScore = options.finalScore ?? snapshot.total
  const bestDelta = Math.max(0, options.bestDelta ?? 0)
  const rewardShards = Math.max(0, options.rewardShards ?? 0)
  const finalScoreLine = finalScore !== snapshot.total
    ? `<div style="display:flex;justify-content:space-between;gap:16px;margin-top:6px;">
        <span style="color:${PALETTE.WHITE};opacity:0.85;">Final Score</span>
        <strong>${Math.round(finalScore).toLocaleString()}</strong>
      </div>`
    : ''
  const bestLine = bestDelta > 0
    ? `<div style="margin-top:6px;color:${PALETTE.GOLD};font-size:0.82rem;">NEW BEST +${bestDelta.toLocaleString()}</div>`
    : options.bestScore !== undefined
      ? `<div style="margin-top:6px;color:${PALETTE.WHITE};opacity:0.75;font-size:0.78rem;">Best: ${options.bestScore.toLocaleString()}</div>`
      : ''
  const rewardLine = rewardShards > 0
    ? `<div style="display:flex;justify-content:space-between;gap:16px;margin-top:6px;">
        <span style="color:${PALETTE.GOLD};">Reward Shards</span>
        <strong>${rewardShards.toLocaleString()}</strong>
      </div>`
    : ''

  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;">
      <h3 style="margin:0;color:${PALETTE.CYAN};font-size:1rem;letter-spacing:1.2px;">SCORE BREAKDOWN</h3>
      <button type="button" aria-label="Dismiss scoring breakdown" data-testid="scoring-breakdown-dismiss" style="
        margin:0;
        padding:2px 8px;
        border:1px solid ${PALETTE.CYAN};
        color:${PALETTE.CYAN};
        background:transparent;
        font-size:0.74rem;
        cursor:pointer;
      ">DISMISS</button>
    </div>
    <div style="margin-top:8px;">${rowHtml}</div>
    ${rewardLine}
    <hr style="border:none;border-top:1px solid ${PALETTE.AMBIENT};margin:10px 0 6px;" />
    <div style="display:flex;justify-content:space-between;gap:16px;" data-testid="scoring-breakdown-total">
      <span style="color:${PALETTE.WHITE};font-weight:700;">Grand Total</span>
      <strong>${Math.round(snapshot.total).toLocaleString()}</strong>
    </div>
    ${finalScoreLine}
    ${bestLine}
    <div style="margin-top:6px;color:${PALETTE.WHITE};opacity:0.62;font-size:0.74rem;">Press ESC or SPACE to close</div>
  `

  const reducedMotion = state.prefersReducedMotion || GameConfig.accessibility.photosensitiveMode
  panel.style.cssText = `
    position: absolute;
    top: 18px;
    left: 18px;
    min-width: 300px;
    max-width: 360px;
    background: rgba(0, 0, 0, 0.88);
    border: 1px solid ${PALETTE.CYAN};
    border-radius: 8px;
    padding: 12px;
    color: ${PALETTE.WHITE};
    font-family: 'Orbitron', sans-serif;
    z-index: 240;
    box-shadow: ${reducedMotion ? 'none' : `0 0 12px ${PALETTE.CYAN}`};
    opacity: 0;
    transform: translateY(-6px);
    transition: opacity 120ms linear, transform 120ms linear;
    pointer-events: auto;
  `

  const dismiss = () => hideScoringBreakdown(state)
  panel.querySelector<HTMLButtonElement>('[data-testid="scoring-breakdown-dismiss"]')?.addEventListener('click', dismiss)
  panel.addEventListener('click', dismiss)

  state.scoringBreakdownKeyHandler = (event: KeyboardEvent) => {
    if (event.key === 'Escape' || event.key === ' ') {
      event.preventDefault()
      dismiss()
    }
  }
  window.addEventListener('keydown', state.scoringBreakdownKeyHandler)

  document.getElementById('game-cabinet')?.appendChild(panel)
  state.scoringBreakdownPanel = panel

  requestAnimationFrame(() => {
    panel.style.opacity = '1'
    panel.style.transform = 'translateY(0)'
    panel.focus()
  })

  const autoDismissMs = Math.max(0, options.autoDismissMs ?? 0)
  if (autoDismissMs > 0) {
    window.setTimeout(() => {
      if (state.scoringBreakdownPanel === panel) {
        hideScoringBreakdown(state)
      }
    }, autoDismissMs)
  }
}

export function hideScoringBreakdown(state: GameUIRuntimeState): void {
  if (state.scoringBreakdownKeyHandler) {
    window.removeEventListener('keydown', state.scoringBreakdownKeyHandler)
    state.scoringBreakdownKeyHandler = null
  }
  state.scoringBreakdownPanel?.remove()
  state.scoringBreakdownPanel = null
}

export function updateCountdownTimer(
  state: GameUIRuntimeState,
  secondsRemaining: number,
  timeLimitSeconds: number
): void {
  let timerEl = document.getElementById('campaign-countdown-timer')
  if (!timerEl) {
    timerEl = document.createElement('div')
    timerEl.id = 'campaign-countdown-timer'
    timerEl.style.cssText = `
      position: absolute;
      top: 14px;
      left: 50%;
      transform: translateX(-50%);
      font-family: 'Orbitron', monospace;
      font-size: 1.4rem;
      font-weight: 700;
      letter-spacing: 2px;
      padding: 4px 14px;
      border-radius: 6px;
      background: rgba(0,0,0,0.65);
      border: 1px solid currentColor;
      pointer-events: none;
      z-index: 60;
      text-shadow: 0 0 8px currentColor;
    `
    document.getElementById('game-cabinet')?.appendChild(timerEl)
  }

  const ratio = timeLimitSeconds > 0 ? secondsRemaining / timeLimitSeconds : 0
  const mins = Math.floor(secondsRemaining / 60)
  const secs = Math.floor(secondsRemaining % 60)
  const display = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`

  let color: string
  if (ratio > 0.5) {
    color = TIMER_COLORS.SAFE
  } else if (ratio > 0.3) {
    color = TIMER_COLORS.CAUTION
  } else if (ratio > 0.15) {
    color = TIMER_COLORS.WARNING
  } else {
    color = TIMER_COLORS.DANGER
  }

  timerEl.textContent = `⏱ ${display}`
  timerEl.style.color = color
  timerEl.style.borderColor = color

  if (!isReducedMotionActive(state) && ratio > 0 && ratio <= 0.15) {
    timerEl.style.animation = 'campaignTimerPulse 0.6s ease-in-out infinite'
    ensureTimerPulseKeyframe()
  } else {
    timerEl.style.animation = ''
  }
}

export function hideCountdownTimer(): void {
  document.getElementById('campaign-countdown-timer')?.remove()
}
