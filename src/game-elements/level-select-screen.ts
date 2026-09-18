/**
 * Level Select Screen - Adventure Mode Level Selection UI
 * 
 * Provides a visual level selector for adventure mode with:
 * - Level unlock status display
 * - Progress indicators
 * - Reward previews
 * - Map selection integration
 */

import type { AdventureState, AdventureLevel } from '../adventure/adventure-state'
import type { TableMapType } from '../shaders/lcd-table'
import { getCampaignRewardsManager } from '../adventure/campaign-rewards-manager'
import { renderLevelSelectStyles } from './level-select-screen-styles'

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
    const campaignRewards = getCampaignRewardsManager()
    const archiveItems = campaignRewards?.getArchiveState() ?? []
    const totalShards = campaignRewards?.getTotalShards() ?? 0

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

        <div class="campaign-archive" data-testid="campaign-archive-panel">
          <div class="campaign-archive-header">
            <h3>Nexus Archive</h3>
            <span class="campaign-shards" data-testid="campaign-shards-total">${Math.round(totalShards).toLocaleString()} Shards</span>
          </div>
          <div class="campaign-archive-items">
            ${archiveItems.map((item) => `
              <div
                class="campaign-archive-item ${item.unlocked ? 'unlocked' : 'locked'} ${item.equipped ? 'equipped' : ''}"
                data-testid="campaign-reward-item-${item.id}"
                data-reward-id="${item.id}"
              >
                <div class="campaign-archive-item-title">${item.name}</div>
                <div class="campaign-archive-item-meta">
                  <span>${item.type.replace('-', ' ')}</span>
                  <span>${item.shardCost.toLocaleString()} shards</span>
                </div>
                <div class="campaign-archive-item-desc">${item.description}</div>
                <div class="campaign-archive-item-state">
                  ${item.unlocked
                    ? (item.equipped
                        ? '<span class="campaign-state-badge">Equipped</span>'
                        : '<button class="campaign-equip-btn" data-reward-id="' + item.id + '">Equip</button>')
                    : '<span class="campaign-state-locked">Locked · Needs ' + item.remainingShards.toLocaleString() + ' more shards</span>'}
                </div>
              </div>
            `).join('')}
          </div>
        </div>

        <div class="level-select-footer">
          <div class="completion-reward ${completionPercent >= 100 ? 'unlocked' : ''}">
            <span class="reward-icon">🏆</span>
            <span class="reward-text">${completionPercent >= 100 ? 'Master of the Cascade!' : 'Complete all levels to unlock'}</span>
          </div>
        </div>
      </div>

${renderLevelSelectStyles()}
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

    const rewardButtons = this.container?.querySelectorAll('.campaign-equip-btn')
    rewardButtons?.forEach((button) => {
      button.addEventListener('click', (event) => {
        event.stopPropagation()
        const target = event.currentTarget as HTMLElement
        const rewardId = target.getAttribute('data-reward-id')
        if (!rewardId) return
        const campaignRewards = getCampaignRewardsManager()
        if (!campaignRewards) return
        if (campaignRewards.equip(rewardId)) {
          this.refreshRewardsPanel()
        }
      })
    })
  }

  private refreshRewardsPanel(): void {
    if (!this.container) return
    this.container.innerHTML = this.renderContent()
    this.setupEventListeners()
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
