// src/game/game-ui.ts
import type { Scene } from '@babylonjs/core'
import { TIMER_COLORS, PALETTE, INTENSITY, pulse } from '../game-elements/visual-language'
import { GameConfig } from '../config'
import type { ScoringBreakdownSnapshot } from '../game-elements/scoring-breakdown'

export interface PopupConfig {
  duration?: number
  fadeIn?: number
  fadeOut?: number
}

export interface HUDData {
  score: number
  lives: number
  ballsInPlay?: number
  combo?: number
  scoreMultiplier?: number
  maxCombo?: number
  bestScore?: number
}

export interface GoldBallCounts {
  goldPlated: number
  solidGold: number
}

export interface AdventureGoal {
  description: string
  current: number
  target: number
}

export interface AdventureLevel {
  name: string
  goals: AdventureGoal[]
}

export interface ScoringBreakdownDisplayOptions {
  finalScore?: number
  bestScore?: number
  bestDelta?: number
  rewardShards?: number
  autoDismissMs?: number
}

export interface PauseMenuSettings {
  masterVolume: number
  shakeEnabled: boolean
  scanlinesEnabled: boolean
  qualityPreset: 'low' | 'medium' | 'high'
  reducedMotion: boolean
  photosensitiveMode: boolean
}

export interface PauseMenuHandlers {
  onResume: () => void
  onRestart: () => void
  onSettingsChange: (next: PauseMenuSettings) => void
}

export class GameUIManager {
  // private _scene: Scene // UNUSED
  private activePopups: Map<string, HTMLElement> = new Map()
  private hudElements: Map<string, HTMLElement> = new Map()
  private goldBallCounter: HTMLElement | null = null
  private loadingOverlay: HTMLElement | null = null

  // HUD element references (bound from game.ts UI bindings)
  private scoreElement: HTMLElement | null = null
  private livesElement: HTMLElement | null = null
  private ballsElement: HTMLElement | null = null
  private comboElement: HTMLElement | null = null
  private bestHudElement: HTMLElement | null = null
  private comboChainMeter: HTMLElement | null = null
  private scoringBreakdownPanel: HTMLElement | null = null
  private scoringBreakdownKeyHandler: ((event: KeyboardEvent) => void) | null = null
  private pauseMenuPanel: HTMLElement | null = null
  private pauseButton: HTMLButtonElement | null = null
  private pauseButtonHandler: (() => void) | null = null

  /**
   * Cached result of the `prefers-reduced-motion` media query.
   * Updated whenever the OS preference changes so we don't re-query the DOM
   * on every animation frame inside updateCountdownTimer.
   */
  private prefersReducedMotion = false

  constructor(scene: Scene) {
    // this._scene = scene // UNUSED
    void scene
    this.bindHUDElements()
    this.initReducedMotionListener()
    this.ensurePauseButton()
  }

  /** Set up a one-time media-query listener so the cached value stays fresh. */
  private initReducedMotionListener(): void {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    this.prefersReducedMotion = mq.matches
    mq.addEventListener('change', (e) => { this.prefersReducedMotion = e.matches })
  }

  /**
   * Bind to existing HUD elements in the DOM
   */
  private bindHUDElements(): void {
    this.scoreElement = document.getElementById('score')
    this.livesElement = document.getElementById('lives')
    this.ballsElement = document.getElementById('balls')
    this.comboElement = document.getElementById('combo')
    this.bestHudElement = document.getElementById('best')
  }

  private ensurePauseButton(): void {
    const cabinet = document.getElementById('game-cabinet')
    if (!cabinet || this.pauseButton) return

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
    button.addEventListener('click', () => this.pauseButtonHandler?.())
    cabinet.appendChild(button)
    this.pauseButton = button
  }

  setPauseButtonHandler(handler: () => void): void {
    this.pauseButtonHandler = handler
  }

  // ==================== POPUP METHODS ====================

  /**
   * Show a cabinet preset popup with fade animation
   */
  showCabinetPopup(name: string): void {
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
    this.activePopups.set('cabinet', popup)

    setTimeout(() => {
      popup.remove()
      style.remove()
      this.activePopups.delete('cabinet')
    }, 1500)
  }

  /**
   * Show a floating map name popup with CRT distortion effect
   */
  showMapNamePopup(name: string, color: string): void {
    // Remove existing popup if any
    const existing = document.getElementById('map-name-popup')
    if (existing) existing.remove()

    // Create popup element
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

    // Add CRT keyframe animation
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

    // Add to game cabinet
    const cabinet = document.getElementById('game-cabinet')
    cabinet?.appendChild(popup)
    this.activePopups.set('map', popup)

    // Animate in
    requestAnimationFrame(() => {
      popup.style.opacity = '1'
      popup.style.transform = 'translate(-50%, -50%) scale(1)'
    })

    // Remove after animation
    setTimeout(() => {
      popup.remove()
      style.remove()
      this.activePopups.delete('map')
    }, 2000)
  }

  /**
   * Show or hide the loading state overlay
   */
   
  showLoadingState(show: boolean, _phase?: 'gameplay' | 'cosmetic'): void {
    if (show) {
      if (!this.loadingOverlay) {
        this.loadingOverlay = document.createElement('div')
        this.loadingOverlay.id = 'loading-overlay'
        this.loadingOverlay.style.cssText = `
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
        document.body.appendChild(this.loadingOverlay)
      }
      this.loadingOverlay.textContent = 'LOADING...'
      this.loadingOverlay.style.display = 'block'
    } else if (this.loadingOverlay) {
      // Fade out and remove
      this.loadingOverlay.style.transition = 'opacity 0.5s'
      this.loadingOverlay.style.opacity = '0'
      setTimeout(() => {
        this.loadingOverlay?.remove()
        this.loadingOverlay = null
      }, 500)
    }
  }

  // ==================== HUD METHODS ====================

  /**
   * Update the main HUD display with score, lives, combo, and best score
   */
  updateHUD(data: HUDData): void {
    if (this.scoreElement) this.scoreElement.textContent = String(data.score)
    if (this.livesElement) this.livesElement.textContent = String(data.lives)
    if (this.ballsElement && data.ballsInPlay !== undefined) this.ballsElement.textContent = String(data.ballsInPlay)
    if (this.comboElement) {
      const comboLabel = data.combo && data.combo > 1 ? `Combo ${data.combo}` : ''
      const multiballLabel = data.scoreMultiplier && data.scoreMultiplier > 1
        ? `MB x${Number(data.scoreMultiplier.toFixed(2)).toString()}`
        : ''
      this.comboElement.textContent = [comboLabel, multiballLabel].filter(Boolean).join(' | ')
    }
    if (this.bestHudElement && data.bestScore !== undefined) {
      this.bestHudElement.textContent = String(data.bestScore)
    }
  }

  updateComboChainMeter(progress: number, target: number, pulseHighlight: boolean): void {
    const safeTarget = Math.max(1, target)
    const clampedProgress = Math.max(0, Math.min(progress, safeTarget))
    let meter = this.comboChainMeter || document.getElementById('combo-chain-meter')

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
      this.comboChainMeter = meter
    }

    const reducedMotion = this.prefersReducedMotion || GameConfig.accessibility.photosensitiveMode
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
   * Update the gold ball counter display
   */
  updateGoldBallDisplay(goldPlated: number, solidGold: number): void {
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
      this.goldBallCounter = counterEl
    }

    counterEl.innerHTML = `
      <div style="font-size: 0.7rem; opacity: 0.7;">COLLECTED</div>
      <div style="display: flex; gap: 10px; margin-top: 5px;">
        <span title="Gold-Plated">🥇 ${goldPlated}</span>
        <span title="Solid Gold">👑 ${solidGold}</span>
      </div>
    `
  }

  /**
   * Update the adventure mode HUD (legacy level-select path).
   */
  updateAdventureHUD(level: AdventureLevel | null, completionPercent: number): void {
    const hudEl = document.getElementById('adventure-hud')
    if (!hudEl) return

    if (!level) {
      hudEl.classList.add('hidden')
      return
    }

    hudEl.classList.remove('hidden')

    const levelNameEl = document.getElementById('adventure-level-name')
    if (levelNameEl) levelNameEl.textContent = level.name

    const goalsEl = document.getElementById('adventure-goals')
    if (goalsEl) {
      goalsEl.innerHTML = level.goals.map(goal => {
        const completed = goal.current >= goal.target
        const percent = Math.min(100, Math.round((goal.current / goal.target) * 100))
        return `
          <div class="adventure-goal ${completed ? 'completed' : ''}">
            <span class="adventure-goal-text">${goal.description}</span>
            <span class="adventure-goal-progress">${percent}%</span>
          </div>
        `
      }).join('')
    }

    const totalGoals = level.goals.length
    const completedGoals = level.goals.filter(g => g.current >= g.target).length
    const overallPercent = Math.round((completedGoals / totalGoals) * 100)

    const progressFill = document.getElementById('adventure-progress-fill')
    const progressText = document.getElementById('adventure-progress-text')
    if (progressFill) progressFill.style.width = `${overallPercent}%`
    if (progressText) progressText.textContent = `${overallPercent}%`

    const hasRewards = completionPercent > 0
    let rewardBadge = hudEl.querySelector('.adventure-reward-badge') as HTMLElement
    if (hasRewards && !rewardBadge) {
      rewardBadge = document.createElement('div')
      rewardBadge.className = 'adventure-reward-badge'
      rewardBadge.textContent = '🏆'
      rewardBadge.title = `${Math.round(completionPercent)}% Complete - Rewards Unlocked!`
      hudEl.appendChild(rewardBadge)
    } else if (rewardBadge) {
      rewardBadge.title = `${Math.round(completionPercent)}% Complete - Rewards Unlocked!`
    }
  }

  /** Live campaign track panel — current goal, timer context, next-sector teaser. */
  updateCampaignHUD(state: {
    trackName: string
    modeLabel: string
    scoreCurrent: number
    scoreTarget: number
    timeRemaining: number
    timeLimit: number
    nextTrackName: string | null
    nextTrackGoal: number | null
    goals: Array<{ description: string; current: number; target: number; completed: boolean }>
    shardTotal: number
    campaignPercent: number
  }): void {
    const hudEl = document.getElementById('adventure-hud')
    if (!hudEl) return

    hudEl.classList.remove('hidden')

    const modeBadge = document.getElementById('campaign-mode-badge')
    if (modeBadge) modeBadge.textContent = state.modeLabel

    const levelNameEl = document.getElementById('adventure-level-name')
    if (levelNameEl) levelNameEl.textContent = state.trackName

    const scoreCurrentEl = document.getElementById('campaign-score-current')
    const scoreTargetEl = document.getElementById('campaign-score-target')
    if (scoreCurrentEl) scoreCurrentEl.textContent = Math.round(state.scoreCurrent).toLocaleString()
    if (scoreTargetEl) scoreTargetEl.textContent = state.scoreTarget.toLocaleString()

    const scoreFill = document.getElementById('campaign-score-fill')
    const scorePct = state.scoreTarget > 0
      ? Math.min(100, Math.round((state.scoreCurrent / state.scoreTarget) * 100))
      : 0
    if (scoreFill) scoreFill.style.width = `${scorePct}%`

    const goalsEl = document.getElementById('adventure-goals')
    if (goalsEl) {
      goalsEl.innerHTML = state.goals.map(goal => {
        const percent = goal.target > 0
          ? Math.min(100, Math.round((goal.current / goal.target) * 100))
          : 0
        return `
          <div class="adventure-goal ${goal.completed ? 'completed' : ''}">
            <span class="adventure-goal-text">${goal.description}</span>
            <span class="adventure-goal-progress">${goal.completed ? '✓' : `${percent}%`}</span>
          </div>
        `
      }).join('')
    }

    const nextNameEl = document.getElementById('campaign-next-track-name')
    const nextGoalEl = document.getElementById('campaign-next-track-goal')
    if (nextNameEl) {
      nextNameEl.textContent = state.nextTrackName ?? 'Campaign complete'
    }
    if (nextGoalEl) {
      nextGoalEl.textContent = state.nextTrackGoal != null
        ? `· ${state.nextTrackGoal.toLocaleString()} pts`
        : ''
    }

    const progressFill = document.getElementById('adventure-progress-fill')
    const progressText = document.getElementById('adventure-progress-text')
    if (progressFill) progressFill.style.width = `${state.campaignPercent}%`
    if (progressText) progressText.textContent = `${state.campaignPercent}% campaign`

    const shardEl = document.getElementById('campaign-hud-shard-total')
    if (shardEl) shardEl.textContent = Math.round(state.shardTotal).toLocaleString()
  }

  showTrackUnlockToast(trackName: string, scoreGoal: number): void {
    this.showMessage(`Unlocked: ${trackName} — reach ${scoreGoal.toLocaleString()} pts`, 3500)
  }

  showCampaignIntermission(clearedTrackName: string): void {
    this.showMessage(`TRACK CLEARED — ${clearedTrackName.toUpperCase()}`, 2800)
  }

  /**
   * Show a temporary message popup
   */
  showMessage(message: string, duration: number = 2000): void {
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
    this.activePopups.set('message', msgEl)

    setTimeout(() => {
      msgEl.remove()
      this.activePopups.delete('message')
    }, duration)
  }

  showRewardToast(shardsEarned: number, totalShards: number, unlockedRewards: string[] = []): void {
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

    const reducedMotion = this.prefersReducedMotion || GameConfig.accessibility.photosensitiveMode
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
    this.activePopups.set('campaign-reward', toast)

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
        this.activePopups.delete('campaign-reward')
      }, 180)
    }, dismissDelay)
  }

  /**
   * Hide the adventure HUD
   */
  hideAdventureHUD(): void {
    const hudEl = document.getElementById('adventure-hud')
    if (hudEl) {
      hudEl.classList.add('hidden')
    }
  }

  // ==================== COUNTDOWN TIMER ====================

  /**
   * Update (or create) the campaign countdown timer HUD element.
   *
   * The timer color shifts from green → yellow → orange → red as time runs out:
   *   > 50 %: green   (#00d9ff → #00ff88)
   *   30–50 %: yellow (#ffe600)
   *   15–30 %: orange (#ff8800)
   *   < 15 %: red     (#ff2200)  — also pulses to signal urgency
   *
   * @param secondsRemaining  Seconds left on the current track timer.
   * @param timeLimitSeconds  Total time limit for the current track.
   */
  private isReducedMotionActive(): boolean {
    return (
      this.prefersReducedMotion ||
      GameConfig.camera.reducedMotion ||
      GameConfig.accessibility.photosensitiveMode
    )
  }

  updateCountdownTimer(secondsRemaining: number, timeLimitSeconds: number): void {
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

    // Pulse animation when critically low (ratio === 0 means timer expired — no need to pulse).
    // Suppressed when the user has opted in to reduced motion.
    if (!this.isReducedMotionActive() && ratio > 0 && ratio <= 0.15) {
      timerEl.style.animation = 'campaignTimerPulse 0.6s ease-in-out infinite'
      this.ensureTimerPulseKeyframe()
    } else {
      timerEl.style.animation = ''
    }
  }

  /** Ensure the timer-pulse @keyframes rule exists exactly once in the document. */
  private ensureTimerPulseKeyframe(): void {
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

  /**
   * Hide (remove) the countdown timer HUD element.
   * Call this when a track ends or adventure mode exits.
   */
  hideCountdownTimer(): void {
    document.getElementById('campaign-countdown-timer')?.remove()
  }

  // ==================== PORTAL OVERLAY ====================

  /**
   * Show a fullscreen overlay announcing a portal event.
   *
   * @param kind      'success' → "PORTAL OPEN"; 'timeout' → "TIME OUT — ESCAPE"
   * @param trackId   Track identifier shown in the subtitle line.
   * @param autoDismissMs  Auto-hide after this many ms (default 3500).
   */
  showPortalOverlay(kind: 'success' | 'timeout', trackId: string, autoDismissMs = 3500): void {
    // Synchronously remove any existing overlay so the new one is unambiguously
    // the only #campaign-portal-overlay in the DOM (avoids duplicate-id querySelector
    // ambiguity when called before the prior async fade-out completes).
    const existingOverlay = document.getElementById('campaign-portal-overlay')
    if (existingOverlay) {
      existingOverlay.remove()
      this.activePopups.delete('portal-overlay')
    }

    const overlay = document.createElement('div')
    overlay.id = 'campaign-portal-overlay'

    const reducedMotion = this.isReducedMotionActive()
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

    // Inject shared keyframe animations once (no color values — those are inline)
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
    this.activePopups.set('portal-overlay', overlay)

    setTimeout(() => this.hidePortalOverlay(), autoDismissMs)
  }

  /**
   * Immediately remove the portal overlay (if present).
   */
  hidePortalOverlay(): void {
    const existing = document.getElementById('campaign-portal-overlay')
    if (!existing) return
    existing.style.animation = 'cpoFadeOut 0.3s ease-in forwards'
    setTimeout(() => {
      existing.remove()
      this.activePopups.delete('portal-overlay')
    }, 300)
  }

  showScoringBreakdown(snapshot: ScoringBreakdownSnapshot, options: ScoringBreakdownDisplayOptions = {}): void {
    this.hideScoringBreakdown()

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

    const reducedMotion = this.prefersReducedMotion || GameConfig.accessibility.photosensitiveMode
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

    const dismiss = () => this.hideScoringBreakdown()
    panel.querySelector<HTMLButtonElement>('[data-testid="scoring-breakdown-dismiss"]')?.addEventListener('click', dismiss)
    panel.addEventListener('click', dismiss)

    this.scoringBreakdownKeyHandler = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === ' ') {
        event.preventDefault()
        dismiss()
      }
    }
    window.addEventListener('keydown', this.scoringBreakdownKeyHandler)

    document.getElementById('game-cabinet')?.appendChild(panel)
    this.scoringBreakdownPanel = panel

    requestAnimationFrame(() => {
      panel.style.opacity = '1'
      panel.style.transform = 'translateY(0)'
      panel.focus()
    })

    const autoDismissMs = Math.max(0, options.autoDismissMs ?? 0)
    if (autoDismissMs > 0) {
      window.setTimeout(() => {
        if (this.scoringBreakdownPanel === panel) {
          this.hideScoringBreakdown()
        }
      }, autoDismissMs)
    }
  }

  hideScoringBreakdown(): void {
    if (this.scoringBreakdownKeyHandler) {
      window.removeEventListener('keydown', this.scoringBreakdownKeyHandler)
      this.scoringBreakdownKeyHandler = null
    }
    this.scoringBreakdownPanel?.remove()
    this.scoringBreakdownPanel = null
  }

  showPauseMenu(settings: PauseMenuSettings, handlers: PauseMenuHandlers): void {
    this.hidePauseMenu()
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
      <p style="margin:10px 0 0;color:${PALETTE.AMBIENT};font-size:0.74rem;">ESC resumes • A/Space select • B/Escape back</p>
    `

    overlay.innerHTML = ''
    overlay.appendChild(panel)
    this.pauseMenuPanel = panel

    const next = (): PauseMenuSettings => ({
      masterVolume: parseFloat((panel.querySelector('input[type="range"]') as HTMLInputElement).value),
      shakeEnabled: (panel.querySelector('input[data-setting="shakeEnabled"]') as HTMLInputElement).checked,
      scanlinesEnabled: (panel.querySelector('input[data-setting="scanlinesEnabled"]') as HTMLInputElement).checked,
      qualityPreset: (panel.querySelector('select[data-setting="qualityPreset"]') as HTMLSelectElement).value as PauseMenuSettings['qualityPreset'],
      reducedMotion: (panel.querySelector('input[data-setting="reducedMotion"]') as HTMLInputElement).checked,
      photosensitiveMode: (panel.querySelector('input[data-setting="photosensitiveMode"]') as HTMLInputElement).checked,
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

  hidePauseMenu(): void {
    if (!this.pauseMenuPanel) return
    const typed = this.pauseMenuPanel as HTMLElement & { __pauseKeyHandler?: (event: KeyboardEvent) => void }
    if (typed.__pauseKeyHandler) {
      window.removeEventListener('keydown', typed.__pauseKeyHandler)
    }
    this.pauseMenuPanel.remove()
    this.pauseMenuPanel = null
  }

  // ==================== CLEANUP ====================

  dispose(): void {
    // Remove all popups
    for (const popup of this.activePopups.values()) {
      popup.remove()
    }
    this.activePopups.clear()

    // Remove HUD elements from tracking (don't remove the original DOM elements,
    // they are managed by the game's HTML structure)
    this.hudElements.clear()

    // Remove gold ball counter
    this.goldBallCounter?.remove()
    this.goldBallCounter = null

    // Remove campaign-specific HUD elements
    this.hideCountdownTimer()
    this.hidePortalOverlay()
    this.hideScoringBreakdown()
    this.hidePauseMenu()
    this.comboChainMeter?.remove()
    this.comboChainMeter = null
    this.pauseButton?.remove()
    this.pauseButton = null

    // Hide loading state
    if (this.loadingOverlay) {
      this.loadingOverlay.remove()
      this.loadingOverlay = null
    }

    // Clear references
    this.scoreElement = null
    this.livesElement = null
    this.comboElement = null
    this.bestHudElement = null
  }
}
