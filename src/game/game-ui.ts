// src/game/game-ui.ts
import type { Scene } from '@babylonjs/core'

export interface PopupConfig {
  duration?: number
  fadeIn?: number
  fadeOut?: number
}

export interface HUDData {
  score: number
  lives: number
  combo?: number
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

export class GameUIManager {
  // private _scene: Scene // UNUSED
  private activePopups: Map<string, HTMLElement> = new Map()
  private hudElements: Map<string, HTMLElement> = new Map()
  private goldBallCounter: HTMLElement | null = null
  private loadingOverlay: HTMLElement | null = null

  // HUD element references (bound from game.ts UI bindings)
  private scoreElement: HTMLElement | null = null
  private livesElement: HTMLElement | null = null
  private comboElement: HTMLElement | null = null
  private bestHudElement: HTMLElement | null = null

  constructor(scene: Scene) {
    // this._scene = scene // UNUSED
    void scene
    this.bindHUDElements()
  }

  /**
   * Bind to existing HUD elements in the DOM
   */
  private bindHUDElements(): void {
    this.scoreElement = document.getElementById('score')
    this.livesElement = document.getElementById('lives')
    this.comboElement = document.getElementById('combo')
    this.bestHudElement = document.getElementById('best')
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
  showLoadingState(show: boolean, phase?: 'gameplay' | 'cosmetic'): void {
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
      if (phase === 'gameplay') {
        this.loadingOverlay.textContent = 'LOADING GAMEPLAY...'
      } else if (phase === 'cosmetic') {
        this.loadingOverlay.textContent = 'LOADING POLISH...'
      } else {
        // Fade out and remove
        this.loadingOverlay.style.transition = 'opacity 0.5s'
        this.loadingOverlay.style.opacity = '0'
        setTimeout(() => {
          this.loadingOverlay?.remove()
          this.loadingOverlay = null
        }, 500)
      }
    }
  }

  // ==================== HUD METHODS ====================

  /**
   * Update the main HUD display with score, lives, combo, and best score
   */
  updateHUD(data: HUDData): void {
    if (this.scoreElement) this.scoreElement.textContent = String(data.score)
    if (this.livesElement) this.livesElement.textContent = String(data.lives)
    if (this.comboElement) this.comboElement.textContent = data.combo && data.combo > 1 ? `Combo ${data.combo}` : ''
    if (this.bestHudElement && data.bestScore !== undefined) {
      this.bestHudElement.textContent = String(data.bestScore)
    }
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
   * Update the adventure mode HUD
   */
  updateAdventureHUD(level: AdventureLevel | null, completionPercent: number): void {
    const hudEl = document.getElementById('adventure-hud')
    if (!hudEl) return

    if (!level) {
      hudEl.classList.add('hidden')
      return
    }

    hudEl.classList.remove('hidden')

    // Update level name
    const levelNameEl = document.getElementById('adventure-level-name')
    if (levelNameEl) levelNameEl.textContent = level.name

    // Update goals
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

    // Update overall progress
    const totalGoals = level.goals.length
    const completedGoals = level.goals.filter(g => g.current >= g.target).length
    const overallPercent = Math.round((completedGoals / totalGoals) * 100)

    const progressFill = document.getElementById('adventure-progress-fill')
    const progressText = document.getElementById('adventure-progress-text')
    if (progressFill) progressFill.style.width = `${overallPercent}%`
    if (progressText) progressText.textContent = `${overallPercent}%`

    // Show completion % badge if rewards are unlocked
    const hasRewards = completionPercent > 0

    // Add reward badge to HUD if not already present
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

  /**
   * Hide the adventure HUD
   */
  hideAdventureHUD(): void {
    const hudEl = document.getElementById('adventure-hud')
    if (hudEl) {
      hudEl.classList.add('hidden')
    }
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
