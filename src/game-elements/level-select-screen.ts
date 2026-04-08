/**
 * Level Select Screen - Adventure Mode Level Selection UI
 * 
 * Provides a visual level selector for adventure mode with:
 * - Level unlock status display
 * - Progress indicators
 * - Reward previews
 * - Map selection integration
 */

import type { AdventureState, AdventureLevel } from './adventure-state'
import type { TableMapType } from '../shaders/lcd-table'

export interface LevelSelectConfig {
  onLevelSelect: (level: AdventureLevel, mapType: TableMapType) => void
  onClose: () => void
}

export class LevelSelectScreen {
  private container: HTMLElement | null = null
  private config: LevelSelectConfig
  private adventureState: AdventureState
  private isVisible = false

  constructor(config: LevelSelectConfig, adventureState: AdventureState) {
    this.config = config
    this.adventureState = adventureState
  }

  /**
   * Show the level select screen
   */
  show(): void {
    if (this.isVisible) return
    this.isVisible = true

    // Remove existing if any
    this.hide()

    // Create container
    this.container = document.createElement('div')
    this.container.id = 'level-select-screen'
    this.container.className = 'level-select-overlay'
    this.container.innerHTML = this.renderContent()

    // Add to game cabinet
    const cabinet = document.getElementById('game-cabinet')
    cabinet?.appendChild(this.container)

    // Setup event listeners
    this.setupEventListeners()

    // Animate in
    requestAnimationFrame(() => {
      this.container?.classList.add('visible')
    })
  }

  /**
   * Hide the level select screen
   */
  hide(): void {
    if (!this.container) return

    this.container.classList.remove('visible')
    
    setTimeout(() => {
      this.container?.remove()
      this.container = null
      this.isVisible = false
    }, 300)
  }

  /**
   * Toggle visibility
   */
  toggle(): void {
    if (this.isVisible) {
      this.hide()
    } else {
      this.show()
    }
  }

  /**
   * Check if screen is visible
   */
  isShowing(): boolean {
    return this.isVisible
  }

  /**
   * Update progress display
   */
  updateProgress(): void {
    if (!this.container || !this.isVisible) return

    const levels = this.adventureState.getAllLevels()
    const progress = this.adventureState.getProgress()

    levels.forEach(level => {
      const levelEl = this.container?.querySelector(`[data-level-id="${level.id}"]`)
      if (levelEl) {
        const isUnlocked = progress.unlockedMaps.includes(level.mapType)
        const isCompleted = progress.completedLevels.includes(level.id)
        
        levelEl.classList.toggle('unlocked', isUnlocked)
        levelEl.classList.toggle('completed', isCompleted)
        levelEl.classList.toggle('locked', !isUnlocked)

        // Update progress bar
        const progressBar = levelEl.querySelector('.level-progress-bar') as HTMLElement
        if (progressBar) {
          const completion = this.calculateLevelCompletion(level)
          progressBar.style.width = `${completion}%`
        }
      }
    })

    // Update overall progress
    const overallProgress = this.container.querySelector('.overall-progress-fill') as HTMLElement
    const overallText = this.container.querySelector('.overall-progress-text')
    if (overallProgress && overallText) {
      const currentLevel = this.adventureState.getCurrentLevel()
      const completionPercent = currentLevel 
        ? this.adventureState.getCompletionPercent(currentLevel.id)
        : this.calculateOverallCompletion()
      overallProgress.style.width = `${completionPercent}%`
      overallText.textContent = `${Math.round(completionPercent)}%`
    }
  }

  /**
   * Render the level select content
   */
  private renderContent(): string {
    const levels = this.adventureState.getAllLevels()
    const progress = this.adventureState.getProgress()
    const currentLevel = this.adventureState.getCurrentLevel()

    const completionPercent = this.adventureState.getOverallCompletionPercent()

    return `
      <div class="level-select-container">
        <div class="level-select-header">
          <h2>SELECT LEVEL</h2>
          <button class="close-btn" id="level-select-close">×</button>
        </div>
        
        <div class="overall-progress">
          <span class="progress-label">Adventure Progress</span>
          <div class="progress-bar">
            <div class="overall-progress-fill" style="width: ${completionPercent}%"></div>
          </div>
          <span class="overall-progress-text">${Math.round(completionPercent)}%</span>
        </div>

        <div class="levels-grid">
          ${levels.map((level, index) => {
            const isUnlocked = progress.unlockedMaps.includes(level.mapType)
            const isCompleted = progress.completedLevels.includes(level.id)
            const isCurrent = currentLevel?.id === level.id
            const levelCompletion = this.calculateLevelCompletion(level)

            return `
              <div class="level-card ${isUnlocked ? 'unlocked' : 'locked'} ${isCompleted ? 'completed' : ''} ${isCurrent ? 'current' : ''}"
                   data-level-id="${level.id}"
                   data-map-type="${level.mapType}">
                <div class="level-number">${index + 1}</div>
                <div class="level-info">
                  <div class="level-name">${level.name}</div>
                  <div class="level-map">${this.formatMapName(level.mapType)}</div>
                  ${isUnlocked ? `
                    <div class="level-progress">
                      <div class="level-progress-bar" style="width: ${levelCompletion}%"></div>
                    </div>
                  ` : `
                    <div class="level-locked-hint">🔒 Complete previous level</div>
                  `}
                </div>
                ${isCompleted ? '<div class="level-complete-badge">✓</div>' : ''}
                ${this.renderRewards(level)}
              </div>
            `
          }).join('')}
        </div>

        <div class="level-select-footer">
          <div class="completion-reward ${completionPercent >= 100 ? 'unlocked' : ''}">
            <span class="reward-icon">🏆</span>
            <span class="reward-text">${completionPercent >= 100 ? 'Master of the Cascade!' : 'Complete all levels to unlock'}</span>
          </div>
        </div>
      </div>

      <style>
        .level-select-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.85);
          backdrop-filter: blur(10px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          opacity: 0;
          transition: opacity 0.3s ease;
          padding: 20px;
        }

        .level-select-overlay.visible {
          opacity: 1;
        }

        .level-select-container {
          background: linear-gradient(135deg, #0a0a1a 0%, #1a1a2e 100%);
          border: 2px solid #00d9ff;
          border-radius: 16px;
          padding: 24px;
          max-width: 800px;
          width: 100%;
          max-height: 90vh;
          overflow-y: auto;
          box-shadow: 
            0 0 40px rgba(0, 217, 255, 0.3),
            inset 0 0 60px rgba(0, 217, 255, 0.05);
        }

        .level-select-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
          border-bottom: 1px solid rgba(0, 217, 255, 0.3);
          padding-bottom: 16px;
        }

        .level-select-header h2 {
          margin: 0;
          font-family: 'Orbitron', sans-serif;
          color: #00d9ff;
          text-shadow: 0 0 20px rgba(0, 217, 255, 0.5);
          letter-spacing: 4px;
        }

        .close-btn {
          background: none;
          border: none;
          color: #00d9ff;
          font-size: 28px;
          cursor: pointer;
          width: 40px;
          height: 40px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          transition: all 0.2s;
        }

        .close-btn:hover {
          background: rgba(0, 217, 255, 0.2);
          transform: scale(1.1);
        }

        .overall-progress {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 24px;
          padding: 12px 16px;
          background: rgba(0, 0, 0, 0.3);
          border-radius: 8px;
        }

        .progress-label {
          color: #888;
          font-size: 0.85rem;
          white-space: nowrap;
        }

        .progress-bar {
          flex: 1;
          height: 8px;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 4px;
          overflow: hidden;
        }

        .overall-progress-fill {
          height: 100%;
          background: linear-gradient(90deg, #00d9ff, #ff00ff);
          border-radius: 4px;
          transition: width 0.5s ease;
        }

        .overall-progress-text {
          color: #00d9ff;
          font-weight: bold;
          font-family: 'Orbitron', sans-serif;
          min-width: 40px;
          text-align: right;
        }

        .levels-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
          gap: 12px;
          margin-bottom: 20px;
        }

        .level-card {
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 12px;
          padding: 16px;
          cursor: pointer;
          transition: all 0.2s;
          position: relative;
          display: flex;
          gap: 12px;
        }

        .level-card:hover:not(.locked) {
          background: rgba(0, 217, 255, 0.1);
          border-color: #00d9ff;
          transform: translateY(-2px);
          box-shadow: 0 4px 20px rgba(0, 217, 255, 0.2);
        }

        .level-card.current {
          border-color: #ffd700;
          box-shadow: 0 0 20px rgba(255, 215, 0, 0.3);
        }

        .level-card.completed {
          border-color: #00ff88;
        }

        .level-card.locked {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .level-number {
          width: 36px;
          height: 36px;
          background: linear-gradient(135deg, #00d9ff, #0088aa);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: bold;
          color: #000;
          font-family: 'Orbitron', sans-serif;
          flex-shrink: 0;
        }

        .level-card.locked .level-number {
          background: #444;
          color: #888;
        }

        .level-card.completed .level-number {
          background: linear-gradient(135deg, #00ff88, #008844);
        }

        .level-info {
          flex: 1;
          min-width: 0;
        }

        .level-name {
          font-weight: bold;
          color: #fff;
          margin-bottom: 4px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .level-map {
          font-size: 0.8rem;
          color: #888;
          margin-bottom: 8px;
          text-transform: capitalize;
        }

        .level-progress {
          height: 4px;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 2px;
          overflow: hidden;
        }

        .level-progress-bar {
          height: 100%;
          background: #00d9ff;
          border-radius: 2px;
          transition: width 0.3s ease;
        }

        .level-locked-hint {
          font-size: 0.75rem;
          color: #666;
        }

        .level-complete-badge {
          position: absolute;
          top: 8px;
          right: 8px;
          width: 20px;
          height: 20px;
          background: #00ff88;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #000;
          font-size: 12px;
          font-weight: bold;
        }

        .level-rewards {
          display: flex;
          gap: 4px;
          margin-top: 8px;
        }

        .reward-item {
          font-size: 0.75rem;
          padding: 2px 6px;
          background: rgba(255, 215, 0, 0.2);
          border: 1px solid rgba(255, 215, 0, 0.5);
          border-radius: 4px;
          color: #ffd700;
        }

        .level-select-footer {
          border-top: 1px solid rgba(255, 255, 255, 0.1);
          padding-top: 16px;
          text-align: center;
        }

        .completion-reward {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 12px 20px;
          background: rgba(255, 215, 0, 0.1);
          border: 1px solid rgba(255, 215, 0, 0.3);
          border-radius: 8px;
          opacity: 0.5;
        }

        .completion-reward.unlocked {
          opacity: 1;
          background: rgba(255, 215, 0, 0.2);
          border-color: #ffd700;
          box-shadow: 0 0 20px rgba(255, 215, 0, 0.3);
        }

        .reward-icon {
          font-size: 1.5rem;
        }

        .reward-text {
          color: #ffd700;
          font-weight: bold;
        }
      </style>
    `
  }

  /**
   * Render reward badges for a level
   */
  private renderRewards(level: AdventureLevel): string {
    const rewards: string[] = []
    
    if (level.rewards.scoreMultiplier > 1) {
      rewards.push(`${level.rewards.scoreMultiplier}x Score`)
    }
    if (level.rewards.unlockMap) {
      rewards.push('Unlock Map')
    }

    if (rewards.length === 0) return ''

    return `
      <div class="level-rewards">
        ${rewards.map(r => `<span class="reward-item">${r}</span>`).join('')}
      </div>
    `
  }

  /**
   * Setup event listeners
   */
  private setupEventListeners(): void {
    // Close button
    const closeBtn = this.container?.querySelector('#level-select-close')
    closeBtn?.addEventListener('click', () => {
      this.config.onClose()
      this.hide()
    })

    // Level cards
    const levelCards = this.container?.querySelectorAll('.level-card:not(.locked)')
    levelCards?.forEach(card => {
      card.addEventListener('click', () => {
        const levelId = card.getAttribute('data-level-id')
        const mapType = card.getAttribute('data-map-type') as TableMapType
        
        if (levelId && mapType) {
          const level = this.adventureState.getAllLevels().find(l => l.id === levelId)
          if (level) {
            this.config.onLevelSelect(level, mapType)
            this.hide()
          }
        }
      })
    })

    // Click outside to close
    this.container?.addEventListener('click', (e) => {
      if (e.target === this.container) {
        this.config.onClose()
        this.hide()
      }
    })

    // Escape key to close
    const escHandler = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        this.config.onClose()
        this.hide()
        document.removeEventListener('keydown', escHandler)
      }
    }
    document.addEventListener('keydown', escHandler)
  }

  /**
   * Format map name for display
   */
  private formatMapName(mapType: string): string {
    return mapType.split('-').map(word => 
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ')
  }

  /**
   * Calculate completion percentage for a level
   */
  private calculateLevelCompletion(level: AdventureLevel): number {
    if (!level.goals || level.goals.length === 0) return 0
    
    const totalGoals = level.goals.length
    const completedGoals = level.goals.filter(g => g.current >= g.target).length
    return Math.round((completedGoals / totalGoals) * 100)
  }

  /**
   * Calculate overall completion percentage
   */
  private calculateOverallCompletion(): number {
    const levels = this.adventureState.getAllLevels()
    const progress = this.adventureState.getProgress()
    
    if (levels.length === 0) return 0
    
    const completedCount = progress.completedLevels.length
    return (completedCount / levels.length) * 100
  }
}

// Singleton instance
let levelSelectScreenInstance: LevelSelectScreen | null = null

export function getLevelSelectScreen(
  config: LevelSelectConfig,
  adventureState: AdventureState
): LevelSelectScreen {
  if (!levelSelectScreenInstance) {
    levelSelectScreenInstance = new LevelSelectScreen(config, adventureState)
  } else {
    // Update config if instance exists
    levelSelectScreenInstance['config'] = config
  }
  return levelSelectScreenInstance
}

export function resetLevelSelectScreen(): void {
  levelSelectScreenInstance?.hide()
  levelSelectScreenInstance = null
}
